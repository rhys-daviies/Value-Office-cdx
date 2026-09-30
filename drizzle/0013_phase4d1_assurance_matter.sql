CREATE TYPE "public"."assurance_stage" AS ENUM('identified', 'awaiting_evidence', 'assessing', 'remediation', 'monitoring', 'escalated');--> statement-breakpoint
ALTER TABLE "leakage_assessment" ALTER COLUMN "total_amount" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "leakage_assessment" ALTER COLUMN "unrecoverable_amount" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "value_leakage" ALTER COLUMN "identified_in_review_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assurance_review" ADD COLUMN "matter_snapshot_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leakage_assessment" ADD COLUMN "snapshot_taken_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leakage_assessment" ADD COLUMN "snapshot_status" "leakage_status";--> statement-breakpoint
ALTER TABLE "leakage_assessment" ADD COLUMN "snapshot_stage" "assurance_stage";--> statement-breakpoint
ALTER TABLE "leakage_assessment" ADD COLUMN "snapshot_title" text;--> statement-breakpoint
ALTER TABLE "leakage_assessment" ADD COLUMN "snapshot_description" text;--> statement-breakpoint
ALTER TABLE "leakage_assessment" ADD COLUMN "snapshot_owner_person_id" uuid;--> statement-breakpoint
ALTER TABLE "leakage_assessment" ADD COLUMN "snapshot_driver_ids" uuid[];--> statement-breakpoint
ALTER TABLE "leakage_assessment" ADD COLUMN "snapshot_consultant_assessment" text;--> statement-breakpoint
ALTER TABLE "leakage_assessment" ADD COLUMN "snapshot_required_decision_date" date;--> statement-breakpoint
ALTER TABLE "leakage_assessment" ADD COLUMN "snapshot_remediation_plan" text;--> statement-breakpoint
ALTER TABLE "leakage_assessment" ADD COLUMN "snapshot_monitor_until" date;--> statement-breakpoint
ALTER TABLE "value_leakage" ADD COLUMN "identified_on" date;--> statement-breakpoint
ALTER TABLE "value_leakage" ADD COLUMN "stage" "assurance_stage";--> statement-breakpoint
ALTER TABLE "value_leakage" ADD COLUMN "working_total_amount" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "value_leakage" ADD COLUMN "working_unrecoverable_amount" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "value_leakage" ADD COLUMN "working_unrecoverable_rationale" text;--> statement-breakpoint
ALTER TABLE "value_leakage" ADD COLUMN "working_assessed_by" uuid;--> statement-breakpoint
ALTER TABLE "value_leakage" ADD COLUMN "working_assessed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "value_leakage" ADD COLUMN "remediation_plan" text;--> statement-breakpoint
ALTER TABLE "value_leakage" ADD COLUMN "monitor_until" date;--> statement-breakpoint
ALTER TABLE "value_leakage" ADD COLUMN "closure_note" text;--> statement-breakpoint
ALTER TABLE "leakage_assessment" ADD CONSTRAINT "leakage_assessment_snapshot_owner_fk" FOREIGN KEY ("project_id","snapshot_owner_person_id") REFERENCES "public"."project_stakeholder"("project_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_leakage" ADD CONSTRAINT "value_leakage_working_assessed_by_app_user_id_fk" FOREIGN KEY ("working_assessed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leakage_assessment" ADD CONSTRAINT "leakage_assessment_quantified_pair" CHECK (("leakage_assessment"."total_amount" is null) = ("leakage_assessment"."unrecoverable_amount" is null));--> statement-breakpoint
ALTER TABLE "leakage_assessment" ADD CONSTRAINT "leakage_assessment_snapshot_shape" CHECK ("leakage_assessment"."snapshot_taken_at" is null or ("leakage_assessment"."snapshot_status" is not null and "leakage_assessment"."snapshot_title" is not null and "leakage_assessment"."snapshot_driver_ids" is not null));--> statement-breakpoint
ALTER TABLE "value_leakage" ADD CONSTRAINT "value_leakage_origin" CHECK ("value_leakage"."identified_in_review_id" is not null or "value_leakage"."identified_on" is not null);--> statement-breakpoint
ALTER TABLE "value_leakage" ADD CONSTRAINT "value_leakage_working_pair" CHECK (("value_leakage"."working_total_amount" is null) = ("value_leakage"."working_unrecoverable_amount" is null));--> statement-breakpoint
ALTER TABLE "value_leakage" ADD CONSTRAINT "value_leakage_working_range" CHECK ("value_leakage"."working_total_amount" is null or ("value_leakage"."working_total_amount" >= 0 and "value_leakage"."working_unrecoverable_amount" >= 0 and "value_leakage"."working_unrecoverable_amount" <= "value_leakage"."working_total_amount"));--> statement-breakpoint
ALTER TABLE "value_leakage" ADD CONSTRAINT "value_leakage_working_rationale" CHECK ("value_leakage"."working_unrecoverable_amount" is null or "value_leakage"."working_unrecoverable_amount" = 0 or "value_leakage"."working_unrecoverable_rationale" is not null);--> statement-breakpoint
ALTER TABLE "value_leakage" ADD CONSTRAINT "value_leakage_working_attribution" CHECK ("value_leakage"."working_total_amount" is null or ("value_leakage"."working_assessed_by" is not null and "value_leakage"."working_assessed_at" is not null));