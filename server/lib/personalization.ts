import type { BusinessIntelligence } from './content-parser';
import type { ScrapeResult } from './scraper';

export type PersonalizationTier = 0 | 1 | 2;

export interface PersonalizationResult {
  bullets: string[];
  icebreaker: string;
  tier: PersonalizationTier;
  isGeneric: boolean;
}

function determineTier(
  scrapeResult: ScrapeResult,
  businessIntel: BusinessIntelligence
): PersonalizationTier {
  // Tier 2: Rich content with extractable data
  if (scrapeResult.success && scrapeResult.content && scrapeResult.content.bodyText.length >= 100) {
    if (businessIntel.services.length > 0 || businessIntel.signals.length > 0 || businessIntel.foundedYear) {
      return 2;
    }
    return 1;
  }
  
  // Tier 1: Scrape succeeded (status 200) but thin content - still try to extract what we can
  if (scrapeResult.success && scrapeResult.content) {
    // Even with thin content, if we have some data points, we can generate bullets
    if (businessIntel.services.length > 0 || businessIntel.signals.length > 0 || 
        businessIntel.city || businessIntel.companyName || businessIntel.foundedYear) {
      return 1;
    }
  }
  
  // Tier 0: No website data available or scrape failed
  return 0;
}

export function generatePersonalization(
  businessIntel: BusinessIntelligence,
  scrapeResult: ScrapeResult,
  inputData: Record<string, string | null | undefined>
): PersonalizationResult {
  const bullets: string[] = [];
  let icebreaker = '';
  
  const companyName = businessIntel.companyName || inputData.company || inputData.companyName || '';
  const location = [businessIntel.city || inputData.city, businessIntel.state || inputData.state].filter(Boolean).join(', ');
  
  const tier = determineTier(scrapeResult, businessIntel);
  
  if (tier === 0) {
    return { 
      bullets: [], 
      icebreaker: '', 
      tier: 0,
      isGeneric: true 
    };
  }
  
  if (businessIntel.services.length > 0) {
    const serviceList = businessIntel.services.slice(0, 3).join(', ');
    bullets.push(`Specializes in ${serviceList}`);
  }
  
  if (location) {
    bullets.push(`Serves the ${location} area`);
  }
  
  if (businessIntel.foundedYear) {
    const yearsInBusiness = new Date().getFullYear() - parseInt(businessIntel.foundedYear);
    if (yearsInBusiness > 0 && yearsInBusiness < 200) {
      bullets.push(`${yearsInBusiness}+ years of experience (since ${businessIntel.foundedYear})`);
    }
  }
  
  for (const signal of businessIntel.signals) {
    if (bullets.length >= 4) break;
    
    if (signal === 'Family-owned business') {
      bullets.push('Family-owned and operated business');
    } else if (signal === 'Licensed and insured') {
      bullets.push('Fully licensed and insured');
    } else if (signal === 'Offers 24/7 service') {
      bullets.push('Provides 24/7 emergency services');
    } else if (signal === 'Award-winning') {
      bullets.push('Award-winning service in the community');
    } else if (signal === 'Offers free estimates') {
      bullets.push('Offers free estimates to customers');
    } else if (signal === 'Veteran-owned') {
      bullets.push('Veteran-owned business');
    }
  }
  
  if (businessIntel.services.length > 0 && location && companyName) {
    icebreaker = `I was researching ${businessIntel.services[0].toLowerCase()} companies in ${location} and noticed ${companyName}'s strong reputation in the area.`;
  } else if (businessIntel.foundedYear && parseInt(businessIntel.foundedYear) < 2010 && companyName) {
    const years = new Date().getFullYear() - parseInt(businessIntel.foundedYear);
    icebreaker = `With ${years}+ years serving your community, ${companyName} has clearly built something special—I'd love to discuss how we might help you grow even further.`;
  } else if (businessIntel.signals.includes('Award-winning') && companyName) {
    icebreaker = `Congratulations on the recognition ${companyName} has received—it's clear you're committed to excellence, and I wanted to connect about a potential opportunity.`;
  } else if (location && companyName) {
    icebreaker = `I noticed ${companyName} serves the ${location} market and wanted to reach out about an opportunity that might interest you.`;
  } else if (companyName && scrapeResult.success) {
    icebreaker = `After reviewing ${companyName}'s website, I was impressed by your services and wanted to connect about a potential opportunity.`;
  }
  
  return { 
    bullets: bullets.slice(0, 4), 
    icebreaker, 
    tier,
    isGeneric: false
  };
}
