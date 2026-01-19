import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

vi.mock('fs/promises');

const mockFs = vi.mocked(fs);

describe('Export Artifacts', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('writeExportArtifact', () => {
    it('should create exports directory if it does not exist', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({ size: 1234 } as any);
      
      const { writeExportArtifact } = await import('../server/lib/exportArtifacts');
      
      const result = await writeExportArtifact('test,data\n1,2', 'job', 'test-job-id', 2);
      
      expect(mockFs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('attached_assets'),
        { recursive: true }
      );
      expect(result).not.toBeNull();
      expect(result?.entityType).toBe('job');
      expect(result?.entityId).toBe('test-job-id');
      expect(result?.rowCount).toBe(2);
    });

    it('should write CSV content to file', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({ size: 500 } as any);
      
      const { writeExportArtifact } = await import('../server/lib/exportArtifacts');
      
      const csvContent = 'header1,header2\nvalue1,value2';
      await writeExportArtifact(csvContent, 'contacts', undefined, 1);
      
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('export-contacts'),
        csvContent,
        'utf-8'
      );
    });

    it('should return metadata with correct filename pattern', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.writeFile.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({ size: 100 } as any);
      
      const { writeExportArtifact } = await import('../server/lib/exportArtifacts');
      
      const result = await writeExportArtifact('data', 'job', 'abc-123', 5);
      
      expect(result?.filename).toMatch(/^export-job-abc-123-\d+\.csv$/);
      expect(result?.size).toBe(100);
    });
  });

  describe('listExportFiles', () => {
    it('should return empty array when directory is empty', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([]);
      
      const { listExportFiles } = await import('../server/lib/exportArtifacts');
      
      const result = await listExportFiles();
      
      expect(result).toEqual([]);
    });

    it('should return sorted list of export files', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        'export-job-123-1000.csv',
        'export-contacts-2000.csv',
        'export-job-456-3000.csv',
      ] as any);
      mockFs.stat.mockImplementation((filePath) => {
        const filename = path.basename(filePath as string);
        const timestamp = parseInt(filename.match(/-(\d+)\.csv$/)?.[1] || '0');
        return Promise.resolve({
          size: 500,
          mtime: new Date(timestamp),
        } as any);
      });
      
      const { listExportFiles } = await import('../server/lib/exportArtifacts');
      
      const result = await listExportFiles();
      
      expect(result.length).toBe(3);
      expect(result[0].name).toBe('export-job-456-3000.csv');
      expect(result[1].name).toBe('export-contacts-2000.csv');
      expect(result[2].name).toBe('export-job-123-1000.csv');
    });

    it('should parse entity type and id from filename', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue(['export-job-abc-def-1234567890.csv'] as any);
      mockFs.stat.mockResolvedValue({ size: 100, mtime: new Date() } as any);
      
      const { listExportFiles } = await import('../server/lib/exportArtifacts');
      
      const result = await listExportFiles();
      
      expect(result[0].entityType).toBe('job');
      expect(result[0].entityId).toBe('abc-def');
    });

    it('should filter out non-CSV files', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        'export-job-123-1000.csv',
        'some-other-file.txt',
        'readme.md',
      ] as any);
      mockFs.stat.mockResolvedValue({ size: 100, mtime: new Date() } as any);
      
      const { listExportFiles } = await import('../server/lib/exportArtifacts');
      
      const result = await listExportFiles();
      
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('export-job-123-1000.csv');
    });
  });

  describe('getExportFile', () => {
    it('should reject invalid filename patterns', async () => {
      const { getExportFile } = await import('../server/lib/exportArtifacts');
      
      const result = await getExportFile('../../../etc/passwd');
      
      expect(result).toBeNull();
    });

    it('should reject filenames without proper format', async () => {
      const { getExportFile } = await import('../server/lib/exportArtifacts');
      
      const result = await getExportFile('malicious-file.csv');
      
      expect(result).toBeNull();
    });

    it('should return file content for valid filename', async () => {
      mockFs.readFile.mockResolvedValue(Buffer.from('test,data'));
      
      const { getExportFile } = await import('../server/lib/exportArtifacts');
      
      const result = await getExportFile('export-job-abc123-1234567890.csv');
      
      expect(result).not.toBeNull();
      expect(result?.mimeType).toBe('text/csv');
    });
  });
});
