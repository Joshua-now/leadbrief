import { getAccessToken, refreshSession, isSupabaseConfigured } from './supabase';
import { triggerSessionExpired } from './session-manager';

export interface ApiRequestOptions extends RequestInit {
  skipAuth?: boolean;
}

export interface ApiError extends Error {
  status: number;
  statusText: string;
  body?: unknown;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  if (!isSupabaseConfigured()) {
    return {};
  }
  
  const token = await getAccessToken();
  if (token) {
    return { 'Authorization': `Bearer ${token}` };
  }
  return {};
}

async function makeRequest(url: string, options: ApiRequestOptions = {}): Promise<Response> {
  const { skipAuth = false, headers: customHeaders, ...restOptions } = options;
  
  const headers: Record<string, string> = {
    ...(customHeaders as Record<string, string> || {}),
  };
  
  if (!skipAuth) {
    const authHeaders = await getAuthHeaders();
    Object.assign(headers, authHeaders);
  }
  
  if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
    try {
      JSON.parse(options.body);
      headers['Content-Type'] = 'application/json';
    } catch {
    }
  }
  
  return fetch(url, {
    ...restOptions,
    headers,
    credentials: 'include',
  });
}

export async function apiRequest(url: string, options: ApiRequestOptions = {}): Promise<Response> {
  let response = await makeRequest(url, options);
  
  if (response.status === 401 && !options.skipAuth && isSupabaseConfigured()) {
    console.log('[API] Got 401, attempting silent refresh...');
    
    const refreshed = await refreshSession();
    
    if (refreshed) {
      console.log('[API] Session refreshed, retrying request...');
      response = await makeRequest(url, options);
      
      if (response.status === 401) {
        console.log('[API] Still 401 after refresh, session truly expired');
        triggerSessionExpired();
      }
    } else {
      console.log('[API] Refresh failed, session expired');
      triggerSessionExpired();
    }
  }
  
  return response;
}

export async function apiGet(url: string, options: ApiRequestOptions = {}): Promise<Response> {
  return apiRequest(url, { ...options, method: 'GET' });
}

export async function apiPost(url: string, body?: unknown, options: ApiRequestOptions = {}): Promise<Response> {
  return apiRequest(url, {
    ...options,
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function apiPut(url: string, body?: unknown, options: ApiRequestOptions = {}): Promise<Response> {
  return apiRequest(url, {
    ...options,
    method: 'PUT',
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function apiPatch(url: string, body?: unknown, options: ApiRequestOptions = {}): Promise<Response> {
  return apiRequest(url, {
    ...options,
    method: 'PATCH',
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function apiDelete(url: string, options: ApiRequestOptions = {}): Promise<Response> {
  return apiRequest(url, { ...options, method: 'DELETE' });
}

export async function apiJson<T>(url: string, options: ApiRequestOptions = {}): Promise<T> {
  const response = await apiGet(url, options);
  
  if (!response.ok) {
    const error = new Error(`API error: ${response.status}`) as ApiError;
    error.status = response.status;
    error.statusText = response.statusText;
    try {
      error.body = await response.json();
    } catch {
    }
    throw error;
  }
  
  return response.json();
}

export async function apiPostJson<T>(url: string, body?: unknown, options: ApiRequestOptions = {}): Promise<T> {
  const response = await apiPost(url, body, options);
  
  if (!response.ok) {
    const error = new Error(`API error: ${response.status}`) as ApiError;
    error.status = response.status;
    error.statusText = response.statusText;
    try {
      error.body = await response.json();
    } catch {
    }
    throw error;
  }
  
  return response.json();
}
