import { BarChart3, TrendingUp, Users, FileText, CheckCircle2, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import type { BulkJob, Contact } from "@shared/schema";

export default function ReportsPage() {
  const { data: jobs } = useQuery<BulkJob[]>({
    queryKey: ["/api/jobs"],
  });

  const { data: contacts } = useQuery<Contact[]>({
    queryKey: ["/api/contacts"],
  });

  const stats = {
    totalJobs: jobs?.length || 0,
    completedJobs: jobs?.filter(j => j.status === "complete" || j.status === "completed").length || 0,
    totalContacts: contacts?.length || 0,
    totalRecordsProcessed: jobs?.reduce((sum, j) => sum + (j.totalRecords || 0), 0) || 0,
    successRate: jobs?.length
      ? Math.round(
          (jobs.reduce((sum, j) => sum + (j.successful || 0), 0) /
            Math.max(jobs.reduce((sum, j) => sum + (j.totalRecords || 0), 0), 1)) *
            100
        )
      : 0,
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="text-muted-foreground">Analytics and insights from your enrichment activities</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Total Jobs"
            value={stats.totalJobs}
            icon={FileText}
            description="Import jobs created"
          />
          <StatCard
            title="Completed"
            value={stats.completedJobs}
            icon={CheckCircle2}
            description="Successfully finished"
            className="text-green-600 dark:text-green-400"
          />
          <StatCard
            title="Contacts"
            value={stats.totalContacts}
            icon={Users}
            description="In database"
          />
          <StatCard
            title="Success Rate"
            value={`${stats.successRate}%`}
            icon={TrendingUp}
            description="Records enriched"
            className={stats.successRate >= 80 ? "text-green-600 dark:text-green-400" : stats.successRate >= 50 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400"}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Activity</CardTitle>
              <CardDescription>Your latest import jobs</CardDescription>
            </CardHeader>
            <CardContent>
              {!jobs || jobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <BarChart3 className="h-12 w-12 text-muted-foreground/50" />
                  <p className="mt-2 text-sm text-muted-foreground">No activity yet</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {jobs.slice(0, 5).map((job) => (
                    <div key={job.id} className="flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{job.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {job.totalRecords} records • {job.status}
                        </p>
                      </div>
                      <div className="text-right text-sm">
                        <span className="text-green-600 dark:text-green-400">{job.successful || 0}</span>
                        {" / "}
                        <span className="text-muted-foreground">{job.totalRecords || 0}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Data Quality</CardTitle>
              <CardDescription>Contact enrichment metrics</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <QualityMetric
                  label="Has Email"
                  value={contacts?.filter(c => c.email).length || 0}
                  total={stats.totalContacts}
                />
                <QualityMetric
                  label="Has Phone"
                  value={contacts?.filter(c => c.phone).length || 0}
                  total={stats.totalContacts}
                />
                <QualityMetric
                  label="Has LinkedIn"
                  value={contacts?.filter(c => c.linkedinUrl).length || 0}
                  total={stats.totalContacts}
                />
                <QualityMetric
                  label="Has Title"
                  value={contacts?.filter(c => c.title).length || 0}
                  total={stats.totalContacts}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  description,
  className,
}: {
  title: string;
  value: number | string;
  icon: React.ElementType;
  description: string;
  className?: string;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className={`mt-1 text-2xl font-semibold ${className || ""}`}>
              {value}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Icon className="h-6 w-6 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function QualityMetric({ label, value, total }: { label: string; value: number; total: number }) {
  const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
  
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="font-medium">{value} ({percentage}%)</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
