import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { CBadge, CButton, CCard, CCardBody, CContainer } from '@coreui/react';
import CIcon from '@coreui/icons-react';
import { cilBell } from '@coreui/icons';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const DEMO_LOGIN = import.meta.env.VITE_ENABLE_DEMO_LOGIN === 'true';
type User = { id: string; name: string; email: string; role: string };
type ManagedUser = User & { active: boolean; created_at: string; supervisor_id?: string | null; default_recruiter_id?: string | null };
type VacancyRequest = { id: string; title: string; opening_type: 'NEW_POSITION'|'REPLACEMENT'; description: string; technical_requirements: string; seniority_level: string; status: string; review_note?: string|null; hiring_manager?: string; recruiter?: string; result_vacancy_id?: string|null };
type Vacancy = {
  id: string;
  code: string;
  title: string;
  status: string;
  priority: number;
  city?: string;
  state?: string;
  country?: string;
  salary_expectation?: string | number | null;
  work_model?: string;
  department?: string;
  target_close_at?: string;
};
type Stage = {
  id: string;
  name: string;
  position: number;
  due_days?: number;
  requires_approval: boolean;
  approval_mode?: string;
  allow_manual_transition?: boolean;
  active: boolean;
  approvers?: Array<{ id: string; name: string; required: boolean }>;
};
type Approver = { id: string; name: string };
type Application = {
  id: string;
  candidate_id: string;
  full_name: string;
  email: string;
  resume_url?: string;
  city?: string;
  state?: string;
  country?: string;
  salary_expectation?: string | number | null;
  status: string;
  current_stage_id: string;
  stage_name: string;
  days_in_stage: number;
  pending_approvals: number;
  note_count: number;
  pending_activities: number;
};
type Approval = {
  id: string;
  decision: string;
  vacancy_title: string;
  stage_name: string;
  candidate_name: string;
  application_id: string;
};
type Notification = { id: string; type: string; message: string; read_at?: string | null; created_at: string };
type Metrics = {
  open_vacancies: number;
  active_applications: number;
  hires: number;
  rejections: number;
  withdrawals: number;
  pending_approvals: number;
  overdue_applications: number;
  avg_days_to_hire: number | null;
};
type TimelineEvent = {
  event_type: string;
  event_id: string;
  occurred_at: string;
  actor?: string;
  summary: string;
  confidential: boolean;
};
type Gsi = {
  accounts: {
    id: {
      initialize: (args: {
        client_id: string;
        callback: (response: { credential: string }) => void;
      }) => void;
      renderButton: (
        element: HTMLElement,
        options: Record<string, unknown>,
      ) => void;
    };
  };
};
declare global {
  interface Window {
    google?: Gsi;
  }
}

export function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    localStorage.getItem('recruitment-tracker-theme') === 'dark' ? 'dark' : 'light',
  );
  const [token, setToken] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState<
    'dashboard' | 'vacancies' | 'approvals' | 'users' | 'openingRequests'
  >('dashboard');
  const [vacancies, setVacancies] = useState<Vacancy[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [pipeline, setPipeline] = useState<
    Array<{ name: string; active_candidates: number }>
  >([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [openingRequests, setOpeningRequests] = useState<VacancyRequest[]>([]);
  const [openingModal, setOpeningModal] = useState(false);
  const [openingEditing, setOpeningEditing] = useState<VacancyRequest | null>(null);
  const [draggedId, setDraggedId] = useState('');
  const [timelineApplication, setTimelineApplication] =
    useState<Application | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [noteText, setNoteText] = useState('');
  const [selected, setSelected] = useState<Vacancy | null>(null);
  const [vacancyView, setVacancyView] = useState<'pipeline' | 'statistics'>('pipeline');
  const [stages, setStages] = useState<Stage[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [vacancyMetrics, setVacancyMetrics] = useState<Metrics | null>(null);
  const [vacancyStageCounts, setVacancyStageCounts] = useState<Array<{ id: string; name: string; active_candidates: number }>>([]);
  const [busy, setBusy] = useState(false);
  const [demoRole, setDemoRole] = useState('manager');
  const [error, setError] = useState('');
  const [candidateModal, setCandidateModal] = useState(false);
  const [candidateQuery, setCandidateQuery] = useState('');
  const [stageModal, setStageModal] = useState(false);
  const [approverUsers, setApproverUsers] = useState<Approver[]>([]);
  const [newStage, setNewStage] = useState({
    name: '',
    description: '',
    dueDays: '',
    requiresApproval: false,
    approvalMode: 'ALL',
    allowManualTransition: true,
    approverIds: [] as string[],
  });

  useEffect(() => {
    localStorage.setItem('recruitment-tracker-theme', theme);
  }, [theme]);

  const request = useCallback(
    async <T,>(path: string, init: RequestInit = {}) => {
      const response = await fetch(`${API}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...init.headers,
        },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Falha na requisição.');
      return body as T;
    },
    [token],
  );

  const refresh = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      const [v, d, a, n] = await Promise.all([
        request<{ items: Vacancy[] }>('/vacancies'),
        request<{
          metrics: Metrics;
          stages: Array<{ name: string; active_candidates: number }>;
        }>('/dashboard/summary'),
        request<{ items: Approval[] }>('/approvals'),
        request<{ items: Notification[] }>('/notifications'),
      ]);
      setVacancies(v.items);
      setMetrics(d.metrics);
      setPipeline(d.stages);
      setApprovals(a.items);
      setNotifications(n.items);
      const openings = await request<{items: VacancyRequest[]}>('/vacancy-requests');
      setOpeningRequests(openings.items);
      if (user?.role === 'ADMIN') {
        const result = await request<{ items: ManagedUser[] }>('/users');
        setManagedUsers(result.items);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [request, token, user]);
  const markNotificationRead = async (notification: Notification) => {
    try {
      await request(`/notifications/${notification.id}/read`, { method: 'PATCH' });
      setNotifications(items => items.map(item => item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item));
    } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (user || !GOOGLE_CLIENT_ID) return;
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      window.google?.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async response => {
          try {
            setBusy(true);
            setError('');
            const session = await request<{ token: string; user: User }>(
              '/auth/google',
              {
                method: 'POST',
                body: JSON.stringify({ credential: response.credential }),
              },
            );
            setToken(session.token);
            setUser(session.user);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        },
      });
      const target = document.getElementById('google-login');
      if (target)
        window.google?.accounts.id.renderButton(target, {
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          width: 280,
        });
    };
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, [request, user]);

  const openVacancy = async (v: Vacancy) => {
    setSelected(v);
    setVacancyView('pipeline');
    setBusy(true);
    setError('');
    try {
      const [s, a, stats] = await Promise.all([
        request<{ items: Stage[] }>(`/vacancies/${v.id}/stages`),
        request<{ items: Application[] }>(`/vacancies/${v.id}/applications`),
        request<{ metrics: Metrics; stages: Array<{ id: string; name: string; active_candidates: number }> }>(`/dashboard/summary?vacancyId=${encodeURIComponent(v.id)}`),
      ]);
      setStages(s.items.filter(x => x.active));
      setApplications(a.items);
      setVacancyMetrics(stats.metrics);
      setVacancyStageCounts(stats.stages);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const openStageSettings = async () => {
    if (!selected) return;
    try {
      const result = await request<{ items: Approver[] }>('/approvers');
      setApproverUsers(result.items);
      setStageModal(true);
    } catch (e) {
      window.alert((e as Error).message);
    }
  };
  const createStage = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selected) return;
    try {
      await request(`/vacancies/${selected.id}/stages`, {
        method: 'POST',
        body: JSON.stringify({
          ...newStage,
          position: stages.length,
          dueDays: newStage.dueDays ? Number(newStage.dueDays) : null,
        }),
      });
      setNewStage({
        name: '',
        description: '',
        dueDays: '',
        requiresApproval: false,
        approvalMode: 'ALL',
        allowManualTransition: true,
        approverIds: [],
      });
      await openVacancy(selected);
    } catch (e) {
      window.alert((e as Error).message);
    }
  };
  const moveStageOrder = async (stageId: string, direction: -1 | 1) => {
    if (!selected) return;
    const index = stages.findIndex(stage => stage.id === stageId);
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= stages.length) return;
    const reordered = [...stages];
    [reordered[index], reordered[nextIndex]] = [
      reordered[nextIndex],
      reordered[index],
    ];
    try {
      await request(`/vacancies/${selected.id}/stages/reorder`, {
        method: 'PUT',
        body: JSON.stringify({ stageIds: reordered.map(stage => stage.id) }),
      });
      setStages(reordered.map((stage, position) => ({ ...stage, position })));
    } catch (e) {
      window.alert((e as Error).message);
    }
  };
  const editStage = async (stage: Stage) => {
    if (!selected) return;
    const name = window.prompt('Nome da etapa:', stage.name)?.trim();
    if (!name) return;
    const due = window.prompt(
      'Prazo nesta etapa em dias (deixe vazio sem prazo):',
      stage.due_days ? String(stage.due_days) : '',
    );
    if (due === null) return;
    try {
      await request(`/stages/${stage.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          description: '',
          dueDays: due ? Number(due) : null,
          requiresApproval: stage.requires_approval,
          approvalMode: stage.approval_mode || 'ALL',
          allowManualTransition: true,
          approverIds: stage.approvers?.map(item => item.id) || [],
        }),
      });
      await openVacancy(selected);
    } catch (e) {
      window.alert((e as Error).message);
    }
  };
  const deactivateStage = async (stage: Stage) => {
    if (!selected || !window.confirm(`Desativar a etapa “${stage.name}”?`))
      return;
    try {
      await request(`/stages/${stage.id}`, { method: 'DELETE' });
      await openVacancy(selected);
    } catch (e) {
      window.alert((e as Error).message);
    }
  };
  const openTimeline = async (app: Application) => {
    setTimelineApplication(app);
    try {
      const result = await request<{ items: TimelineEvent[] }>(
        `/applications/${app.id}/timeline`,
      );
      setTimeline(result.items);
    } catch (e) {
      window.alert((e as Error).message);
    }
  };
  const addNote = async () => {
    if (!timelineApplication || !noteText.trim()) return;
    try {
      await request(`/applications/${timelineApplication.id}/notes`, {
        method: 'POST',
        body: JSON.stringify({ body: noteText }),
      });
      setNoteText('');
      const result = await request<{ items: TimelineEvent[] }>(
        `/applications/${timelineApplication.id}/timeline`,
      );
      setTimeline(result.items);
      if (selected) await openVacancy(selected);
    } catch (e) {
      window.alert((e as Error).message);
    }
  };
  const signOut = () => {
    setToken('');
    setUser(null);
    setSelected(null);
    setVacancies([]);
    setMetrics(null);
  };
  const submitCandidate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selected) return;
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      await request('/applications', {
        method: 'POST',
        body: JSON.stringify({
          vacancyId: selected.id,
          candidate: Object.fromEntries(data),
          salaryExpectation: data.get('salaryExpectation') ? Number(data.get('salaryExpectation')) : null,
        }),
      });
      setCandidateModal(false);
      await openVacancy(selected);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const move = async (app: Application) => {
    const i = stages.findIndex(s => s.id === app.current_stage_id);
    const next = stages[i + 1];
    if (!next) {
      window.alert('Última etapa configurada.');
      return;
    }
    await moveToStage(app, next.id);
  };
  const moveToStage = async (app: Application, toStageId: string) => {
    if (!canMoveCandidates || toStageId === app.current_stage_id) return;
    const currentIndex=stages.findIndex(stage=>stage.id===app.current_stage_id);
    const destinationIndex=stages.findIndex(stage=>stage.id===toStageId);
    let reason: string | undefined;
    if(destinationIndex>currentIndex+1){ reason=window.prompt('Justificativa para avançar etapas:')?.trim(); if(!reason)return; }
    try {
      await request(`/applications/${app.id}/move`, {
        method: 'POST',
        body: JSON.stringify({ toStageId, reason }),
      });
      if (selected) await openVacancy(selected);
    } catch (e) {
      window.alert((e as Error).message);
    }
  };
  const reviewOpening = async (opening: VacancyRequest, decision: 'APPROVE'|'RETURN') => {
    const comment=decision==='RETURN'?window.prompt('Observações para o gestor ajustar:')?.trim():undefined;
    if(decision==='RETURN'&&!comment)return;
    try { await request(`/vacancy-requests/${opening.id}/review`,{method:'POST',body:JSON.stringify({decision,comment})}); await refresh(); } catch(e){window.alert((e as Error).message);}
  };
  const submitOpening = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const data=Object.fromEntries(new FormData(e.currentTarget)); try { await request('/vacancy-requests',{method:'POST',body:JSON.stringify(data)}); setOpeningModal(false); await refresh(); } catch(err){setError((err as Error).message);} };
  const resubmitOpening = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); if(!openingEditing)return; const data=Object.fromEntries(new FormData(e.currentTarget)); try { await request(`/vacancy-requests/${openingEditing.id}/resubmit`,{method:'PATCH',body:JSON.stringify(data)}); setOpeningEditing(null); await refresh(); } catch(err){setError((err as Error).message);} };
  const saveManagerLinks = async (target: ManagedUser, supervisorId: string, recruiterId: string) => { try { await request(`/users/${target.id}/relationships`,{method:'PATCH',body:JSON.stringify({supervisorId:supervisorId||null,recruiterId:recruiterId||null})}); await refresh(); } catch(e){window.alert((e as Error).message);} };
  const close = async (app: Application) => {
    try {
      const kindChoice = window.prompt(
        'Tipo de encerramento: 1 = Reprovação, 2 = Desistência',
      );
      const kind = kindChoice === '2' ? 'WITHDRAWAL' : 'REJECTION';
      if (kindChoice !== '1' && kindChoice !== '2') return;
      const { items } = await request<{
        items: Array<{ id: string; label: string; requires_note: boolean }>;
      }>(`/closure-reasons?kind=${kind}`);
      const choice = window.prompt(
        `Motivo:\n${items
          .map((item, i) => `${i + 1}. ${item.label}`)
          .join('\n')}\n\nDigite o número do motivo`,
      );
      const reason = items[Number(choice) - 1];
      if (!reason) return;
      let comment: string | undefined;
      if (reason.requires_note) {
        comment = window.prompt('Justificativa obrigatória:') || undefined;
        if (!comment?.trim()) return;
      }
      await request(`/applications/${app.id}/close`, {
        method: 'POST',
        body: JSON.stringify({ kind, reasonId: reason.id, comment }),
      });
      if (selected) await openVacancy(selected);
    } catch (e) {
      window.alert((e as Error).message);
    }
  };
  const hire = async (app: Application) => {
    if (!window.confirm(`Confirmar contratação de ${app.full_name}?`)) return;
    try {
      await request(`/applications/${app.id}/hire`, { method: 'POST' });
      if (selected) await openVacancy(selected);
      await refresh();
    } catch (e) {
      window.alert((e as Error).message);
    }
  };
  const decide = async (id: string, decision: string) => {
    try {
      await request(`/approvals/${id}/decision`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          comment:
            decision === 'APPROVED'
              ? undefined
              : 'Complemento solicitado pelo aprovador.',
        }),
      });
      await refresh();
    } catch (e) {
      window.alert((e as Error).message);
    }
  };
  const changeUserRole = async (target: ManagedUser, role: string) => {
    try {
      await request(`/users/${target.id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role, active: target.active }),
      });
      await refresh();
    } catch (e) {
      window.alert((e as Error).message);
    }
  };
  const toggleUser = async (target: ManagedUser) => {
    try {
      await request(`/users/${target.id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: target.role, active: !target.active }),
      });
      await refresh();
    } catch (e) {
      window.alert((e as Error).message);
    }
  };
  const signInDemo = async () => {
    try {
      setBusy(true);
      setError('');
      const session = await request<{ token: string; user: User }>('/auth/demo', {
        method: 'POST',
        body: JSON.stringify({ role: demoRole }),
      });
      setToken(session.token);
      setUser(session.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const createDepartment = async () => {
    const name = window.prompt('Nome do departamento:')?.trim();
    if (!name) return;
    try {
      await request('/departments', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      window.alert('Departamento criado.');
    } catch (e) {
      window.alert((e as Error).message);
    }
  };
  const canManage = ['ADMIN', 'HIRING_MANAGER'].includes(user?.role || '');
  const canMoveCandidates = ['ADMIN', 'HIRING_MANAGER', 'RECRUITER'].includes(user?.role || '');
  const pageName = useMemo(
    () =>
      ((
        {
          dashboard: 'Visão geral',
          vacancies: 'Vagas',
          approvals: 'Aprovações',
          users: 'Administração',
          openingRequests: 'Aberturas de vaga',
        } as const
      )[page]),
    [page],
  );

  if (!user)
    return (
      <main className="login-page" data-coreui-theme={theme}>
        <div className="login-card">
          <div className="brand-mark">R</div>
          <p className="eyebrow">RECRUITMENT TRACKER</p>
          <h1>
            Pessoas certas,
            <br />
            processos claros.
          </h1>
          <p className="muted">
            Gerencie vagas, candidaturas e decisões em um só lugar.
          </p>
          {error && <div className="error">{error}</div>}
          {!GOOGLE_CLIENT_ID ? (
            <div className="config-notice">
              Configure <code>VITE_GOOGLE_CLIENT_ID</code> e{' '}
              <code>VITE_API_URL</code> no ambiente web para ativar o acesso.
            </div>
          ) : (
            <div id="google-login" />
          )}
          {DEMO_LOGIN && (
            <div className="demo-login">
              <label htmlFor="demo-role">Demonstração local</label>
              <div>
                <select id="demo-role" value={demoRole} onChange={event => setDemoRole(event.target.value)}>
                  <option value="manager">Gestora</option>
                  <option value="recruiter">Recrutador</option>
                  <option value="approver">Aprovadora</option>
                </select>
                <button className="secondary" onClick={signInDemo} disabled={busy}>Entrar</button>
              </div>
            </div>
          )}
          <small>
            Acesso somente para usuários autorizados · login via Google
          </small>
        </div>
      </main>
    );

  return (
    <div className="app-shell" data-coreui-theme={theme}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-small">R</div>
          <span>
            recruitment <i>tracker</i>
          </span>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <nav>
          {(
            [
              'dashboard',
              'vacancies',
              'approvals',
              ...(['ADMIN','HIRING_MANAGER','RECRUITER'].includes(user.role) ? ['openingRequests' as const] : []),
              ...(user.role === 'ADMIN' ? ['users' as const] : []),
            ] as const
          ).map(item => (
            <button
              key={item}
              className={page === item ? 'nav-item active' : 'nav-item'}
              onClick={() => {
                setPage(item);
                setSelected(null);
              }}
            >
              <span className="nav-symbol">
                {
                  {
                    dashboard: '◫',
                    vacancies: '▦',
                    approvals: '✓',
                    users: '⚙',
                    openingRequests: '＋',
                  }[item]
                }
              </span>
              {
                (
                  {
                    dashboard: 'Visão geral',
                    vacancies: 'Vagas',
                    approvals: 'Aprovações',
                    users: 'Administração',
                    openingRequests: 'Aberturas',
                  } as const
                )[item]
              }
              {item === 'approvals' &&
                approvals.filter(a => a.decision === 'PENDING').length > 0 && (
                  <b className="nav-badge">
                    {approvals.filter(a => a.decision === 'PENDING').length}
                  </b>
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-avatar">
            {user.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="user-meta">
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </div>
          <button className="icon-button" title="Sair" onClick={signOut}>
            ↗
          </button>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div>
            <span className="crumb">Recruitment Tracker</span>
            <span className="crumb-sep">/</span>
            <strong>{selected?.title || pageName}</strong>
          </div>
          <div className="top-actions">
            <CButton color="light" className="theme-toggle" onClick={() => setTheme(current => current === 'light' ? 'dark' : 'light')} aria-label={theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'} title={theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'}>
              <span aria-hidden="true">{theme === 'light' ? '◐' : '☀'}</span><span className="theme-toggle-label">{theme === 'light' ? 'Escuro' : 'Claro'}</span>
            </CButton>
            <div className="notification-wrap">
              <CButton color="light" className="icon-button notification-button" onClick={() => setShowNotifications(open => !open)} title="Notificações" aria-label="Notificações">
                <CIcon icon={cilBell} />{notifications.filter(item => !item.read_at).length > 0 && <CBadge color="primary" className="notification-count">{notifications.filter(item => !item.read_at).length}</CBadge>}
              </CButton>
              {showNotifications && <div className="notification-popover">
                <strong>Notificações</strong>
                {notifications.length === 0 ? <p className="muted">Nenhuma notificação.</p> : notifications.slice(0, 8).map(item => <button key={item.id} className={item.read_at ? 'notification-item read' : 'notification-item'} onClick={() => markNotificationRead(item)}>
                  <span>{item.message}</span><small>{item.read_at ? 'Lida' : 'Marcar como lida'}</small>
                </button>)}
              </div>}
            </div>
            <span className="role-chip">
              {{
                ADMIN: 'Administrador',
                HIRING_MANAGER: 'Gestor',
                RECRUITER: 'Recrutador',
                APPROVER: 'Aprovador',
              }[user.role] || user.role}
            </span>
            <CButton color="light" className="refresh-button" onClick={() => refresh()} title="Atualizar dados">
              ↻ <span>Atualizar</span>
            </CButton>
          </div>
        </header>
        {error && (
          <div className="error-banner">
            {error}
            <button onClick={() => setError('')}>×</button>
          </div>
        )}
        {busy && <div className="loading-line" />}
        {selected ? (
          <CContainer fluid className="content">
              <button className="back-button" onClick={() => setSelected(null)}>
              ← Voltar para vagas
            </button>
            <div className="page-heading vacancy-heading">
              <div>
                <p className="eyebrow">
                  {selected.code} · {selected.status}
                </p>
                <h1>{selected.title}</h1>
                <p className="muted">
                  {selected.city || 'Brasil'} ·{' '}
                  {selected.work_model || 'Modelo não informado'}
                </p>
              </div>
              <div className="header-buttons">
                {canManage && (
                  <button className="secondary" onClick={openStageSettings}>
                    Configurar etapas
                  </button>
                )}
                <button
                  className="primary"
                  onClick={() => setCandidateModal(true)}
                >
                  ＋ Adicionar candidato
                </button>
              </div>
            </div>
            <div className="vacancy-tabs" role="tablist" aria-label="Visualizações da vaga">
              <button role="tab" aria-selected={vacancyView === 'pipeline'} className={vacancyView === 'pipeline' ? 'vacancy-tab active' : 'vacancy-tab'} onClick={() => setVacancyView('pipeline')}>Pipeline</button>
              <button role="tab" aria-selected={vacancyView === 'statistics'} className={vacancyView === 'statistics' ? 'vacancy-tab active' : 'vacancy-tab'} onClick={() => setVacancyView('statistics')}>Dados e estatísticas</button>
            </div>
            {vacancyView === 'statistics' && (
            <div className="vacancy-insights" aria-label={`Estatísticas da vaga ${selected.title}`}>
              <div className="vacancy-metric-grid">
                <Metric title="Candidaturas ativas" value={vacancyMetrics?.active_applications} />
                <Metric title="Contratações" value={vacancyMetrics?.hires} />
                <Metric title="Reprovações" value={vacancyMetrics?.rejections} />
                <Metric title="Desistências" value={vacancyMetrics?.withdrawals} />
                <Metric title="Aprovações pendentes" value={vacancyMetrics?.pending_approvals} />
                <Metric title="Etapas atrasadas" value={vacancyMetrics?.overdue_applications} />
                <Metric title="Tempo médio até contratação" value={vacancyMetrics?.avg_days_to_hire != null ? `${vacancyMetrics.avg_days_to_hire} dias` : '—'} />
                <Metric title="Conversão em contratação" value={applications.length ? `${Math.round(((vacancyMetrics?.hires || 0) / applications.length) * 100)}%` : '0%'} />
              </div>
              <div className="panel vacancy-stage-panel">
                <div className="panel-title"><h2>Pipeline desta vaga</h2><span>Candidatos ativos por etapa</span></div>
                {vacancyStageCounts.map(stage => <div className="pipeline-row" key={stage.id}><span>{stage.name}</span><div className="bar-track"><div style={{ width: `${Math.max(4, Math.min(stage.active_candidates * 10, 100))}%` }} /></div><b>{stage.active_candidates}</b></div>)}
                {!vacancyStageCounts.length && <p className="muted">As etapas aparecerão aqui quando estiverem configuradas.</p>}
              </div>
            </div>
            )}
            {vacancyView === 'pipeline' && <>
            <div className="kanban-tools">
              <span>
                {applications.filter(app => app.status === 'ACTIVE').length}{' '}
                candidaturas ativas
              </span>
              <input
                aria-label="Buscar candidato"
                placeholder="Buscar por nome, e-mail ou cidade"
                value={candidateQuery}
                onChange={event => setCandidateQuery(event.target.value)}
              />
            </div>
            <div className="kanban-board">
              {stages.map(stage => (
                <div className={`kanban-lane ${draggedId && canMoveCandidates ? 'drop-ready' : ''}`} key={stage.id} onDragOver={e => { if (canMoveCandidates) { e.preventDefault(); e.currentTarget.classList.add('drag-over'); } }} onDragLeave={e => e.currentTarget.classList.remove('drag-over')} onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); const id=e.dataTransfer.getData('text/application-id'); const app=applications.find(item=>item.id===id); if(app) void moveToStage(app,stage.id); setDraggedId(''); }}>
                  <div className="lane-heading">
                    <strong>{stage.name}</strong>
                    <span>
                      {
                        applications.filter(
                          a =>
                            a.status === 'ACTIVE' &&
                            a.current_stage_id === stage.id,
                        ).length
                      }
                    </span>
                  </div>
                  {stage.due_days && (
                    <small className="lane-deadline">
                      Prazo de {stage.due_days} dias
                    </small>
                  )}
                  <div className="lane-cards">
                    {applications
                      .filter(
                        a =>
                          a.status === 'ACTIVE' &&
                          a.current_stage_id === stage.id &&
                          [a.full_name, a.email, a.city || '']
                            .join(' ')
                            .toLowerCase()
                            .includes(candidateQuery.toLowerCase()),
                      )
                      .map(app => (
                        <article className="candidate-card" key={app.id} draggable={canMoveCandidates} onDragStart={e => { e.dataTransfer.setData('text/application-id',app.id); e.dataTransfer.effectAllowed='move'; setDraggedId(app.id); }} onDragEnd={() => setDraggedId('')}>
                          <div className="candidate-head">
                            <div className="candidate-avatar">
                              {app.full_name.slice(0, 1).toUpperCase()}
                            </div>
                            <div>
                              <strong>{app.full_name}</strong>
                              <small>{[app.city,app.state,app.country].filter(Boolean).join(', ') || 'Localização não informada'}</small>
                              <small>{app.salary_expectation ? `Pretensão: ${Number(app.salary_expectation).toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0})}` : 'Pretensão não informada'}</small>
                            </div>
                          </div>
                          <div className="tag-row">
                            <span className="tag">
                              {Math.floor(app.days_in_stage || 0)} dias na etapa
                            </span>
                            {app.pending_approvals > 0 && (
                              <span className="tag warning">
                                {app.pending_approvals} aprovações
                              </span>
                            )}
                          </div>
                          <p className="card-muted">
                            {app.note_count} notas · {app.pending_activities}{' '}
                            pendências
                          </p>
                          {app.resume_url && (
                            <a
                              className="resume-link"
                              href={app.resume_url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Abrir currículo ↗
                            </a>
                          )}
                          <div className="card-actions">
                            <button
                              className="inline-link"
                              onClick={() => openTimeline(app)}
                            >
                              Histórico
                            </button>
                            <button
                              className="secondary"
                              onClick={() => move(app)}
                            >
                              Mover →
                            </button>
                            {stages.at(-1)?.id === stage.id && (
                              <button
                                className="approve"
                                onClick={() => hire(app)}
                              >
                                Contratar
                              </button>
                            )}
                            <button
                              className="text-danger"
                              onClick={() => close(app)}
                            >
                              Encerrar
                            </button>
                          </div>
                        </article>
                      ))}
                    {applications.every(
                      a =>
                        a.current_stage_id !== stage.id ||
                        a.status !== 'ACTIVE',
                    ) && (
                      <div className="empty-lane">
                        Sem candidaturas nesta etapa
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            </>}
          </CContainer>
        ) : page === 'dashboard' ? (
          <CContainer fluid className="content">
            <div className="page-heading">
              <div>
                <p className="eyebrow">PAINEL EXECUTIVO</p>
                <h1>Saúde do recrutamento</h1>
                <p className="muted">
                  Indicadores das vagas dentro do seu escopo de acesso.
                </p>
              </div>
              <CButton color="light" className="secondary" onClick={refresh}>
                Atualizar dados ↻
              </CButton>
            </div>
            <div className="metric-grid">
              <Metric title="Vagas abertas" value={metrics?.open_vacancies} />
              <Metric
                title="Candidatos ativos"
                value={metrics?.active_applications}
              />
              <Metric title="Contratações" value={metrics?.hires} />
              <Metric
                title="Etapas atrasadas"
                value={metrics?.overdue_applications}
              />
              <Metric
                title="Aprovações pendentes"
                value={metrics?.pending_approvals}
              />
              <Metric
                title="Tempo médio até contratação"
                value={
                  metrics?.avg_days_to_hire
                    ? `${metrics.avg_days_to_hire} dias`
                    : '—'
                }
              />
            </div>
            <div className="dashboard-columns">
              <div className="panel">
                <div className="panel-title">
                  <h2>Pipeline ativo</h2>
                  <span>Candidatos por etapa</span>
                </div>
                {pipeline.length ? (
                  pipeline.map((item, index) => (
                    <div className="pipeline-row" key={`${item.name}-${index}`}>
                      <span>{item.name}</span>
                      <div className="bar-track">
                        <div
                          style={{
                            width: `${Math.max(
                              4,
                              Math.min(item.active_candidates * 9, 100),
                            )}%`,
                          }}
                        />
                      </div>
                      <b>{item.active_candidates}</b>
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    Cadastre uma vaga para acompanhar o pipeline.
                  </p>
                )}
              </div>
              <div className="panel">
                <div className="panel-title">
                  <h2>Vagas recentes</h2>
                  <button
                    className="inline-link"
                    onClick={() => setPage('vacancies')}
                  >
                    Ver todas
                  </button>
                </div>
                {vacancies.slice(0, 5).map(v => (
                  <button
                    className="recent-row"
                    key={v.id}
                    onClick={() => openVacancy(v)}
                  >
                    <div className="candidate-avatar">
                      {v.title.slice(0, 1)}
                    </div>
                    <div>
                      <strong>{v.title}</strong>
                      <small>
                        {v.code} · {v.city || 'Brasil'}
                      </small>
                    </div>
                    <CBadge color={v.status === 'OPEN' ? 'success' : 'secondary'} className="status-pill">
                      {v.status === 'OPEN' ? 'Aberta' : v.status}
                    </CBadge>
                  </button>
                ))}
              </div>
            </div>
          </CContainer>
        ) : page === 'vacancies' ? (
          <CContainer fluid className="content">
            <div className="page-heading">
              <div>
                <p className="eyebrow">PROCESSOS SELETIVOS</p>
                <h1>Vagas</h1>
                <p className="muted">
                  Acompanhe prazos, responsáveis e candidaturas.
                </p>
              </div>
              {canManage && (
                <button
                  className="primary"
                  onClick={() => setOpeningModal(true)}
                >
                  ＋ Solicitar abertura
                </button>
              )}
            </div>
            <div className="vacancy-grid">
              {vacancies.map(v => (
                <button
                  className="vacancy-tile"
                  key={v.id}
                  onClick={() => openVacancy(v)}
                >
                  <div className="tile-top">
                    <span className="job-icon">{v.title.slice(0, 1)}</span>
                    <span className="status-pill">
                      {v.status === 'OPEN' ? 'Aberta' : v.status}
                    </span>
                  </div>
                  <strong>{v.title}</strong>
                  <small>
                    {v.code} · {v.department || 'Sem departamento'}
                  </small>
                  <div className="tile-footer">
                    <span>
                      {v.city || 'Localização não definida'} ·{' '}
                      {v.work_model || 'Modelo não definido'}
                    </span>
                    <b>Abrir pipeline →</b>
                  </div>
                </button>
              ))}
            </div>
            {vacancies.length === 0 && (
              <div className="empty-state">
                <h2>Sem vagas por enquanto</h2>
                <p>
                  {canManage
                    ? 'Crie sua primeira vaga para configurar um processo seletivo.'
                    : 'Vagas atribuídas a você aparecerão aqui.'}
                </p>
              </div>
            )}
          </CContainer>
        ) : page === 'openingRequests' ? (
          <CContainer fluid className="content">
            <div className="page-heading"><div><p className="eyebrow">SOLICITAÇÕES E ANÁLISE</p><h1>Aberturas de vaga</h1><p className="muted">O recrutador analisa a necessidade antes de criar a vaga no pipeline.</p></div>{['ADMIN','HIRING_MANAGER'].includes(user.role) && <button className="primary" onClick={() => setOpeningModal(true)}>＋ Solicitar abertura</button>}</div>
            <div className="opening-list">{openingRequests.map(item=><article className="opening-card" key={item.id}><div className="tile-top"><CBadge color={item.status==='APPROVED'?'success':item.status==='RETURNED'?'warning':'primary'}>{item.status==='PENDING_RECRUITER'?'Em análise':item.status==='RETURNED'?'Devolvida': 'Aprovada'}</CBadge><small>{item.hiring_manager} · recrutador: {item.recruiter}</small></div><h2>{item.title}</h2><p><b>{item.opening_type==='NEW_POSITION'?'Nova cadeira':'Reposição'} · {item.seniority_level}</b></p><p>{item.description}</p><p><b>Requisitos técnicos:</b> {item.technical_requirements}</p>{item.review_note&&<p className="review-note"><b>Observações do recrutador:</b> {item.review_note}</p>}{user.role==='RECRUITER'&&item.status==='PENDING_RECRUITER'&&<div className="header-buttons"><button className="approve" onClick={()=>void reviewOpening(item,'APPROVE')}>Aprovar abertura</button><button className="secondary" onClick={()=>void reviewOpening(item,'RETURN')}>Devolver com observações</button></div>}{item.status==='RETURNED'&&['ADMIN','HIRING_MANAGER'].includes(user.role)&&<button className="secondary" onClick={()=>setOpeningEditing(item)}>Ajustar e reenviar</button>}{item.status==='APPROVED'&&item.result_vacancy_id&&<small>Vaga criada e encaminhada para o pipeline.</small>}</article>)}{!openingRequests.length&&<div className="empty-state"><h2>Nenhuma solicitação</h2><p>Solicitações abertas ou atribuídas aparecerão aqui.</p></div>}</div>
          </CContainer>
        ) : page === 'approvals' ? (
          <CContainer fluid className="content">
            <div className="page-heading">
              <div>
                <p className="eyebrow">SUA FILA</p>
                <h1>Aprovações</h1>
                <p className="muted">
                  Decida candidaturas encaminhadas para sua avaliação.
                </p>
              </div>
            </div>
            <div className="approval-list">
              {approvals
                .filter(
                  a =>
                    a.decision === 'PENDING' ||
                    a.decision === 'NEEDS_INFORMATION',
                )
                .map(a => (
                  <article className="approval-row" key={a.id}>
                    <div className="approval-icon">✓</div>
                    <div className="approval-body">
                      <small>
                        {a.vacancy_title} · {a.stage_name}
                      </small>
                      <strong>{a.candidate_name}</strong>
                      <p>
                        {a.decision === 'NEEDS_INFORMATION'
                          ? 'Informação solicitada; revise para concluir.'
                          : 'Etapa enviada para aprovação'}
                      </p>
                    </div>
                    <button
                      className="approve"
                      onClick={() => decide(a.id, 'APPROVED')}
                    >
                      Aprovar
                    </button>
                    <button
                      className="secondary"
                      onClick={() => decide(a.id, 'NEEDS_INFORMATION')}
                    >
                      Pedir informações
                    </button>
                  </article>
                ))}
              {!approvals.some(
                a =>
                  a.decision === 'PENDING' ||
                  a.decision === 'NEEDS_INFORMATION',
              ) && (
                <div className="empty-state">
                  <h2>Tudo em dia</h2>
                  <p>Você não tem aprovações pendentes.</p>
                </div>
              )}
            </div>
          </CContainer>
        ) : (
          <section className="content">
            <div className="page-heading">
              <div>
                <p className="eyebrow">CONFIGURAÇÃO</p>
                <h1>Usuários e equipes</h1>
                <p className="muted">
                  Atribua papéis a usuários que já autenticaram com Google.
                </p>
              </div>
              <CButton color="primary" className="primary" onClick={createDepartment}>
                ＋ Departamento
              </CButton>
            </div>
            <div className="user-table">
              <div className="user-table-head">
                <span>Usuário</span>
                <span>Papel</span>
                <span>Supervisor / recrutador</span>
                <span>Status</span>
              </div>
              {managedUsers.map(target => (
                <div className="user-table-row" key={target.id}>
                  <div className="managed-user">
                    <span className="candidate-avatar">
                      {target.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <strong>{target.name}</strong>
                      <small>{target.email}</small>
                    </div>
                  </div>
                  <select
                    aria-label={`Papel de ${target.name}`}
                    value={target.role}
                    disabled={target.role === 'ADMIN'}
                    onChange={event =>
                      changeUserRole(target, event.target.value)
                    }
                  >
                    <option value="RECRUITER">Recrutador</option>
                    <option value="HIRING_MANAGER">Gestor da vaga</option>
                    <option value="APPROVER">Aprovador</option>
                  </select>
                  {target.role === 'HIRING_MANAGER' ? <div className="manager-links"><select aria-label={`Supervisor de ${target.name}`} value={target.supervisor_id||''} onChange={event=>void saveManagerLinks(target,event.target.value,target.default_recruiter_id||'')}><option value="">Sem supervisor</option>{managedUsers.filter(x=>x.role==='HIRING_MANAGER'&&x.id!==target.id&&x.active).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select><select aria-label={`Recrutador de ${target.name}`} value={target.default_recruiter_id||''} onChange={event=>void saveManagerLinks(target,target.supervisor_id||'',event.target.value)}><option value="">Vincular recrutador…</option>{managedUsers.filter(x=>x.role==='RECRUITER'&&x.active).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></div> : <small>—</small>}
                  <button
                    className={target.active ? 'status-pill' : 'inactive-pill'}
                    onClick={() => toggleUser(target)}
                    disabled={target.id === user.id}
                  >
                    {target.active ? 'Ativo' : 'Inativo'}
                  </button>
                </div>
              ))}
              {!managedUsers.length && (
                <div className="empty-state">
                  <h2>Nenhum usuário encontrado</h2>
                  <p>Usuários aparecerão após o primeiro login Google.</p>
                </div>
              )}
            </div>
          </section>
        )}
      </main>
      {openingModal && <Modal title="Solicitar abertura de vaga" close={() => setOpeningModal(false)}><form onSubmit={submitOpening}>{user.role==='ADMIN'&&<><label className="field"><span>Gestor responsável</span><select name="hiringManagerId" required><option value="">Selecione…</option>{managedUsers.filter(x=>x.role==='HIRING_MANAGER'&&x.active).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label className="field"><span>Recrutador (opcional se já vinculado ao gestor)</span><select name="recruiterId"><option value="">Usar vínculo do gestor</option>{managedUsers.filter(x=>x.role==='RECRUITER'&&x.active).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label></>}<Field name="title" label="Nome do cargo" required/><label className="field"><span>Tipo de abertura</span><select name="openingType" required><option value="NEW_POSITION">Nova cadeira</option><option value="REPLACEMENT">Reposição</option></select></label><Field name="description" label="Descrição da vaga" multiline required/><Field name="technicalRequirements" label="Requisitos técnicos" multiline required/><SenioritySelect/><button className="primary wide">Encaminhar para análise</button></form></Modal>}
      {openingEditing && <Modal title="Ajustar solicitação devolvida" close={() => setOpeningEditing(null)}><form onSubmit={resubmitOpening}><Field name="title" label="Nome do cargo" defaultValue={openingEditing.title} required/><label className="field"><span>Tipo de abertura</span><select name="openingType" defaultValue={openingEditing.opening_type} required><option value="NEW_POSITION">Nova cadeira</option><option value="REPLACEMENT">Reposição</option></select></label><Field name="description" label="Descrição da vaga" multiline defaultValue={openingEditing.description} required/><Field name="technicalRequirements" label="Requisitos técnicos" multiline defaultValue={openingEditing.technical_requirements} required/><SenioritySelect defaultValue={openingEditing.seniority_level}/><button className="primary wide">Reenviar para análise</button></form></Modal>}
      {candidateModal && (
        <Modal
          title="Adicionar candidato"
          close={() => setCandidateModal(false)}
        >
          <form onSubmit={submitCandidate}>
            <Field name="fullName" label="Nome completo" required />
            <Field name="email" label="E-mail" type="email" required />
            <Field name="phone" label="Telefone" />
            <Field name="city" label="Cidade" />
            <div className="form-row"><Field name="state" label="Estado" /><Field name="country" label="País" value="Brasil" /></div>
            <Field name="salaryExpectation" label="Pretensão salarial (R$ / mês)" type="number" />
            <Field name="resumeUrl" label="Link do currículo" type="url" />
            <button className="primary wide" disabled={busy}>
              {busy ? 'Salvando…' : 'Criar candidatura'}
            </button>
          </form>
        </Modal>
      )}
      {stageModal && selected && (
        <Modal
          title={`Etapas · ${selected.title}`}
          close={() => setStageModal(false)}
        >
          <div className="stage-editor-list">
            {stages.map((stage, index) => (
              <div className="stage-editor-row" key={stage.id}>
                <div className="stage-order">
                  <button
                    disabled={index === 0}
                    onClick={() => moveStageOrder(stage.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    disabled={index === stages.length - 1}
                    onClick={() => moveStageOrder(stage.id, 1)}
                  >
                    ↓
                  </button>
                </div>
                <div className="stage-editor-main">
                  <strong>{stage.name}</strong>
                  <small>
                    {stage.due_days ? `${stage.due_days} dias` : 'Sem prazo'} ·{' '}
                    {stage.requires_approval
                      ? 'Exige aprovação'
                      : 'Sem aprovação obrigatória'}
                  </small>
                </div>
                <button
                  className="inline-link"
                  onClick={() => editStage(stage)}
                >
                  Editar
                </button>
                <button
                  className="text-danger"
                  onClick={() => deactivateStage(stage)}
                >
                  Desativar
                </button>
              </div>
            ))}
          </div>
          <h3 className="stage-form-title">Adicionar etapa</h3>
          <form onSubmit={createStage}>
            <Field
              name="name"
              label="Nome da etapa"
              required
              value={newStage.name}
              onChange={event =>
                setNewStage({ ...newStage, name: event.target.value })
              }
            />
            <Field
              name="description"
              label="Descrição"
              value={newStage.description}
              onChange={event =>
                setNewStage({ ...newStage, description: event.target.value })
              }
            />
            <Field
              name="dueDays"
              label="Prazo em dias (opcional)"
              type="number"
              value={newStage.dueDays}
              onChange={event =>
                setNewStage({ ...newStage, dueDays: event.target.value })
              }
            />
            <label className="check-field">
              <input
                type="checkbox"
                checked={newStage.requiresApproval}
                onChange={event =>
                  setNewStage({
                    ...newStage,
                    requiresApproval: event.target.checked,
                  })
                }
              />{' '}
              Exigir aprovação para concluir a etapa
            </label>
            {newStage.requiresApproval && (
              <>
                <label className="field">
                  <span>Regra de aprovação</span>
                  <select
                    value={newStage.approvalMode}
                    onChange={event =>
                      setNewStage({
                        ...newStage,
                        approvalMode: event.target.value,
                      })
                    }
                  >
                    <option value="ALL">Todos devem aprovar</option>
                    <option value="MAJORITY">Maioria</option>
                    <option value="ANY">Qualquer aprovador</option>
                  </select>
                </label>
                <div className="approver-picks">
                  <span>Aprovadores obrigatórios</span>
                  {approverUsers.map(approver => (
                    <label key={approver.id}>
                      <input
                        type="checkbox"
                        checked={newStage.approverIds.includes(approver.id)}
                        onChange={event =>
                          setNewStage({
                            ...newStage,
                            approverIds: event.target.checked
                              ? [...newStage.approverIds, approver.id]
                              : newStage.approverIds.filter(
                                  id => id !== approver.id,
                                ),
                          })
                        }
                      />
                      {approver.name}
                    </label>
                  ))}
                  {!approverUsers.length && (
                    <small>
                      Cadastre usuários com papel Aprovador na administração.
                    </small>
                  )}
                </div>
              </>
            )}
            <label className="check-field">
              <input
                type="checkbox"
                checked={newStage.allowManualTransition}
                onChange={event =>
                  setNewStage({
                    ...newStage,
                    allowManualTransition: event.target.checked,
                  })
                }
              />{' '}
              Permitir movimentação manual
            </label>
            <button className="primary wide">Adicionar etapa</button>
          </form>
        </Modal>
      )}
      {timelineApplication && (
        <Modal
          title={`Histórico de ${timelineApplication.full_name}`}
          close={() => setTimelineApplication(null)}
        >
          <div className="timeline-list">
            {timeline.map(event => (
              <article
                className="timeline-event"
                key={`${event.event_type}-${event.event_id}`}
              >
                <span
                  className={`event-dot ${event.event_type.toLowerCase()}`}
                />
                <div>
                  <strong>{event.summary}</strong>
                  <small>
                    {event.actor || event.event_type} ·{' '}
                    {new Date(event.occurred_at).toLocaleString('pt-BR')}
                  </small>
                </div>
              </article>
            ))}
            {!timeline.length && (
              <p className="muted">Nenhum evento registrado.</p>
            )}
          </div>
          <label className="field note-entry">
            <span>Adicionar observação</span>
            <textarea
              rows={3}
              value={noteText}
              onChange={event => setNoteText(event.target.value)}
              placeholder="Registre um comentário sobre esta candidatura"
            />
          </label>
          <button
            className="primary wide"
            onClick={addNote}
            disabled={!noteText.trim()}
          >
            Salvar observação
          </button>
        </Modal>
      )}
    </div>
  );
}

function Metric({
  title,
  value,
}: {
  title: string;
  value: number | string | undefined | null;
}) {
  return (
    <CCard className="metric-card">
      <CCardBody>
        <span>{title}</span>
        <strong>{value ?? '—'}</strong>
      </CCardBody>
    </CCard>
  );
}

const SENIORITY_LEVELS = [
  'Aprendiz',
  'Estágio',
  'Auxiliar',
  'Assistente',
  'Júnior',
  'Pleno',
  'Sênior',
  'Especialista',
  'Líder / Tech Lead',
  'Supervisão',
  'Coordenação',
  'Gerência',
  'Diretoria',
  'Executivo / C-Level',
  'Outro',
];

function SenioritySelect({ defaultValue = '' }: { defaultValue?: string }) {
  return (
    <label className="field">
      <span>Nível da posição</span>
      <select name="seniorityLevel" defaultValue={defaultValue} required>
        <option value="" disabled>Selecione um nível</option>
        {!SENIORITY_LEVELS.includes(defaultValue) && defaultValue && (
          <option value={defaultValue}>{defaultValue}</option>
        )}
        {SENIORITY_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
      </select>
    </label>
  );
}

function Field({
  name,
  label,
  type = 'text',
  required = false,
  multiline = false,
  value,
  defaultValue,
  onChange,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  multiline?: boolean;
  value?: string;
  defaultValue?: string;
  onChange?: (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {multiline ? (
        <textarea
          name={name}
          required={required}
          rows={3}
          value={onChange ? value : undefined}
          defaultValue={onChange ? undefined : defaultValue}
          onChange={onChange ? event => onChange(event) : undefined}
        />
      ) : (
        <input
          name={name}
          type={type}
          required={required}
          value={onChange ? value : undefined}
          defaultValue={onChange ? undefined : (defaultValue ?? value)}
          onChange={onChange ? event => onChange(event) : undefined}
        />
      )}
    </label>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rt-modal-backdrop"
      onMouseDown={e => e.target === e.currentTarget && close()}
    >
      <section className="rt-modal">
        <header>
          <h2>{title}</h2>
          <button className="icon-button" onClick={close}>
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
