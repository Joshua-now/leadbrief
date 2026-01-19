import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { FileText, Clock, CheckCircle2, XCircle, Loader2, AlertCircle, RefreshCw, RotateCcw, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { exportFile } from "@/lib/export-utils";
import type { BulkJob } from "@shared/schema";

const statusConfig: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  pending: { icon: Clock, color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400", label: "Pending" },
  processing: { icon: Loader2, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", label: "Processing" },
  complete: { icon: CheckCircle2, color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", label: "Complete" },
  completed: { icon: CheckCircle2, color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400", label: "Complete" },
  failed: { icon: XCircle, color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", label: "Failed" },
};

export default function JobsPage() {
  const { data: jobs, isLoading, error, refetch } = useQuery<BulkJob[]>({
    queryKey: ["/api/jobs"],
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
          <div className="flex items-center gap-2">
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
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function JobCard({ job, onRetry, isRetrying }: { 
  job: BulkJob; 
  onRetry: () => void; 
  isRetrying: boolean;
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

  const handleExport = async (format: 'csv' | 'json') => {
    if ((job.successful || 0) === 0) {
      toast({ 
        title: "No Data to Export", 
        description: "No completed records to export. Process some records first.", 
        variant: "destructive" 
      });
      return;
    }
    
    setIsExporting(true);
    const result = await exportFile({
      endpoint: `/api/jobs/${job.id}/export`,
      format,
      filename: `export-${job.id}.${format}`,
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

          <div className="flex items-center gap-2">
            {canExport && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport('csv')}
                disabled={isExporting}
                data-testid={`button-export-${job.id}`}
              >
                {isExporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                {isExporting ? 'Exporting...' : 'Export CSV'}
              </Button>
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
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
