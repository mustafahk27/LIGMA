const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers, ...rest } = options;
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.message ?? body.error ?? message;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, message);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  color: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: { id: string; name: string; email: string; color: string };
}

export const auth = {
  register: (data: RegisterPayload) =>
    apiFetch<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data: LoginPayload) =>
    apiFetch<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  logout: (token: string) =>
    apiFetch<void>('/auth/logout', { method: 'POST', token }),
};

// ── Rooms ─────────────────────────────────────────────────────────────────────

export interface Room {
  id: string;
  name: string;
  created_at: string;
  members: { id: string; name: string; color: string; role: string }[];
}

export const rooms = {
  create: (name: string, token: string) =>
    apiFetch<Room>('/rooms', { method: 'POST', body: JSON.stringify({ name }), token }),
  get: (id: string, token: string) =>
    apiFetch<Room>(`/rooms/${id}`, { token }),
  list: (token: string) =>
    apiFetch<Room[]>('/rooms', { token }),
};

// ── Invites ───────────────────────────────────────────────────────────────────

export interface InviteResponse {
  invite_url: string;
  token: string;
}

export interface InviteInfo {
  room: { id: string; name: string };
  role: string;
  inviter: { name: string };
}

export const invites = {
  create: (roomId: string, email: string, role: string, token: string) =>
    apiFetch<InviteResponse>(`/rooms/${roomId}/invite`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
      token,
    }),
  info: (inviteToken: string) =>
    apiFetch<InviteInfo>(`/invites/${inviteToken}`),
  accept: (inviteToken: string, token: string) =>
    apiFetch<void>(`/invites/${inviteToken}/accept`, { method: 'POST', token, body: JSON.stringify({}) }),
};
