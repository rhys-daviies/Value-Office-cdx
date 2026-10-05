CREATE TYPE "public"."value_change_determination_kind" AS ENUM('no_value_change_required', 'value_change_proposed');--> statement-breakpoint
CREATE TABLE "value_change_determination" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"assurance_review_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"determination" "value_change_determination_kind" NOT NULL,
	"rationale" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "value_change_determination_decision_uq" UNIQUE("decision_id"),
	CONSTRAINT "value_change_determination_rationale" CHECK (btrim("value_change_determination"."rationale") <> '')
);
--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_id_review_uq" UNIQUE("id","assurance_review_id");--> statement-breakpoint
ALTER TABLE "value_change_determination" ADD CONSTRAINT "value_change_determination_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_change_determination" ADD CONSTRAINT "value_change_determination_decision_fk" FOREIGN KEY ("decision_id","assurance_review_id") REFERENCES "public"."decision"("id","assurance_review_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "value_change_determination" ADD CONSTRAINT "value_change_determination_review_fk" FOREIGN KEY ("assurance_review_id","project_id") REFERENCES "public"."assurance_review"("id","project_id") ON DELETE no action ON UPDATE no action;
