ALTER TABLE "compliance_items" ADD COLUMN "monitoring_lease_token" text;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "monitoring_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "monitoring_job_id" text;