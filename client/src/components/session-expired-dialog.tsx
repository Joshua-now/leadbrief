import { useState, useEffect } from "react";
import { LogIn } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { onSessionExpired, clearSessionExpired } from "@/lib/session-manager";
import { ensureSupabaseConfigured } from "@/lib/supabase";

export function SessionExpiredDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [authProvider, setAuthProvider] = useState<string | null>(null);

  useEffect(() => {
    // Fetch auth config to determine provider
    fetch('/api/auth/config', { cache: 'no-store' })
      .then(res => res.json())
      .then(data => {
        console.log('[Auth] SessionExpiredDialog detected provider:', data.provider);
        setAuthProvider(data.provider);
      })
      .catch(err => {
        console.error('[Auth] Failed to fetch auth config:', err);
        setAuthProvider('replit'); // Default to replit if config fetch fails
      });
  }, []);

  useEffect(() => {
    const unsubscribe = onSessionExpired(() => {
      setIsOpen(true);
    });

    return unsubscribe;
  }, []);

  const handleLogin = async () => {
    clearSessionExpired();
    
    // Determine login route based on auth provider
    const isSupabase = await ensureSupabaseConfigured();
    const loginPath = isSupabase ? "/login" : "/api/login";
    
    console.log('[Auth] SessionExpiredDialog login redirect:', { 
      authProvider, 
      isSupabaseConfigured: isSupabase,
      loginPath 
    });
    
    // For Replit auth, use window.location.href to trigger server-side OIDC
    // For Supabase auth, also use window.location.href to ensure clean state
    window.location.href = loginPath;
  };

  const handleClose = () => {
    setIsOpen(false);
    clearSessionExpired();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogIn className="h-5 w-5" />
            Session Expired
          </DialogTitle>
          <DialogDescription>
            Your session has expired. Please log in again to continue.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={handleClose} data-testid="button-dismiss-session">
            Dismiss
          </Button>
          <Button onClick={handleLogin} data-testid="button-login-session">
            <LogIn className="mr-2 h-4 w-4" />
            Log In
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
