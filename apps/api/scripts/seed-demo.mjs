import { Pool } from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const manager = { id: 'demo-manager', email: 'gestora.demo@example.test', name: 'Marina Costa', role: 'HIRING_MANAGER', google: 'demo-google-manager' };
const recruiter = { id: 'demo-recruiter', email: 'recrutador.demo@example.test', name: 'Rafael Lima', role: 'RECRUITER', google: 'demo-google-recruiter' };
const approver = { id: 'demo-approver', email: 'aprovadora.demo@example.test', name: 'Luiza Martins', role: 'APPROVER', google: 'demo-google-approver' };
const vacancyId = 'demo-vacancy-product-designer';
const stageIds = ['demo-stage-screening','demo-stage-recruiter','demo-stage-technical','demo-stage-manager','demo-stage-offer'];
const candidates = [
  {id:'demo-candidate-ana',name:'Ana Ribeiro',email:'ana.ribeiro@example.test',stage:0,days:2,city:'São Paulo'},
  {id:'demo-candidate-bruno',name:'Bruno Azevedo',email:'bruno.azevedo@example.test',stage:1,days:4,city:'Campinas'},
  {id:'demo-candidate-carla',name:'Carla Mendes',email:'carla.mendes@example.test',stage:2,days:7,city:'São Paulo'},
  {id:'demo-candidate-diego',name:'Diego Fernandes',email:'diego.fernandes@example.test',stage:3,days:1,city:'Curitiba'},
  {id:'demo-candidate-elaine',name:'Elaine Souza',email:'elaine.souza@example.test',stage:2,days:3,city:'Rio de Janeiro'},
  {id:'demo-candidate-felipe',name:'Felipe Rocha',email:'felipe.rocha@example.test',stage:1,days:9,city:'Belo Horizonte'},
];
const client = await pool.connect();
try {
  await client.query('BEGIN');
  for (const user of [manager,recruiter,approver]) {
    await client.query(
      `INSERT INTO users (id,google_subject,email,name,role,active) VALUES ($1,$2,$3,$4,$5,true)
       ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email,name=EXCLUDED.name,role=EXCLUDED.role,active=true`,
      [user.id,user.google,user.email,user.name,user.role],
    );
  }
  await client.query("INSERT INTO departments (id,name) VALUES ('demo-dept-product','Produto') ON CONFLICT (id) DO NOTHING");
  await client.query(
    `INSERT INTO vacancies (id,code,title,description,requirements,department_id,hiring_manager_id,recruiter_id,openings,city,state,country,work_model,priority,status,opened_at,target_close_at)
     VALUES ($1,'RT-2026-014','Product Designer Sênior','Lidere a evolução da experiência digital do produto.','Experiência com discovery, prototipação e sistemas de design.','demo-dept-product',$2,$3,2,'São Paulo','SP','Brasil','Híbrido',2,'OPEN',now()-interval '21 days',now()+interval '11 days')
     ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,status='OPEN',target_close_at=EXCLUDED.target_close_at`,
    [vacancyId,manager.id,recruiter.id],
  );
  const stageNames = ['Triagem de currículo','Entrevista com recrutamento','Entrevista técnica','Entrevista com gestor','Proposta'];
  for (let position=0;position<stageNames.length;position++) {
    await client.query(
      `INSERT INTO recruitment_stages (id,vacancy_id,name,description,position,due_days,requires_approval,approval_mode,allow_manual_transition,active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,true)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,position=EXCLUDED.position,active=true`,
      [stageIds[position],vacancyId,stageNames[position],`Etapa ${position+1} do processo seletivo.`,position,[3,5,5,4,3][position],position===2,position===2?'ALL':null],
    );
  }
  await client.query('INSERT INTO stage_approvers (stage_id,user_id,required) VALUES ($1,$2,true) ON CONFLICT DO NOTHING',[stageIds[2],approver.id]);
  const reason = await client.query("SELECT id FROM closure_reasons WHERE kind='REJECTION' AND label='Conhecimento técnico insuficiente' LIMIT 1");
  for (let index=0;index<candidates.length;index++) {
    const candidate=candidates[index];
    await client.query(
      `INSERT INTO candidates (id,full_name,email,phone,resume_url,city,state,country) VALUES ($1,$2,$3,$4,$5,$6,$7,'Brasil')
       ON CONFLICT (id) DO UPDATE SET full_name=EXCLUDED.full_name,email=EXCLUDED.email,city=EXCLUDED.city`,
      [candidate.id,candidate.name,candidate.email,'+55 11 90000-0000',`https://example.test/cv/${candidate.id}.pdf`,candidate.city,candidate.city==='Curitiba'?'PR':candidate.city==='Belo Horizonte'?'MG':candidate.city==='Rio de Janeiro'?'RJ':'SP'],
    );
    const applicationId=`demo-application-${index+1}`;
    await client.query(
      `INSERT INTO applications (id,candidate_id,vacancy_id,current_stage_id,status,applied_at,last_moved_at)
       VALUES ($1,$2,$3,$4,'ACTIVE',now()-($5 || ' days')::interval,now()-($6 || ' days')::interval)
       ON CONFLICT (id) DO UPDATE SET current_stage_id=EXCLUDED.current_stage_id,status='ACTIVE',last_moved_at=EXCLUDED.last_moved_at`,
      [applicationId,candidate.id,vacancyId,stageIds[candidate.stage],candidate.days+4,candidate.days],
    );
    await client.query('DELETE FROM stage_transitions WHERE application_id=$1',[applicationId]);
    await client.query(
      `INSERT INTO stage_transitions (application_id,from_stage_id,to_stage_id,actor_id,entered_at,exited_at,reason)
       VALUES ($1,NULL,$2,$3,now()-($4 || ' days')::interval,NULL,'Inscrição inicial')`,
      [applicationId,stageIds[candidate.stage],recruiter.id,candidate.days],
    );
    if(candidate.stage===2) {
      const approvalId=`demo-approval-${index+1}`;
      await client.query(
        `INSERT INTO approval_records (id,application_id,stage_id,approver_id,decision,comment,due_at)
         VALUES ($1,$2,$3,$4,'PENDING',NULL,now()+interval '1 day')
         ON CONFLICT (id) DO UPDATE SET decision='PENDING',comment=NULL`,
        [approvalId,applicationId,stageIds[2],approver.id],
      );
    } else await client.query('DELETE FROM approval_records WHERE application_id=$1',[applicationId]);
    if(index===3) {
      await client.query('DELETE FROM candidate_notes WHERE application_id=$1',[applicationId]);
      await client.query('INSERT INTO candidate_notes (id,application_id,author_id,body) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING',
        [`demo-note-${index+1}`,applicationId,recruiter.id,'Boa aderência ao portfólio; validar disponibilidade na próxima conversa.']);
      await client.query('INSERT INTO candidate_activities (id,application_id,title,due_at) VALUES ($1,$2,$3,now()+interval \'2 days\') ON CONFLICT (id) DO NOTHING',
        [`demo-activity-${index+1}`,applicationId,'Agendar conversa de alinhamento']);
    }
  }
  for(const notification of [
    ['demo-notification-approval',approver.id,'APPROVAL','Nova aprovação pendente para Carla Mendes.',`demo-application-3`,'demo-approval-3'],
    ['demo-notification-deadline',manager.id,'VACANCY_DEADLINE','A vaga Product Designer Sênior está próxima do prazo.',vacancyId,'deadline-demo-vacancy'],
  ]) await client.query(
    `INSERT INTO notifications (id,user_id,type,message,entity_type,entity_id,due_at,dedupe_key)
     VALUES ($1,$2,$3,$4,'vacancy',$5,now()+interval '1 day',$6) ON CONFLICT (dedupe_key) DO NOTHING`,notification,
  );
  await client.query('COMMIT');
  console.log('Demo data seeded: 3 users, 1 vacancy, 5 stages and 6 candidates.');
} catch(error) {
  await client.query('ROLLBACK');throw error;
} finally { client.release();await pool.end(); }
