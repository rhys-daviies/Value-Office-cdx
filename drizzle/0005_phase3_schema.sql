CREATE TYPE "public"."leakage_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."scenario_kind" AS ENUM('current', 'recommended', 'alternative', 'no_action');--> statement-breakpoint
CREATE TYPE "public"."value_change_status" AS ENUM('draft', 'proposed', 'authorised', 'rejected', 'withdrawn');--> statement-breakpoint
ALTER TYPE "public"."version_status" ADD VALUE 'rejected';--> statement-breakpoint
ALTER TYPE "public"."version_status" ADD VALUE 'withdrawn';--> statement-breakpoint
CREATE TABLE "decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assurance_review_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"selected_scenario_id" uuid NOT NULL,
	"decided_by_person_id" uuid NOT NULL,
	"decided_on" date NOT NULL,
	"rationale" text,
	"economic_consequence" text,
	"supporting_evidence_id" uuid,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_review_uq" UNIQUE("assurance_review_id"),
	CONSTRAINT "decision_id_project_uq" UNIQUE("id","project_id")
);
--> statement-breakpoint
CREATE TABLE "leakage_assessment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"value_leakage_id" uuid NOT NULL,
	"assurance_review_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"unrecoverable_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"unrecoverable_rationale" text,
	"unrecoverable_validated_by" uuid,
	"assessment_note" text,
	"assessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leakage_assessment_review_uq" UNIQUE("value_leakage_id","assurance_review_id"),
	CONSTRAINT "leakage_assessment_total_non_negative" CHECK ("leakage_assessment"."total_amount" >= 0),
	CONSTRAINT "leakage_assessment_unrecoverable_range" CHECK ("leakage_assessment"."unrecoverable_amount" >= 0 and "leakage_assessment"."unrecoverable_amount" <= "leakage_assessment"."total_amount"),
	CONSTRAINT "leakage_assessment_unrecoverable_validated" CHECK ("leakage_assessment"."unrecoverable_amount" = 0 or ("leakage_assessment"."unrecoverable_rationale" is not null and "leakage_assessment"."unrecoverable_validated_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "recommendation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assurance_review_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"narrative" text NOT NULL,
	"issued_by" uuid,
	"issued_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_review_uq" UNIQUE("assurance_review_id"),
	CONSTRAINT "recommendation_issued_shape" CHECK (("recommendation"."issued_at" is null) = ("recommendation"."issued_by" is null))
);
--> statement-breakpoint
CREATE TABLE "scenario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assurance_review_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"label" text NOT NULL,
	"kind" "scenario_kind" NOT NULL,
	"total_value" numeric(18, 2) NOT NULL,
	"narrative" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scenario_id_review_uq" UNIQUE("id","assurance_review_id")
);
--> statement-breakpoint
CREATE TABLE "value_change" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"value_case_id" uuid NOT NULL,
	"code" text NOT NULL,
	"from_version_id" uuid NOT NULL,
	"to_version_id" uuid NOT NULL,
	"assurance_review_id" uuid,
	"decision_id" uuid,
	"reason" text,
	"economic_impact_narrative" text,
	"stated_change_amount" numeric(18, 2),
	"status" "value_change_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"proposed_at" timestamp with time zone,
	"proposed_by" uuid,
	"authorised_on" date,
	"authorised_by_person_id" uuid,
	"authorisation_evidence_id" uuid,
	"authorisation_note" text,
	"authorisation_recorded_by" uuid,
	"authorisation_recorded_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"closure_note" text,
	CONSTRAINT "value_change_code_uq" UNIQUE("value_case_id","code"),
	CONSTRAINT "value_change_to_version_uq" UNIQUE("to_version_id"),
	CONSTRAINT "value_change_versions_differ" CHECK ("value_change"."from_version_id" <> "value_change"."to_version_id"),
	CONSTRAINT "value_change_code_not_blank" CHECK (length(trim("value_change"."code")) > 0),
	CONSTRAINT "value_change_proposed_shape" CHECK ("value_change"."status" in ('draft', 'withdrawn') or ("value_change"."proposed_at" is not null and "value_change"."proposed_by" is not null and "value_change"."reason" is not null)),
	CONSTRAINT "value_change_authorised_shape" CHECK ("value_change"."status" <> 'authorised' or (
            "value_change"."authorised_on" is not null and "value_change"."authorised_by_person_id" is not null
        and "value_change"."authorisation_evidence_id" is not null and "value_change"."authorisation_recorded_by" is not null
        and "value_change"."authorisation_recorded_at" is not null)),
	CONSTRAINT "value_change_closed_shape" CHECK (("value_change"."status" in ('rejected', 'withdrawn')) = ("value_change"."closed_at" is not null and "value_change"."closed_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "value_leakage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"value_case_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"identified_in_review_id" uuid NOT NULL,
	"response_owner_person_id" uuid,
	"status" "leakage_status" DEFAULT 'open' NOT NULL,
	"required_decision_date" date,
	"consultant_assessment" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "value_leakage_code_uq" UNIQUE("project_id","code"),
	CONSTRAINT "value_leakage_id_project_uq" UNIQUE("id","project_id"),
	CONSTRAINT "value_leakage_id_case_uq" UNIQUE("id","value_case_id")
);
--> statement-breakpoint
CREATE TABLE "value_leakage_driver" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"value_leakage_id" uuid NOT NULL,
	"value_case_id" uuid NOT NULL,
	"value_driver_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "value_leakage_driver_uq" UNIQUE("value_leakage_id","value_driver_id")
);
--> statement-breakpoint
ALTER TABLE "assurance_review" ADD COLUMN "unattributed_realised_value" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "assurance_review" ADD COLUMN "unattributed_realised_rationale" text;--> statement-breakpoint
ALTER TABLE "value_position" ADD COLUMN "forecast_not_assessed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_recorded_by_app_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_review_fk" FOREIGN KEY ("assurance_review_id","project_id") REFERENCES "public"."assurance_review"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_scenario_fk" FOREIGN KEY ("selected_scenario_id","assurance_review_id") REFERENCES "public"."scenario"("id","assurance_review_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_decided_by_fk" FOREIGN KEY ("project_id","decided_by_person_id") REFERENCES "public"."project_stakeholder"("project_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_evidence_fk" FOREIGN KEY ("supporting_evidence_id","project_id") REFERENCES "public"."evidence"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leakage_assessment" ADD CONSTRAINT "leakage_assessment_unrecoverable_validated_by_app_user_id_fk" FOREIGN KEY ("unrecoverable_validated_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leakage_assessment" ADD CONSTRAINT "leakage_assessment_leakage_fk" FOREIGN KEY ("value_leakage_id","project_id") REFERENCES "public"."value_leakage"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leakage_assessment" ADD CONSTRAINT "leakage_assessment_review_fk" FOREIGN KEY ("assurance_review_id","project_id") REFERENCES "public"."assurance_review"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_issued_by_app_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_review_fk" FOREIGN KEY ("assurance_review_id","project_id") REFERENCES "public"."assurance_review"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_scenario_fk" FOREIGN KEY ("scenario_id","assurance_review_id") REFERENCES "public"."scenario"("id","assurance_review_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario" ADD CONSTRAINT "scenario_review_fk" FOREIGN KEY ("assurance_review_id","project_id") REFERENCES "public"."assurance_review"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_change" ADD CONSTRAINT "value_change_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_change" ADD CONSTRAINT "value_change_proposed_by_app_user_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_change" ADD CONSTRAINT "value_change_authorisation_recorded_by_app_user_id_fk" FOREIGN KEY ("authorisation_recorded_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_change" ADD CONSTRAINT "value_change_closed_by_app_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_change" ADD CONSTRAINT "value_change_case_fk" FOREIGN KEY ("value_case_id","project_id") REFERENCES "public"."value_case"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_change" ADD CONSTRAINT "value_change_from_version_fk" FOREIGN KEY ("from_version_id","value_case_id","project_id") REFERENCES "public"."value_case_version"("id","value_case_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_change" ADD CONSTRAINT "value_change_to_version_fk" FOREIGN KEY ("to_version_id","value_case_id","project_id") REFERENCES "public"."value_case_version"("id","value_case_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_change" ADD CONSTRAINT "value_change_review_fk" FOREIGN KEY ("assurance_review_id","project_id") REFERENCES "public"."assurance_review"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_change" ADD CONSTRAINT "value_change_decision_fk" FOREIGN KEY ("decision_id","project_id") REFERENCES "public"."decision"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_change" ADD CONSTRAINT "value_change_authorised_by_fk" FOREIGN KEY ("project_id","authorised_by_person_id") REFERENCES "public"."project_stakeholder"("project_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_change" ADD CONSTRAINT "value_change_authorisation_evidence_fk" FOREIGN KEY ("authorisation_evidence_id","project_id") REFERENCES "public"."evidence"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_leakage" ADD CONSTRAINT "value_leakage_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_leakage" ADD CONSTRAINT "value_leakage_case_fk" FOREIGN KEY ("value_case_id","project_id") REFERENCES "public"."value_case"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_leakage" ADD CONSTRAINT "value_leakage_review_fk" FOREIGN KEY ("identified_in_review_id","project_id") REFERENCES "public"."assurance_review"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_leakage" ADD CONSTRAINT "value_leakage_owner_fk" FOREIGN KEY ("project_id","response_owner_person_id") REFERENCES "public"."project_stakeholder"("project_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_leakage_driver" ADD CONSTRAINT "value_leakage_driver_leakage_fk" FOREIGN KEY ("value_leakage_id","value_case_id") REFERENCES "public"."value_leakage"("id","value_case_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_leakage_driver" ADD CONSTRAINT "value_leakage_driver_driver_fk" FOREIGN KEY ("value_driver_id","value_case_id") REFERENCES "public"."value_driver"("id","value_case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_leakage_driver" ADD CONSTRAINT "value_leakage_driver_project_fk" FOREIGN KEY ("value_leakage_id","project_id") REFERENCES "public"."value_leakage"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_one_current_uq" ON "scenario" USING btree ("assurance_review_id") WHERE "scenario"."kind" = 'current';--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_one_recommended_uq" ON "scenario" USING btree ("assurance_review_id") WHERE "scenario"."kind" = 'recommended';--> statement-breakpoint
CREATE UNIQUE INDEX "value_change_one_open_uq" ON "value_change" USING btree ("value_case_id") WHERE "value_change"."status" in ('draft', 'proposed');--> statement-breakpoint
ALTER TABLE "assurance_review" ADD CONSTRAINT "assurance_review_unattributed_rationale" CHECK ("assurance_review"."unattributed_realised_value" is null or "assurance_review"."unattributed_realised_rationale" is not null);--> statement-breakpoint
ALTER TABLE "value_position" ADD CONSTRAINT "value_position_not_assessed_shape" CHECK (not "value_position"."forecast_not_assessed" or ("value_position"."current_forecast" is null and "value_position"."forecast_rationale" is not null));