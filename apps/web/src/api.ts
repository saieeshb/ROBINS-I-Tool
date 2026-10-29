/** Thin client for the local ROBer COP server. */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details: unknown = null,
    public current: unknown = null
  ) {
    super(message);
  }
}

const REVIEWER_KEY = 'robercop.reviewer';

export function currentReviewer(): string {
  try {
    return localStorage.getItem(REVIEWER_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setCurrentReviewer(name: string): void {
  try {
    localStorage.setItem(REVIEWER_KEY, name);
  } catch {
    /* private mode */
  }
}

function headers(json: boolean): Record<string, string> {
  const h: Record<string, string> = { 'X-Robercop': '1' };
  const r = currentReviewer();
  if (r) h['X-Reviewer'] = encodeURIComponent(r);
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function handle<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`, body?.details ?? null, body?.current ?? null);
  return body as T;
}

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    const json = body !== undefined ? JSON.stringify(body) : undefined;
    // keepalive lets a save started while the tab closes still reach the server (browsers cap such bodies at 64 KB).
    res = await fetch(`/api${url}`, { method, headers: headers(body !== undefined), body: json, keepalive: method !== 'GET' && !!json && json.length < 60_000 });
  } catch {
    throw new ApiError(0, 'Cannot reach the ROBer COP server. Is it still running?');
  }
  return handle<T>(res);
}

export const get = <T = any>(url: string) => api<T>('GET', url);
export const post = <T = any>(url: string, body: unknown = {}) => api<T>('POST', url, body);
export const patch = <T = any>(url: string, body: unknown) => api<T>('PATCH', url, body);
export const put = <T = any>(url: string, body: unknown) => api<T>('PUT', url, body);
export const del = <T = any>(url: string) => api<T>('DELETE', url);

export async function upload<T = any>(url: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', file);
  const res = await fetch(`/api${url}`, { method: 'POST', headers: headers(false), body: form });
  return handle<T>(res);
}

/** Downloads a file produced by the server (GET with headers, then a blob link). */
export async function download(url: string, fallbackName: string): Promise<void> {
  const res = await fetch(`/api${url}`, { headers: headers(false) });
  if (!res.ok) await handle(res);
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') ?? '';
  const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function postDownload(url: string, body: unknown, fallbackName: string): Promise<void> {
  const res = await fetch(`/api${url}`, { method: 'POST', headers: headers(true), body: JSON.stringify(body) });
  if (!res.ok) await handle(res);
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') ?? '';
  const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = m ? decodeURIComponent(m[1]) : fallbackName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const details = Array.isArray(err.details) ? (err.details as { message: string }[]).map((d) => d.message) : [];
    return details.length ? `${err.message}\n• ${details.slice(0, 8).join('\n• ')}${details.length > 8 ? `\n…and ${details.length - 8} more` : ''}` : err.message;
  }
  return (err as Error)?.message ?? String(err);
}
