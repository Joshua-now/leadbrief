import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/models/auth";
import { getAccessToken, ensureSupabaseConfigured, signOut } from "@/lib/supabase";

const AUTH_QUERY_KEY = ["/api/auth/user"] as const;

async function logout(): Promise<void> {
  // Clear Supabase session first (if configured), then redirect to server logout
  try {
    const isConfigured = await ensureSupabaseConfigured();
    if (isConfigured) {
      // signOut() will clear Supabase session and redirect to /api/logout
      await signOut();
    } else {
      // For Replit Auth, just redirect to server logout
      window.location.href = "/api/logout";
    }
  } catch (e) {
    console.error('[Auth] Logout error:', e);
    // Fallback: force redirect even if signOut fails
    window.location.href = "/api/logout";
  }
}

export function useAuth() {
  const queryClient = useQueryClient();
  
  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: AUTH_QUERY_KEY,
    queryFn: async () => {
      const headers: HeadersInit = {};
      
      const isConfigured = await ensureSupabaseConfigured();
      if (isConfigured) {
        const token = await getAccessToken();
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
      }
      
      const response = await fetch("/api/auth/user", {
        credentials: "include",
        headers,
        cache: "no-store",
      });

      if (response.status === 401) {
        return null;
      }

      // Handle 304 Not Modified - reuse cached data
      if (response.status === 304) {
        return queryClient.getQueryData<User | null>(AUTH_QUERY_KEY) ?? null;
      }

      if (!response.ok) {
        throw new Error(`${response.status}: ${response.statusText}`);
      }

      return response.json();
    },
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.setQueryData(AUTH_QUERY_KEY, null);
    },
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
  };
}
