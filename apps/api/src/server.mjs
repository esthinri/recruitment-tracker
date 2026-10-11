import { createServer } from 'node:http';
import {
  createPublicKey,
  createVerify,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { Pool } from 'pg';

const required = [
  'DATABASE_URL',
  'GOOGLE_CLIENT_IDS',
  'INITIAL_ADMIN_EMAIL',
  'SESSION_SECRET',
];
const missing = required.filter(key => !process.env[key]);
if (missing.length)
  throw new Error(`Missing environment configuration: ${missing.join(', ')}`);
if (process.env.SESSION_SECRET.length < 32)
  throw new Error('SESSION_SECRET must contain at least 32 characters.');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: true }
      : undefined,
});
const clientIds = new Set(
  process.env.GOOGLE_CLIENT_IDS.split(',')
    .map(value => value.trim())
    .filter(Boolean),
);
const adminEmail = process.env.INITIAL_ADMIN_EMAIL.trim().toLowerCase();
const secret = Buffer.from(process.env.SESSION_SECRET);
const port = Number(process.env.PORT || 4000);
let googleKeys;
let googleKeysExpireAt = 0;

function send(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000)
      throw Object.assign(new Error('Request body too large.'), {
        status: 413,
      });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON body.'), { status: 400 });
  }
}

async function getGoogleKeys() {
  if (googleKeys && Date.now() < googleKeysExpireAt) return googleKeys;
  const response = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!response.ok) throw new Error('Could not load Google signing keys.');
  const data = await response.json();
  const maxAge = Number(
    response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] || 300,
  );
  googleKeys = new Map(
    data.keys.map(jwk => [
      jwk.kid,
      createPublicKey({ key: jwk, format: 'jwk' }),
    ]),
  );
  googleKeysExpireAt = Date.now() + Math.min(maxAge, 3600) * 1000;
  return googleKeys;
}

async function verifyGoogleIdToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3)
    throw Object.assign(new Error('Invalid Google credential.'), {
      status: 401,
    });
  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch {
    throw Object.assign(new Error('Invalid Google credential.'), {
      status: 401,
    });
  }
  const key = (await getGoogleKeys()).get(header.kid);
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  verifier.end();
  if (
    header.alg !== 'RS256' ||
    !key ||
    !verifier.verify(key, Buffer.from(parts[2], 'base64url'))
  ) {
    throw Object.assign(new Error('Invalid Google credential signature.'), {
      status: 401,
    });
  }
  const now = Math.floor(Date.now() / 1000);
  if (
    !['accounts.google.com', 'https://accounts.google.com'].includes(
      claims.iss,
    ) ||
    !clientIds.has(claims.aud) ||
    typeof claims.exp !== 'number' ||
    claims.exp <= now ||
    typeof claims.iat !== 'number' ||
    claims.iat > now + 60 ||
    claims.email_verified !== true ||
    typeof claims.sub !== 'string' ||
    typeof claims.email !== 'string'
  ) {
    throw Object.assign(
      new Error(
        'Google credential is expired or not authorized for this application.',
      ),
      { status: 401 },
    );
  }
  return {
    googleSubject: claims.sub,
    email: claims.email.toLowerCase(),
    name: claims.name || claims.email,
  };
}

function signSession(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id,
      role: user.role,
      iat: now,
      exp: now + 8 * 60 * 60,
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

async function authenticate(request) {
  const token = request.headers.authorization?.match(/^Bearer ([\w.-]+)$/)?.[1];
  if (!token)
    throw Object.assign(new Error('Authentication required.'), { status: 401 });
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra)
    throw Object.assign(new Error('Invalid session.'), { status: 401 });
  const expected = createHmac('sha256', secret).update(payload).digest();
  let provided;
  try {
    provided = Buffer.from(signature, 'base64url');
  } catch {
    provided = Buffer.alloc(0);
  }
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  )
    throw Object.assign(new Error('Invalid session.'), { status: 401 });
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    throw Object.assign(new Error('Invalid session.'), { status: 401 });
  }
  if (!claims.sub || claims.exp <= Math.floor(Date.now() / 1000))
    throw Object.assign(new Error('Session expired.'), { status: 401 });
  const { rows } = await pool.query(
    'SELECT id, email, name, role, active FROM users WHERE id = $1',
    [claims.sub],
  );
  if (!rows[0]?.active)
    throw Object.assign(new Error('User is inactive.'), { status: 401 });
  return rows[0];
}

function requireRole(user, roles) {
  if (!roles.includes(user.role))
    throw Object.assign(new Error('Insufficient permission.'), { status: 403 });
}

async function ensureVacancyAccess(user, vacancyId, client = pool) {
  if (user.role === 'ADMIN') return;
  const { rows } = await client.query(
    `SELECT 1 FROM vacancies v WHERE v.id = $1 AND (v.hiring_manager_id = $2 OR v.recruiter_id = $2
      OR EXISTS (SELECT 1 FROM stage_approvers sa JOIN recruitment_stages s ON s.id = sa.stage_id WHERE s.vacancy_id = v.id AND sa.user_id = $2))`,
    [vacancyId, user.id],
  );
  if (!rows.length)
    throw Object.assign(new Error('Vacancy not found or access denied.'), {
      status: 404,
    });
}

async function audit(
  client,
  userId,
  action,
  entityType,
  entityId,
  metadata = {},
) {
  await client.query(
    'INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,$4,$5)',
    [userId, action, entityType, entityId, JSON.stringify(metadata)],
  );
}

function makeId() {
  return randomBytes(16).toString('hex');
}

async function handle(request, response) {
  const url = new URL(
    request.url,
    `http://${request.headers.host || 'localhost'}`,
  );
  if (request.method === 'OPTIONS') {
    const allowedOrigin = process.env.WEB_ORIGIN;
    if (allowedOrigin && request.headers.origin === allowedOrigin) {
      response.writeHead(204, {
        'access-control-allow-origin': allowedOrigin,
        'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
        'access-control-allow-headers': 'authorization,content-type',
        vary: 'Origin',
      });
      return response.end();
    }
    return send(response, 403, { error: 'Origin is not allowed.' });
  }
  if (
    process.env.WEB_ORIGIN &&
    request.headers.origin === process.env.WEB_ORIGIN
  ) {
    response.setHeader('access-control-allow-origin', process.env.WEB_ORIGIN);
    response.setHeader('vary', 'Origin');
  }
  if (request.method === 'GET' && url.pathname === '/health') {
    try {
      await pool.query('SELECT 1');
      return send(response, 200, { status: 'ok' });
    } catch {
      return send(response, 503, { status: 'unavailable' });
    }
  }
  if (request.method === 'POST' && url.pathname === '/auth/google') {
    const body = await readJson(request);
    if (typeof body.credential !== 'string')
      throw Object.assign(new Error('credential is required.'), {
        status: 400,
      });
    const identity = await verifyGoogleIdToken(body.credential);
    const role = identity.email === adminEmail ? 'ADMIN' : 'RECRUITER';
    const { rows } = await pool.query(
      `INSERT INTO users (google_subject, email, name, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (google_subject) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name,
         role = CASE WHEN EXCLUDED.email = $5 THEN 'ADMIN'::user_role
                     WHEN users.role = 'ADMIN'::user_role THEN 'RECRUITER'::user_role
                     ELSE users.role END,
         updated_at = now()
       RETURNING id, email, name, role, active`,
      [identity.googleSubject, identity.email, identity.name, role, adminEmail],
    );
    if (!rows[0].active)
      throw Object.assign(new Error('User is inactive.'), { status: 403 });
    return send(response, 200, { token: signSession(rows[0]), user: rows[0] });
  }

  const user = await authenticate(request);
  if (request.method === 'GET' && url.pathname === '/auth/me')
    return send(response, 200, { user });

  if (request.method === 'GET' && url.pathname === '/users') {
    requireRole(user, ['ADMIN']);
    const { rows } = await pool.query(
      'SELECT id, email, name, role, active, created_at FROM users ORDER BY name LIMIT 500',
    );
    return send(response, 200, { items: rows });
  }

  if (request.method === 'GET' && url.pathname === '/approvers') {
    const { rows } = await pool.query(
      "SELECT id,name FROM users WHERE role='APPROVER' AND active=true ORDER BY name LIMIT 200",
    );
    return send(response, 200, { items: rows });
  }

  if (request.method === 'GET' && url.pathname === '/departments') {
    requireRole(user, ['ADMIN']);
    const { rows } = await pool.query(
      'SELECT id, name FROM departments ORDER BY name',
    );
    return send(response, 200, { items: rows });
  }

  const userRoleMatch = url.pathname.match(/^\/users\/([\w-]+)\/role$/);
  if (request.method === 'PATCH' && userRoleMatch) {
    requireRole(user, ['ADMIN']);
    const body = await readJson(request);
    if (
      !['HIRING_MANAGER', 'RECRUITER', 'APPROVER'].includes(body.role) ||
      typeof body.active !== 'boolean'
    ) {
      throw Object.assign(
        new Error(
          'role must be HIRING_MANAGER, RECRUITER or APPROVER and active must be boolean.',
        ),
        { status: 400 },
      );
    }
    if (userRoleMatch[1] === user.id && !body.active)
      throw Object.assign(
        new Error(
          'The initial administrator cannot deactivate their own account.',
        ),
        { status: 400 },
      );
    if (userRoleMatch[1] === user.id && user.role === 'ADMIN')
      throw Object.assign(new Error('The fixed initial administrator role cannot be changed.'), { status:400 });
    const { rows } = await pool.query(
      'UPDATE users SET role = $1, active = $2 WHERE id = $3 RETURNING id, email, name, role, active',
      [body.role, body.active, userRoleMatch[1]],
    );
    if (!rows[0])
      throw Object.assign(new Error('User not found.'), { status: 404 });
    await pool.query(
      'INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,$4,$5)',
      [
        user.id,
        'user.role_changed',
        'user',
        rows[0].id,
        JSON.stringify({ role: body.role, active: body.active }),
      ],
    );
    return send(response, 200, { user: rows[0] });
  }

  if (request.method === 'POST' && url.pathname === '/departments') {
    requireRole(user, ['ADMIN']);
    const body = await readJson(request);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 120)
      throw Object.assign(
        new Error('A department name up to 120 characters is required.'),
        { status: 400 },
      );
    const id = randomBytes(16).toString('hex');
    const { rows } = await pool.query(
      'INSERT INTO departments (id, name) VALUES ($1,$2) RETURNING id, name',
      [id, name],
    );
    await pool.query(
      'INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,$4,$5)',
      [
        user.id,
        'department.created',
        'department',
        id,
        JSON.stringify({ name }),
      ],
    );
    return send(response, 201, { item: rows[0] });
  }

  if (request.method === 'GET' && url.pathname === '/vacancies') {
    const values = [];
    let scope = '';
    if (user.role !== 'ADMIN') {
      values.push(user.id);
      scope = `AND (v.hiring_manager_id = $1 OR v.recruiter_id = $1)`;
    }
    if (url.searchParams.has('status')) {
      const status = url.searchParams.get('status');
      if (!['DRAFT', 'OPEN', 'PAUSED', 'CLOSED', 'CANCELLED'].includes(status))
        throw Object.assign(new Error('Invalid vacancy status filter.'), {
          status: 400,
        });
      values.push(status);
      scope += ` AND v.status = $${values.length}`;
    }
    const { rows } = await pool.query(
      `SELECT v.id, v.code, v.title, v.status, v.priority, v.opened_at, v.target_close_at,
              v.city, v.state, v.country, v.work_model, v.openings,
              d.name AS department, hm.name AS hiring_manager, rec.name AS recruiter
       FROM vacancies v LEFT JOIN departments d ON d.id = v.department_id
       JOIN users hm ON hm.id = v.hiring_manager_id JOIN users rec ON rec.id = v.recruiter_id
       WHERE true ${scope} ORDER BY v.updated_at DESC LIMIT 100`,
      values,
    );
    return send(response, 200, { items: rows });
  }

  if (request.method === 'POST' && url.pathname === '/vacancies') {
    requireRole(user, ['ADMIN', 'HIRING_MANAGER']);
    const body = await readJson(request);
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const description =
      typeof body.description === 'string' ? body.description.trim() : '';
    const requirements =
      typeof body.requirements === 'string' ? body.requirements.trim() : '';
    const openings = Number(body.openings ?? 1);
    const code =
      typeof body.code === 'string' && body.code.trim()
        ? body.code.trim().toUpperCase()
        : `V-${randomBytes(4).toString('hex').toUpperCase()}`;
    if (
      !title ||
      !description ||
      !requirements ||
      !Number.isInteger(openings) ||
      openings < 1 ||
      openings > 1000
    ) {
      throw Object.assign(
        new Error(
          'title, description, requirements and a valid openings count are required.',
        ),
        { status: 400 },
      );
    }
    const recruiterId =
      typeof body.recruiterId === 'string' ? body.recruiterId : user.id;
    const managerId =
      user.role === 'ADMIN' && typeof body.hiringManagerId === 'string'
        ? body.hiringManagerId
        : user.id;
    const targetCloseAt = body.targetCloseAt
      ? new Date(body.targetCloseAt)
      : null;
    if (targetCloseAt && Number.isNaN(targetCloseAt.getTime()))
      throw Object.assign(new Error('targetCloseAt must be a valid date.'), {
        status: 400,
      });
    const { rows: assignments } = await pool.query(
      'SELECT id, role, active FROM users WHERE id = ANY($1::text[])',
      [[managerId, recruiterId]],
    );
    const manager = assignments.find(person => person.id === managerId);
    const recruiter = assignments.find(person => person.id === recruiterId);
    if (
      !manager?.active ||
      !['ADMIN', 'HIRING_MANAGER'].includes(manager.role) ||
      !recruiter?.active ||
      !['ADMIN', 'HIRING_MANAGER', 'RECRUITER'].includes(recruiter.role)
    ) {
      throw Object.assign(
        new Error(
          'The assigned manager or recruiter is inactive or has an incompatible role.',
        ),
        { status: 400 },
      );
    }
    const { rows } = await pool.query(
      `INSERT INTO vacancies (code, title, description, requirements, department_id, hiring_manager_id, recruiter_id,
         openings, city, state, country, work_model, employment_type, priority, status, opened_at, target_close_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id, code, title, description, requirements, hiring_manager_id, recruiter_id,
         openings, city, state, country, work_model, employment_type, priority, status, opened_at, target_close_at, created_at`,
      [
        code,
        title,
        description,
        requirements,
        body.departmentId || null,
        managerId,
        recruiterId,
        openings,
        body.city || null,
        body.state || null,
        body.country || 'Brasil',
        body.workModel || null,
        body.employmentType || null,
        Number.isInteger(body.priority)
          ? Math.min(5, Math.max(1, body.priority))
          : 3,
        'OPEN',
        new Date(),
        targetCloseAt,
      ],
    );
    const defaultStages = [
      'Triagem de currículo',
      'Entrevista com recrutamento',
      'Entrevista técnica',
      'Entrevista com gestor',
      'Entrevista final',
      'Proposta',
      'Contratado',
    ];
    for (let position = 0; position < defaultStages.length; position++) {
      await pool.query(
        'INSERT INTO recruitment_stages (vacancy_id,name,position) VALUES ($1,$2,$3)',
        [rows[0].id, defaultStages[position], position],
      );
    }
    await pool.query(
      'INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,$4,$5)',
      [
        user.id,
        'vacancy.created',
        'vacancy',
        rows[0].id,
        JSON.stringify({ code, title }),
      ],
    );
    return send(response, 201, { item: rows[0] });
  }

  const vacancyPath = url.pathname.match(/^\/vacancies\/([\w-]+)$/);
  if (request.method === 'PATCH' && vacancyPath) {
    requireRole(user, ['ADMIN','HIRING_MANAGER']);
    await ensureVacancyAccess(user,vacancyPath[1]);
    const body=await readJson(request);
    const allowedStatuses=['DRAFT','OPEN','PAUSED','CLOSED','CANCELLED'];
    if(body.status&&!allowedStatuses.includes(body.status))throw Object.assign(new Error('Invalid vacancy status.'),{status:400});
    if(['CLOSED','CANCELLED'].includes(body.status)&&!String(body.closureReason||'').trim())throw Object.assign(new Error('A closure reason is required to close or cancel a vacancy.'),{status:400});
    if(body.priority!==undefined&&(!Number.isInteger(body.priority)||body.priority<1||body.priority>5))throw Object.assign(new Error('priority must be from 1 to 5.'),{status:400});
    const hasTarget=Object.prototype.hasOwnProperty.call(body,'targetCloseAt');
    const target=body.targetCloseAt?new Date(body.targetCloseAt):null;
    if(target&&Number.isNaN(target.getTime()))throw Object.assign(new Error('targetCloseAt must be a valid date.'),{status:400});
    const {rows}=await pool.query(
      `UPDATE vacancies SET status=COALESCE($1,status),priority=COALESCE($2,priority),
       target_close_at=CASE WHEN $3 THEN $4 ELSE target_close_at END,
       closure_reason=CASE WHEN $1 IN ('CLOSED','CANCELLED') THEN $5 WHEN $1='OPEN' THEN NULL ELSE closure_reason END,
       closed_at=CASE WHEN $1 IN ('CLOSED','CANCELLED') THEN now() WHEN $1='OPEN' THEN NULL ELSE closed_at END
       WHERE id=$6 RETURNING id,code,title,status,priority,target_close_at,closed_at,closure_reason`,
      [body.status||null,body.priority??null,hasTarget,target,body.closureReason||null,vacancyPath[1]],
    );
    await audit(pool,user.id,'vacancy.updated','vacancy',vacancyPath[1],{status:body.status,priority:body.priority,targetCloseAt:body.targetCloseAt});
    return send(response,200,{item:rows[0]});
  }

  const stagesPath = url.pathname.match(/^\/vacancies\/([\w-]+)\/stages$/);
  if (stagesPath && request.method === 'GET') {
    await ensureVacancyAccess(user, stagesPath[1]);
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.description, s.position, s.due_days, s.requires_approval,
              s.approval_mode, s.allow_manual_transition, s.active,
              COALESCE(json_agg(json_build_object('id', u.id, 'name', u.name, 'required', sa.required))
                FILTER (WHERE u.id IS NOT NULL), '[]') AS approvers
       FROM recruitment_stages s LEFT JOIN stage_approvers sa ON sa.stage_id = s.id
       LEFT JOIN users u ON u.id = sa.user_id WHERE s.vacancy_id = $1
       GROUP BY s.id ORDER BY s.position`,
      [stagesPath[1]],
    );
    return send(response, 200, { items: rows });
  }

  if (stagesPath && request.method === 'POST') {
    requireRole(user, ['ADMIN', 'HIRING_MANAGER']);
    await ensureVacancyAccess(user, stagesPath[1]);
    const body = await readJson(request);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const position = Number(body.position);
    if (
      !name ||
      name.length > 120 ||
      !Number.isInteger(position) ||
      position < 0
    ) {
      throw Object.assign(
        new Error('A stage name and non-negative position are required.'),
        { status: 400 },
      );
    }
    const mode = body.approvalMode ?? null;
    if (mode !== null && !['ALL', 'MAJORITY', 'ANY'].includes(mode))
      throw Object.assign(
        new Error('approvalMode must be ALL, MAJORITY or ANY.'),
        { status: 400 },
      );
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const stageId = makeId();
      await client.query(
        `INSERT INTO recruitment_stages (id, vacancy_id, name, description, position, due_days, requires_approval, approval_mode, allow_manual_transition)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          stageId,
          stagesPath[1],
          name,
          body.description || null,
          position,
          body.dueDays || null,
          Boolean(body.requiresApproval),
          mode,
          body.allowManualTransition !== false,
        ],
      );
      const approverIds = [
        ...new Set(
          Array.isArray(body.approverIds)
            ? body.approverIds.filter(id => typeof id === 'string')
            : [],
        ),
      ];
      for (const approverId of approverIds) {
        const { rows } = await client.query(
          "SELECT id FROM users WHERE id=$1 AND role='APPROVER' AND active=true",
          [approverId],
        );
        if (!rows.length)
          throw Object.assign(
            new Error(
              'Every approver must be an active user with the APPROVER role.',
            ),
            { status: 400 },
          );
        await client.query(
          'INSERT INTO stage_approvers (stage_id,user_id,required) VALUES ($1,$2,true)',
          [stageId, approverId],
        );
      }
      if (Boolean(body.requiresApproval) && !approverIds.length)
        throw Object.assign(new Error('At least one approver is required.'), {
          status: 400,
        });
      await audit(client, user.id, 'stage.created', 'stage', stageId, {
        vacancyId: stagesPath[1],
        name,
        position,
      });
      await client.query('COMMIT');
      return send(response, 201, { item: { id: stageId, name, position } });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const stagePath = url.pathname.match(/^\/stages\/([\w-]+)$/);
  if (stagePath && request.method === 'PATCH') {
    requireRole(user, ['ADMIN', 'HIRING_MANAGER']);
    const body = await readJson(request);
    const { rows: existing } = await pool.query(
      'SELECT id,vacancy_id FROM recruitment_stages WHERE id=$1',
      [stagePath[1]],
    );
    if (!existing[0])
      throw Object.assign(new Error('Stage not found.'), { status: 404 });
    await ensureVacancyAccess(user, existing[0].vacancy_id);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 120)
      throw Object.assign(
        new Error('A stage name up to 120 characters is required.'),
        { status: 400 },
      );
    const mode = body.approvalMode || null;
    if (mode !== null && !['ALL', 'MAJORITY', 'ANY'].includes(mode))
      throw Object.assign(
        new Error('approvalMode must be ALL, MAJORITY or ANY.'),
        { status: 400 },
      );
    const { rows } = await pool.query(
      `UPDATE recruitment_stages SET name=$1,description=$2,due_days=$3,requires_approval=$4,
       approval_mode=$5,allow_manual_transition=$6 WHERE id=$7
       RETURNING id,name,description,position,due_days,requires_approval,approval_mode,allow_manual_transition,active`,
      [
        name,
        body.description || null,
        body.dueDays || null,
        Boolean(body.requiresApproval),
        mode,
        body.allowManualTransition !== false,
        stagePath[1],
      ],
    );
    if (Array.isArray(body.approverIds)) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM stage_approvers WHERE stage_id=$1', [
          stagePath[1],
        ]);
        for (const approverId of [...new Set(body.approverIds)]) {
          const { rows: approver } = await client.query(
            "SELECT id FROM users WHERE id=$1 AND role='APPROVER' AND active=true",
            [approverId],
          );
          if (!approver.length)
            throw Object.assign(
              new Error(
                'Approvers must be active users with the APPROVER role.',
              ),
              { status: 400 },
            );
          await client.query(
            'INSERT INTO stage_approvers (stage_id,user_id,required) VALUES ($1,$2,true)',
            [stagePath[1], approverId],
          );
        }
        if (body.requiresApproval && body.approverIds.length === 0)
          throw Object.assign(new Error('At least one approver is required.'), {
            status: 400,
          });
        await audit(client, user.id, 'stage.updated', 'stage', stagePath[1], {
          name,
        });
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } else
      await audit(pool, user.id, 'stage.updated', 'stage', stagePath[1], {
        name,
      });
    return send(response, 200, { item: rows[0] });
  }

  if (stagePath && request.method === 'DELETE') {
    requireRole(user, ['ADMIN', 'HIRING_MANAGER']);
    const { rows: stage } = await pool.query(
      'SELECT id,vacancy_id FROM recruitment_stages WHERE id=$1 AND active=true',
      [stagePath[1]],
    );
    if (!stage[0])
      throw Object.assign(new Error('Active stage not found.'), {
        status: 404,
      });
    await ensureVacancyAccess(user, stage[0].vacancy_id);
    const { rows: current } = await pool.query(
      "SELECT id FROM applications WHERE current_stage_id=$1 AND status='ACTIVE' LIMIT 1",
      [stagePath[1]],
    );
    if (current.length)
      throw Object.assign(
        new Error(
          'Cannot deactivate a stage with active applications. Move candidates first.',
        ),
        { status: 409 },
      );
    await pool.query('UPDATE recruitment_stages SET active=false WHERE id=$1', [
      stagePath[1],
    ]);
    await audit(pool, user.id, 'stage.deactivated', 'stage', stagePath[1]);
    return send(response, 200, { ok: true });
  }

  const reorderPath = url.pathname.match(
    /^\/vacancies\/([\w-]+)\/stages\/reorder$/,
  );
  if (reorderPath && request.method === 'PUT') {
    requireRole(user, ['ADMIN', 'HIRING_MANAGER']);
    await ensureVacancyAccess(user, reorderPath[1]);
    const body = await readJson(request);
    if (
      !Array.isArray(body.stageIds) ||
      body.stageIds.some(id => typeof id !== 'string') ||
      new Set(body.stageIds).size !== body.stageIds.length
    ) {
      throw Object.assign(
        new Error('stageIds must be a unique ordered array.'),
        { status: 400 },
      );
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT id FROM recruitment_stages WHERE vacancy_id=$1 AND active=true',
        [reorderPath[1]],
      );
      if (
        rows.length !== body.stageIds.length ||
        rows.some(({ id }) => !body.stageIds.includes(id))
      )
        throw Object.assign(
          new Error(
            'stageIds must contain every active stage for this vacancy.',
          ),
          { status: 400 },
        );
      await client.query(
        'UPDATE recruitment_stages SET position = -position - 1 WHERE vacancy_id=$1 AND active=true',
        [reorderPath[1]],
      );
      for (let position = 0; position < body.stageIds.length; position++) {
        await client.query(
          'UPDATE recruitment_stages SET position=$1 WHERE id=$2',
          [position, body.stageIds[position]],
        );
      }
      await audit(
        client,
        user.id,
        'stage.reordered',
        'vacancy',
        reorderPath[1],
        { stageIds: body.stageIds },
      );
      await client.query('COMMIT');
      return send(response, 200, { ok: true });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  if (request.method === 'POST' && url.pathname === '/candidates') {
    requireRole(user, ['ADMIN', 'HIRING_MANAGER', 'RECRUITER']);
    const body = await readJson(request);
    const fullName =
      typeof body.fullName === 'string' ? body.fullName.trim() : '';
    const email =
      typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!fullName || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw Object.assign(
        new Error('A full name and valid email are required.'),
        { status: 400 },
      );
    const { rows: duplicates } = await pool.query(
      'SELECT id, full_name, email FROM candidates WHERE lower(email)=lower($1) LIMIT 5',
      [email],
    );
    if (duplicates.length)
      return send(response, 409, {
        error: 'Possible duplicate candidate.',
        matches: duplicates,
      });
    const { rows } = await pool.query(
      `INSERT INTO candidates (id,full_name,email,phone,resume_url,professional_url,city,state,country)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id,full_name,email,phone,resume_url,professional_url,city,state,country,created_at`,
      [
        makeId(),
        fullName,
        email,
        body.phone || null,
        body.resumeUrl || null,
        body.professionalUrl || null,
        body.city || null,
        body.state || null,
        body.country || null,
      ],
    );
    await audit(pool, user.id, 'candidate.created', 'candidate', rows[0].id, {
      email,
    });
    return send(response, 201, { item: rows[0] });
  }

  if (request.method === 'GET' && url.pathname === '/candidates') {
    const search = (url.searchParams.get('q') || '').trim();
    const values = [user.id, `%${search}%`];
    let scope =
      user.role === 'ADMIN'
        ? ''
        : 'AND (v.hiring_manager_id=$1 OR v.recruiter_id=$1 OR EXISTS (SELECT 1 FROM stage_approvers sa JOIN recruitment_stages s ON s.id=sa.stage_id WHERE s.vacancy_id=v.id AND sa.user_id=$1))';
    const { rows } = await pool.query(
      `SELECT DISTINCT c.id,c.full_name,c.email,c.phone,c.resume_url,c.professional_url,c.city,c.state,c.country
       FROM candidates c JOIN applications a ON a.candidate_id=c.id JOIN vacancies v ON v.id=a.vacancy_id
       WHERE (c.full_name ILIKE $2 OR c.email ILIKE $2) ${scope}
       ORDER BY c.full_name LIMIT 100`,
      values,
    );
    return send(response, 200, { items: rows });
  }

  if (request.method === 'POST' && url.pathname === '/applications') {
    requireRole(user, ['ADMIN', 'HIRING_MANAGER', 'RECRUITER']);
    const body = await readJson(request);
    if (typeof body.vacancyId !== 'string')
      throw Object.assign(new Error('vacancyId is required.'), { status: 400 });
    await ensureVacancyAccess(user, body.vacancyId);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let candidateId = body.candidateId;
      if (body.candidate && !candidateId) {
        const c = body.candidate;
        const fullName =
          typeof c.fullName === 'string' ? c.fullName.trim() : '';
        const email =
          typeof c.email === 'string' ? c.email.trim().toLowerCase() : '';
        if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          throw Object.assign(
            new Error('Candidate fullName and valid email are required.'),
            { status: 400 },
          );
        const { rows: candidates } = await client.query(
          'SELECT id FROM candidates WHERE lower(email)=lower($1) LIMIT 1',
          [email],
        );
        candidateId = candidates[0]?.id;
        if (!candidateId) {
          candidateId = makeId();
          await client.query(
            'INSERT INTO candidates (id,full_name,email,phone,resume_url,professional_url,city,state,country) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            [
              candidateId,
              fullName,
              email,
              c.phone || null,
              c.resumeUrl || null,
              c.professionalUrl || null,
              c.city || null,
              c.state || null,
              c.country || null,
            ],
          );
        }
      }
      if (typeof candidateId !== 'string')
        throw Object.assign(
          new Error('candidateId or candidate details are required.'),
          { status: 400 },
        );
      const { rows: firstStage } = await client.query(
        'SELECT id,due_days FROM recruitment_stages WHERE vacancy_id=$1 AND active=true ORDER BY position LIMIT 1',
        [body.vacancyId],
      );
      const {rows:vacancyStatus}=await client.query('SELECT status FROM vacancies WHERE id=$1',[body.vacancyId]);
      if(vacancyStatus[0]?.status!=='OPEN')throw Object.assign(new Error('Only open vacancies accept new applications.'),{status:409});
      if (!firstStage[0])
        throw Object.assign(
          new Error(
            'Configure at least one active stage before adding candidates.',
          ),
          { status: 409 },
        );
      const applicationId = makeId();
      const { rows } = await client.query(
        `INSERT INTO applications (id,candidate_id,vacancy_id,current_stage_id,salary_expectation)
         VALUES ($1,$2,$3,$4,$5) RETURNING id,candidate_id,vacancy_id,current_stage_id,status,applied_at,last_moved_at`,
        [
          applicationId,
          candidateId,
          body.vacancyId,
          firstStage[0].id,
          body.salaryExpectation || null,
        ],
      );
      await client.query(
        'INSERT INTO stage_transitions (application_id,from_stage_id,to_stage_id,actor_id,reason) VALUES ($1,NULL,$2,$3,$4)',
        [applicationId, firstStage[0].id, user.id, 'Inscrição inicial'],
      );
      const { rows: approvers } = await client.query(
        'SELECT user_id FROM stage_approvers WHERE stage_id=$1',
        [firstStage[0].id],
      );
      for (const approver of approvers)
        await client.query(
          'INSERT INTO approval_records (application_id,stage_id,approver_id,due_at) VALUES ($1,$2,$3,$4)',
          [
            applicationId,
            firstStage[0].id,
            approver.user_id,
            firstStage[0].due_days
              ? new Date(Date.now() + firstStage[0].due_days * 86400000)
              : null,
          ],
        );
      await audit(
        client,
        user.id,
        'application.created',
        'application',
        applicationId,
        { vacancyId: body.vacancyId, candidateId },
      );
      await client.query('COMMIT');
      return send(response, 201, { item: rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const vacancyApplicationsPath = url.pathname.match(
    /^\/vacancies\/([\w-]+)\/applications$/,
  );
  if (request.method === 'GET' && vacancyApplicationsPath) {
    await ensureVacancyAccess(user, vacancyApplicationsPath[1]);
    const { rows } = await pool.query(
      `SELECT a.id,a.vacancy_id,a.status,a.applied_at,a.last_moved_at,a.current_stage_id,
        s.name AS stage_name,s.position AS stage_position,s.due_days,
        c.id AS candidate_id,c.full_name,c.email,c.phone,c.resume_url,c.professional_url,c.city,c.state,c.country,
        u.name AS recruiter,
        EXTRACT(EPOCH FROM (now()-a.last_moved_at))/86400 AS days_in_stage,
        (SELECT count(*) FROM candidate_notes n WHERE n.application_id=a.id) AS note_count,
        (SELECT count(*) FROM candidate_activities ca WHERE ca.application_id=a.id AND ca.completed_at IS NULL) AS pending_activities,
        (SELECT count(*) FROM approval_records ar WHERE ar.application_id=a.id AND ar.stage_id=a.current_stage_id AND ar.decision IN ('PENDING','NEEDS_INFORMATION')) AS pending_approvals
       FROM applications a JOIN candidates c ON c.id=a.candidate_id
       LEFT JOIN recruitment_stages s ON s.id=a.current_stage_id LEFT JOIN users u ON u.id=(SELECT recruiter_id FROM vacancies WHERE id=a.vacancy_id)
       WHERE a.vacancy_id=$1 ORDER BY s.position,a.last_moved_at`,
      [vacancyApplicationsPath[1]],
    );
    return send(response, 200, { items: rows });
  }

  if (request.method === 'GET' && url.pathname === '/approvals') {
    const { rows } = await pool.query(
      `SELECT ar.id,ar.decision,ar.comment,ar.due_at,ar.created_at,s.name AS stage_name,
        v.id AS vacancy_id,v.title AS vacancy_title,c.full_name AS candidate_name,a.id AS application_id
       FROM approval_records ar JOIN applications a ON a.id=ar.application_id
       JOIN candidates c ON c.id=a.candidate_id JOIN recruitment_stages s ON s.id=ar.stage_id
       JOIN vacancies v ON v.id=a.vacancy_id
       WHERE ar.approver_id=$1 AND ar.decision IN ('PENDING','NEEDS_INFORMATION') ORDER BY (ar.due_at IS NULL),ar.due_at,ar.created_at LIMIT 200`,
      [user.id],
    );
    return send(response, 200, { items: rows });
  }

  const approvalPath = url.pathname.match(/^\/approvals\/([\w-]+)\/decision$/);
  if (request.method === 'POST' && approvalPath) {
    requireRole(user, ['ADMIN', 'APPROVER']);
    const body = await readJson(request);
    if (
      !['APPROVED', 'REJECTED', 'NEEDS_INFORMATION'].includes(body.decision) ||
      (body.decision !== 'APPROVED' && !String(body.comment || '').trim())
    ) {
      throw Object.assign(
        new Error(
          'Valid decision and a comment for non-approval decisions are required.',
        ),
        { status: 400 },
      );
    }
    const { rows } = await pool.query(
      `UPDATE approval_records SET decision=$1,comment=$2,decided_at=now()
       WHERE id=$3 AND approver_id=$4 AND decision IN ('PENDING','NEEDS_INFORMATION') RETURNING id,application_id,stage_id,decision,comment,decided_at`,
      [body.decision, body.comment || null, approvalPath[1], user.id],
    );
    if (!rows[0])
      throw Object.assign(
        new Error('Pending approval not found for this user.'),
        { status: 404 },
      );
    await audit(pool, user.id, 'approval.decided', 'approval', rows[0].id, {
      decision: body.decision,
    });
    return send(response, 200, { item: rows[0] });
  }

  const movePath = url.pathname.match(/^\/applications\/([\w-]+)\/move$/);
  if (request.method === 'POST' && movePath) {
    requireRole(user, ['ADMIN', 'HIRING_MANAGER', 'RECRUITER']);
    const body = await readJson(request);
    if (typeof body.toStageId !== 'string')
      throw Object.assign(new Error('toStageId is required.'), { status: 400 });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: apps } = await client.query(
        'SELECT a.*,v.id AS vacancy_id FROM applications a JOIN vacancies v ON v.id=a.vacancy_id WHERE a.id=$1 FOR UPDATE',
        [movePath[1]],
      );
      const application = apps[0];
      if (!application)
        throw Object.assign(new Error('Application not found.'), {
          status: 404,
        });
      await ensureVacancyAccess(user, application.vacancy_id, client);
      if (application.status !== 'ACTIVE')
        throw Object.assign(new Error('Closed applications cannot be moved.'), {
          status: 409,
        });
      const { rows: stages } = await client.query(
        'SELECT * FROM recruitment_stages WHERE vacancy_id=$1 AND active=true ORDER BY position',
        [application.vacancy_id],
      );
      const from = stages.find(
        stage => stage.id === application.current_stage_id,
      );
      const to = stages.find(stage => stage.id === body.toStageId);
      if (!from || !to || from.id === to.id)
        throw Object.assign(new Error('Invalid destination stage.'), {
          status: 400,
        });
      if (!from.allow_manual_transition && to.position !== from.position + 1)
        throw Object.assign(
          new Error(
            'This stage only permits transition to the next configured stage.',
          ),
          { status: 409 },
        );
      if (
        Math.abs(to.position - from.position) > 1 &&
        !String(body.reason || '').trim()
      )
        throw Object.assign(
          new Error('A reason is required when skipping stages.'),
          { status: 400 },
        );
      if (from.requires_approval) {
        const { rows: approvals } = await client.query(
          'SELECT decision FROM approval_records WHERE application_id=$1 AND stage_id=$2',
          [application.id, from.id],
        );
        const approved = approvals.filter(
          record => record.decision === 'APPROVED',
        ).length;
        const rejected = approvals.filter(
          record => record.decision === 'REJECTED',
        ).length;
        const total = approvals.length;
        const mode = from.approval_mode || 'ALL';
        const passed =
          mode === 'ALL'
            ? total > 0 && approved === total
            : mode === 'ANY'
            ? approved > 0
            : approved > Math.floor(total / 2);
        if (!passed || (rejected > 0 && mode === 'ALL'))
          throw Object.assign(
            new Error('Required stage approvals are not complete.'),
            { status: 409 },
          );
      }
      await client.query(
        'UPDATE stage_transitions SET exited_at=now() WHERE application_id=$1 AND exited_at IS NULL',
        [application.id],
      );
      await client.query(
        'UPDATE applications SET current_stage_id=$1,last_moved_at=now() WHERE id=$2',
        [to.id, application.id],
      );
      await client.query(
        'INSERT INTO stage_transitions (application_id,from_stage_id,to_stage_id,actor_id,reason) VALUES ($1,$2,$3,$4,$5)',
        [application.id, from.id, to.id, user.id, body.reason || null],
      );
      const { rows: approvers } = await client.query(
        'SELECT user_id FROM stage_approvers WHERE stage_id=$1',
        [to.id],
      );
      for (const approver of approvers)
        await client.query(
          'INSERT INTO approval_records (application_id,stage_id,approver_id,due_at) VALUES ($1,$2,$3,$4)',
          [
            application.id,
            to.id,
            approver.user_id,
            to.due_days ? new Date(Date.now() + to.due_days * 86400000) : null,
          ],
        );
      await audit(
        client,
        user.id,
        'application.moved',
        'application',
        application.id,
        { fromStageId: from.id, toStageId: to.id, reason: body.reason || null },
      );
      await client.query('COMMIT');
      return send(response, 200, {
        ok: true,
        currentStageId: to.id,
        movedAt: new Date().toISOString(),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  if (request.method === 'GET' && url.pathname === '/closure-reasons') {
    const kind = url.searchParams.get('kind');
    if (kind && !['REJECTION', 'WITHDRAWAL'].includes(kind))
      throw Object.assign(new Error('kind must be REJECTION or WITHDRAWAL.'), {
        status: 400,
      });
    const { rows } = await pool.query(
      'SELECT id,kind,label,requires_note FROM closure_reasons WHERE active=true AND ($1::text IS NULL OR kind=$1) ORDER BY kind,label',
      [kind],
    );
    return send(response, 200, { items: rows });
  }

  const closePath = url.pathname.match(/^\/applications\/([\w-]+)\/close$/);
  if (request.method === 'POST' && closePath) {
    requireRole(user, ['ADMIN', 'HIRING_MANAGER', 'RECRUITER']);
    const body = await readJson(request);
    if (
      !['REJECTION', 'WITHDRAWAL'].includes(body.kind) ||
      typeof body.reasonId !== 'string'
    )
      throw Object.assign(new Error('kind and reasonId are required.'), {
        status: 400,
      });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: apps } = await client.query(
        'SELECT a.*,v.id AS vacancy_id FROM applications a JOIN vacancies v ON v.id=a.vacancy_id WHERE a.id=$1 FOR UPDATE',
        [closePath[1]],
      );
      const application = apps[0];
      if (!application)
        throw Object.assign(new Error('Application not found.'), {
          status: 404,
        });
      await ensureVacancyAccess(user, application.vacancy_id, client);
      if (application.status !== 'ACTIVE')
        throw Object.assign(new Error('Application is already closed.'), {
          status: 409,
        });
      const { rows: reasons } = await client.query(
        'SELECT * FROM closure_reasons WHERE id=$1 AND kind=$2 AND active=true',
        [body.reasonId, body.kind],
      );
      if (!reasons[0])
        throw Object.assign(
          new Error('Active reason not found for this closure kind.'),
          { status: 400 },
        );
      if (reasons[0].requires_note && !String(body.comment || '').trim())
        throw Object.assign(new Error('This reason requires a comment.'), {
          status: 400,
        });
      await client.query(
        'UPDATE applications SET status=$1,closure_kind=$2,closure_reason_id=$3,closure_reason=$4,closure_comment=$5,closed_at=now() WHERE id=$6',
        [
          body.kind === 'REJECTION' ? 'REJECTED' : 'WITHDRAWN',
          body.kind,
          body.reasonId,
          reasons[0].label,
          body.comment || null,
          application.id,
        ],
      );
      await client.query(
        'UPDATE stage_transitions SET exited_at=now() WHERE application_id=$1 AND exited_at IS NULL',
        [application.id],
      );
      await client.query(
        'INSERT INTO stage_transitions (application_id,from_stage_id,to_stage_id,actor_id,entered_at,exited_at,reason) VALUES ($1,$2,NULL,$3,now(),now(),$4)',
        [application.id,application.current_stage_id,user.id,body.kind + ': ' + reasons[0].label + (body.comment ? ' · ' + body.comment : '')],
      );
      await audit(
        client,
        user.id,
        'application.closed',
        'application',
        application.id,
        {
          kind: body.kind,
          reasonId: body.reasonId,
          comment: body.comment || null,
        },
      );
      await client.query('COMMIT');
      return send(response, 200, {
        ok: true,
        status: body.kind === 'REJECTION' ? 'REJECTED' : 'WITHDRAWN',
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const hirePath = url.pathname.match(/^\/applications\/([\w-]+)\/hire$/);
  if (request.method === 'POST' && hirePath) {
    requireRole(user, ['ADMIN', 'HIRING_MANAGER']);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: apps } = await client.query(
        'SELECT a.*,v.id AS vacancy_id FROM applications a JOIN vacancies v ON v.id=a.vacancy_id WHERE a.id=$1 FOR UPDATE',
        [hirePath[1]],
      );
      const app = apps[0];
      if (!app)
        throw Object.assign(new Error('Application not found.'), {
          status: 404,
        });
      await ensureVacancyAccess(user, app.vacancy_id, client);
      if (app.status !== 'ACTIVE')
        throw Object.assign(new Error('Application is already closed.'), {
          status: 409,
        });
      const { rows: stage } = await client.query(
        'SELECT requires_approval,approval_mode FROM recruitment_stages WHERE id=$1',
        [app.current_stage_id],
      );
      const { rows: finalStage } = await client.query(
        'SELECT id FROM recruitment_stages WHERE vacancy_id=$1 AND active=true ORDER BY position DESC LIMIT 1',
        [app.vacancy_id],
      );
      if (finalStage[0]?.id !== app.current_stage_id)
        throw Object.assign(
          new Error('Move the application to the final stage before hiring.'),
          { status: 409 },
        );
      if (stage[0]?.requires_approval) {
        const { rows: decisions } = await client.query(
          'SELECT decision FROM approval_records WHERE application_id=$1 AND stage_id=$2',
          [app.id, app.current_stage_id],
        );
        const count = decisions.filter(
          item => item.decision === 'APPROVED',
        ).length;
        const total = decisions.length;
        const mode = stage[0].approval_mode || 'ALL';
        const passed =
          mode === 'ALL'
            ? total > 0 && count === total
            : mode === 'ANY'
            ? count > 0
            : count > Math.floor(total / 2);
        if (!passed)
          throw Object.assign(
            new Error('Current stage approvals are not complete.'),
            { status: 409 },
          );
      }
      await client.query(
        "UPDATE applications SET status='HIRED',closure_kind='HIRED',closed_at=now() WHERE id=$1",
        [app.id],
      );
      await client.query(
        'UPDATE stage_transitions SET exited_at=now() WHERE application_id=$1 AND exited_at IS NULL',
        [app.id],
      );
      await client.query(
        "INSERT INTO stage_transitions (application_id,from_stage_id,to_stage_id,actor_id,entered_at,exited_at,reason) VALUES ($1,$2,NULL,$3,now(),now(),'HIRED')",
        [app.id,app.current_stage_id,user.id],
      );
      await audit(client, user.id, 'application.hired', 'application', app.id);
      await client.query('COMMIT');
      return send(response, 200, { ok: true, status: 'HIRED' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  const notesPath = url.pathname.match(/^\/applications\/([\w-]+)\/notes$/);
  if (notesPath && request.method === 'GET') {
    const { rows: accessible } = await pool.query(
      'SELECT vacancy_id FROM applications WHERE id=$1',
      [notesPath[1]],
    );
    if (!accessible[0])
      throw Object.assign(new Error('Application not found.'), { status: 404 });
    await ensureVacancyAccess(user, accessible[0].vacancy_id);
    const confidentialFilter = ['ADMIN', 'HIRING_MANAGER'].includes(user.role)
      ? ''
      : 'AND n.confidential=false';
    const { rows } = await pool.query(
      `SELECT n.id,n.body,n.confidential,n.created_at,u.name AS author FROM candidate_notes n JOIN users u ON u.id=n.author_id WHERE n.application_id=$1 ${confidentialFilter} ORDER BY n.created_at`,
      [notesPath[1]],
    );
    return send(response, 200, { items: rows });
  }
  if (notesPath && request.method === 'POST') {
    const body = await readJson(request);
    const content = typeof body.body === 'string' ? body.body.trim() : '';
    if (!content || content.length > 10000)
      throw Object.assign(
        new Error('Note text is required and must be under 10,000 characters.'),
        { status: 400 },
      );
    const { rows: accessible } = await pool.query(
      'SELECT vacancy_id FROM applications WHERE id=$1',
      [notesPath[1]],
    );
    if (!accessible[0])
      throw Object.assign(new Error('Application not found.'), { status: 404 });
    await ensureVacancyAccess(user, accessible[0].vacancy_id);
    if (body.confidential && !['ADMIN', 'HIRING_MANAGER'].includes(user.role))
      throw Object.assign(
        new Error(
          'Only administrators and hiring managers may add confidential notes.',
        ),
        { status: 403 },
      );
    const id = makeId();
    const { rows } = await pool.query(
      'INSERT INTO candidate_notes (id,application_id,author_id,body,confidential) VALUES ($1,$2,$3,$4,$5) RETURNING id,body,confidential,created_at',
      [id, notesPath[1], user.id, content, Boolean(body.confidential)],
    );
    await audit(pool, user.id, 'note.created', 'application', notesPath[1], {
      confidential: Boolean(body.confidential),
    });
    return send(response, 201, { item: rows[0] });
  }

  const timelinePath = url.pathname.match(
    /^\/applications\/([\w-]+)\/timeline$/,
  );
  if (timelinePath && request.method === 'GET') {
    const { rows: app } = await pool.query(
      'SELECT vacancy_id FROM applications WHERE id=$1',
      [timelinePath[1]],
    );
    if (!app[0])
      throw Object.assign(new Error('Application not found.'), { status: 404 });
    await ensureVacancyAccess(user, app[0].vacancy_id);
    const confidentialFilter = ['ADMIN', 'HIRING_MANAGER'].includes(user.role)
      ? ''
      : 'AND n.confidential=false';
    const { rows } = await pool.query(
      `SELECT event_type,event_id,occurred_at,actor,summary,confidential FROM (
         SELECT 'TRANSITION'::text AS event_type,st.id::text AS event_id,st.entered_at AS occurred_at,u.name AS actor,
           COALESCE(fs.name,'Inscrição') || ' → ' || COALESCE(ts.name,'Encerramento') || COALESCE(' · ' || st.reason,'') AS summary,false AS confidential
         FROM stage_transitions st JOIN users u ON u.id=st.actor_id LEFT JOIN recruitment_stages fs ON fs.id=st.from_stage_id LEFT JOIN recruitment_stages ts ON ts.id=st.to_stage_id WHERE st.application_id=$1
         UNION ALL
         SELECT 'NOTE',n.id,n.created_at,u.name,n.body,n.confidential FROM candidate_notes n JOIN users u ON u.id=n.author_id WHERE n.application_id=$1 ${confidentialFilter}
         UNION ALL
         SELECT 'APPROVAL',ar.id,COALESCE(ar.decided_at,ar.created_at),u.name,s.name || ': ' || ar.decision || COALESCE(' · ' || ar.comment,''),false
         FROM approval_records ar JOIN users u ON u.id=ar.approver_id JOIN recruitment_stages s ON s.id=ar.stage_id WHERE ar.application_id=$1
         UNION ALL
         SELECT 'ACTIVITY',ca.id,COALESCE(ca.completed_at,ca.due_at,ca.created_at),NULL,ca.title,false FROM candidate_activities ca WHERE ca.application_id=$1
       ) events ORDER BY occurred_at DESC LIMIT 250`,
      [timelinePath[1]],
    );
    return send(response, 200, { items: rows });
  }

  const activitiesPath = url.pathname.match(
    /^\/applications\/([\w-]+)\/activities$/,
  );
  if (activitiesPath && request.method === 'GET') {
    const { rows: app } = await pool.query(
      'SELECT vacancy_id FROM applications WHERE id=$1',
      [activitiesPath[1]],
    );
    if (!app[0])
      throw Object.assign(new Error('Application not found.'), { status: 404 });
    await ensureVacancyAccess(user, app[0].vacancy_id);
    const { rows } = await pool.query(
      'SELECT id,title,due_at,completed_at,created_at FROM candidate_activities WHERE application_id=$1 ORDER BY due_at NULLS LAST,created_at',
      [activitiesPath[1]],
    );
    return send(response, 200, { items: rows });
  }
  if (activitiesPath && request.method === 'POST') {
    const body = await readJson(request);
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title)
      throw Object.assign(new Error('Activity title is required.'), {
        status: 400,
      });
    const { rows: app } = await pool.query(
      'SELECT vacancy_id FROM applications WHERE id=$1',
      [activitiesPath[1]],
    );
    if (!app[0])
      throw Object.assign(new Error('Application not found.'), { status: 404 });
    await ensureVacancyAccess(user, app[0].vacancy_id);
    const dueAt = body.dueAt ? new Date(body.dueAt) : null;
    if (dueAt && Number.isNaN(dueAt.getTime()))
      throw Object.assign(new Error('dueAt must be a valid date.'), {
        status: 400,
      });
    const { rows } = await pool.query(
      'INSERT INTO candidate_activities (application_id,title,due_at) VALUES ($1,$2,$3) RETURNING id,title,due_at,completed_at,created_at',
      [activitiesPath[1], title, dueAt],
    );
    await audit(
      pool,
      user.id,
      'activity.created',
      'application',
      activitiesPath[1],
      { title },
    );
    return send(response, 201, { item: rows[0] });
  }

  const activityCompletePath = url.pathname.match(
    /^\/activities\/([\w-]+)\/complete$/,
  );
  if (activityCompletePath && request.method === 'POST') {
    const { rows } = await pool.query(
      `UPDATE candidate_activities ca SET completed_at=COALESCE(ca.completed_at,now())
       WHERE ca.id=$1 AND EXISTS (SELECT 1 FROM applications a JOIN vacancies v ON v.id=a.vacancy_id
         WHERE a.id=ca.application_id AND ($2='ADMIN' OR v.hiring_manager_id=$3 OR v.recruiter_id=$3))
       RETURNING ca.id,ca.completed_at`,
      [activityCompletePath[1], user.role, user.id],
    );
    if (!rows[0])
      throw Object.assign(new Error('Activity not found or access denied.'), {
        status: 404,
      });
    return send(response, 200, { item: rows[0] });
  }

  if (request.method === 'GET' && url.pathname === '/dashboard/summary') {
    const vacancyId = url.searchParams.get('vacancyId');
    if (vacancyId) await ensureVacancyAccess(user, vacancyId);
    const values = [];
    let scope = '';
    if (vacancyId) {
      values.push(vacancyId);
      scope += ` AND v.id=$${values.length}`;
    }
    if (user.role !== 'ADMIN') {
      values.push(user.id);
      scope += ` AND (v.hiring_manager_id=$${values.length} OR v.recruiter_id=$${values.length} OR EXISTS (SELECT 1 FROM stage_approvers sa JOIN recruitment_stages s ON s.id=sa.stage_id WHERE s.vacancy_id=v.id AND sa.user_id=$${values.length}))`;
    }
    const { rows } = await pool.query(
      `WITH scoped_vacancies AS (
         SELECT v.* FROM vacancies v WHERE true ${scope}
       ), scoped_applications AS (
         SELECT a.*,s.due_days FROM applications a JOIN scoped_vacancies v ON v.id=a.vacancy_id
         LEFT JOIN recruitment_stages s ON s.id=a.current_stage_id
       )
       SELECT (SELECT count(*) FROM scoped_vacancies WHERE status='OPEN')::int AS open_vacancies,
         (SELECT count(*) FROM scoped_applications WHERE status='ACTIVE')::int AS active_applications,
         (SELECT count(*) FROM scoped_applications WHERE status='HIRED')::int AS hires,
         (SELECT count(*) FROM scoped_applications WHERE status='REJECTED')::int AS rejections,
         (SELECT count(*) FROM scoped_applications WHERE status='WITHDRAWN')::int AS withdrawals,
         (SELECT count(*) FROM approval_records ar JOIN scoped_applications a ON a.id=ar.application_id WHERE ar.decision IN ('PENDING','NEEDS_INFORMATION'))::int AS pending_approvals,
         (SELECT count(*) FROM scoped_applications WHERE status='ACTIVE' AND due_days IS NOT NULL AND last_moved_at + (due_days || ' days')::interval < now())::int AS overdue_applications,
         ROUND((SELECT AVG(EXTRACT(EPOCH FROM (closed_at-applied_at))/86400) FROM scoped_applications WHERE status='HIRED')::numeric,1) AS avg_days_to_hire`,
      values,
    );
    const stageValues = [...values];
    const { rows: stages } = await pool.query(
      `SELECT s.id,s.name,v.id AS vacancy_id,v.title AS vacancy_title,COUNT(a.id)::int AS active_candidates
       FROM vacancies v JOIN recruitment_stages s ON s.vacancy_id=v.id AND s.active=true
       LEFT JOIN applications a ON a.current_stage_id=s.id AND a.status='ACTIVE'
       WHERE true ${scope} GROUP BY s.id,v.id ORDER BY v.title,s.position`,
      stageValues,
    );
    return send(response, 200, { metrics: rows[0], stages });
  }

  send(response, 404, { error: 'Not found.' });
}

const server = createServer((request, response) => {
  handle(request, response).catch(error => {
    if (error.code === '23505')
      return send(response, 409, {
        error: 'A record with that identifier already exists.',
      });
    if (error.code === '23503')
      return send(response, 400, {
        error: 'A referenced user or department does not exist.',
      });
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    send(response, status, {
      error: status >= 500 ? 'Internal server error.' : error.message,
    });
  });
});

server.listen(port, '0.0.0.0', () =>
  console.log(`Recruitment Tracker API listening on :${port}`),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    server.close();
    await pool.end();
    process.exit(0);
  });
