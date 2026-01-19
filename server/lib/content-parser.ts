import type { ScrapeResult } from './scraper';

export interface BusinessIntelligence {
  companyName: string | null;
  city: string | null;
  state: string | null;
  services: string[];
  signals: string[];
  industry: string | null;
  employeeCount: string | null;
  foundedYear: string | null;
  contactInfo: {
    phone?: string;
    email?: string;
    address?: string;
  };
}

const SERVICE_KEYWORDS = [
  'hvac', 'heating', 'cooling', 'air conditioning', 'furnace', 'ventilation',
  'roofing', 'roof repair', 'roof installation', 'shingles', 'gutters',
  'plumbing', 'pipe', 'drain', 'water heater',
  'electrical', 'wiring', 'lighting', 'panel',
  'construction', 'remodeling', 'renovation', 'building',
  'landscaping', 'lawn care', 'tree service',
  'painting', 'drywall', 'flooring',
  'pest control', 'exterminator',
  'cleaning', 'janitorial', 'maid service',
  'moving', 'storage', 'hauling',
  'auto repair', 'mechanic', 'body shop',
  'dental', 'dentist', 'orthodontic',
  'medical', 'clinic', 'healthcare',
  'legal', 'law firm', 'attorney',
  'accounting', 'tax', 'bookkeeping',
  'insurance', 'real estate', 'mortgage',
  'restaurant', 'catering', 'food service',
  'retail', 'wholesale', 'distribution',
  'manufacturing', 'fabrication',
  'technology', 'software', 'it services',
  'marketing', 'advertising', 'seo',
  'consulting', 'coaching', 'training',
];

const SIGNAL_PATTERNS = [
  { pattern: /family[- ]owned|family business/i, signal: 'Family-owned business' },
  { pattern: /since \d{4}|established \d{4}|founded \d{4}/i, signal: 'Established business' },
  { pattern: /free (estimate|quote|consultation)/i, signal: 'Offers free estimates' },
  { pattern: /24[\/\-]?7|emergency/i, signal: 'Offers 24/7 service' },
  { pattern: /licensed|insured|bonded/i, signal: 'Licensed and insured' },
  { pattern: /certified|certification/i, signal: 'Has certifications' },
  { pattern: /award|winner|best of/i, signal: 'Award-winning' },
  { pattern: /financing|payment plan/i, signal: 'Offers financing' },
  { pattern: /warranty|guarantee/i, signal: 'Provides warranties' },
  { pattern: /serving .* (county|area|region)/i, signal: 'Serves regional area' },
  { pattern: /years? (of )?experience/i, signal: 'Experienced team' },
  { pattern: /satisfaction guarantee/i, signal: 'Satisfaction guaranteed' },
  { pattern: /same[- ]day|next[- ]day/i, signal: 'Fast service available' },
  { pattern: /veteran[- ]owned/i, signal: 'Veteran-owned' },
  { pattern: /woman[- ]owned|women[- ]owned/i, signal: 'Woman-owned' },
  { pattern: /locally owned|local business/i, signal: 'Locally owned' },
];

const CITY_STATE_PATTERN = /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),?\s*([A-Z]{2})\b/g;
const PHONE_PATTERN = /(?:\+1[- ]?)?(?:\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4})/g;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const YEAR_PATTERN = /(?:since|established|founded|serving since)\s*(\d{4})/i;

export function extractBusinessIntelligence(scrapeResult: ScrapeResult, inputData: Record<string, string | null | undefined>): BusinessIntelligence {
  const result: BusinessIntelligence = {
    companyName: inputData.company || inputData.companyName || null,
    city: inputData.city || null,
    state: null,
    services: [],
    signals: [],
    industry: null,
    employeeCount: null,
    foundedYear: null,
    contactInfo: {},
  };
  
  if (!scrapeResult.success || !scrapeResult.content) {
    return result;
  }
  
  const { title, description, bodyText, headings, metadata } = scrapeResult.content;
  const allText = [title, description, ...headings, bodyText].join(' ').toLowerCase();
  
  if (!result.companyName && title) {
    const titleParts = title.split(/[|\-–—]/);
    if (titleParts.length > 0) {
      result.companyName = titleParts[0].trim();
    }
  }
  
  const cityStateMatches = bodyText.match(CITY_STATE_PATTERN);
  if (cityStateMatches && cityStateMatches.length >= 3 && !result.city) {
    const match = CITY_STATE_PATTERN.exec(bodyText);
    if (match) {
      result.city = match[1];
      result.state = match[2];
    }
  }
  
  for (const keyword of SERVICE_KEYWORDS) {
    if (allText.includes(keyword.toLowerCase())) {
      const formattedService = keyword.charAt(0).toUpperCase() + keyword.slice(1);
      if (!result.services.includes(formattedService)) {
        result.services.push(formattedService);
      }
    }
  }
  result.services = result.services.slice(0, 5);
  
  for (const { pattern, signal } of SIGNAL_PATTERNS) {
    if (pattern.test(allText)) {
      if (!result.signals.includes(signal)) {
        result.signals.push(signal);
      }
    }
  }
  result.signals = result.signals.slice(0, 5);
  
  if (result.services.some(s => ['Hvac', 'Heating', 'Cooling', 'Air conditioning'].includes(s))) {
    result.industry = 'HVAC';
  } else if (result.services.some(s => ['Roofing', 'Roof repair', 'Roof installation'].includes(s))) {
    result.industry = 'Roofing';
  } else if (result.services.some(s => ['Plumbing', 'Pipe', 'Drain'].includes(s))) {
    result.industry = 'Plumbing';
  } else if (result.services.some(s => ['Electrical', 'Wiring', 'Lighting'].includes(s))) {
    result.industry = 'Electrical';
  } else if (result.services.some(s => ['Dental', 'Dentist'].includes(s))) {
    result.industry = 'Dental';
  } else if (result.services.some(s => ['Legal', 'Law firm', 'Attorney'].includes(s))) {
    result.industry = 'Legal';
  } else if (result.services.length > 0) {
    result.industry = 'Home Services';
  }
  
  const yearMatch = bodyText.match(YEAR_PATTERN);
  if (yearMatch) {
    result.foundedYear = yearMatch[1];
  }
  
  const phoneMatches = bodyText.match(PHONE_PATTERN);
  if (phoneMatches && phoneMatches.length > 0) {
    result.contactInfo.phone = phoneMatches[0];
  }
  
  const emailMatches = bodyText.match(EMAIL_PATTERN);
  if (emailMatches && emailMatches.length > 0) {
    const businessEmail = emailMatches.find(e => !e.includes('example') && !e.includes('test'));
    if (businessEmail) {
      result.contactInfo.email = businessEmail;
    }
  }
  
  return result;
}

export function calculateConfidenceScore(
  scrapeResult: ScrapeResult,
  businessIntel: BusinessIntelligence,
  inputData: Record<string, string | null | undefined>
): { score: number; rationale: string } {
  let score = 0;
  const factors: string[] = [];
  
  // Track if we have any REAL enrichment data from scraping
  // Input data (company name, location) alone doesn't count as enrichment
  let hasEnrichment = false;
  
  if (scrapeResult.success && scrapeResult.content) {
    score += 0.3;
    factors.push('Website scraped successfully');
    hasEnrichment = true;
    
    if (scrapeResult.content.title) {
      score += 0.05;
    }
    if (scrapeResult.content.description) {
      score += 0.05;
    }
    if (scrapeResult.content.bodyText.length > 500) {
      score += 0.1;
      factors.push('Rich website content');
    } else if (scrapeResult.content.bodyText.length > 50) {
      score += 0.05;
      factors.push('Thin website content');
    }
  }
  
  // These are input-derived fields, not enrichment
  if (businessIntel.companyName) {
    score += 0.1;
  }
  
  if (businessIntel.city || businessIntel.state) {
    score += 0.1;
  }
  
  // Services and signals from scraping ARE enrichment
  if (businessIntel.services.length > 0) {
    score += 0.1;
    factors.push(`${businessIntel.services.length} services identified`);
    hasEnrichment = true;
  }
  
  if (businessIntel.signals.length >= 2) {
    score += 0.1;
    factors.push('Multiple business signals found');
    hasEnrichment = true;
  } else if (businessIntel.signals.length === 1) {
    score += 0.05;
    factors.push('Business signal found');
    hasEnrichment = true;
  }
  
  if (inputData.email) {
    score += 0.05;
  }
  if (inputData.phone) {
    score += 0.05;
  }
  
  score = Math.min(score, 1);
  score = Math.round(score * 100) / 100;
  
  // If no real enrichment data (no scrape success, no services/signals), return thin_record
  // This is regardless of having company name or location from input
  if (!hasEnrichment) {
    return {
      score,
      rationale: 'thin_record',
    };
  }
  
  return {
    score,
    rationale: factors.join('; '),
  };
}
