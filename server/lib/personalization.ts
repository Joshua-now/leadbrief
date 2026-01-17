import type { BusinessIntelligence } from './content-parser';
import type { ScrapeResult } from './scraper';

export interface PersonalizationResult {
  bullets: string[];
  icebreaker: string;
  isGeneric: boolean;
}

const GENERIC_BULLETS = [
  'Serves local customers in their area',
  'Provides professional services',
  'Committed to customer satisfaction',
];

const GENERIC_ICEBREAKERS = [
  'I noticed your business in the area and wanted to reach out.',
  'I came across your company and thought we might be able to help.',
];

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function generatePersonalization(
  businessIntel: BusinessIntelligence,
  scrapeResult: ScrapeResult,
  inputData: Record<string, string | null | undefined>
): PersonalizationResult {
  const bullets: string[] = [];
  let icebreaker = '';
  let isGeneric = false;
  
  const companyName = businessIntel.companyName || inputData.company || inputData.companyName || 'your company';
  const location = [businessIntel.city, businessIntel.state].filter(Boolean).join(', ');
  
  if (!scrapeResult.success || !scrapeResult.content || scrapeResult.content.bodyText.length < 100) {
    isGeneric = true;
    
    if (location) {
      bullets.push(`Based in ${location}`);
    }
    if (inputData.city) {
      bullets.push(`Serves the ${inputData.city} area`);
    }
    bullets.push(...GENERIC_BULLETS.slice(0, 4 - bullets.length));
    
    icebreaker = location 
      ? `I noticed ${companyName} serves the ${location} area and wanted to connect.`
      : GENERIC_ICEBREAKERS[0];
    
    return { bullets: bullets.slice(0, 4), icebreaker, isGeneric };
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
  
  while (bullets.length < 2) {
    if (businessIntel.industry) {
      bullets.push(`Professional ${businessIntel.industry.toLowerCase()} services`);
    } else {
      bullets.push('Committed to quality service');
    }
    if (bullets.length < 2) {
      bullets.push('Focused on customer satisfaction');
    }
  }
  
  if (businessIntel.services.length > 0 && location) {
    icebreaker = `I was researching ${businessIntel.services[0].toLowerCase()} companies in ${location} and noticed ${companyName}'s strong reputation in the area.`;
  } else if (businessIntel.foundedYear && parseInt(businessIntel.foundedYear) < 2010) {
    const years = new Date().getFullYear() - parseInt(businessIntel.foundedYear);
    icebreaker = `With ${years}+ years serving your community, ${companyName} has clearly built something special—I'd love to discuss how we might help you grow even further.`;
  } else if (businessIntel.signals.includes('Award-winning')) {
    icebreaker = `Congratulations on the recognition ${companyName} has received—it's clear you're committed to excellence, and I wanted to connect about a potential opportunity.`;
  } else if (location) {
    icebreaker = `I noticed ${companyName} serves the ${location} market and wanted to reach out about an opportunity that might interest you.`;
  } else {
    icebreaker = `After reviewing ${companyName}'s website, I was impressed by your services and wanted to connect about a potential opportunity.`;
  }
  
  return { 
    bullets: bullets.slice(0, 4), 
    icebreaker, 
    isGeneric 
  };
}
