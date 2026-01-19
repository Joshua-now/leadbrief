/**
 * Domain Discovery Module
 * Attempts to find a valid website domain for a company using various strategies
 */

export interface DomainDiscoveryResult {
  domain: string | null;
  verified: boolean;
  source: 'input' | 'guessed' | 'search' | 'none';
  attempts: Array<{
    domain: string;
    success: boolean;
    error?: string;
  }>;
}

const DISCOVERY_CONFIG = {
  TIMEOUT_MS: 5000,
  MAX_GUESSES: 3,
} as const;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function generateDomainGuesses(companyName: string, city?: string): string[] {
  const guesses: string[] = [];
  const slug = slugify(companyName);
  
  if (!slug) return guesses;
  
  const words = companyName.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const filtered = words.filter(w => 
    !['inc', 'llc', 'ltd', 'corp', 'co', 'company', 'services', 'the'].includes(w)
  );
  
  guesses.push(`${slug}.com`);
  
  if (filtered.length > 0) {
    const mainSlug = filtered.map(w => w.replace(/[^a-z0-9]/g, '')).join('');
    if (mainSlug !== slug && mainSlug.length > 2) {
      guesses.push(`${mainSlug}.com`);
    }
  }
  
  if (filtered.length >= 2) {
    const initials = filtered.map(w => w[0]).join('');
    if (initials.length >= 2) {
      guesses.push(`${initials}${city ? slugify(city).slice(0, 3) : ''}.com`);
    }
  }
  
  if (slug.length > 3) {
    guesses.push(`${slug}hvac.com`);
    guesses.push(`${slug}services.com`);
  }
  
  return Array.from(new Set(guesses)).slice(0, DISCOVERY_CONFIG.MAX_GUESSES);
}

async function verifyDomain(domain: string): Promise<{ valid: boolean; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_CONFIG.TIMEOUT_MS);
  
  const urlsToTry = [
    `https://${domain}`,
    `https://www.${domain}`,
    `http://${domain}`,
  ];
  
  try {
    for (const url of urlsToTry) {
      try {
        const response = await fetch(url, {
          method: 'HEAD',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; LeadBrief/1.0)',
          },
          redirect: 'follow',
        });
        
        if (response.ok || response.status === 403 || response.status === 405) {
          return { valid: true };
        }
      } catch (e) {
        continue;
      }
    }
    
    return { valid: false, error: 'No valid response from domain' };
  } catch (e) {
    return { 
      valid: false, 
      error: e instanceof Error && e.name === 'AbortError' ? 'Timeout' : 'Network error' 
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractDomainFromInput(data: Record<string, string | null | undefined>): string | null {
  const websiteUrl = data.website || data.websiteUrl || data.url || data.companyDomain || data.domain;
  
  if (!websiteUrl) return null;
  
  try {
    let normalized = websiteUrl.trim();
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = 'https://' + normalized;
    }
    const url = new URL(normalized);
    return url.hostname.replace(/^www\./, '');
  } catch {
    const domain = websiteUrl.trim().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    if (domain && domain.includes('.')) {
      return domain;
    }
    return null;
  }
}

export async function discoverDomain(
  data: Record<string, string | null | undefined>
): Promise<DomainDiscoveryResult> {
  const attempts: DomainDiscoveryResult['attempts'] = [];
  
  const inputDomain = extractDomainFromInput(data);
  
  if (inputDomain) {
    console.log(`[DomainDiscovery] Input domain found: ${inputDomain}`);
    const verification = await verifyDomain(inputDomain);
    attempts.push({ domain: inputDomain, success: verification.valid, error: verification.error });
    
    if (verification.valid) {
      return {
        domain: inputDomain,
        verified: true,
        source: 'input',
        attempts,
      };
    }
    console.log(`[DomainDiscovery] Input domain ${inputDomain} failed verification: ${verification.error}`);
  }
  
  const companyName = data.company || data.companyName || data.company_name;
  
  if (!companyName) {
    return {
      domain: null,
      verified: false,
      source: 'none',
      attempts,
    };
  }
  
  const city = data.city || undefined;
  const guesses = generateDomainGuesses(companyName, city);
  
  console.log(`[DomainDiscovery] Trying ${guesses.length} guesses for "${companyName}": ${guesses.join(', ')}`);
  
  for (const guess of guesses) {
    const verification = await verifyDomain(guess);
    attempts.push({ domain: guess, success: verification.valid, error: verification.error });
    
    if (verification.valid) {
      console.log(`[DomainDiscovery] Found valid domain: ${guess}`);
      return {
        domain: guess,
        verified: true,
        source: 'guessed',
        attempts,
      };
    }
  }
  
  console.log(`[DomainDiscovery] No valid domain found for "${companyName}"`);
  return {
    domain: null,
    verified: false,
    source: 'none',
    attempts,
  };
}
