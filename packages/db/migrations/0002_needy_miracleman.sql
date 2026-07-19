ALTER TABLE "decisions" ADD COLUMN "objective_id" uuid;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "decisions" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "product_id" uuid;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_objective_id_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."objectives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decisions_org_objective_idx" ON "decisions" USING btree ("org_id","objective_id");--> statement-breakpoint
CREATE INDEX "decisions_org_project_idx" ON "decisions" USING btree ("org_id","project_id");--> statement-breakpoint
CREATE INDEX "decisions_org_task_idx" ON "decisions" USING btree ("org_id","task_id");--> statement-breakpoint
CREATE INDEX "opportunities_org_product_idx" ON "opportunities" USING btree ("org_id","product_id");--> statement-breakpoint
CREATE INDEX "opportunities_org_project_idx" ON "opportunities" USING btree ("org_id","project_id");--> statement-breakpoint
CREATE INDEX "products_org_project_idx" ON "products" USING btree ("org_id","project_id");