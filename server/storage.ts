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
import { eq, desc, sql } from "drizzle-orm";

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
  getContactByCompanyAndCity(companyName: string, city: string): Promise<Contact | undefined>;
  getContacts(limit?: number): Promise<Contact[]>;
  createContact(contact: InsertContact): Promise<Contact>;
  upsertContact(contact: InsertContact): Promise<Contact>;
  
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
    const [created] = await db.insert(contacts).values({
      ...contact,
      email: contact.email?.toLowerCase(),
    }).returning();
    return created;
  }

  async upsertContact(contact: InsertContact): Promise<Contact> {
    if (contact.email) {
      const existing = await this.getContactByEmail(contact.email);
      if (existing) {
        const [updated] = await db
          .update(contacts)
          .set({ ...contact, email: contact.email.toLowerCase() })
          .where(eq(contacts.id, existing.id))
          .returning();
        return updated;
      }
    }
    return this.createContact(contact);
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
