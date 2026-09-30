CREATE TABLE "value_driver_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"value_driver_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"metric" text,
	"metric_unit" text,
	"baseline_value" numeric(20, 6),
	"target_value" numeric(20, 6),
	"calculation_rationale" text,
	"working_estimate" numeric(18, 2),
	"estimate_recorded_by" uuid,
	"estimate_recorded_at" timestamp with time zone,
	"avo_person_id" uuid,
	"qualification_status" "qualification_status" DEFAULT 'unqualified' NOT NULL,
	"evidence_status" "evidence_status" DEFAULT 'unevidenced' NOT NULL,
	"notes" text,
	"identified_on" date,
	"origin_value_leakage_id" uuid,
	"initialised_from_version_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "value_driver_record_driver_uq" UNIQUE("value_driver_id"),
	CONSTRAINT "value_driver_record_id_project_uq" UNIQUE("id","project_id"),
	CONSTRAINT "value_driver_record_name_not_blank" CHECK (length(trim("value_driver_record"."name")) > 0),
	CONSTRAINT "value_driver_record_estimate_non_negative" CHECK ("value_driver_record"."working_estimate" is null or "value_driver_record"."working_estimate" >= 0),
	CONSTRAINT "value_driver_record_estimate_attribution" CHECK (("value_driver_record"."working_estimate" is null) = ("value_driver_record"."estimate_recorded_by" is null and "value_driver_record"."estimate_recorded_at" is null)),
	CONSTRAINT "value_driver_record_origin_shape" CHECK (("value_driver_record"."identified_on" is not null) <> ("value_driver_record"."initialised_from_version_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "value_driver_record_assumption" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"value_driver_record_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"statement" text NOT NULL,
	"evidence_status" "evidence_status" DEFAULT 'unevidenced' NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "value_driver_record_assumption_not_blank" CHECK (length(trim("value_driver_record_assumption"."statement")) > 0)
);
--> statement-breakpoint
ALTER TABLE "value_driver_record" ADD CONSTRAINT "value_driver_record_estimate_recorded_by_app_user_id_fk" FOREIGN KEY ("estimate_recorded_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_driver_record" ADD CONSTRAINT "value_driver_record_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_driver_record" ADD CONSTRAINT "value_driver_record_driver_fk" FOREIGN KEY ("value_driver_id","project_id") REFERENCES "public"."value_driver"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_driver_record" ADD CONSTRAINT "value_driver_record_avo_fk" FOREIGN KEY ("project_id","avo_person_id") REFERENCES "public"."project_stakeholder"("project_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_driver_record" ADD CONSTRAINT "value_driver_record_origin_fk" FOREIGN KEY ("origin_value_leakage_id","project_id") REFERENCES "public"."value_leakage"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_driver_record" ADD CONSTRAINT "value_driver_record_initialised_from_fk" FOREIGN KEY ("initialised_from_version_id","project_id") REFERENCES "public"."value_case_version"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_driver_record_assumption" ADD CONSTRAINT "value_driver_record_assumption_record_fk" FOREIGN KEY ("value_driver_record_id","project_id") REFERENCES "public"."value_driver_record"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "value_driver_record_assumption_record_idx" ON "value_driver_record_assumption" USING btree ("value_driver_record_id");