import { describe, it, expect } from 'vitest';
import { calculateConfidenceScore } from '../server/lib/content-parser';

describe('calculateConfidenceScore', () => {
  describe('thin_record rationale', () => {
    it('should return thin_record when scrape fails and no services/signals', () => {
      const scrapeResult = {
        success: false,
        sources: [],
        error: 'No website',
      };
      const businessIntel = {
        companyName: 'Test Company',
        city: 'New York',
        state: 'NY',
        services: [],
        signals: [],
        industry: null,
        employeeCount: null,
        foundedYear: null,
        contactInfo: {},
      };
      const inputData = {
        email: 'test@example.com',
        phone: '555-1234',
        company: 'Test Company',
      };

      const result = calculateConfidenceScore(scrapeResult, businessIntel, inputData);
      
      expect(result.rationale).toBe('thin_record');
      expect(result.score).toBeGreaterThan(0); // Should still have score from input data
    });

    it('should return thin_record when no website and only input data', () => {
      const scrapeResult = {
        success: false,
        sources: [],
        error: 'No website URL available',
      };
      const businessIntel = {
        companyName: 'ACME Corp',
        city: 'Chicago',
        state: 'IL',
        services: [],
        signals: [],
        industry: null,
        employeeCount: null,
        foundedYear: null,
        contactInfo: {},
      };
      const inputData = {
        company: 'ACME Corp',
        city: 'Chicago',
        state: 'IL',
      };

      const result = calculateConfidenceScore(scrapeResult, businessIntel, inputData);
      
      expect(result.rationale).toBe('thin_record');
    });
  });

  describe('enriched records', () => {
    it('should return descriptive rationale when scrape succeeds', () => {
      const scrapeResult = {
        success: true,
        sources: [{ url: 'https://example.com', statusCode: 200, success: true }],
        content: {
          title: 'Example Company',
          description: 'A great company',
          bodyText: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(20),
          headings: [],
          links: [],
          metadata: {},
        },
      };
      const businessIntel = {
        companyName: 'Example Company',
        city: 'Boston',
        state: 'MA',
        services: ['HVAC', 'Plumbing'],
        signals: ['Licensed and insured'],
        industry: 'Home Services',
        employeeCount: null,
        foundedYear: '2010',
        contactInfo: {},
      };
      const inputData = {
        email: 'contact@example.com',
      };

      const result = calculateConfidenceScore(scrapeResult, businessIntel, inputData);
      
      expect(result.rationale).not.toBe('thin_record');
      expect(result.rationale).toContain('Website scraped successfully');
      expect(result.rationale).toContain('Rich website content');
      expect(result.rationale).toContain('services identified');
      expect(result.score).toBeGreaterThan(0.5);
    });

    it('should return descriptive rationale when services/signals are found', () => {
      const scrapeResult = {
        success: true,
        sources: [{ url: 'https://example.com', statusCode: 200, success: true }],
        content: {
          title: 'Test',
          description: '',
          bodyText: 'Short content',
          headings: [],
          links: [],
          metadata: {},
        },
      };
      const businessIntel = {
        companyName: 'Test Co',
        city: null,
        state: null,
        services: ['Roofing'],
        signals: [],
        industry: null,
        employeeCount: null,
        foundedYear: null,
        contactInfo: {},
      };
      const inputData = {};

      const result = calculateConfidenceScore(scrapeResult, businessIntel, inputData);
      
      expect(result.rationale).not.toBe('thin_record');
      expect(result.rationale).toContain('Website scraped successfully');
      expect(result.rationale).toContain('1 services identified');
    });
  });

  describe('score calculation', () => {
    it('should score higher for more data points', () => {
      const baseScrape = {
        success: true,
        sources: [{ url: 'https://example.com', statusCode: 200, success: true }],
        content: {
          title: 'Test',
          description: 'Description',
          bodyText: 'Some content that is more than fifty characters long for the test.',
          headings: [],
          links: [],
          metadata: {},
        },
      };
      
      const richBusinessIntel = {
        companyName: 'Rich Company',
        city: 'NYC',
        state: 'NY',
        services: ['HVAC', 'Plumbing', 'Electrical'],
        signals: ['Licensed and insured', 'Award-winning'],
        industry: 'Home Services',
        employeeCount: '50',
        foundedYear: '2005',
        contactInfo: { phone: '555-1234' },
      };
      
      const sparseBusinessIntel = {
        companyName: 'Sparse Company',
        city: null,
        state: null,
        services: [],
        signals: [],
        industry: null,
        employeeCount: null,
        foundedYear: null,
        contactInfo: {},
      };
      
      const richResult = calculateConfidenceScore(baseScrape, richBusinessIntel, { email: 'a@b.com', phone: '555' });
      const sparseResult = calculateConfidenceScore(baseScrape, sparseBusinessIntel, {});
      
      expect(richResult.score).toBeGreaterThan(sparseResult.score);
    });
  });
});
