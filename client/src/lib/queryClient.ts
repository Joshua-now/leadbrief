import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getAccessToken, refreshSession, isSupabaseConfigured } from "./supabase";
import { triggerSessionExpired } from "@/lib/session-manager";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

async function getAuthHeaders(): Promise<HeadersInit> {
  if (isSupabaseConfigured()) {
    const token = await getAccessToken();
    if (token) {
      return { Authorization: `Bearer ${token}` };
    }
  }
  return {};
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const makeRequest = async () => {
    const authHeaders = await getAuthHeaders();
    const headers: HeadersInit = {
      ...authHeaders,
      ...(data ? { "Content-Type": "application/json" } : {}),
    };
    
    return fetch(url, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });
  };
  
  let res = await makeRequest();
  
  if (res.status === 401 && isSupabaseConfigured()) {
    console.log(`[API] Got 401 on ${method} ${url}, attempting silent refresh...`);
    const refreshed = await refreshSession();
    
    if (refreshed) {
      console.log(`[API] Session refreshed, retrying request...`);
      res = await makeRequest();
    }
    
    if (res.status === 401) {
      console.log(`[API] Still 401 after refresh, triggering session expired`);
      triggerSessionExpired();
    }
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey.join("/") as string;
    
    const makeRequest = async () => {
      const authHeaders = await getAuthHeaders();
      return fetch(url, {
        credentials: "include",
        headers: authHeaders,
      });
    };
    
    let res = await makeRequest();

    if (res.status === 401 && isSupabaseConfigured()) {
      console.log(`[Query] Got 401 on ${url}, attempting silent refresh...`);
      const refreshed = await refreshSession();
      
      if (refreshed) {
        console.log(`[Query] Session refreshed, retrying query...`);
        res = await makeRequest();
      }
      
      if (res.status === 401) {
        console.log(`[Query] Still 401 after refresh, triggering session expired`);
        triggerSessionExpired();
        if (unauthorizedBehavior === "returnNull") {
          return null;
        }
      }
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
