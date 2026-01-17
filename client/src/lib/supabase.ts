import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  const configured = !!(
    import.meta.env.VITE_SUPABASE_URL && 
    import.meta.env.VITE_SUPABASE_ANON_KEY
  );
  console.log('[Supabase] isConfigured:', configured, {
    url: !!import.meta.env.VITE_SUPABASE_URL,
    key: !!import.meta.env.VITE_SUPABASE_ANON_KEY,
  });
  return configured;
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }
  
  if (!supabaseClient) {
    console.log('[Supabase] Creating client with persistence enabled');
    supabaseClient = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storage: localStorage,
          storageKey: 'leadbrief-auth',
        },
      }
    );
  }
  
  return supabaseClient;
}

export async function signInWithEmail(email: string, password: string) {
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
  
  // Sync session with backend
  if (data.session) {
    console.log('[Supabase] Syncing session with backend...');
    const response = await fetch('/api/auth/supabase/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ access_token: data.session.access_token }),
    });
    
    const result = await response.json();
    console.log('[Supabase] Backend session sync:', response.status, result);
    
    if (!response.ok) {
      throw new Error(result.error || 'Failed to sync session with server');
    }
  }
  
  return data;
}

export async function signUpWithEmail(email: string, password: string) {
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
  if (!client) {
    // Just call the backend logout
    window.location.href = '/api/logout';
    return;
  }
  
  await client.auth.signOut();
  window.location.href = '/api/logout';
}

export async function getSession() {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }
  
  const { data: { session } } = await client.auth.getSession();
  return session;
}

export async function getUser() {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }
  
  const { data: { user } } = await client.auth.getUser();
  return user;
}
