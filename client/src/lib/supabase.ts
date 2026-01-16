import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return !!(
    import.meta.env.VITE_SUPABASE_URL && 
    import.meta.env.VITE_SUPABASE_ANON_KEY
  );
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }
  
  if (!supabaseClient) {
    supabaseClient = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY
    );
  }
  
  return supabaseClient;
}

export async function signInWithEmail(email: string, password: string) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Supabase is not configured');
  }
  
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  
  if (error) {
    throw error;
  }
  
  // Sync session with backend
  if (data.session) {
    await fetch('/api/auth/supabase/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: data.session.access_token }),
    });
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
