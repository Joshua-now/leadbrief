import {
  companies,
  contacts,
  bulkJobs,
  bulkJobItems,
  settings,
  type Company,
  type InsertCompany,
  type Contact,
  type InsertContact,
  type BulkJob,
  type InsertBulkJob,
  type BulkJobItem,
  type InsertBulkJobItem,
  type Settings,
  type InsertSettings,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, sql, and, isNotNull } from "drizzle-orm";
import { normalizeContactFields, normalizeEmail, normalizeDomain, normalizePhone } from "./lib/normalize";

export interface MergeResult {
  contact: Contact;
  isNew: boolean;
  matchedBy: 'email' | 'domain' | 'phone' | null;
  fieldsUpdated: string[];
}

export interface IStorage {
  // Companies
  getCompany(id: string): Promise<Company | undefined>;
  getCompanyByDomain(domain: string): Promise<Company | undefined>;
  getCompanyByName(name: string): Promise<Company | undefined>;
  createCompany(company: InsertCompany): Promise<Company>;
  upsertCompany(company: InsertCompany): Promise<Company>;
  
  // Contacts
  getContact(id: string): Promise<Contact | undefined>;
  getContactByEmail(email: string): Promise<Contact | undefined>;
  getContactByEmailNorm(emailNorm: string): Promise<Contact | undefined>;
  getContactByDomainNorm(domainNorm: string): Promise<Contact | undefined>;
  getContactByPhoneNorm(phoneNorm: string): Promise<Contact | undefined>;
  getContactByCompanyAndCity(companyName: string, city: string): Promise<Contact | undefined>;
  getContacts(limit?: number): Promise<Contact[]>;
  createContact(contact: InsertContact): Promise<Contact>;
  upsertContact(contact: InsertContact): Promise<Contact>;
  mergeContact(contact: InsertContact, source: string): Promise<MergeResult>;
  
  // Bulk Jobs
  getBulkJob(id: string): Promise<BulkJob | undefined>;
  getBulkJobs(limit?: number): Promise<BulkJob[]>;
  createBulkJob(job: InsertBulkJob): Promise<BulkJob>;
  updateBulkJob(id: string, updates: Partial<InsertBulkJob>): Promise<BulkJob | undefined>;
  
  // Bulk Job Items
  getBulkJobItems(bulkJobId: string): Promise<BulkJobItem[]>;
  createBulkJobItems(items: InsertBulkJobItem[]): Promise<BulkJobItem[]>;
  updateBulkJobItem(id: string, updates: Partial<InsertBulkJobItem>): Promise<BulkJobItem | undefined>;
  getBulkJobStats(bulkJobId: string): Promise<{ total: number; completed: number; failed: number; processing: number }>;
  
  // Settings
  getSettings(): Promise<Settings | undefined>;
  upsertSettings(data: InsertSettings): Promise<Settings>;
}

export class DatabaseStorage implements IStorage {
  // Companies
  async getCompany(id: string): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    return company || undefined;
  }

  async getCompanyByDomain(domain: string): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.domain, domain));
    return company || undefined;
  }

  async getCompanyByName(name: string): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.name, name));
    return company || undefined;
  }

  async createCompany(company: InsertCompany): Promise<Company> {
    const [created] = await db.insert(companies).values(company).returning();
    return created;
  }

  async upsertCompany(company: InsertCompany): Promise<Company> {
    if (company.domain) {
      const existing = await this.getCompanyByDomain(company.domain);
      if (existing) {
        const [updated] = await db
          .update(companies)
          .set(company)
          .where(eq(companies.id, existing.id))
          .returning();
        return updated;
      }
    }
    return this.createCompany(company);
  }

  // Contacts
  async getContact(id: string): Promise<Contact | undefined> {
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
    return contact || undefined;
  }

  async getContactByEmail(email: string): Promise<Contact | undefined> {
    const [contact] = await db.select().from(contacts).where(eq(contacts.email, email.toLowerCase()));
    return contact || undefined;
  }

  async getContactByEmailNorm(emailNorm: string): Promise<Contact | undefined> {
    const [contact] = await db.select().from(contacts).where(eq(contacts.emailNorm, emailNorm));
    return contact || undefined;
  }

  async getContactByDomainNorm(domainNorm: string): Promise<Contact | undefined> {
    const [contact] = await db.select().from(contacts).where(eq(contacts.domainNorm, domainNorm));
    return contact || undefined;
  }

  async getContactByPhoneNorm(phoneNorm: string): Promise<Contact | undefined> {
    const [contact] = await db.select().from(contacts).where(eq(contacts.phoneNorm, phoneNorm));
    return contact || undefined;
  }

  async getContactByCompanyAndCity(companyName: string, city: string): Promise<Contact | undefined> {
    const company = await this.getCompanyByName(companyName);
    if (!company) return undefined;
    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.companyId, company.id));
    if (contact && contact.city?.toLowerCase() === city.toLowerCase()) {
      return contact;
    }
    return undefined;
  }

  async getContacts(limit = 100): Promise<Contact[]> {
    return db.select().from(contacts).orderBy(desc(contacts.createdAt)).limit(limit);
  }

  async createContact(contact: InsertContact): Promise<Contact> {
    const normalized = normalizeContactFields(contact);
    const [created] = await db.insert(contacts).values({
      ...contact,
      email: contact.email?.toLowerCase(),
      emailNorm: normalized.emailNorm,
      domainNorm: normalized.domainNorm,
      phoneNorm: normalized.phoneNorm,
      sourceHash: normalized.sourceHash,
      lastSeenAt: new Date(),
    }).returning();
    return created;
  }

  async upsertContact(contact: InsertContact): Promise<Contact> {
    const normalized = normalizeContactFields(contact);
    if (normalized.emailNorm) {
      const existing = await this.getContactByEmailNorm(normalized.emailNorm);
      if (existing) {
        const [updated] = await db
          .update(contacts)
          .set({ 
            ...contact, 
            email: contact.email?.toLowerCase() || existing.email,
            emailNorm: normalized.emailNorm,
            domainNorm: normalized.domainNorm ?? existing.domainNorm,
            phoneNorm: normalized.phoneNorm ?? existing.phoneNorm,
            sourceHash: normalized.sourceHash,
            lastSeenAt: new Date(),
          })
          .where(eq(contacts.id, existing.id))
          .returning();
        return updated;
      }
    }
    return this.createContact(contact);
  }

  async mergeContact(contact: InsertContact, source: string): Promise<MergeResult> {
    const normalized = normalizeContactFields(contact);
    let existing: Contact | undefined;
    let matchedBy: 'email' | 'domain' | 'phone' | null = null;

    if (normalized.emailNorm) {
      existing = await this.getContactByEmailNorm(normalized.emailNorm);
      if (existing) matchedBy = 'email';
    }
    if (!existing && normalized.domainNorm) {
      existing = await this.getContactByDomainNorm(normalized.domainNorm);
      if (existing) matchedBy = 'domain';
    }
    if (!existing && normalized.phoneNorm) {
      existing = await this.getContactByPhoneNorm(normalized.phoneNorm);
      if (existing) matchedBy = 'phone';
    }

    const fieldsUpdated: string[] = [];
    const now = new Date();

    if (existing) {
      const mergedData: Partial<InsertContact> = {
        lastSeenAt: now,
      };

      const fillIfMissing = (field: keyof InsertContact) => {
        const existingVal = existing![field as keyof Contact];
        const newVal = contact[field];
        if ((!existingVal || existingVal === '') && newVal && newVal !== '') {
          (mergedData as any)[field] = newVal;
          fieldsUpdated.push(field);
        }
      };

      fillIfMissing('email');
      fillIfMissing('phone');
      fillIfMissing('website');
      fillIfMissing('companyName');
      fillIfMissing('firstName');
      fillIfMissing('lastName');
      fillIfMissing('title');
      fillIfMissing('city');
      fillIfMissing('state');
      fillIfMissing('address');
      fillIfMissing('category');
      fillIfMissing('linkedinUrl');

      if (normalized.emailNorm && normalized.emailNorm !== existing.emailNorm) {
        mergedData.emailNorm = normalized.emailNorm;
      }
      if (normalized.domainNorm && normalized.domainNorm !== existing.domainNorm) {
        mergedData.domainNorm = normalized.domainNorm;
      }
      if (normalized.phoneNorm && normalized.phoneNorm !== existing.phoneNorm) {
        mergedData.phoneNorm = normalized.phoneNorm;
      }
      if (normalized.sourceHash) {
        mergedData.sourceHash = normalized.sourceHash;
      }

      const existingSources: string[] = (existing.sources as string[]) || [];
      if (!existingSources.includes(source)) {
        mergedData.sources = [...existingSources, source];
      }

      const [updated] = await db
        .update(contacts)
        .set(mergedData)
        .where(eq(contacts.id, existing.id))
        .returning();

      return { contact: updated, isNew: false, matchedBy, fieldsUpdated };
    } else {
      const newContact: InsertContact = {
        ...contact,
        email: contact.email?.toLowerCase(),
        emailNorm: normalized.emailNorm,
        domainNorm: normalized.domainNorm,
        phoneNorm: normalized.phoneNorm,
        sourceHash: normalized.sourceHash,
        sources: [source],
        lastSeenAt: now,
      };

      const [created] = await db.insert(contacts).values(newContact).returning();
      return { contact: created, isNew: true, matchedBy: null, fieldsUpdated: [] };
    }
  }

  // Bulk Jobs
  async getBulkJob(id: string): Promise<BulkJob | undefined> {
    const [job] = await db.select().from(bulkJobs).where(eq(bulkJobs.id, id));
    return job || undefined;
  }

  async getBulkJobs(limit = 20): Promise<BulkJob[]> {
    return db.select().from(bulkJobs).orderBy(desc(bulkJobs.createdAt)).limit(limit);
  }

  async createBulkJob(job: InsertBulkJob): Promise<BulkJob> {
    const [created] = await db.insert(bulkJobs).values(job).returning();
    return created;
  }

  async updateBulkJob(id: string, updates: Partial<InsertBulkJob>): Promise<BulkJob | undefined> {
    const [updated] = await db
      .update(bulkJobs)
      .set(updates)
      .where(eq(bulkJobs.id, id))
      .returning();
    return updated || undefined;
  }

  // Bulk Job Items
  async getBulkJobItems(bulkJobId: string): Promise<BulkJobItem[]> {
    return db.select().from(bulkJobItems).where(eq(bulkJobItems.bulkJobId, bulkJobId));
  }

  async createBulkJobItems(items: InsertBulkJobItem[]): Promise<BulkJobItem[]> {
    if (items.length === 0) return [];
    return db.insert(bulkJobItems).values(items).returning();
  }

  async updateBulkJobItem(id: string, updates: Partial<InsertBulkJobItem>): Promise<BulkJobItem | undefined> {
    const [updated] = await db
      .update(bulkJobItems)
      .set(updates)
      .where(eq(bulkJobItems.id, id))
      .returning();
    return updated || undefined;
  }

  async getBulkJobStats(bulkJobId: string): Promise<{ total: number; completed: number; failed: number; processing: number }> {
    const items = await this.getBulkJobItems(bulkJobId);
    return {
      total: items.length,
      completed: items.filter(i => i.status === "complete").length,
      failed: items.filter(i => i.status === "failed").length,
      processing: items.filter(i => i.status === "processing").length,
    };
  }

  // Settings
  async getSettings(): Promise<Settings | undefined> {
    const [result] = await db.select().from(settings).limit(1);
    return result || undefined;
  }

  async upsertSettings(data: InsertSettings): Promise<Settings> {
    const existing = await this.getSettings();
    if (existing) {
      const [updated] = await db
        .update(settings)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(settings.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(settings).values(data).returning();
    return created;
  }
}

export const storage = new DatabaseStorage();
