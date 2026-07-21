CREATE TABLE "mfa_login_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts_remaining" integer DEFAULT 5 NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mfa_login_challenges_attempts_ck" CHECK ("mfa_login_challenges"."attempts_remaining" >= 0 and "mfa_login_challenges"."attempts_remaining" <= 5)
);
--> statement-breakpoint
CREATE TABLE "user_mfa_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"secret_iv" text NOT NULL,
	"secret_auth_tag" text NOT NULL,
	"encryption_key_id" text NOT NULL,
	"enabled_at" timestamp with time zone,
	"setup_expires_at" timestamp with time zone,
	"last_used_counter" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_mfa_credentials_state_ck" CHECK (("user_mfa_credentials"."enabled_at" is null and "user_mfa_credentials"."setup_expires_at" is not null) or ("user_mfa_credentials"."enabled_at" is not null and "user_mfa_credentials"."setup_expires_at" is null))
);
--> statement-breakpoint
CREATE TABLE "user_mfa_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mfa_login_challenges" ADD CONSTRAINT "mfa_login_challenges_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_login_challenges" ADD CONSTRAINT "mfa_login_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_mfa_credentials" ADD CONSTRAINT "user_mfa_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_mfa_recovery_codes" ADD CONSTRAINT "user_mfa_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_login_challenges_token_hash_uq" ON "mfa_login_challenges" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "mfa_login_challenges_user_org_idx" ON "mfa_login_challenges" USING btree ("user_id","org_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_mfa_recovery_codes_hash_uq" ON "user_mfa_recovery_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "user_mfa_recovery_codes_user_idx" ON "user_mfa_recovery_codes" USING btree ("user_id","used_at");