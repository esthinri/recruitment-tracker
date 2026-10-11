import { API_BASE_URL } from './config';

export type User = { id: string; name: string; email: string; role: string };
export type Vacancy = {
  id: string; code: string; title: string; status: string; priority: number;
  city?: string; state?: string; country?: string; work_model?: string;
  department?: string; target_close_at?: string;
};
export type Stage = {
  id: string; name: string; position: number; due_days?: number;
  requires_approval: boolean; approval_mode?: string; active: boolean;
};
export type Application = {
  id: string; vacancy_id: string; status: string; current_stage_id: string;
  stage_name: string; candidate_id: string; full_name: string; email: string;
  resume_url?: string; city?: string; state?: string; country?: string;
  work_model?: string; days_in_stage: number; pending_approvals: number;
  note_count: number; pending_activities: number;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

let sessionToken: string | null = null;
export function setSessionToken(token: string | null) { sessionToken = token; }

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, payload.error || 'Não foi possível concluir a operação.');
  return payload as T;
}
