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

export function SessionExpiredDialog() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = onSessionExpired(() => {
      setIsOpen(true);
    });

    return unsubscribe;
  }, []);

  const handleLogin = () => {
    clearSessionExpired();
    window.location.href = "/api/login";
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
