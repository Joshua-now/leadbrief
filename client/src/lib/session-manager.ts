import { refreshSession as refreshSupabaseSession, isSupabaseConfigured } from './supabase';

type SessionExpiredCallback = () => void;

let sessionExpiredCallbacks: SessionExpiredCallback[] = [];
let isSessionExpired = false;
let isRefreshing = false;

export function onSessionExpired(callback: SessionExpiredCallback): () => void {
  sessionExpiredCallbacks.push(callback);
  
  if (isSessionExpired) {
    callback();
  }
  
  return () => {
    sessionExpiredCallbacks = sessionExpiredCallbacks.filter(cb => cb !== callback);
  };
}

// Try silent refresh first - only trigger expired if refresh fails
export async function trySilentRefresh(): Promise<boolean> {
  // Prevent multiple concurrent refresh attempts
  if (isRefreshing) {
    console.log('[Session] Refresh already in progress, waiting...');
    return false;
  }
  
  // Only try Supabase refresh if Supabase is configured
  if (!isSupabaseConfigured()) {
    console.log('[Session] Supabase not configured, skipping silent refresh');
    return false;
  }
  
  isRefreshing = true;
  try {
    console.log('[Session] Attempting silent session refresh...');
    const refreshed = await refreshSupabaseSession();
    
    if (refreshed) {
      console.log('[Session] Silent refresh successful');
      clearSessionExpired(); // Clear any pending expired state
      return true;
    }
    
    console.log('[Session] Silent refresh failed');
    return false;
  } catch (e) {
    console.error('[Session] Silent refresh error:', e);
    return false;
  } finally {
    isRefreshing = false;
  }
}

export function triggerSessionExpired(): void {
  if (isSessionExpired) return;
  
  isSessionExpired = true;
  console.log('[Session] Session expired, triggering callbacks');
  sessionExpiredCallbacks.forEach(cb => cb());
}

export function clearSessionExpired(): void {
  isSessionExpired = false;
  console.log('[Session] Session expired state cleared');
}

export function getIsSessionExpired(): boolean {
  return isSessionExpired;
}
