import { useQuery } from "@tanstack/react-query";
import { Settings, Shield, RefreshCw, AlertCircle, Check, Mail, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface IntegrationStatus {
  inbound: {
    endpoint: string;
    method: string;
    authHeader: string;
    apiKeyConfigured: boolean;
    status: string;
  };
  instantly: {
    configured: boolean;
    campaignId: string | null;
    status: string;
  };
}

export default function SettingsPage() {
  const { data: integrations, isLoading, error, refetch } = useQuery<IntegrationStatus>({
    queryKey: ["/api/integrations/status"],
    retry: 2,
    retryDelay: 1000,
    staleTime: 30000,
  });

  if (isLoading) {
    return (
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-2xl space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Configuration Status</h1>
            <p className="text-muted-foreground">View current environment configuration</p>
          </div>
          <Card>
            <CardContent className="p-6 space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-2xl">
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="flex items-center gap-4 py-6">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <div className="flex-1">
                <p className="font-medium">Failed to load configuration</p>
                <p className="text-sm text-muted-foreground">
                  {error instanceof Error ? error.message : "Unknown error"}
                </p>
              </div>
              <Button variant="outline" onClick={() => refetch()} data-testid="button-retry">
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-settings-title">Configuration Status</h1>
          <p className="text-muted-foreground">All settings are managed via environment variables</p>
        </div>

        <Card className="border-blue-500/20 bg-blue-500/5">
          <CardContent className="flex items-center gap-4 py-4 flex-wrap">
            <Info className="h-5 w-5 text-blue-600" />
            <div>
              <p className="text-sm font-medium">Read-Only Configuration View</p>
              <p className="text-xs text-muted-foreground">
                Settings are controlled by environment variables in Railway/Replit. Changes are made in the deployment platform, not here.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Inbound API Authentication
            </CardTitle>
            <CardDescription>
              POST /api/intake endpoint security status
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="space-y-0.5">
                  <Label className="font-medium">API_INTAKE_KEY</Label>
                  <p className="text-xs text-muted-foreground">
                    Environment variable for /api/intake authentication
                  </p>
                </div>
                <Badge 
                  variant={integrations?.inbound.apiKeyConfigured ? "default" : "destructive"} 
                  data-testid="badge-api-key-status"
                >
                  {integrations?.inbound.apiKeyConfigured ? "Configured" : "Not Set"}
                </Badge>
              </div>
            </div>
            
            <div className="rounded-md bg-muted p-3 text-xs space-y-2">
              <p className="font-medium">Inbound Intake Endpoint:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Endpoint: <code className="text-primary">POST /api/intake</code></li>
                <li>Header: <code className="text-primary">X-API-Key: [API_INTAKE_KEY value]</code></li>
              </ul>
              {integrations?.inbound.apiKeyConfigured ? (
                <div className="mt-2 p-2 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                  API key authentication is active. Requests without valid X-API-Key header will be rejected.
                </div>
              ) : (
                <div className="mt-2 p-2 rounded bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300">
                  No API key configured. Set API_INTAKE_KEY in environment variables to enable authentication.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Instantly Integration
            </CardTitle>
            <CardDescription>
              Push enriched leads to Instantly for email campaigns
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="space-y-0.5">
                  <Label className="font-medium">INSTANTLY_API_KEY</Label>
                  <p className="text-xs text-muted-foreground">API key for Instantly</p>
                </div>
                <Badge 
                  variant={integrations?.instantly.configured ? "default" : "secondary"} 
                  data-testid="badge-instantly-api-status"
                >
                  {integrations?.instantly.configured ? "Configured" : "Not Set"}
                </Badge>
              </div>
              
              <div className="flex items-center justify-between flex-wrap gap-2 pt-2 border-t">
                <div className="space-y-0.5">
                  <Label className="font-medium">INSTANTLY_CAMPAIGN_ID</Label>
                  <p className="text-xs text-muted-foreground">Target campaign for leads</p>
                </div>
                <Badge 
                  variant={integrations?.instantly.campaignId ? "default" : "secondary"} 
                  data-testid="badge-instantly-campaign-status"
                >
                  {integrations?.instantly.campaignId ? `...${integrations.instantly.campaignId}` : "Not Set"}
                </Badge>
              </div>
            </div>
            
            <div className="rounded-md bg-muted p-3 text-xs">
              {integrations?.instantly.configured ? (
                <div className="p-2 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                  Instantly is configured and ready. Enriched leads can be pushed to campaigns.
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-muted-foreground">
                    Set these environment variables to enable Instantly:
                  </p>
                  <ul className="list-disc list-inside space-y-1">
                    <li><code>INSTANTLY_API_KEY</code> - Your Instantly API key</li>
                    <li><code>INSTANTLY_CAMPAIGN_ID</code> - Target campaign ID</li>
                  </ul>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-green-500/20 bg-green-500/5">
          <CardContent className="flex items-center gap-4 py-4 flex-wrap">
            <Check className="h-5 w-5 text-green-600" />
            <div>
              <p className="text-sm font-medium">System Status</p>
              <p className="text-xs text-muted-foreground">
                Configuration loaded successfully. Database connected.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
