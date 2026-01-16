import { useState, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, FileText, AlertCircle, CheckCircle2, Loader2, AlertTriangle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface ImportStats {
  total: number;
  valid: number;
  invalid: number;
  errorRate: number;
}

interface ImportResponse {
  success: boolean;
  jobId: string;
  stats?: ImportStats;
  totalRows?: number;
  importedRows?: number;
  skippedRows?: number;
  errors?: Array<{ row: number; reason: string }>;
  warnings?: string[];
  message: string;
}

interface ImportLimits {
  MAX_RECORDS: number;
  MAX_FILE_SIZE_MB: number;
  MAX_EMAIL_LENGTH: number;
  MAX_FIELD_LENGTH: number;
  MIN_EMAIL_LENGTH: number;
}

export default function ImportPage() {
  const [content, setContent] = useState("");
  const [jobName, setJobName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch import limits
  const { data: limits } = useQuery<ImportLimits>({
    queryKey: ["/api/config/limits"],
  });

  const importMutation = useMutation({
    mutationFn: async (data: { content: string; jobName: string }) => {
      const response = await apiRequest("POST", "/api/import/bulk", data);
      return await response.json() as ImportResponse;
    },
    onSuccess: (data) => {
      toast({
        title: "Import Started",
        description: data.message,
      });
      setContent("");
      setJobName("");
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const fileUploadMutation = useMutation({
    mutationFn: async (data: { file: File; jobName: string }) => {
      const formData = new FormData();
      formData.append("file", data.file);
      formData.append("jobName", data.jobName);
      
      const response = await fetch("/api/import/file", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Upload failed: ${response.statusText}`);
      }
      
      return await response.json() as ImportResponse;
    },
    onSuccess: (data) => {
      toast({
        title: "File Import Started",
        description: data.message,
      });
      setContent("");
      setJobName("");
      setSelectedFile(null);
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
    },
    onError: (error: Error) => {
      toast({
        title: "File Import Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const isBinaryFile = (filename: string): boolean => {
    const ext = filename.toLowerCase().split('.').pop();
    return ext === 'xlsx' || ext === 'xls';
  };

  const isUnsupportedFile = (filename: string): boolean => {
    const ext = filename.toLowerCase().split('.').pop();
    return ext === 'pdf' || ext === 'doc' || ext === 'docx' || ext === 'png' || ext === 'jpg' || ext === 'jpeg';
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      
      // Check for unsupported file types
      if (isUnsupportedFile(file.name)) {
        toast({
          title: "Unsupported File Type",
          description: "Please upload a CSV or Excel (.xlsx) file. PDFs and images are not supported.",
          variant: "destructive",
        });
        return;
      }
      
      // Check file size
      const sizeMB = file.size / (1024 * 1024);
      if (limits && sizeMB > limits.MAX_FILE_SIZE_MB) {
        toast({
          title: "File Too Large",
          description: `Maximum file size is ${limits.MAX_FILE_SIZE_MB}MB`,
          variant: "destructive",
        });
        return;
      }
      
      handleFile(file);
    }
  }, [limits, toast]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      
      // Check for unsupported file types
      if (isUnsupportedFile(file.name)) {
        toast({
          title: "Unsupported File Type",
          description: "Please upload a CSV or Excel (.xlsx) file. PDFs and images are not supported.",
          variant: "destructive",
        });
        return;
      }
      
      // Check file size
      const sizeMB = file.size / (1024 * 1024);
      if (limits && sizeMB > limits.MAX_FILE_SIZE_MB) {
        toast({
          title: "File Too Large",
          description: `Maximum file size is ${limits.MAX_FILE_SIZE_MB}MB`,
          variant: "destructive",
        });
        return;
      }
      
      handleFile(file);
      if (!jobName) {
        setJobName(file.name.replace(/\.[^/.]+$/, ""));
      }
    }
  }, [jobName, limits, toast]);

  const handleFile = (file: File) => {
    if (isBinaryFile(file.name)) {
      setSelectedFile(file);
      setContent(`[Excel file: ${file.name}]`);
    } else {
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setContent(text);
      };
      reader.readAsText(file);
    }
  };

  const handleSubmit = () => {
    if (!content.trim() && !selectedFile) {
      toast({
        title: "No Data",
        description: "Please paste or upload data to import.",
        variant: "destructive",
      });
      return;
    }
    
    if (selectedFile) {
      fileUploadMutation.mutate({
        file: selectedFile,
        jobName: jobName || `Import ${new Date().toLocaleDateString()}`,
      });
    } else {
      importMutation.mutate({
        content,
        jobName: jobName || `Import ${new Date().toLocaleDateString()}`,
      });
    }
  };

  const detectFormat = (text: string, file: File | null): string => {
    if (file) {
      const ext = file.name.toLowerCase().split('.').pop();
      if (ext === 'xlsx' || ext === 'xls') return "Excel";
      if (ext === 'csv') return "CSV";
    }
    const trimmed = text.trim();
    if (trimmed.startsWith("[Excel file:")) return "Excel";
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) return "JSON";
    if (trimmed.includes(",") && trimmed.split("\n")[0].includes(",")) return "CSV";
    return "Email List";
  };

  const lineCount = selectedFile 
    ? (selectedFile.name.endsWith('.xlsx') || selectedFile.name.endsWith('.xls') ? 0 : content.split("\n").filter(l => l.trim()).length)
    : content.split("\n").filter(l => l.trim()).length;
  const format = (content || selectedFile) ? detectFormat(content, selectedFile) : null;
  const contentSizeMB = selectedFile 
    ? (selectedFile.size / (1024 * 1024)).toFixed(2) 
    : content ? (new Blob([content]).size / (1024 * 1024)).toFixed(2) : "0";
  const isPending = importMutation.isPending || fileUploadMutation.isPending;
  const isSuccess = importMutation.isSuccess || fileUploadMutation.isSuccess;
  const mutationData = fileUploadMutation.data || importMutation.data;
  
  // Validation warnings
  const validationWarnings: string[] = [];
  if (limits) {
    if (lineCount > limits.MAX_RECORDS) {
      validationWarnings.push(`File has ${lineCount} rows. Only first ${limits.MAX_RECORDS} will be processed.`);
    }
    if (parseFloat(contentSizeMB) > limits.MAX_FILE_SIZE_MB * 0.8) {
      validationWarnings.push(`File is ${contentSizeMB}MB, approaching the ${limits.MAX_FILE_SIZE_MB}MB limit.`);
    }
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Import Data</h1>
          <p className="text-muted-foreground">
            Upload CSV, JSON, or a list of emails to start enrichment
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">Data Input</CardTitle>
              <CardDescription>
                Paste your data directly or drag and drop a file
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="jobName">Job Name (optional)</Label>
                <Input
                  id="jobName"
                  placeholder="e.g., Q1 Leads Import"
                  value={jobName}
                  onChange={(e) => setJobName(e.target.value)}
                  maxLength={200}
                  data-testid="input-job-name"
                />
              </div>

              <div
                className={`relative rounded-md border-2 border-dashed transition-colors ${
                  dragActive
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25 hover:border-muted-foreground/50"
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              >
                <Textarea
                  placeholder={`Paste CSV, JSON, or email list here...

Example CSV:
email,firstName,lastName,company
john@example.com,John,Doe,Acme Inc
jane@example.com,Jane,Smith,Tech Corp

Example Email List:
john@example.com
jane@example.com

Limits: ${limits ? `${limits.MAX_RECORDS.toLocaleString()} records, ${limits.MAX_FILE_SIZE_MB}MB` : 'Loading...'}`}
                  className="min-h-[280px] resize-none border-0 focus-visible:ring-0"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  data-testid="textarea-import-data"
                />
                
                {!content && (
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/50">
                    <Upload className="h-10 w-10 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">
                      Drop file here or paste data
                    </p>
                    <label className="pointer-events-auto">
                      <span className="cursor-pointer text-sm font-medium text-primary hover:underline">
                        Browse files
                      </span>
                      <input
                        type="file"
                        accept=".csv,.json,.txt,.xlsx,.xls"
                        className="hidden"
                        onChange={handleFileInput}
                        data-testid="input-file-upload"
                      />
                    </label>
                  </div>
                )}
              </div>

              {(content || selectedFile) && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary" data-testid="badge-format">
                      {format}
                    </Badge>
                    <span className="text-sm text-muted-foreground" data-testid="text-line-count">
                      {selectedFile ? selectedFile.name : `${lineCount.toLocaleString()} line${lineCount !== 1 ? "s" : ""}`} ({contentSizeMB}MB)
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setContent(""); setSelectedFile(null); }}
                    data-testid="button-clear"
                  >
                    Clear
                  </Button>
                </div>
              )}

              {validationWarnings.length > 0 && (
                <Alert variant="default" className="border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/30">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                  <AlertTitle className="text-yellow-800 dark:text-yellow-200">Warnings</AlertTitle>
                  <AlertDescription className="text-yellow-700 dark:text-yellow-300">
                    <ul className="list-disc list-inside space-y-1">
                      {validationWarnings.map((warning, idx) => (
                        <li key={idx}>{warning}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              <Button
                className="w-full"
                size="lg"
                onClick={handleSubmit}
                disabled={(!content.trim() && !selectedFile) || isPending}
                data-testid="button-start-import"
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Start Import
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Supported Formats</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <FormatInfo
                  icon={<FileText className="h-4 w-4" />}
                  title="CSV"
                  description="Comma-separated with headers"
                />
                <FormatInfo
                  icon={<FileText className="h-4 w-4" />}
                  title="Excel (.xlsx)"
                  description="Excel spreadsheet files"
                />
                <FormatInfo
                  icon={<FileText className="h-4 w-4" />}
                  title="JSON"
                  description="Array of contact objects"
                />
                <FormatInfo
                  icon={<FileText className="h-4 w-4" />}
                  title="Email List"
                  description="One email per line"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Field Mapping</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p>We auto-detect these fields:</p>
                <ul className="mt-2 space-y-1">
                  <li>email, firstName, lastName</li>
                  <li>phone, title, company</li>
                  <li>city, websiteUrl, linkedinUrl</li>
                </ul>
                <p className="mt-2 text-xs">Header synonyms supported (e.g., "full_name" → firstName)</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Guard Rails</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  <span>Duplicate detection</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  <span>Email validation</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  <span>Auto-retry on failure</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  <span>Data quality scoring</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {isSuccess && mutationData && (
          <Card className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30">
            <CardContent className="py-4">
              <div className="flex items-center gap-4">
                <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
                <div className="flex-1">
                  <p className="font-medium text-green-800 dark:text-green-200">
                    Import queued successfully!
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-300">
                    {mutationData.importedRows ?? mutationData.stats?.valid ?? 0} records ready for processing
                    {((mutationData.skippedRows ?? mutationData.stats?.invalid ?? 0) > 0) && 
                      ` (${mutationData.skippedRows ?? mutationData.stats?.invalid} rows skipped)`}
                  </p>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <a href="/jobs" data-testid="link-view-jobs">View Jobs</a>
                </Button>
              </div>
              
              {mutationData.errors && mutationData.errors.length > 0 && (
                <div className="mt-3 rounded-md bg-yellow-100 dark:bg-yellow-900/30 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5" />
                    <div className="text-sm text-yellow-800 dark:text-yellow-200">
                      <p className="font-medium">Row errors:</p>
                      <ul className="mt-1 list-disc list-inside">
                        {mutationData.errors.slice(0, 5).map((err, i) => (
                          <li key={i}>Row {err.row}: {err.reason}</li>
                        ))}
                        {mutationData.errors.length > 5 && (
                          <li>...and {mutationData.errors.length - 5} more</li>
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
              
              {mutationData.warnings && mutationData.warnings.length > 0 && (
                <div className="mt-3 rounded-md bg-yellow-100 dark:bg-yellow-900/30 p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5" />
                    <div className="text-sm text-yellow-800 dark:text-yellow-200">
                      <p className="font-medium">Warnings:</p>
                      <ul className="mt-1 list-disc list-inside">
                        {mutationData.warnings.slice(0, 5).map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                        {mutationData.warnings.length > 5 && (
                          <li>...and {mutationData.warnings.length - 5} more</li>
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function FormatInfo({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
