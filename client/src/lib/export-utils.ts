import { toast } from "@/hooks/use-toast";
import { apiGet } from "@/lib/apiClient";

export interface ExportOptions {
  endpoint: string;
  format: 'csv' | 'json';
  filename: string;
}

export interface ExportArtifactMetadata {
  filename: string | null;
  filePath: string | null;
  rowCount: number | null;
}

export interface ExportResult {
  success: boolean;
  error?: string;
  artifact?: ExportArtifactMetadata;
}

export async function exportFile(options: ExportOptions): Promise<ExportResult> {
  const { endpoint, format, filename } = options;
  
  const separator = endpoint.includes('?') ? '&' : '?';
  const url = `${endpoint}${separator}format=${format}`;
  
  console.log(`[Export] Starting export: ${url}`);
  
  try {
    const response = await apiGet(url);
    
    console.log(`[Export] Response status: ${response.status} ${response.statusText}`);
    
    if (response.status === 404) {
      const errorMsg = 'Resource not found (404). It may have been deleted.';
      console.error(`[Export] Not found: ${errorMsg}`);
      toast({
        title: "Export Failed", 
        description: errorMsg,
        variant: "destructive",
      });
      return { success: false, error: errorMsg };
    }
    
    if (response.status >= 500) {
      let responseText = '';
      try {
        responseText = await response.text();
        responseText = responseText.substring(0, 200);
      } catch { /* ignore */ }
      
      const errorMsg = `Server error (${response.status}). ${responseText || 'Please try again.'}`;
      console.error(`[Export] Server error: ${errorMsg}`, { url, status: response.status });
      toast({
        title: "Export Failed",
        description: errorMsg,
        variant: "destructive",
      });
      return { success: false, error: errorMsg };
    }
    
    if (!response.ok) {
      let errorBody: { error?: string; message?: string } = {};
      try {
        errorBody = await response.json();
      } catch { /* ignore */ }
      
      const errorMsg = errorBody.error || errorBody.message || `Export failed (${response.status})`;
      console.error(`[Export] Failed: ${errorMsg}`, { url, status: response.status, body: errorBody });
      toast({
        title: "Export Failed",
        description: errorMsg,
        variant: "destructive", 
      });
      return { success: false, error: errorMsg };
    }
    
    const contentType = response.headers.get('content-type') || '';
    console.log(`[Export] Content-Type: ${contentType}`);
    
    if (contentType.includes('text/html')) {
      const errorMsg = 'Routing issue: API returned HTML instead of data. First 200 chars logged to console.';
      const htmlPreview = await response.text();
      console.error(`[Export] HTML response received instead of data`, { url, htmlPreview: htmlPreview.substring(0, 200) });
      toast({
        title: "Export Failed",
        description: errorMsg,
        variant: "destructive",
      });
      return { success: false, error: errorMsg };
    }
    
    // Check for structured "no data" JSON response (server returns 200 with noData: true)
    if (contentType.includes('application/json')) {
      const jsonData = await response.json();
      
      if (jsonData.noData) {
        const reason = jsonData.reason || 'No data available for export';
        const counts = jsonData.counts || {};
        console.warn(`[Export] No data response:`, { reason, counts, job: jsonData.job });
        
        // Build detailed message
        let detailMessage = reason;
        if (counts.byStatus) {
          const statusList = Object.entries(counts.byStatus)
            .map(([status, count]) => `${status}: ${count}`)
            .join(', ');
          detailMessage += ` (${statusList})`;
        }
        
        toast({
          title: "No Data to Export",
          description: detailMessage,
          variant: "destructive",
        });
        return { success: false, error: reason };
      }
      
      // If JSON export format was requested and we have actual data, download it
      if (format === 'json') {
        const jsonBlob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
        console.log(`[Export] Downloading JSON file: ${filename} (${jsonBlob.size} bytes)`);
        
        const blobUrl = window.URL.createObjectURL(jsonBlob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(blobUrl);
        document.body.removeChild(a);
        
        toast({
          title: "Export Complete",
          description: `Downloaded ${filename}`,
        });
        
        return { success: true };
      }
    }
    
    // Capture artifact metadata from headers
    const artifactFilename = response.headers.get('X-Export-Filename');
    const artifactPath = response.headers.get('X-Export-Path');
    const artifactRows = response.headers.get('X-Export-Rows');
    
    const artifact: ExportArtifactMetadata = {
      filename: artifactFilename,
      filePath: artifactPath,
      rowCount: artifactRows ? parseInt(artifactRows, 10) : null,
    };
    
    console.log(`[Export] Artifact metadata:`, artifact);
    
    const blob = await response.blob();
    
    if (blob.size === 0) {
      const errorMsg = 'Export returned empty file. No data to export.';
      console.warn(`[Export] Empty blob received`, { url });
      toast({
        title: "No Data to Export",
        description: errorMsg,
        variant: "destructive",
      });
      return { success: false, error: errorMsg };
    }
    
    console.log(`[Export] Downloading file: ${filename} (${blob.size} bytes)`);
    
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(blobUrl);
    document.body.removeChild(a);
    
    // Show toast with artifact filename if available
    const displayFilename = artifact.filename || filename;
    toast({
      title: "Export Complete",
      description: artifact.filename 
        ? `Downloaded ${displayFilename} (saved to server)`
        : `Downloaded ${displayFilename}`,
    });
    
    return { success: true, artifact };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Network error. Please check your connection.';
    console.error(`[Export] Exception:`, error, { url });
    toast({
      title: "Export Failed",
      description: errorMsg,
      variant: "destructive",
    });
    return { success: false, error: errorMsg };
  }
}
