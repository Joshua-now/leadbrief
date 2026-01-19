import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { FileText, Clock, CheckCircle2, XCircle, Loader2, AlertCircle, RefreshCw, RotateCcw, Download, ChevronDown, ChevronUp, FolderOpen, Shield, Archive, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { exportFile } from "@/lib/export-utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BulkJob } from "@shared/schema";

interface AuthConfig {
  provider: string;
  isEnabled: boolean;
  supabaseConfigured: boolean;
}

interface ExportHealthData {
  database: {
    companies: number;
    contacts: number;
    jobs: number;
    jobItems: number;
  };
  quality: {
    avgQualityScore: string;
    completionRate: string;
  };
}

interface ExportFile {
  name: string;
  createdAt: string;
  size: number;
  entityType: string;
  entityId: string | null;
}

const statusConfig: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  pending: { icon: Clock, color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400", label: "Pending" },
  processing: { icon: Loader2, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", label: "Processing" },
  complete: { icon: CheckCircle2, color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", label: "Complete" },
  completed: { icon: CheckCircle2, color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", label: "Complete" },
  failed: { icon: XCircle, color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", label: "Failed" },
};

export default function JobsPage() {
  const [filter, setFilter] = useState<'active' | 'archived'>('active');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [jobToDelete, setJobToDelete] = useState<BulkJob | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  
  const { data: jobs, isLoading, error, refetch } = useQuery<BulkJob[]>({
    queryKey: ["/api/jobs", filter],
    queryFn: async () => {
      const response = await fetch(`/api/jobs?filter=${filter}`, { credentials: 'include' });
      if (!response.ok) throw new Error(`${response.status}`);
      return response.json();
    },
    refetchInterval: 5000,
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const retryMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const response = await apiRequest("POST", `/api/jobs/${jobId}/retry`);
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "Job Retry Started",
        description: "The job is being reprocessed.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Retry Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const recoverMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/jobs/recover");
      return await response.json() as { recoveredJobs: number };
    },
    onSuccess: (data) => {
      toast({
        title: "Recovery Complete",
        description: data.recoveredJobs > 0 
          ? `Recovered ${data.recoveredJobs} stale job(s).`
          : "No stale jobs found.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Recovery Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const response = await apiRequest("POST", `/api/jobs/${jobId}/archive`);
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "Job Archived",
        description: "The job has been moved to the archive.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Archive Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const response = await apiRequest("DELETE", `/api/jobs/${jobId}`, { confirmDelete: "DELETE" });
      return await response.json();
    },
    onSuccess: (data: { message: string; itemsDeleted: number }) => {
      toast({
        title: "Job Deleted",
        description: data.message,
      });
      setDeleteDialogOpen(false);
      setJobToDelete(null);
      setDeleteConfirmText("");
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Delete Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDeleteClick = (job: BulkJob) => {
    setJobToDelete(job);
    setDeleteConfirmText("");
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = () => {
    if (deleteConfirmText === "DELETE" && jobToDelete) {
      deleteMutation.mutate(jobToDelete.id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
            <p className="text-muted-foreground">Track import and enrichment progress</p>
          </div>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <div className="flex items-center gap-4">
                    <Skeleton className="h-10 w-10 rounded-md" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-5 w-48" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                    <Skeleton className="h-6 w-20" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    const isAuthError = error instanceof Error && 
      (error.message.includes('401') || error.message.includes('Unauthorized') || error.message.includes('unauthorized'));
    
    return (
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl">
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="flex items-center gap-4 py-6">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <div className="flex-1">
                <p className="font-medium">
                  {isAuthError ? "Session expired" : "Failed to load jobs"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {isAuthError 
                    ? "Your session has ended. Please log in again to continue."
                    : (error instanceof Error ? error.message : "Unknown error")}
                </p>
              </div>
              {isAuthError ? (
                <Button variant="default" onClick={() => window.location.href = '/api/login'} data-testid="button-login">
                  Log In
                </Button>
              ) : (
                <Button variant="outline" onClick={() => refetch()} data-testid="button-retry">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Retry
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const hasProcessingJobs = jobs?.some(j => j.status === "processing");
  const hasFailedJobs = jobs?.some(j => j.status === "failed");

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
            <p className="text-muted-foreground">Track import and enrichment progress</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center rounded-md border bg-muted/50 p-1">
              <Button
                variant={filter === 'active' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setFilter('active')}
                data-testid="button-filter-active"
              >
                Active
              </Button>
              <Button
                variant={filter === 'archived' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setFilter('archived')}
                data-testid="button-filter-archived"
              >
                <Archive className="mr-2 h-4 w-4" />
                Archived
              </Button>
            </div>
            {hasProcessingJobs && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => recoverMutation.mutate()}
                disabled={recoverMutation.isPending}
                data-testid="button-recover"
              >
                {recoverMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="mr-2 h-4 w-4" />
                )}
                Recover Stale
              </Button>
            )}
            <Button variant="outline" onClick={() => refetch()} size="sm" data-testid="button-refresh">
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        {!jobs || jobs.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <FileText className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium">No jobs yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Import some data to see jobs here
              </p>
              <Button className="mt-4" asChild>
                <a href="/" data-testid="link-import">Go to Import</a>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {jobs.map((job) => (
              <JobCard 
                key={job.id} 
                job={job} 
                onRetry={() => retryMutation.mutate(job.id)}
                isRetrying={retryMutation.isPending}
                onArchive={() => archiveMutation.mutate(job.id)}
                isArchiving={archiveMutation.isPending}
                onDelete={() => handleDeleteClick(job)}
                showArchive={filter === 'active'}
              />
            ))}
          </div>
        )}

        <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-destructive">
                <Trash2 className="h-5 w-5" />
                Delete Job
              </DialogTitle>
              <DialogDescription>
                This action cannot be undone. This will permanently delete the job
                <strong className="block mt-2">&quot;{jobToDelete?.name}&quot;</strong>
                and its {jobToDelete?.totalRecords || 0} import records. Contacts created from this job will remain and must be deleted separately.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="confirm-delete">
                Type <strong>DELETE</strong> to confirm
              </Label>
              <Input
                id="confirm-delete"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                className="mt-2"
                data-testid="input-confirm-delete"
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteDialogOpen(false)}
                data-testid="button-cancel-delete"
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmDelete}
                disabled={deleteConfirmText !== "DELETE" || deleteMutation.isPending}
                data-testid="button-confirm-delete"
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Delete Job
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        
        <RecentExportsPanel />
        <DiagnosticsPanel />
      </div>
    </div>
  );
}

function JobCard({ job, onRetry, isRetrying, onArchive, isArchiving, onDelete, showArchive }: { 
  job: BulkJob; 
  onRetry: () => void; 
  isRetrying: boolean;
  onArchive: () => void;
  isArchiving: boolean;
  onDelete: () => void;
  showArchive: boolean;
}) {
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();
  const status = statusConfig[job.status || "pending"] || statusConfig.pending;
  const StatusIcon = status.icon;
  const progress = job.totalRecords
    ? Math.round(((job.successful || 0) + (job.failed || 0)) / job.totalRecords * 100)
    : job.progress || 0;

  const canRetry = job.status === "failed" || (job.status === "complete" && (job.failed || 0) > 0);
  const canExport = job.status === "complete" || job.status === "completed";
  const canArchive = showArchive && (job.status === "complete" || job.status === "completed" || job.status === "failed");

  const handleExport = async (format: 'csv' | 'json', scope: 'full' | 'core' = 'full') => {
    if ((job.successful || 0) === 0) {
      toast({ 
        title: "No Data to Export", 
        description: "No completed records to export. Process some records first.", 
        variant: "destructive" 
      });
      return;
    }
    
    setIsExporting(true);
    const prefix = scope === 'core' ? 'core-' : '';
    const result = await exportFile({
      endpoint: `/api/jobs/${job.id}/export?scope=${scope}`,
      format,
      filename: `${prefix}export-${job.id}.${format}`,
    });
    setIsExporting(false);
    
    if (!result.success) {
      console.error(`[Job ${job.id} Export] Failed:`, result.error);
    }
  };

  return (
    <Card className="hover-elevate transition-shadow" data-testid={`card-job-${job.id}`}>
      <CardContent className="p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
            <FileText className="h-5 w-5 text-muted-foreground" />
          </div>
          
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-medium truncate" data-testid={`text-job-name-${job.id}`}>
                {job.name}
              </h3>
              <Badge variant="secondary" className={status.color}>
                {job.status === "processing" && (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                )}
                {job.status !== "processing" && (
                  <StatusIcon className="mr-1 h-3 w-3" />
                )}
                {status.label}
              </Badge>
            </div>
            
            <div className="mt-1 flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
              <span>{job.totalRecords || 0} records</span>
              {job.sourceFormat && (
                <span className="capitalize">{job.sourceFormat.replace("_", " ")}</span>
              )}
              {job.createdAt && (
                <span>
                  {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
                </span>
              )}
            </div>

            {(job.status === "processing" || progress > 0) && (
              <div className="mt-3 space-y-1">
                <Progress value={progress} className="h-2" />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{progress}% complete</span>
                  <span>
                    <span className="text-green-600 dark:text-green-400">{job.successful || 0} success</span>
                    {(job.failed || 0) > 0 && (
                      <span className="text-red-600 dark:text-red-400">, {job.failed} failed</span>
                    )}
                    {(job.duplicatesFound || 0) > 0 && (
                      <span className="text-yellow-600 dark:text-yellow-400">, {job.duplicatesFound} duplicates</span>
                    )}
                  </span>
                </div>
              </div>
            )}

            {job.lastError && (
              <div className="mt-2 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{job.lastError}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {canExport && (
              <>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => handleExport('csv', 'core')}
                  disabled={isExporting}
                  data-testid={`button-export-core-${job.id}`}
                >
                  {isExporting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Core CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleExport('csv', 'full')}
                  disabled={isExporting}
                  data-testid={`button-export-csv-${job.id}`}
                >
                  {isExporting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Full CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleExport('json', 'full')}
                  disabled={isExporting}
                  data-testid={`button-export-json-${job.id}`}
                >
                  {isExporting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  JSON
                </Button>
              </>
            )}
            {canRetry && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRetry}
                disabled={isRetrying}
                data-testid={`button-retry-${job.id}`}
              >
                {isRetrying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Retry
                  </>
                )}
              </Button>
            )}
            {canArchive && (
              <Button
                variant="outline"
                size="sm"
                onClick={onArchive}
                disabled={isArchiving}
                data-testid={`button-archive-${job.id}`}
              >
                {isArchiving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Archive className="mr-2 h-4 w-4" />
                    Archive
                  </>
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              className="text-muted-foreground hover:text-destructive"
              data-testid={`button-delete-${job.id}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RecentExportsPanel() {
  const [isExpanded, setIsExpanded] = useState(false);
  const { toast } = useToast();
  
  const { data, isLoading, error } = useQuery<{ exports: ExportFile[]; count: number }>({
    queryKey: ["/api/exports"],
    enabled: isExpanded,
  });
  
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
  
  const handleDownload = async (filename: string) => {
    try {
      const a = document.createElement('a');
      a.href = `/api/exports/${filename}`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast({
        title: "Download Started",
        description: `Downloading ${filename}`,
      });
    } catch (error) {
      toast({
        title: "Download Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };
  
  return (
    <Card className="mt-6" data-testid="panel-recent-exports">
      <CardHeader className="cursor-pointer pb-3" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Recent Exports</CardTitle>
            <Badge variant="secondary" className="text-xs">Debug</Badge>
          </div>
          <Button variant="ghost" size="icon" data-testid="button-toggle-exports">
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      
      {isExpanded && (
        <CardContent className="pt-0">
          {isLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}
          
          {error && (
            <div className="text-sm text-destructive">
              Failed to load exports: {error instanceof Error ? error.message : "Unknown error"}
            </div>
          )}
          
          {data && data.exports.length === 0 && (
            <div className="py-4 text-center text-sm text-muted-foreground">
              No export files found. Run an export to see files here.
            </div>
          )}
          
          {data && data.exports.length > 0 && (
            <div className="space-y-2">
              {data.exports.map((file) => (
                <div
                  key={file.name}
                  className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm hover-elevate"
                  data-testid={`export-file-${file.name}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{file.name}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                      <span>{formatFileSize(file.size)}</span>
                      <span>{formatDistanceToNow(new Date(file.createdAt), { addSuffix: true })}</span>
                      {file.entityType && (
                        <Badge variant="outline" className="text-xs">
                          {file.entityType}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDownload(file.name)}
                    data-testid={`button-download-${file.name}`}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function DiagnosticsPanel() {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const { data: authConfig } = useQuery<AuthConfig>({
    queryKey: ["/api/auth/config"],
    enabled: isExpanded,
  });
  
  const { data: exportHealth, isLoading: healthLoading } = useQuery<ExportHealthData>({
    queryKey: ["/api/debug/export-health"],
    enabled: isExpanded,
  });
  
  const { data: recentExports } = useQuery<{ exports: ExportFile[]; count: number }>({
    queryKey: ["/api/exports"],
    enabled: isExpanded,
  });
  
  return (
    <Card className="mt-4" data-testid="panel-diagnostics">
      <CardHeader className="cursor-pointer pb-3" onClick={() => setIsExpanded(prev => !prev)}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Diagnostics</CardTitle>
            <Badge variant="secondary" className="text-xs">Admin</Badge>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            data-testid="button-toggle-diagnostics"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(prev => !prev);
            }}
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      
      {isExpanded && (
        <CardContent className="pt-0 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Authentication</h4>
              <div className="text-xs space-y-1 text-muted-foreground">
                <div className="flex justify-between">
                  <span>Provider:</span>
                  <Badge variant="outline" className="text-xs">
                    {authConfig?.provider || 'loading...'}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span>Auth Enabled:</span>
                  <span>{authConfig?.isEnabled ? 'Yes' : 'No'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Supabase:</span>
                  <span>{authConfig?.supabaseConfigured ? 'Configured' : 'Not configured'}</span>
                </div>
              </div>
            </div>
            
            <div className="space-y-2">
              <h4 className="text-sm font-medium">API Configuration</h4>
              <div className="text-xs space-y-1 text-muted-foreground">
                <div className="flex justify-between">
                  <span>Base URL:</span>
                  <span className="truncate max-w-32">{window.location.origin}</span>
                </div>
                <div className="flex justify-between">
                  <span>Environment:</span>
                  <Badge variant="outline" className="text-xs">
                    {import.meta.env.MODE}
                  </Badge>
                </div>
              </div>
            </div>
          </div>
          
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Database Stats</h4>
            {healthLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : exportHealth ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div className="bg-muted/50 rounded p-2">
                  <div className="text-muted-foreground">Companies</div>
                  <div className="font-medium">{exportHealth.database?.companies || 0}</div>
                </div>
                <div className="bg-muted/50 rounded p-2">
                  <div className="text-muted-foreground">Contacts</div>
                  <div className="font-medium">{exportHealth.database?.contacts || 0}</div>
                </div>
                <div className="bg-muted/50 rounded p-2">
                  <div className="text-muted-foreground">Jobs</div>
                  <div className="font-medium">{exportHealth.database?.jobs || 0}</div>
                </div>
                <div className="bg-muted/50 rounded p-2">
                  <div className="text-muted-foreground">Job Items</div>
                  <div className="font-medium">{exportHealth.database?.jobItems || 0}</div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Unable to load stats</div>
            )}
          </div>
          
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Last Export</h4>
            {recentExports && recentExports.exports.length > 0 ? (
              <div className="text-xs space-y-1 text-muted-foreground">
                <div className="flex justify-between">
                  <span>File:</span>
                  <span className="truncate max-w-48">{recentExports.exports[0].name}</span>
                </div>
                <div className="flex justify-between">
                  <span>Created:</span>
                  <span>{formatDistanceToNow(new Date(recentExports.exports[0].createdAt), { addSuffix: true })}</span>
                </div>
                <div className="flex justify-between">
                  <span>Size:</span>
                  <span>{(recentExports.exports[0].size / 1024).toFixed(1)} KB</span>
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">No exports yet</div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
