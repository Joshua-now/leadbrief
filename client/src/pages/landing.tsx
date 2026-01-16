import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, Upload, Users, BarChart3, Shield, Zap, RefreshCw } from "lucide-react";
import { Link } from "wouter";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="fixed top-0 left-0 right-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <FileText className="h-4 w-4" />
            </div>
            <span className="text-lg font-semibold">LeadBrief</span>
          </div>
          <Button asChild data-testid="button-login">
            <Link href="/login">Sign In</Link>
          </Button>
        </div>
      </header>

      <main className="pt-16">
        <section className="container mx-auto px-4 py-24 text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl" data-testid="text-hero-title">
            Bulk Contact Enrichment
            <br />
            <span className="text-primary">Made Simple</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            Import CSV, Excel, or JSON files. Validate and enrich contact data.
            Track jobs with robust guard rails and self-healing capabilities.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Button size="lg" asChild data-testid="button-get-started">
              <Link href="/login">Get Started Free</Link>
            </Button>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            No credit card required
          </p>
        </section>

        <section className="container mx-auto px-4 py-16">
          <h2 className="mb-12 text-center text-2xl font-bold">Key Features</h2>
          <div className="grid gap-6 md:grid-cols-3">
            <Card className="hover-elevate">
              <CardContent className="p-6">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <Upload className="h-6 w-6 text-primary" />
                </div>
                <h3 className="mb-2 text-lg font-semibold">Bulk Import</h3>
                <p className="text-sm text-muted-foreground">
                  Import up to 10,000 contacts from CSV, Excel, or JSON files with automatic field mapping.
                </p>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardContent className="p-6">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <Shield className="h-6 w-6 text-primary" />
                </div>
                <h3 className="mb-2 text-lg font-semibold">Data Validation</h3>
                <p className="text-sm text-muted-foreground">
                  Automatic email validation, duplicate detection, and data quality scoring for every contact.
                </p>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardContent className="p-6">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <RefreshCw className="h-6 w-6 text-primary" />
                </div>
                <h3 className="mb-2 text-lg font-semibold">Self-Healing</h3>
                <p className="text-sm text-muted-foreground">
                  Auto-retry failed items with exponential backoff and job recovery for stale processing.
                </p>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardContent className="p-6">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <Users className="h-6 w-6 text-primary" />
                </div>
                <h3 className="mb-2 text-lg font-semibold">Contact Management</h3>
                <p className="text-sm text-muted-foreground">
                  View and manage enriched contacts with company associations and quality scores.
                </p>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardContent className="p-6">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <BarChart3 className="h-6 w-6 text-primary" />
                </div>
                <h3 className="mb-2 text-lg font-semibold">Analytics</h3>
                <p className="text-sm text-muted-foreground">
                  Track import job progress, success rates, and enrichment status with detailed reports.
                </p>
              </CardContent>
            </Card>

            <Card className="hover-elevate">
              <CardContent className="p-6">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                  <Zap className="h-6 w-6 text-primary" />
                </div>
                <h3 className="mb-2 text-lg font-semibold">GHL Integration</h3>
                <p className="text-sm text-muted-foreground">
                  Native GoHighLevel webhook support for real-time contact intake and enrichment.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        <footer className="border-t py-8">
          <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} LeadBrief. All rights reserved.
          </div>
        </footer>
      </main>
    </div>
  );
}
