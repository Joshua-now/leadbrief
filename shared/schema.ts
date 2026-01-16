import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, numeric, jsonb, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at").defaultNow(),
  name: text("name").notNull(),
  domain: text("domain").unique(),
  linkedinUrl: text("linkedin_url"),
  isHvac: boolean("is_hvac").default(false),
  isRoofing: boolean("is_roofing").default(false),
  enrichmentStatus: text("enrichment_status").default("pending"),
  fullData: jsonb("full_data"),
});

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at").defaultNow(),
  email: text("email").unique(),
  phone: text("phone"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  title: text("title"),
  city: text("city"),
  companyId: uuid("company_id").references(() => companies.id),
  linkedinUrl: text("linkedin_url"),
  linkedinProfileId: text("linkedin_profile_id").unique(),
  dataQualityScore: numeric("data_quality_score"),
  lastEnriched: timestamp("last_enriched"),
});

export const bulkJobs = pgTable("bulk_jobs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at").defaultNow(),
  name: text("name").notNull(),
  sourceFormat: text("source_format"),
  totalRecords: integer("total_records"),
  status: text("status").default("pending"),
  progress: integer("progress").default(0),
  successful: integer("successful").default(0),
  failed: integer("failed").default(0),
  duplicatesFound: integer("duplicates_found").default(0),
  checkpointPosition: integer("checkpoint_position").default(0),
  lastError: text("last_error"),
  errorLog: jsonb("error_log"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
});

export const bulkJobItems = pgTable("bulk_job_items", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at").defaultNow(),
  bulkJobId: uuid("bulk_job_id").notNull().references(() => bulkJobs.id, { onDelete: "cascade" }),
  rowNumber: integer("row_number"),
  status: text("status").default("pending"),
  rawData: jsonb("raw_data"),
  parsedData: jsonb("parsed_data"),
  companyId: uuid("company_id").references(() => companies.id),
  contactId: uuid("contact_id").references(() => contacts.id),
  fitScore: numeric("fit_score"),
  summary: jsonb("summary"),
  retryCount: integer("retry_count").default(0),
  lastError: text("last_error"),
  nextRetryAt: timestamp("next_retry_at"),
  matchedContactId: uuid("matched_contact_id").references(() => contacts.id),
  matchConfidence: numeric("match_confidence"),
});

export const enrichmentErrors = pgTable("enrichment_errors", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at").defaultNow(),
  bulkJobItemId: uuid("bulk_job_item_id").references(() => bulkJobItems.id),
  errorType: text("error_type"),
  errorMessage: text("error_message"),
  errorDetails: jsonb("error_details"),
  isRecoverable: boolean("is_recoverable").default(true),
});

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at").defaultNow(),
  contactId: uuid("contact_id").references(() => contacts.id),
  fitScore: numeric("fit_score"),
  summary: text("summary"),
  talkingPoints: text("talking_points").array(),
  risks: text("risks").array(),
  websiteData: jsonb("website_data"),
  linkedinData: jsonb("linkedin_data"),
});

// Relations
export const companiesRelations = relations(companies, ({ many }) => ({
  contacts: many(contacts),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  company: one(companies, {
    fields: [contacts.companyId],
    references: [companies.id],
  }),
  reports: many(reports),
}));

export const bulkJobsRelations = relations(bulkJobs, ({ many }) => ({
  items: many(bulkJobItems),
}));

export const bulkJobItemsRelations = relations(bulkJobItems, ({ one }) => ({
  bulkJob: one(bulkJobs, {
    fields: [bulkJobItems.bulkJobId],
    references: [bulkJobs.id],
  }),
  company: one(companies, {
    fields: [bulkJobItems.companyId],
    references: [companies.id],
  }),
  contact: one(contacts, {
    fields: [bulkJobItems.contactId],
    references: [contacts.id],
  }),
}));

export const reportsRelations = relations(reports, ({ one }) => ({
  contact: one(contacts, {
    fields: [reports.contactId],
    references: [contacts.id],
  }),
}));

// Insert schemas
export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
});

export const insertContactSchema = createInsertSchema(contacts).omit({
  id: true,
  createdAt: true,
});

export const insertBulkJobSchema = createInsertSchema(bulkJobs).omit({
  id: true,
  createdAt: true,
});

export const insertBulkJobItemSchema = createInsertSchema(bulkJobItems).omit({
  id: true,
  createdAt: true,
});

// Types
export type Company = typeof companies.$inferSelect;
export type InsertCompany = z.infer<typeof insertCompanySchema>;

export type Contact = typeof contacts.$inferSelect;
export type InsertContact = z.infer<typeof insertContactSchema>;

export type BulkJob = typeof bulkJobs.$inferSelect;
export type InsertBulkJob = z.infer<typeof insertBulkJobSchema>;

export type BulkJobItem = typeof bulkJobItems.$inferSelect;
export type InsertBulkJobItem = z.infer<typeof insertBulkJobItemSchema>;

export type Report = typeof reports.$inferSelect;

// Auth tables (required for Replit Auth)
export * from "./models/auth";

// Settings table
export const settings = pgTable("settings", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  webhookUrl: text("webhook_url"),
  apiKeyEnabled: boolean("api_key_enabled").default(false),
  emailNotifications: boolean("email_notifications").default(false),
  autoRetryEnabled: boolean("auto_retry_enabled").default(true),
  maxRetries: integer("max_retries").default(3),
});

export const insertSettingsSchema = createInsertSchema(settings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Settings = typeof settings.$inferSelect;
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
