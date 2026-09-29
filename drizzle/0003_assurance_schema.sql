CREATE TYPE "public"."assurance_review_status" AS ENUM('draft', 'finalised');--> statement-breakpoint
CREATE TYPE "public"."assurance_trigger" AS ENUM('kickoff', 'go_live', 'six_month', 'material_evidence_change', 'ad_hoc');--> statement-breakpoint
CREATE TABLE "assurance_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"value_case_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"trigger" "assurance_trigger" NOT NULL,
	"trigger_evidence_id" uuid,
	"against_version_id" uuid NOT NULL,
	"previous_review_id" uuid,
	"review_date" date NOT NULL,
	"status" "assurance_review_status" DEFAULT 'draft' NOT NULL,
	"what_changed" text,
	"why_it_matters" text,
	"summary" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalised_by" uuid,
	"finalised_at" timestamp with time zone,
	CONSTRAINT "assurance_review_sequence_uq" UNIQUE("project_id","sequence"),
	CONSTRAINT "assurance_review_id_project_uq" UNIQUE("id","project_id"),
	CONSTRAINT "assurance_review_id_case_uq" UNIQUE("id","value_case_id"),
	CONSTRAINT "assurance_review_sequence_positive" CHECK ("assurance_review"."sequence" >= 1),
	CONSTRAINT "assurance_review_not_self_previous" CHECK ("assurance_review"."previous_review_id" is distinct from "assurance_review"."id"),
	CONSTRAINT "assurance_review_finalised_shape" CHECK (("assurance_review"."status" = 'finalised') = ("assurance_review"."finalised_by" is not null and "assurance_review"."finalised_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "value_position" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assurance_review_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"value_case_id" uuid NOT NULL,
	"value_driver_id" uuid NOT NULL,
	"current_forecast" numeric(18, 2),
	"realised_value" numeric(18, 2),
	"forecast_rationale" text,
	"realised_value_rationale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "value_position_driver_uq" UNIQUE("assurance_review_id","value_driver_id")
);
--> statement-breakpoint
ALTER TABLE "evidence_link" DROP CONSTRAINT "evidence_link_exactly_one_target";--> statement-breakpoint
ALTER TABLE "evidence_link" ADD COLUMN "assurance_review_id" uuid;--> statement-breakpoint
ALTER TABLE "assurance_review" ADD CONSTRAINT "assurance_review_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_review" ADD CONSTRAINT "assurance_review_finalised_by_app_user_id_fk" FOREIGN KEY ("finalised_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_review" ADD CONSTRAINT "assurance_review_case_fk" FOREIGN KEY ("value_case_id","project_id") REFERENCES "public"."value_case"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_review" ADD CONSTRAINT "assurance_review_version_fk" FOREIGN KEY ("against_version_id","value_case_id","project_id") REFERENCES "public"."value_case_version"("id","value_case_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_review" ADD CONSTRAINT "assurance_review_previous_fk" FOREIGN KEY ("previous_review_id","project_id") REFERENCES "public"."assurance_review"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assurance_review" ADD CONSTRAINT "assurance_review_trigger_evidence_fk" FOREIGN KEY ("trigger_evidence_id","project_id") REFERENCES "public"."evidence"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_position" ADD CONSTRAINT "value_position_review_fk" FOREIGN KEY ("assurance_review_id","project_id") REFERENCES "public"."assurance_review"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_position" ADD CONSTRAINT "value_position_review_case_fk" FOREIGN KEY ("assurance_review_id","value_case_id") REFERENCES "public"."assurance_review"("id","value_case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_position" ADD CONSTRAINT "value_position_driver_fk" FOREIGN KEY ("value_driver_id","value_case_id") REFERENCES "public"."value_driver"("id","value_case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assurance_review_one_draft_uq" ON "assurance_review" USING btree ("project_id") WHERE "assurance_review"."status" = 'draft';--> statement-breakpoint
ALTER TABLE "evidence_link" ADD CONSTRAINT "evidence_link_review_fk" FOREIGN KEY ("assurance_review_id","project_id") REFERENCES "public"."assurance_review"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_link_review_uq" ON "evidence_link" USING btree ("evidence_id","assurance_review_id") WHERE "evidence_link"."assurance_review_id" is not null;--> statement-breakpoint
ALTER TABLE "evidence_link" ADD CONSTRAINT "evidence_link_exactly_one_target" CHECK (num_nonnulls("evidence_link"."value_driver_version_id", "evidence_link"."assumption_id", "evidence_link"."assurance_review_id") = 1);