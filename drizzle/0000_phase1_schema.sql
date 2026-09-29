CREATE TYPE "public"."evidence_status" AS ENUM('unevidenced', 'partially_evidenced', 'evidenced');--> statement-breakpoint
CREATE TYPE "public"."information_request_item_status" AS ENUM('open', 'partially_received', 'received', 'not_available');--> statement-breakpoint
CREATE TYPE "public"."information_request_status" AS ENUM('draft', 'issued', 'closed');--> statement-breakpoint
CREATE TYPE "public"."key_date_kind" AS ENUM('kickoff', 'go_live', 'six_month_review', 'other');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."qualification_status" AS ENUM('unqualified', 'partially_qualified', 'qualified');--> statement-breakpoint
CREATE TYPE "public"."version_kind" AS ENUM('inherited_business_case', 'value_case');--> statement-breakpoint
CREATE TYPE "public"."version_status" AS ENUM('draft', 'recorded', 'proposed', 'authorised', 'superseded');--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assumption" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"value_driver_version_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"statement" text NOT NULL,
	"evidence_status" "evidence_status" DEFAULT 'unevidenced' NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assumption_id_project_uq" UNIQUE("id","project_id")
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"transaction_id" bigint NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"command" text NOT NULL,
	"table_name" text NOT NULL,
	"row_id" uuid NOT NULL,
	"action" text NOT NULL,
	"old_row" jsonb,
	"new_row" jsonb,
	CONSTRAINT "audit_event_action" CHECK ("audit_event"."action" in ('INSERT', 'UPDATE', 'DELETE'))
);
--> statement-breakpoint
CREATE TABLE "client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source_description" text NOT NULL,
	"source_person_id" uuid,
	"uri" text,
	"storage_key" text,
	"original_filename" text,
	"mime_type" text,
	"size_bytes" bigint,
	"sha256" char(64),
	"received_on" date,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_id_project_uq" UNIQUE("id","project_id"),
	CONSTRAINT "document_sha256_hex" CHECK ("document"."sha256" is null or "document"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "document_size_non_negative" CHECK ("document"."size_bytes" is null or "document"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"document_id" uuid,
	"source_person_id" uuid,
	"evidence_date" date,
	"received_on" date,
	"supersedes_evidence_id" uuid,
	"is_material_change" boolean DEFAULT false NOT NULL,
	"material_change_note" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_code_uq" UNIQUE("project_id","code"),
	CONSTRAINT "evidence_id_project_uq" UNIQUE("id","project_id"),
	CONSTRAINT "evidence_not_self_superseding" CHECK ("evidence"."supersedes_evidence_id" is distinct from "evidence"."id")
);
--> statement-breakpoint
CREATE TABLE "evidence_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"value_driver_version_id" uuid,
	"assumption_id" uuid,
	"relevance_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_link_exactly_one_target" CHECK (num_nonnulls("evidence_link"."value_driver_version_id", "evidence_link"."assumption_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "information_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"title" text NOT NULL,
	"status" "information_request_status" DEFAULT 'draft' NOT NULL,
	"issued_on" date,
	"closed_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "information_request_reference_uq" UNIQUE("project_id","reference"),
	CONSTRAINT "information_request_id_project_uq" UNIQUE("id","project_id"),
	CONSTRAINT "information_request_issued_shape" CHECK ("information_request"."status" = 'draft' or "information_request"."issued_on" is not null),
	CONSTRAINT "information_request_closed_shape" CHECK ("information_request"."status" <> 'closed' or "information_request"."closed_on" is not null)
);
--> statement-breakpoint
CREATE TABLE "information_request_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"information_request_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"description" text NOT NULL,
	"requested_from_person_id" uuid,
	"due_on" date,
	"value_driver_id" uuid,
	"status" "information_request_item_status" DEFAULT 'open' NOT NULL,
	"fulfilled_by_evidence_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "information_request_item_sequence_uq" UNIQUE("information_request_id","sequence")
);
--> statement-breakpoint
CREATE TABLE "key_date" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "key_date_kind" NOT NULL,
	"label" text NOT NULL,
	"date" date NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"organisation" text,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_id_client_uq" UNIQUE("id","client_id")
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"context" text,
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"currency" char(3) NOT NULL,
	"value_basis_description" text,
	"value_period_start" date,
	"value_period_end" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_code_uq" UNIQUE("code"),
	CONSTRAINT "project_id_client_uq" UNIQUE("id","client_id"),
	CONSTRAINT "project_currency_iso" CHECK ("project"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "project_value_period_order" CHECK ("project"."value_period_start" is null or "project"."value_period_end" is null or "project"."value_period_start" <= "project"."value_period_end")
);
--> statement-breakpoint
CREATE TABLE "project_stakeholder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"role_description" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_stakeholder_uq" UNIQUE("project_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "value_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"vco_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "value_case_project_uq" UNIQUE("project_id"),
	CONSTRAINT "value_case_id_project_uq" UNIQUE("id","project_id")
);
--> statement-breakpoint
CREATE TABLE "value_case_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"value_case_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"kind" "version_kind" NOT NULL,
	"status" "version_status" DEFAULT 'draft' NOT NULL,
	"based_on_version_id" uuid,
	"title" text NOT NULL,
	"summary" text,
	"stated_total_value" numeric(18, 2),
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_at" timestamp with time zone,
	"proposed_at" timestamp with time zone,
	"proposed_by" uuid,
	"authorised_on" date,
	"authorised_by_person_id" uuid,
	"authorisation_evidence_id" uuid,
	"authorisation_note" text,
	"authorisation_recorded_by" uuid,
	"authorisation_recorded_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "value_case_version_number_uq" UNIQUE("value_case_id","version_number"),
	CONSTRAINT "value_case_version_scope_uq" UNIQUE("id","value_case_id","project_id"),
	CONSTRAINT "value_case_version_id_project_uq" UNIQUE("id","project_id"),
	CONSTRAINT "value_case_version_id_case_uq" UNIQUE("id","value_case_id"),
	CONSTRAINT "value_case_version_kind_shape" CHECK (("value_case_version"."kind" = 'inherited_business_case' and "value_case_version"."version_number" = 0 and "value_case_version"."status" in ('draft', 'recorded'))
       or ("value_case_version"."kind" = 'value_case' and "value_case_version"."version_number" >= 1 and "value_case_version"."status" <> 'recorded' and "value_case_version"."stated_total_value" is null)),
	CONSTRAINT "value_case_version_recorded_shape" CHECK ("value_case_version"."status" <> 'recorded' or "value_case_version"."recorded_at" is not null),
	CONSTRAINT "value_case_version_proposed_shape" CHECK ("value_case_version"."status" not in ('proposed', 'authorised', 'superseded') or ("value_case_version"."proposed_at" is not null and "value_case_version"."proposed_by" is not null)),
	CONSTRAINT "value_case_version_authorised_shape" CHECK ("value_case_version"."status" not in ('authorised', 'superseded') or (
            "value_case_version"."authorised_on" is not null and "value_case_version"."authorised_by_person_id" is not null
        and "value_case_version"."authorisation_evidence_id" is not null and "value_case_version"."authorisation_recorded_by" is not null
        and "value_case_version"."authorisation_recorded_at" is not null)),
	CONSTRAINT "value_case_version_superseded_shape" CHECK (("value_case_version"."status" = 'superseded') = ("value_case_version"."superseded_at" is not null)),
	CONSTRAINT "value_case_version_not_self_based" CHECK ("value_case_version"."based_on_version_id" is distinct from "value_case_version"."id")
);
--> statement-breakpoint
CREATE TABLE "value_driver" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"value_case_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "value_driver_code_uq" UNIQUE("value_case_id","code"),
	CONSTRAINT "value_driver_scope_uq" UNIQUE("id","value_case_id"),
	CONSTRAINT "value_driver_id_project_uq" UNIQUE("id","project_id"),
	CONSTRAINT "value_driver_code_not_blank" CHECK (length(trim("value_driver"."code")) > 0)
);
--> statement-breakpoint
CREATE TABLE "value_driver_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"value_case_version_id" uuid NOT NULL,
	"value_driver_id" uuid NOT NULL,
	"value_case_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"metric" text,
	"metric_unit" text,
	"baseline_value" numeric(20, 6),
	"target_value" numeric(20, 6),
	"calculation_rationale" text,
	"financial_value" numeric(18, 2),
	"timing_description" text,
	"benefit_start_date" date,
	"benefit_full_date" date,
	"avo_person_id" uuid,
	"qualification_status" "qualification_status" DEFAULT 'unqualified' NOT NULL,
	"evidence_status" "evidence_status" DEFAULT 'unevidenced' NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "value_driver_version_uq" UNIQUE("value_case_version_id","value_driver_id"),
	CONSTRAINT "value_driver_version_id_project_uq" UNIQUE("id","project_id"),
	CONSTRAINT "value_driver_version_benefit_dates_order" CHECK ("value_driver_version"."benefit_start_date" is null or "value_driver_version"."benefit_full_date" is null or "value_driver_version"."benefit_start_date" <= "value_driver_version"."benefit_full_date")
);
--> statement-breakpoint
ALTER TABLE "assumption" ADD CONSTRAINT "assumption_driver_version_fk" FOREIGN KEY ("value_driver_version_id","project_id") REFERENCES "public"."value_driver_version"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_user_id_app_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_recorded_by_app_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_source_person_fk" FOREIGN KEY ("project_id","source_person_id") REFERENCES "public"."project_stakeholder"("project_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_recorded_by_app_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_document_fk" FOREIGN KEY ("document_id","project_id") REFERENCES "public"."document"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_source_person_fk" FOREIGN KEY ("project_id","source_person_id") REFERENCES "public"."project_stakeholder"("project_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_supersedes_fk" FOREIGN KEY ("supersedes_evidence_id","project_id") REFERENCES "public"."evidence"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_link" ADD CONSTRAINT "evidence_link_evidence_fk" FOREIGN KEY ("evidence_id","project_id") REFERENCES "public"."evidence"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_link" ADD CONSTRAINT "evidence_link_driver_version_fk" FOREIGN KEY ("value_driver_version_id","project_id") REFERENCES "public"."value_driver_version"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_link" ADD CONSTRAINT "evidence_link_assumption_fk" FOREIGN KEY ("assumption_id","project_id") REFERENCES "public"."assumption"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_request" ADD CONSTRAINT "information_request_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_request_item" ADD CONSTRAINT "information_request_item_request_fk" FOREIGN KEY ("information_request_id","project_id") REFERENCES "public"."information_request"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_request_item" ADD CONSTRAINT "information_request_item_requested_from_fk" FOREIGN KEY ("project_id","requested_from_person_id") REFERENCES "public"."project_stakeholder"("project_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_request_item" ADD CONSTRAINT "information_request_item_driver_fk" FOREIGN KEY ("value_driver_id","project_id") REFERENCES "public"."value_driver"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_request_item" ADD CONSTRAINT "information_request_item_evidence_fk" FOREIGN KEY ("fulfilled_by_evidence_id","project_id") REFERENCES "public"."evidence"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_date" ADD CONSTRAINT "key_date_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stakeholder" ADD CONSTRAINT "project_stakeholder_project_fk" FOREIGN KEY ("project_id","client_id") REFERENCES "public"."project"("id","client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stakeholder" ADD CONSTRAINT "project_stakeholder_person_fk" FOREIGN KEY ("person_id","client_id") REFERENCES "public"."person"("id","client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_case" ADD CONSTRAINT "value_case_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_case" ADD CONSTRAINT "value_case_vco_fk" FOREIGN KEY ("project_id","vco_person_id") REFERENCES "public"."project_stakeholder"("project_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_case_version" ADD CONSTRAINT "value_case_version_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_case_version" ADD CONSTRAINT "value_case_version_proposed_by_app_user_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_case_version" ADD CONSTRAINT "value_case_version_authorisation_recorded_by_app_user_id_fk" FOREIGN KEY ("authorisation_recorded_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_case_version" ADD CONSTRAINT "value_case_version_case_fk" FOREIGN KEY ("value_case_id","project_id") REFERENCES "public"."value_case"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_case_version" ADD CONSTRAINT "value_case_version_based_on_fk" FOREIGN KEY ("based_on_version_id","value_case_id") REFERENCES "public"."value_case_version"("id","value_case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_case_version" ADD CONSTRAINT "value_case_version_authorised_by_fk" FOREIGN KEY ("project_id","authorised_by_person_id") REFERENCES "public"."project_stakeholder"("project_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_case_version" ADD CONSTRAINT "value_case_version_authorisation_evidence_fk" FOREIGN KEY ("authorisation_evidence_id","project_id") REFERENCES "public"."evidence"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_driver" ADD CONSTRAINT "value_driver_case_fk" FOREIGN KEY ("value_case_id","project_id") REFERENCES "public"."value_case"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_driver_version" ADD CONSTRAINT "value_driver_version_version_fk" FOREIGN KEY ("value_case_version_id","value_case_id","project_id") REFERENCES "public"."value_case_version"("id","value_case_id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_driver_version" ADD CONSTRAINT "value_driver_version_driver_fk" FOREIGN KEY ("value_driver_id","value_case_id") REFERENCES "public"."value_driver"("id","value_case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_driver_version" ADD CONSTRAINT "value_driver_version_avo_fk" FOREIGN KEY ("project_id","avo_person_id") REFERENCES "public"."project_stakeholder"("project_id","person_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_email_lower_uq" ON "app_user" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "audit_event_row_idx" ON "audit_event" USING btree ("table_name","row_id");--> statement-breakpoint
CREATE INDEX "audit_event_tx_idx" ON "audit_event" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_link_driver_version_uq" ON "evidence_link" USING btree ("evidence_id","value_driver_version_id") WHERE "evidence_link"."value_driver_version_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_link_assumption_uq" ON "evidence_link" USING btree ("evidence_id","assumption_id") WHERE "evidence_link"."assumption_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "key_date_single_kickoff_golive_uq" ON "key_date" USING btree ("project_id","kind") WHERE "key_date"."kind" in ('kickoff', 'go_live');--> statement-breakpoint
CREATE UNIQUE INDEX "value_case_one_authorised_uq" ON "value_case_version" USING btree ("value_case_id") WHERE "value_case_version"."status" = 'authorised';--> statement-breakpoint
CREATE UNIQUE INDEX "value_case_one_open_version_uq" ON "value_case_version" USING btree ("value_case_id") WHERE "value_case_version"."kind" = 'value_case' and "value_case_version"."status" in ('draft', 'proposed');