import { toast } from "@/hooks/use-toast";

export interface ExportOptions {
  endpoint: string;
  format: 'csv' | 'json';
  filename: string;
}

export interface ExportResult {
  success: boolean;
  error?: string;
}

export async function exportFile(options: ExportOptions): Promise<ExportResult> {
  const { endpoint, format, filename } = options;
  const url = `${endpoint}?format=${format}`;
  
  console.log(`[Export] Starting export: ${url}`);
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
    });
    
    console.log(`[Export] Response status: ${response.status} ${response.statusText}`);
    
    if (response.status === 401) {
      const errorMsg = 'Session expired (401 Unauthorized). Please log in again.';
      console.error(`[Export] Auth error: ${errorMsg}`);
      toast({
        title: "Export Failed",
        description: errorMsg,
        variant: "destructive",
      });
      return { success: false, error: errorMsg };
    }
    
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
      const errorMsg = 'Server returned HTML instead of data. Check if you are logged in.';
      console.error(`[Export] HTML response received instead of data`, { url });
      toast({
        title: "Export Failed",
        description: errorMsg,
        variant: "destructive",
      });
      return { success: false, error: errorMsg };
    }
    
    const blob = await response.blob();
    
    if (blob.size === 0) {
      const errorMsg = 'Export returned empty file. No data to export.';
      console.warn(`[Export] Empty blob received`, { url });
      toast({
        title: "Export Failed",
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
    
    toast({
      title: "Export Complete",
      description: `Downloaded ${filename}`,
    });
    
    return { success: true };
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
