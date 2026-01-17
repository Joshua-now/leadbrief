import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;
let configLogged = false;

export function isSupabaseConfigured(): boolean {
  const hasUrl = !!process.env.SUPABASE_URL;
  const hasKey = !!process.env.SUPABASE_ANON_KEY;
  const configured = hasUrl && hasKey;
  
  if (!configLogged) {
    console.log(`[Supabase Server] isConfigured: ${configured} (url: ${hasUrl}, key: ${hasKey})`);
    configLogged = true;
  }
  
  return configured;
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }
  
  if (!supabaseClient) {
    console.log('[Supabase Server] Creating Supabase client');
    supabaseClient = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!
    );
  }
  
  return supabaseClient;
}

export function getSupabaseServiceClient(): SupabaseClient | null {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export async function verifySupabaseToken(accessToken: string): Promise<{ user: any } | null> {
  const client = getSupabaseClient();
  if (!client) {
    console.log('[Supabase Server] verifyToken failed: client not configured');
    return null;
  }
  
  try {
    const { data: { user }, error } = await client.auth.getUser(accessToken);
    if (error) {
      console.log('[Supabase Server] verifyToken error:', error.message);
      return null;
    }
    if (!user) {
      console.log('[Supabase Server] verifyToken: no user returned');
      return null;
    }
    console.log('[Supabase Server] verifyToken success for user:', user.id);
    return { user };
  } catch (err: any) {
    console.log('[Supabase Server] verifyToken exception:', err?.message);
    return null;
  }
}
