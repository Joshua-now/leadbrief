CREATE TABLE "bulk_job_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"bulk_job_id" uuid NOT NULL,
	"row_number" integer,
	"status" text DEFAULT 'pending',
	"raw_data" jsonb,
	"parsed_data" jsonb,
	"company_id" uuid,
	"contact_id" uuid,
	"fit_score" numeric,
	"summary" jsonb,
	"retry_count" integer DEFAULT 0,
	"last_error" text,
	"next_retry_at" timestamp,
	"matched_contact_id" uuid,
	"match_confidence" numeric,
	"enrichment_data" jsonb,
	"scrape_sources" jsonb,
	"personalization_bullets" text[],
	"icebreaker" text,
	"confidence_score" numeric,
	"confidence_rationale" text
);
--> statement-breakpoint
CREATE TABLE "bulk_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"name" text NOT NULL,
	"source_format" text,
	"total_records" integer,
	"status" text DEFAULT 'pending',
	"progress" integer DEFAULT 0,
	"successful" integer DEFAULT 0,
	"failed" integer DEFAULT 0,
	"duplicates_found" integer DEFAULT 0,
	"checkpoint_position" integer DEFAULT 0,
	"last_error" text,
	"error_log" jsonb,
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"name" text NOT NULL,
	"domain" text,
	"linkedin_url" text,
	"is_hvac" boolean DEFAULT false,
	"is_roofing" boolean DEFAULT false,
	"enrichment_status" text DEFAULT 'pending',
	"full_data" jsonb,
	CONSTRAINT "companies_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"email" text,
	"phone" text,
	"first_name" text,
	"last_name" text,
	"title" text,
	"city" text,
	"company_id" uuid,
	"linkedin_url" text,
	"linkedin_profile_id" text,
	"data_quality_score" numeric,
	"last_enriched" timestamp,
	CONSTRAINT "contacts_email_unique" UNIQUE("email"),
	CONSTRAINT "contacts_linkedin_profile_id_unique" UNIQUE("linkedin_profile_id")
);
--> statement-breakpoint
CREATE TABLE "enrichment_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"bulk_job_item_id" uuid,
	"error_type" text,
	"error_message" text,
	"error_details" jsonb,
	"is_recoverable" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"contact_id" uuid,
	"fit_score" numeric,
	"summary" text,
	"talking_points" text[],
	"risks" text[],
	"website_data" jsonb,
	"linkedin_data" jsonb
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"webhook_url" text,
	"api_key_enabled" boolean DEFAULT false,
	"email_notifications" boolean DEFAULT false,
	"auto_retry_enabled" boolean DEFAULT true,
	"max_retries" integer DEFAULT 3
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "bulk_job_items" ADD CONSTRAINT "bulk_job_items_bulk_job_id_bulk_jobs_id_fk" FOREIGN KEY ("bulk_job_id") REFERENCES "public"."bulk_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_job_items" ADD CONSTRAINT "bulk_job_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_job_items" ADD CONSTRAINT "bulk_job_items_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_job_items" ADD CONSTRAINT "bulk_job_items_matched_contact_id_contacts_id_fk" FOREIGN KEY ("matched_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_errors" ADD CONSTRAINT "enrichment_errors_bulk_job_item_id_bulk_job_items_id_fk" FOREIGN KEY ("bulk_job_item_id") REFERENCES "public"."bulk_job_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");