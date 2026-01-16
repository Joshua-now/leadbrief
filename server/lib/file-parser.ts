import * as XLSX from 'xlsx';
import Papa from 'papaparse';

interface ParsedRecord {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  leadName?: string | null;
  company?: string | null;
  companyName?: string | null;
  title?: string | null;
  city?: string | null;
  websiteUrl?: string | null;
  linkedinUrl?: string | null;
  [key: string]: string | null | undefined;
}

interface FileParseResult {
  records: ParsedRecord[];
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  errors: Array<{ row: number; reason: string }>;
}

const HEADER_MAPPINGS: Record<string, string> = {
  'name': 'leadName',
  'full_name': 'leadName',
  'fullname': 'leadName',
  'contact_name': 'leadName',
  'contactname': 'leadName',
  'lead_name': 'leadName',
  'leadname': 'leadName',
  
  'first_name': 'firstName',
  'firstname': 'firstName',
  'first': 'firstName',
  'fname': 'firstName',
  
  'last_name': 'lastName',
  'lastname': 'lastName',
  'last': 'lastName',
  'lname': 'lastName',
  'surname': 'lastName',
  
  'company': 'companyName',
  'company_name': 'companyName',
  'companyname': 'companyName',
  'business': 'companyName',
  'business_name': 'companyName',
  'organization': 'companyName',
  'org': 'companyName',
  
  'website': 'websiteUrl',
  'website_url': 'websiteUrl',
  'websiteurl': 'websiteUrl',
  'url': 'websiteUrl',
  'site': 'websiteUrl',
  'web': 'websiteUrl',
  'domain': 'websiteUrl',
  
  'email': 'email',
  'email_address': 'email',
  'emailaddress': 'email',
  'e-mail': 'email',
  'mail': 'email',
  
  'phone': 'phone',
  'phone_number': 'phone',
  'phonenumber': 'phone',
  'telephone': 'phone',
  'tel': 'phone',
  'mobile': 'phone',
  'cell': 'phone',
  
  'city': 'city',
  'town': 'city',
  'location': 'city',
  
  'title': 'title',
  'job_title': 'title',
  'jobtitle': 'title',
  'position': 'title',
  'role': 'title',
  
  'linkedin': 'linkedinUrl',
  'linkedin_url': 'linkedinUrl',
  'linkedinurl': 'linkedinUrl',
  'linkedin_profile': 'linkedinUrl',
};

function normalizeHeader(header: string): string {
  const normalized = header
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_')
    .replace(/[^\w_]/g, '');
  
  return HEADER_MAPPINGS[normalized] || normalized;
}

function removeBOM(text: string): string {
  if (text.charCodeAt(0) === 0xFEFF) {
    return text.slice(1);
  }
  return text;
}

function isRowEmpty(row: Record<string, unknown>): boolean {
  return Object.values(row).every(v => v === null || v === undefined || String(v).trim() === '');
}

function isValidRecord(record: ParsedRecord): { valid: boolean; reason?: string } {
  const hasEmail = record.email && record.email.trim().length > 0;
  const hasWebsite = record.websiteUrl && record.websiteUrl.trim().length > 0;
  const hasCompanyAndCity = 
    (record.companyName || record.company) && 
    record.city && 
    record.city.trim().length > 0;
  
  if (hasEmail || hasWebsite || hasCompanyAndCity) {
    return { valid: true };
  }
  
  return { 
    valid: false, 
    reason: 'Requires email, websiteUrl, or companyName+city' 
  };
}

export function parseCSV(content: string): FileParseResult {
  const cleanContent = removeBOM(content);
  
  const parseResult = Papa.parse(cleanContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeader,
    delimiter: '',
  });
  
  const records: ParsedRecord[] = [];
  const errors: Array<{ row: number; reason: string }> = [];
  let skippedRows = 0;
  
  (parseResult.data as Record<string, unknown>[]).forEach((row, index) => {
    const rowNum = index + 2;
    
    if (isRowEmpty(row)) {
      skippedRows++;
      return;
    }
    
    const record: ParsedRecord = {};
    Object.entries(row).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        record[key] = String(value).trim() || null;
      }
    });
    
    const validation = isValidRecord(record);
    if (!validation.valid) {
      errors.push({ row: rowNum, reason: validation.reason || 'Invalid record' });
      skippedRows++;
      return;
    }
    
    records.push(record);
  });
  
  parseResult.errors.forEach((err) => {
    errors.push({ 
      row: err.row !== undefined ? err.row + 2 : 0, 
      reason: err.message 
    });
  });
  
  console.log(`[FileParser] CSV parsed: ${records.length} valid, ${skippedRows} skipped, ${errors.length} errors`);
  
  return {
    records,
    totalRows: parseResult.data.length,
    importedRows: records.length,
    skippedRows,
    errors,
  };
}

export function parseXLSX(buffer: Buffer): FileParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  
  const rawData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { 
    defval: null,
    raw: false,
  });
  
  const records: ParsedRecord[] = [];
  const errors: Array<{ row: number; reason: string }> = [];
  let skippedRows = 0;
  
  rawData.forEach((row, index) => {
    const rowNum = index + 2;
    
    if (isRowEmpty(row)) {
      skippedRows++;
      return;
    }
    
    const record: ParsedRecord = {};
    Object.entries(row).forEach(([key, value]) => {
      const normalizedKey = normalizeHeader(key);
      if (value !== null && value !== undefined) {
        record[normalizedKey] = String(value).trim() || null;
      }
    });
    
    const validation = isValidRecord(record);
    if (!validation.valid) {
      errors.push({ row: rowNum, reason: validation.reason || 'Invalid record' });
      skippedRows++;
      return;
    }
    
    records.push(record);
  });
  
  console.log(`[FileParser] XLSX parsed: ${records.length} valid, ${skippedRows} skipped, ${errors.length} errors`);
  
  return {
    records,
    totalRows: rawData.length,
    importedRows: records.length,
    skippedRows,
    errors,
  };
}

export function detectFileType(filename: string, mimetype: string): 'csv' | 'xlsx' | 'unsupported' {
  const ext = filename.toLowerCase().split('.').pop();
  
  if (ext === 'csv' || mimetype === 'text/csv') {
    return 'csv';
  }
  
  if (ext === 'xlsx' || ext === 'xls' || 
      mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimetype === 'application/vnd.ms-excel') {
    return 'xlsx';
  }
  
  return 'unsupported';
}

export function parseFile(buffer: Buffer, filename: string, mimetype: string): FileParseResult | { error: string; status: number } {
  const fileType = detectFileType(filename, mimetype);
  
  console.log(`[FileParser] Processing file: ${filename}, type: ${fileType}, size: ${buffer.length} bytes`);
  
  if (fileType === 'unsupported') {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') {
      return { 
        error: 'PDF files are not supported. Please upload a CSV or Excel (.xlsx) file.', 
        status: 415 
      };
    }
    return { 
      error: `Unsupported file type. Please upload a CSV or Excel (.xlsx) file.`, 
      status: 415 
    };
  }
  
  if (fileType === 'csv') {
    return parseCSV(buffer.toString('utf-8'));
  }
  
  return parseXLSX(buffer);
}
