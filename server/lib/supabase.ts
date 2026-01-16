import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return !!(
    process.env.SUPABASE_URL && 
    process.env.SUPABASE_ANON_KEY
  );
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }
  
  if (!supabaseClient) {
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
    return null;
  }
  
  try {
    const { data: { user }, error } = await client.auth.getUser(accessToken);
    if (error || !user) {
      return null;
    }
    return { user };
  } catch {
    return null;
  }
}
