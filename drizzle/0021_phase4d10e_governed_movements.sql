CREATE TABLE "value_driver_exclusion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"value_case_version_id" uuid NOT NULL,
	"value_driver_id" uuid NOT NULL,
	"value_case_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"adjustment_rationale" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "value_driver_exclusion_uq" UNIQUE("value_case_version_id","value_driver_id"),
	CONSTRAINT "value_driver_exclusion_rationale" CHECK (btrim("value_driver_exclusion"."adjustment_rationale") <> '')
);
--> statement-breakpoint
ALTER TABLE "value_driver_version" ADD COLUMN "adjustment_rationale" text;--> statement-breakpoint
ALTER TABLE "value_position" ADD COLUMN "value_leakage_id" uuid;--> statement-breakpoint
ALTER TABLE "value_driver_exclusion" ADD CONSTRAINT "value_driver_exclusion_version_fk" FOREIGN KEY ("value_case_version_id","value_case_id","project_id") REFERENCES "public"."value_case_version"("id","value_case_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_driver_exclusion" ADD CONSTRAINT "value_driver_exclusion_driver_fk" FOREIGN KEY ("value_driver_id","value_case_id") REFERENCES "public"."value_driver"("id","value_case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_position" ADD CONSTRAINT "value_position_matter_fk" FOREIGN KEY ("value_leakage_id","project_id") REFERENCES "public"."value_leakage"("id","project_id") ON DELETE no action ON UPDATE no action;