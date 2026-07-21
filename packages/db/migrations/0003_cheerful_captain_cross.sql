CREATE TYPE "public"."compliance_content_hash_status" AS ENUM('pending_fetch', 'current', 'changed', 'failed');--> statement-breakpoint
CREATE TABLE "compliance_source_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"source_id" uuid NOT NULL,
	"requested_url" text NOT NULL,
	"final_url" text NOT NULL,
	"http_status" integer NOT NULL,
	"content_type" text,
	"size_bytes" bigint NOT NULL,
	"etag" text,
	"last_modified" text,
	"raw_hash" text,
	"normalized_hash" text,
	"previous_content_hash" text,
	"normalized_excerpt" text,
	"changed" boolean DEFAULT false NOT NULL,
	"not_modified" boolean DEFAULT false NOT NULL,
	"fetcher_version" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "content_hash_status" "compliance_content_hash_status" DEFAULT 'pending_fetch' NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "next_review_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "monitoring_cadence_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "next_monitor_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "last_fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "last_resolved_url" text;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "last_http_status" integer;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "last_etag" text;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "last_modified" text;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "raw_snapshot_hash" text;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "monitoring_failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "last_monitoring_error" text;--> statement-breakpoint
ALTER TABLE "compliance_source_snapshots" ADD CONSTRAINT "compliance_source_snapshots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_source_snapshots" ADD CONSTRAINT "compliance_source_snapshots_source_id_compliance_items_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."compliance_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compliance_source_snapshots_org_source_idx" ON "compliance_source_snapshots" USING btree ("org_id","source_id","fetched_at");--> statement-breakpoint
CREATE INDEX "compliance_items_org_monitor_idx" ON "compliance_items" USING btree ("org_id","content_hash_status","next_monitor_at");