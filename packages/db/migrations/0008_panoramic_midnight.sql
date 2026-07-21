ALTER TABLE "workflow_runs" ADD COLUMN "definition_version" integer;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "steps_snapshot" jsonb;