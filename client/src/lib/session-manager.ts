type SessionExpiredCallback = () => void;

let sessionExpiredCallbacks: SessionExpiredCallback[] = [];
let isSessionExpired = false;

export function onSessionExpired(callback: SessionExpiredCallback): () => void {
  sessionExpiredCallbacks.push(callback);
  
  if (isSessionExpired) {
    callback();
  }
  
  return () => {
    sessionExpiredCallbacks = sessionExpiredCallbacks.filter(cb => cb !== callback);
  };
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
