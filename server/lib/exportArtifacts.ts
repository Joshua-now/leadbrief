import fs from 'fs/promises';
import path from 'path';

const EXPORTS_DIR = path.resolve(process.cwd(), 'attached_assets', 'exports');

export type ExportEntityType = 'job' | 'contacts' | 'report' | 'core' | 'core-contacts';

export interface ExportArtifactMetadata {
  filename: string;
  filePath: string;
  rowCount: number;
  createdAt: string;
  entityType: ExportEntityType;
  entityId?: string;
  size: number;
}

export interface ExportFile {
  name: string;
  createdAt: string;
  size: number;
  entityType: string;
  entityId: string | null;
}

function isRailway(): boolean {
  return Boolean(process.env.RAILWAY_PROJECT_NAME || process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_ENVIRONMENT_NAME);
}

function isReplit(): boolean {
  return Boolean(process.env.REPL_SLUG || process.env.REPL_ID);
}

export async function ensureExportsDirectory(): Promise<void> {
  try {
    await fs.mkdir(EXPORTS_DIR, { recursive: true });
  } catch (error) {
    if (isRailway()) {
      console.warn('[Export Artifacts] Warning: Could not create exports directory in Railway (ephemeral filesystem):', error);
    } else {
      throw error;
    }
  }
}

export async function writeExportArtifact(
  csvContent: string,
  entityType: ExportEntityType,
  entityId?: string,
  rowCount: number = 0
): Promise<ExportArtifactMetadata | null> {
  const timestamp = Date.now();
  const idPart = entityId ? `-${entityId}` : '';
  const filename = `export-${entityType}${idPart}-${timestamp}.csv`;
  const filePath = path.join(EXPORTS_DIR, filename);
  
  try {
    await ensureExportsDirectory();
    await fs.writeFile(filePath, csvContent, 'utf-8');
    
    const stats = await fs.stat(filePath);
    
    const metadata: ExportArtifactMetadata = {
      filename,
      filePath,
      rowCount,
      createdAt: new Date().toISOString(),
      entityType,
      entityId,
      size: stats.size,
    };
    
    console.log(`[Export Artifacts] Written: ${filename} (${rowCount} rows, ${stats.size} bytes)`);
    return metadata;
  } catch (error) {
    if (isRailway()) {
      console.warn('[Export Artifacts] Warning: Could not write export file in Railway (ephemeral filesystem):', error);
      return null;
    } else if (isReplit()) {
      console.error('[Export Artifacts] Error: Failed to write export file in Replit:', error);
      throw error;
    } else {
      console.warn('[Export Artifacts] Warning: Could not write export file:', error);
      return null;
    }
  }
}

export async function listExportFiles(): Promise<ExportFile[]> {
  try {
    await ensureExportsDirectory();
    const files = await fs.readdir(EXPORTS_DIR);
    
    const exportFiles: ExportFile[] = [];
    
    for (const name of files) {
      if (!name.endsWith('.csv')) continue;
      
      try {
        const filePath = path.join(EXPORTS_DIR, name);
        const stats = await fs.stat(filePath);
        
        const match = name.match(/^export-(job|contacts|report|core|core-contacts)(?:-([a-f0-9-]+))?-(\d+)\.csv$/);
        
        exportFiles.push({
          name,
          createdAt: stats.mtime.toISOString(),
          size: stats.size,
          entityType: match?.[1] || 'unknown',
          entityId: match?.[2] || null,
        });
      } catch (statError) {
        console.warn(`[Export Artifacts] Could not stat file ${name}:`, statError);
      }
    }
    
    exportFiles.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    return exportFiles.slice(0, 50);
  } catch (error) {
    if (isRailway()) {
      console.warn('[Export Artifacts] Warning: Could not list export files in Railway:', error);
      return [];
    }
    console.error('[Export Artifacts] Error listing export files:', error);
    return [];
  }
}

export async function getExportFile(filename: string): Promise<{ content: Buffer; mimeType: string } | null> {
  if (!/^export-(job|contacts|report|core|core-contacts)(?:-[a-f0-9-]+)?-\d+\.csv$/.test(filename)) {
    console.warn(`[Export Artifacts] Invalid filename pattern: ${filename}`);
    return null;
  }
  
  const filePath = path.join(EXPORTS_DIR, filename);
  
  const normalizedPath = path.normalize(filePath);
  if (!normalizedPath.startsWith(EXPORTS_DIR)) {
    console.warn(`[Export Artifacts] Path traversal attempt blocked: ${filename}`);
    return null;
  }
  
  try {
    const content = await fs.readFile(filePath);
    return { content, mimeType: 'text/csv' };
  } catch (error) {
    console.warn(`[Export Artifacts] File not found: ${filename}`);
    return null;
  }
}

export function getExportsDirectory(): string {
  return EXPORTS_DIR;
}
