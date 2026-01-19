import { refreshSession as refreshSupabaseSession, ensureSupabaseConfigured } from './supabase';

type SessionExpiredCallback = () => void;

let sessionExpiredCallbacks: SessionExpiredCallback[] = [];
let isSessionExpired = false;

// Shared promise for concurrent refresh requests - all callers wait on the same promise
let refreshPromise: Promise<boolean> | null = null;

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
// Uses shared promise so concurrent callers all wait for the same refresh result
export async function trySilentRefresh(): Promise<boolean> {
  // If refresh is already in progress, wait for the same promise
  if (refreshPromise) {
    console.log('[Session] Refresh already in progress, waiting for result...');
    return refreshPromise;
  }
  
  // Create and store the refresh promise
  refreshPromise = (async () => {
    try {
      // Ensure Supabase config is loaded before checking if configured
      const isConfigured = await ensureSupabaseConfigured();
      
      if (!isConfigured) {
        console.log('[Session] Supabase not configured, skipping silent refresh');
        return false;
      }
      
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
    }
  })();
  
  try {
    return await refreshPromise;
  } finally {
    // Clear the promise after completion so future refreshes can happen
    refreshPromise = null;
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
