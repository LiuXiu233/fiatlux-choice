ALTER TABLE "compliance_events" ADD COLUMN "evidence_file_id" uuid;--> statement-breakpoint
ALTER TABLE "obligations" ADD COLUMN "evidence_file_id" uuid;--> statement-breakpoint
ALTER TABLE "compliance_events" ADD CONSTRAINT "compliance_events_evidence_file_id_files_id_fk" FOREIGN KEY ("evidence_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_evidence_file_id_files_id_fk" FOREIGN KEY ("evidence_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compliance_events_org_evidence_file_idx" ON "compliance_events" USING btree ("org_id","evidence_file_id");--> statement-breakpoint
CREATE INDEX "obligations_org_evidence_file_idx" ON "obligations" USING btree ("org_id","evidence_file_id");