import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;
let supabaseConfig: { url: string; anonKey: string } | null = null;
let configFetched = false;
let configPromise: Promise<void> | null = null;

// Fetch Supabase config from server (for runtime configuration)
async function fetchSupabaseConfig(): Promise<void> {
  if (configFetched && supabaseConfig) return;
  if (configPromise) return configPromise;
  
  configPromise = (async () => {
    try {
      // Use cache: no-store to prevent 304 responses without body
      const response = await fetch('/api/auth/config', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (response.ok) {
        const data = await response.json();
        console.log('[Supabase] Config response:', { provider: data.provider, supabaseConfigured: data.supabaseConfigured });
        if (data.supabase) {
          supabaseConfig = {
            url: data.supabase.url,
            anonKey: data.supabase.anonKey,
          };
          console.log('[Supabase] Config fetched from server successfully');
          configFetched = true;
        } else {
          console.log('[Supabase] No supabase config in response');
        }
      } else {
        console.error('[Supabase] Config fetch failed with status:', response.status);
      }
    } catch (e) {
      console.error('[Supabase] Failed to fetch config:', e);
    }
  })();
  
  return configPromise;
}

// Check build-time env vars first, then runtime config
function getConfig(): { url: string; anonKey: string } | null {
  // Try build-time env vars first
  if (import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY) {
    return {
      url: import.meta.env.VITE_SUPABASE_URL,
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    };
  }
  // Fall back to runtime config
  return supabaseConfig;
}

export function isSupabaseConfigured(): boolean {
  const config = getConfig();
  const configured = !!(config?.url && config?.anonKey);
  console.log('[Supabase] isConfigured:', configured);
  return configured;
}

// Async version that fetches config first
export async function ensureSupabaseConfigured(): Promise<boolean> {
  await fetchSupabaseConfig();
  return isSupabaseConfigured();
}

export function getSupabaseClient(): SupabaseClient | null {
  const config = getConfig();
  if (!config) {
    return null;
  }
  
  if (!supabaseClient) {
    console.log('[Supabase] Creating client with persistence enabled');
    supabaseClient = createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage: localStorage,
        storageKey: 'leadbrief-auth',
      },
    });
  }
  
  return supabaseClient;
}

// Async version that ensures config is loaded
export async function getSupabaseClientAsync(): Promise<SupabaseClient | null> {
  await fetchSupabaseConfig();
  return getSupabaseClient();
}

export async function signInWithEmail(email: string, password: string) {
  await fetchSupabaseConfig();
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase is not configured');
  }
  
  console.log('[Supabase] Attempting sign in for:', email);
  
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  
  if (error) {
    console.error('[Supabase] Sign in error:', error.message);
    throw error;
  }
  
  console.log('[Supabase] Sign in successful, session:', !!data.session);
  
  return data;
}

export async function signUpWithEmail(email: string, password: string) {
  await fetchSupabaseConfig();
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase is not configured');
  }
  
  const { data, error } = await client.auth.signUp({
    email,
    password,
  });
  
  if (error) {
    throw error;
  }
  
  return data;
}

export async function signOut() {
  const client = getSupabaseClient();
  if (client) {
    await client.auth.signOut();
  }
  window.location.href = '/api/logout';
}

export async function getSession() {
  await fetchSupabaseConfig();
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }
  
  const { data: { session } } = await client.auth.getSession();
  return session;
}

export async function getAccessToken(): Promise<string | null> {
  const session = await getSession();
  return session?.access_token || null;
}

export async function getUser() {
  await fetchSupabaseConfig();
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }
  
  const { data: { user } } = await client.auth.getUser();
  return user;
}
