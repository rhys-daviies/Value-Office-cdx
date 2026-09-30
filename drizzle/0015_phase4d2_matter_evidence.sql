CREATE TYPE "public"."information_request_purpose" AS ENUM('mobilisation', 'assurance');--> statement-breakpoint
ALTER TABLE "evidence_link" DROP CONSTRAINT "evidence_link_exactly_one_target";--> statement-breakpoint
ALTER TABLE "evidence_link" ADD COLUMN "value_leakage_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence_link" ADD COLUMN "value_driver_id" uuid;--> statement-breakpoint
ALTER TABLE "information_request" ADD COLUMN "purpose" "information_request_purpose";--> statement-breakpoint
ALTER TABLE "information_request_item" ADD COLUMN "value_leakage_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence_link" ADD CONSTRAINT "evidence_link_matter_fk" FOREIGN KEY ("value_leakage_id","project_id") REFERENCES "public"."value_leakage"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_link" ADD CONSTRAINT "evidence_link_driver_fk" FOREIGN KEY ("value_driver_id","project_id") REFERENCES "public"."value_driver"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information_request_item" ADD CONSTRAINT "information_request_item_matter_fk" FOREIGN KEY ("value_leakage_id","project_id") REFERENCES "public"."value_leakage"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_link_matter_uq" ON "evidence_link" USING btree ("evidence_id","value_leakage_id") WHERE "evidence_link"."value_leakage_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_link_driver_uq" ON "evidence_link" USING btree ("evidence_id","value_driver_id") WHERE "evidence_link"."value_driver_id" is not null;--> statement-breakpoint
CREATE INDEX "evidence_link_matter_idx" ON "evidence_link" USING btree ("value_leakage_id") WHERE "evidence_link"."value_leakage_id" is not null;--> statement-breakpoint
CREATE INDEX "information_request_item_matter_idx" ON "information_request_item" USING btree ("value_leakage_id") WHERE "information_request_item"."value_leakage_id" is not null;--> statement-breakpoint
ALTER TABLE "evidence_link" ADD CONSTRAINT "evidence_link_exactly_one_target" CHECK (num_nonnulls("evidence_link"."value_driver_version_id", "evidence_link"."assumption_id", "evidence_link"."assurance_review_id", "evidence_link"."value_leakage_id", "evidence_link"."value_driver_id") = 1);