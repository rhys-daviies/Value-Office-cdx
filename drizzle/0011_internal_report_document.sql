CREATE TABLE "report_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"sha256" char(64) NOT NULL,
	"content" "bytea" NOT NULL,
	"bytes" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_document_key_uq" UNIQUE("key"),
	CONSTRAINT "report_document_key_format" CHECK ("report_document"."key" = 'reports/' || "report_document"."sha256" || '.pdf'),
	CONSTRAINT "report_document_sha256_format" CHECK ("report_document"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "report_document_bytes" CHECK ("report_document"."bytes" > 0 and "report_document"."bytes" = octet_length("report_document"."content"))
);
--> statement-breakpoint
ALTER TABLE "report_document" ADD CONSTRAINT "report_document_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;