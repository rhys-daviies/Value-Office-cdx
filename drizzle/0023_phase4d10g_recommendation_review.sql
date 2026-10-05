CREATE TYPE "public"."recommendation_review_event_kind" AS ENUM('submitted', 'returned', 'approved');--> statement-breakpoint
CREATE TYPE "public"."recommendation_review_status" AS ENUM('in_internal_review', 'returned', 'ready_to_issue');--> statement-breakpoint
CREATE TABLE "recommendation_review_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"assurance_review_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "recommendation_review_event_kind" NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_review_event_feedback" CHECK ("recommendation_review_event"."kind" <> 'returned' or btrim(coalesce("recommendation_review_event"."note", '')) <> '')
);
--> statement-breakpoint
ALTER TABLE "recommendation" ADD COLUMN "internal_review_status" "recommendation_review_status";--> statement-breakpoint
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_id_review_uq" UNIQUE("id","assurance_review_id");--> statement-breakpoint
ALTER TABLE "recommendation_review_event" ADD CONSTRAINT "recommendation_review_event_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_review_event" ADD CONSTRAINT "recommendation_review_event_rec_fk" FOREIGN KEY ("recommendation_id","assurance_review_id") REFERENCES "public"."recommendation"("id","assurance_review_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendation_review_event" ADD CONSTRAINT "recommendation_review_event_review_fk" FOREIGN KEY ("assurance_review_id","project_id") REFERENCES "public"."assurance_review"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recommendation_review_event_rec_idx" ON "recommendation_review_event" USING btree ("recommendation_id","created_at");--> statement-breakpoint
ALTER TABLE "recommendation" ADD CONSTRAINT "recommendation_issued_review_shape" CHECK ("recommendation"."issued_at" is null or "recommendation"."internal_review_status" is null or "recommendation"."internal_review_status" = 'ready_to_issue');