ALTER TABLE "issue_protocol_messages"
  ADD COLUMN "payload_sha256" text;
--> statement-breakpoint
ALTER TABLE "issue_protocol_messages"
  ADD COLUMN "previous_integrity_signature" text;
--> statement-breakpoint
ALTER TABLE "issue_protocol_messages"
  ADD COLUMN "integrity_algorithm" text;
--> statement-breakpoint
ALTER TABLE "issue_protocol_messages"
  ADD COLUMN "integrity_signature" text;
