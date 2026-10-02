CREATE TYPE "public"."value_basis_kind" AS ENUM('cumulative_benefit', 'annual_run_rate', 'net_present_value', 'other');--> statement-breakpoint
CREATE TABLE "value_trajectory_point" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"value_case_version_id" uuid,
	"assurance_review_id" uuid,
	"scenario_id" uuid,
	"as_of" date NOT NULL,
	"value" numeric(18, 2) NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "value_trajectory_point_one_parent" CHECK (num_nonnulls("value_trajectory_point"."value_case_version_id", "value_trajectory_point"."assurance_review_id", "value_trajectory_point"."scenario_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "value_case_version" ADD COLUMN "value_basis_kind" "value_basis_kind";--> statement-breakpoint
ALTER TABLE "value_case_version" ADD COLUMN "value_period_start" date;--> statement-breakpoint
ALTER TABLE "value_case_version" ADD COLUMN "value_period_end" date;--> statement-breakpoint
ALTER TABLE "scenario" ADD CONSTRAINT "scenario_id_project_uq" UNIQUE("id","project_id");--> statement-breakpoint
ALTER TABLE "value_trajectory_point" ADD CONSTRAINT "value_trajectory_point_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_trajectory_point" ADD CONSTRAINT "value_trajectory_point_version_fk" FOREIGN KEY ("value_case_version_id","project_id") REFERENCES "public"."value_case_version"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_trajectory_point" ADD CONSTRAINT "value_trajectory_point_review_fk" FOREIGN KEY ("assurance_review_id","project_id") REFERENCES "public"."assurance_review"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_trajectory_point" ADD CONSTRAINT "value_trajectory_point_scenario_fk" FOREIGN KEY ("scenario_id","project_id") REFERENCES "public"."scenario"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "value_trajectory_point_version_date_uq" ON "value_trajectory_point" USING btree ("value_case_version_id","as_of") WHERE "value_trajectory_point"."value_case_version_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "value_trajectory_point_review_date_uq" ON "value_trajectory_point" USING btree ("assurance_review_id","as_of") WHERE "value_trajectory_point"."assurance_review_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "value_trajectory_point_scenario_date_uq" ON "value_trajectory_point" USING btree ("scenario_id","as_of") WHERE "value_trajectory_point"."scenario_id" is not null;--> statement-breakpoint
ALTER TABLE "value_case_version" ADD CONSTRAINT "value_case_version_period_order" CHECK ("value_case_version"."value_period_start" is null or "value_case_version"."value_period_end" is null or "value_case_version"."value_period_start" <= "value_case_version"."value_period_end");--> statement-breakpoint
ALTER TABLE "value_case_version" ADD CONSTRAINT "value_case_version_v0_no_trajectory" CHECK ("value_case_version"."kind" = 'value_case' or ("value_case_version"."value_basis_kind" is null and "value_case_version"."value_period_start" is null and "value_case_version"."value_period_end" is null));