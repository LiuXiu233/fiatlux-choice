ALTER TABLE "compliance_items" ADD COLUMN "source_status" text;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "source_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "metadata_hash" text;