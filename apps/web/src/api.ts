import { Capacitor } from '@capacitor/core';
import { localApi } from './local-api';

let token = localStorage.getItem('daye_token');
const previewParams = new URLSearchParams(window.location.search);
const nativePreview = import.meta.env.DEV && (previewParams.get('previewNative') === '1' || previewParams.get('studio') === '1');
export const isLocalMode = Capacitor.isNativePlatform() || nativePreview;

export function getApiUrl() { return isLocalMode ? '' : (localStorage.getItem('daye_api_url') ?? import.meta.env.VITE_API_URL ?? '').replace(/\/$/, ''); }
export function setApiUrl(value: string) { if (isLocalMode) return; const clean = value.trim().replace(/\/$/, ''); clean ? localStorage.setItem('daye_api_url', clean) : localStorage.removeItem('daye_api_url'); }

export function hasToken() { return isLocalMode || Boolean(token); }
export function setToken(value: string | null) { if (isLocalMode) return; token = value; value ? localStorage.setItem('daye_token', value) : localStorage.removeItem('daye_token'); }

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (isLocalMode) return localApi<T>(path, init);
  const response = await fetch(`${getApiUrl()}${path}`, { ...init, headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
  if (response.status === 401) { setToken(null); window.dispatchEvent(new Event('daye-unauthorized')); throw new Error('登录已过期'); }
  const type = response.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error((data as { error?: string; message?: string })?.message ?? (data as { error?: string })?.error ?? `请求失败 (${response.status})`);
  return data as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const del = (path: string) => api<void>(path, { method: 'DELETE' });
