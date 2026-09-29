CREATE TYPE "public"."report_type" AS ENUM('information_request', 'requalification', 'assurance', 'value_change_notice');--> statement-breakpoint
CREATE TABLE "report_issue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"type" "report_type" NOT NULL,
	"information_request_id" uuid,
	"value_case_version_id" uuid,
	"assurance_review_id" uuid,
	"value_change_id" uuid,
	"subject_status" text NOT NULL,
	"issue_number" integer NOT NULL,
	"title" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"snapshot_sha256" char(64) NOT NULL,
	"renderer_version" text NOT NULL,
	"document_key" text NOT NULL,
	"document_sha256" char(64) NOT NULL,
	"document_bytes" integer NOT NULL,
	"issued_by" uuid NOT NULL,
	"issued_by_name" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_issue_subject_shape" CHECK (("report_issue"."type" = 'information_request') = ("report_issue"."information_request_id" is not null)
        and ("report_issue"."type" = 'requalification') = ("report_issue"."value_case_version_id" is not null)
        and ("report_issue"."type" = 'assurance') = ("report_issue"."assurance_review_id" is not null)
        and ("report_issue"."type" = 'value_change_notice') = ("report_issue"."value_change_id" is not null)),
	CONSTRAINT "report_issue_number_positive" CHECK ("report_issue"."issue_number" >= 1),
	CONSTRAINT "report_issue_hashes" CHECK ("report_issue"."snapshot_sha256" ~ '^[0-9a-f]{64}$' and "report_issue"."document_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "report_issue_document_bytes" CHECK ("report_issue"."document_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "value_change" ADD CONSTRAINT "value_change_id_project_uq" UNIQUE("id","project_id");--> statement-breakpoint
ALTER TABLE "report_issue" ADD CONSTRAINT "report_issue_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_issue" ADD CONSTRAINT "report_issue_issued_by_app_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_issue" ADD CONSTRAINT "report_issue_information_request_fk" FOREIGN KEY ("information_request_id","project_id") REFERENCES "public"."information_request"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_issue" ADD CONSTRAINT "report_issue_version_fk" FOREIGN KEY ("value_case_version_id","project_id") REFERENCES "public"."value_case_version"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_issue" ADD CONSTRAINT "report_issue_review_fk" FOREIGN KEY ("assurance_review_id","project_id") REFERENCES "public"."assurance_review"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_issue" ADD CONSTRAINT "report_issue_value_change_fk" FOREIGN KEY ("value_change_id","project_id") REFERENCES "public"."value_change"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_issue_subject_number_uq" ON "report_issue" USING btree ("type",coalesce("information_request_id", "value_case_version_id", "assurance_review_id", "value_change_id"),"issue_number");--> statement-breakpoint
CREATE INDEX "report_issue_project_idx" ON "report_issue" USING btree ("project_id","issued_at");