import * as cheerio from 'cheerio';

export interface ScrapeSource {
  url: string;
  statusCode: number;
  success: boolean;
  error?: string;
  redirectedTo?: string;
}

export interface ScrapeResult {
  success: boolean;
  sources: ScrapeSource[];
  content?: {
    title: string;
    description: string;
    headings: string[];
    bodyText: string;
    links: string[];
    metadata: Record<string, string>;
  };
  error?: string;
}

const SCRAPER_CONFIG = {
  TIMEOUT_MS: 10000,
  MAX_RETRIES: 2,
  MAX_REDIRECTS: 5,
  USER_AGENT: 'Mozilla/5.0 (compatible; LeadBrief/1.0; +https://leadbrief.app)',
  MAX_CONTENT_LENGTH: 5 * 1024 * 1024,
} as const;

function normalizeUrl(url: string): string {
  if (!url) return '';
  let normalized = url.trim().toLowerCase();
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized;
  }
  try {
    const parsed = new URL(normalized);
    return parsed.href;
  } catch {
    return '';
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': SCRAPER_CONFIG.USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function parseHtml(html: string, url: string): ScrapeResult['content'] {
  const $ = cheerio.load(html);
  
  $('script, style, nav, footer, header, iframe, noscript').remove();
  
  const title = $('title').text().trim() || 
                $('meta[property="og:title"]').attr('content')?.trim() || 
                $('h1').first().text().trim() || '';
  
  const description = $('meta[name="description"]').attr('content')?.trim() ||
                      $('meta[property="og:description"]').attr('content')?.trim() || '';
  
  const headings: string[] = [];
  $('h1, h2, h3').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length < 200) {
      headings.push(text);
    }
  });
  
  const bodyText = $('body').text()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50000);
  
  const links: string[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
      try {
        const absoluteUrl = new URL(href, url).href;
        if (!links.includes(absoluteUrl)) {
          links.push(absoluteUrl);
        }
      } catch {}
    }
  });
  
  const metadata: Record<string, string> = {};
  $('meta').each((_, el) => {
    const name = $(el).attr('name') || $(el).attr('property');
    const content = $(el).attr('content');
    if (name && content) {
      metadata[name] = content.slice(0, 500);
    }
  });
  
  return {
    title,
    description,
    headings: headings.slice(0, 20),
    bodyText,
    links: links.slice(0, 50),
    metadata,
  };
}

export async function scrapeWebsite(websiteUrl: string): Promise<ScrapeResult> {
  const normalizedUrl = normalizeUrl(websiteUrl);
  
  if (!normalizedUrl) {
    return {
      success: false,
      sources: [{
        url: websiteUrl,
        statusCode: 0,
        success: false,
        error: 'Invalid URL format',
      }],
      error: 'Invalid URL format',
    };
  }
  
  const sources: ScrapeSource[] = [];
  let lastError = '';
  
  for (let attempt = 0; attempt < SCRAPER_CONFIG.MAX_RETRIES; attempt++) {
    try {
      console.log(`[Scraper] Fetching ${normalizedUrl} (attempt ${attempt + 1})`);
      
      const response = await fetchWithTimeout(normalizedUrl, SCRAPER_CONFIG.TIMEOUT_MS);
      
      const source: ScrapeSource = {
        url: normalizedUrl,
        statusCode: response.status,
        success: response.ok,
      };
      
      if (response.redirected && response.url !== normalizedUrl) {
        source.redirectedTo = response.url;
      }
      
      sources.push(source);
      
      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${response.statusText}`;
        if (response.status === 403 || response.status === 404) {
          break;
        }
        continue;
      }
      
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        return {
          success: false,
          sources,
          error: `Non-HTML content type: ${contentType}`,
        };
      }
      
      const html = await response.text();
      
      if (html.length > SCRAPER_CONFIG.MAX_CONTENT_LENGTH) {
        return {
          success: false,
          sources,
          error: 'Content exceeds maximum size',
        };
      }
      
      const content = parseHtml(html, response.url || normalizedUrl);
      
      console.log(`[Scraper] Successfully scraped ${normalizedUrl}: "${(content?.title || '').slice(0, 50)}..."`);
      
      return {
        success: true,
        sources,
        content,
      };
      
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          lastError = 'Request timeout';
        } else {
          lastError = error.message;
        }
      } else {
        lastError = 'Unknown error';
      }
      
      sources.push({
        url: normalizedUrl,
        statusCode: 0,
        success: false,
        error: lastError,
      });
      
      console.log(`[Scraper] Attempt ${attempt + 1} failed for ${normalizedUrl}: ${lastError}`);
    }
  }
  
  return {
    success: false,
    sources,
    error: lastError || 'Failed after retries',
  };
}

export async function scrapeMultipleUrls(urls: string[]): Promise<Map<string, ScrapeResult>> {
  const results = new Map<string, ScrapeResult>();
  const CONCURRENCY = 3;
  
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(url => scrapeWebsite(url).then(result => ({ url, result })))
    );
    
    for (const { url, result } of batchResults) {
      results.set(url, result);
    }
  }
  
  return results;
}
