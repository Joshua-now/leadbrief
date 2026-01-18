import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Settings, Key, Bell, Shield, Save, RefreshCw, AlertCircle, Check, Zap, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface AppSettings {
  id: string;
  webhookUrl: string | null;
  apiKeyEnabled: boolean;
  emailNotifications: boolean;
  autoRetryEnabled: boolean;
  maxRetries: number;
}

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
  const { toast } = useToast();
  const [webhookUrl, setWebhookUrl] = useState("");
  const [apiKeyEnabled, setApiKeyEnabled] = useState(false);
  const [emailNotifications, setEmailNotifications] = useState(false);
  const [autoRetryEnabled, setAutoRetryEnabled] = useState(true);
  const [maxRetries, setMaxRetries] = useState(3);

  const { data: settings, isLoading, error } = useQuery<AppSettings>({
    queryKey: ["/api/settings"],
  });

  const { data: integrations } = useQuery<IntegrationStatus>({
    queryKey: ["/api/integrations/status"],
  });

  const saveMutation = useMutation({
    mutationFn: async (data: Partial<AppSettings>) => {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to save settings");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({
        title: "Settings saved",
        description: "Your settings have been updated successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to save",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    saveMutation.mutate({
      webhookUrl,
      apiKeyEnabled,
      emailNotifications,
      autoRetryEnabled,
      maxRetries,
    });
  };

  useEffect(() => {
    if (settings) {
      setWebhookUrl(settings.webhookUrl || "");
      setApiKeyEnabled(settings.apiKeyEnabled);
      setEmailNotifications(settings.emailNotifications);
      setAutoRetryEnabled(settings.autoRetryEnabled);
      setMaxRetries(settings.maxRetries);
    }
  }, [settings]);

  if (isLoading) {
    return (
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-2xl space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
            <p className="text-muted-foreground">Manage your application settings</p>
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
                <p className="font-medium">Failed to load settings</p>
                <p className="text-sm text-muted-foreground">
                  {error instanceof Error ? error.message : "Unknown error"}
                </p>
              </div>
              <Button variant="outline" onClick={() => window.location.reload()} data-testid="button-retry">
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
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-settings-title">Settings</h1>
            <p className="text-muted-foreground">Manage your application settings</p>
          </div>
          <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-settings">
            {saveMutation.isPending ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Changes
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Inbound API (External to LeadBrief)
            </CardTitle>
            <CardDescription>
              Configure how external systems send leads TO LeadBrief via POST /api/intake
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="space-y-0.5">
                <Label>Require API Key for Inbound</Label>
                <p className="text-xs text-muted-foreground">
                  When enabled, inbound requests must include X-API-Key header
                </p>
              </div>
              <Switch
                checked={apiKeyEnabled}
                onCheckedChange={setApiKeyEnabled}
                data-testid="switch-api-key"
              />
            </div>
            <div className="rounded-md bg-muted p-3 text-xs space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="font-medium">Inbound Intake Endpoint:</p>
                <Badge variant={integrations?.inbound.apiKeyConfigured ? "default" : "secondary"} data-testid="badge-api-key-status">
                  API_INTAKE_KEY: {integrations?.inbound.apiKeyConfigured ? "Configured" : "Not Set"}
                </Badge>
              </div>
              <code className="text-primary block">POST /api/intake</code>
              <p className="text-muted-foreground">
                Header: <code>X-API-Key: [your API_INTAKE_KEY]</code>
              </p>
              {apiKeyEnabled && !integrations?.inbound.apiKeyConfigured && (
                <p className="text-orange-600 dark:text-orange-400">
                  Set API_INTAKE_KEY in environment variables to protect this endpoint
                </p>
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
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="space-y-0.5">
                <Label>Instantly Status</Label>
                <p className="text-xs text-muted-foreground">
                  Configure via INSTANTLY_API_KEY and INSTANTLY_CAMPAIGN_ID env vars
                </p>
              </div>
              <Badge variant={integrations?.instantly.configured ? "default" : "secondary"} data-testid="badge-instantly-status">
                {integrations?.instantly.configured ? "Ready" : "Not Configured"}
              </Badge>
            </div>
            {integrations?.instantly.configured && integrations.instantly.campaignId && (
              <div className="rounded-md bg-muted p-3 text-xs">
                <p className="text-muted-foreground">
                  Campaign ID: <code>{integrations.instantly.campaignId}</code>
                </p>
              </div>
            )}
            {!integrations?.instantly.configured && (
              <div className="rounded-md bg-muted p-3 text-xs">
                <p className="text-muted-foreground">
                  Set these environment variables to enable Instantly:
                </p>
                <ul className="list-disc list-inside mt-1 space-y-1">
                  <li><code>INSTANTLY_API_KEY</code></li>
                  <li><code>INSTANTLY_CAMPAIGN_ID</code></li>
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Outbound to GoHighLevel
            </CardTitle>
            <CardDescription>
              Configure webhook URL where LeadBrief sends enriched results TO GoHighLevel
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="webhook-url">GHL Webhook URL (Outbound)</Label>
              <Input
                id="webhook-url"
                placeholder="https://services.leadconnectorhq.com/hooks/..."
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                data-testid="input-webhook-url"
              />
              <p className="text-xs text-muted-foreground">
                LeadBrief will POST enriched contact data to this URL after processing
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Notifications
            </CardTitle>
            <CardDescription>
              Configure notification preferences
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="space-y-0.5">
                <Label>Email Notifications</Label>
                <p className="text-xs text-muted-foreground">
                  Receive email alerts for job completions
                </p>
              </div>
              <Switch
                checked={emailNotifications}
                onCheckedChange={setEmailNotifications}
                data-testid="switch-email-notifications"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Processing Settings
            </CardTitle>
            <CardDescription>
              Configure job processing behavior
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="space-y-0.5">
                <Label>Auto-Retry Failed Items</Label>
                <p className="text-xs text-muted-foreground">
                  Automatically retry failed enrichment attempts
                </p>
              </div>
              <Switch
                checked={autoRetryEnabled}
                onCheckedChange={setAutoRetryEnabled}
                data-testid="switch-auto-retry"
              />
            </div>
            
            {autoRetryEnabled && (
              <div className="space-y-2">
                <Label htmlFor="max-retries">Maximum Retries</Label>
                <Input
                  id="max-retries"
                  type="number"
                  min={1}
                  max={10}
                  value={maxRetries}
                  onChange={(e) => setMaxRetries(parseInt(e.target.value) || 3)}
                  className="w-24"
                  data-testid="input-max-retries"
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-green-500/20 bg-green-500/5">
          <CardContent className="flex items-center gap-4 py-4 flex-wrap">
            <Check className="h-5 w-5 text-green-600" />
            <div>
              <p className="text-sm font-medium">System Status</p>
              <p className="text-xs text-muted-foreground">
                All systems operational. Database connected.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
