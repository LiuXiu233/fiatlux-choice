ALTER TABLE "compliance_items" ADD COLUMN "review_outcome" text;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "reviewer_name" text;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "reviewer_role" text;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "reviewer_organization" text;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "reviewer_qualification" text;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "review_missing_information" text;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "review_evidence_file_id" uuid;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "reviewed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "reviewed_source_version" integer;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "reviewed_content_hash" text;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD COLUMN "reviewed_metadata_hash" text;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD CONSTRAINT "compliance_items_review_evidence_file_id_files_id_fk" FOREIGN KEY ("review_evidence_file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD CONSTRAINT "compliance_items_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compliance_items_org_review_evidence_idx" ON "compliance_items" USING btree ("org_id","review_evidence_file_id");