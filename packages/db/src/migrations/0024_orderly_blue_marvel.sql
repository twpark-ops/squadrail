CREATE TABLE "issue_protocol_threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "issue_id" uuid NOT NULL REFERENCES "issues"("id") ON DELETE CASCADE,
  "thread_type" text DEFAULT 'primary' NOT NULL,
  "title" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_protocol_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "issue_id" uuid NOT NULL REFERENCES "issues"("id") ON DELETE CASCADE,
  "thread_id" uuid NOT NULL REFERENCES "issue_protocol_threads"("id") ON DELETE CASCADE,
  "seq" integer NOT NULL,
  "message_type" text NOT NULL,
  "sender_actor_type" text NOT NULL,
  "sender_actor_id" text NOT NULL,
  "sender_role" text NOT NULL,
  "workflow_state_before" text NOT NULL,
  "workflow_state_after" text NOT NULL,
  "summary" text NOT NULL,
  "payload" jsonb NOT NULL,
  "causal_message_id" uuid REFERENCES "issue_protocol_messages"("id") ON DELETE SET NULL,
  "retrieval_run_id" uuid,
  "requires_ack" boolean DEFAULT false NOT NULL,
  "acked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_protocol_recipients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "message_id" uuid NOT NULL REFERENCES "issue_protocol_messages"("id") ON DELETE CASCADE,
  "recipient_type" text NOT NULL,
  "recipient_id" text NOT NULL,
  "recipient_role" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_protocol_artifacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "message_id" uuid NOT NULL REFERENCES "issue_protocol_messages"("id") ON DELETE CASCADE,
  "artifact_kind" text NOT NULL,
  "artifact_uri" text NOT NULL,
  "label" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_review_cycles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "issue_id" uuid NOT NULL REFERENCES "issues"("id") ON DELETE CASCADE,
  "cycle_number" integer NOT NULL,
  "reviewer_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "reviewer_user_id" text,
  "submitted_message_id" uuid NOT NULL REFERENCES "issue_protocol_messages"("id"),
  "opened_at" timestamp with time zone DEFAULT now() NOT NULL,
  "closed_at" timestamp with time zone,
  "outcome" text,
  "outcome_message_id" uuid REFERENCES "issue_protocol_messages"("id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE "issue_protocol_violations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "issue_id" uuid NOT NULL REFERENCES "issues"("id") ON DELETE CASCADE,
  "thread_id" uuid REFERENCES "issue_protocol_threads"("id") ON DELETE CASCADE,
  "message_id" uuid REFERENCES "issue_protocol_messages"("id") ON DELETE SET NULL,
  "violation_code" text NOT NULL,
  "severity" text NOT NULL,
  "detected_by_actor_type" text NOT NULL,
  "detected_by_actor_id" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "issue_protocol_state" (
  "issue_id" uuid PRIMARY KEY NOT NULL REFERENCES "issues"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "workflow_state" text NOT NULL,
  "coarse_issue_status" text NOT NULL,
  "tech_lead_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "primary_engineer_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "reviewer_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL,
  "current_review_cycle" integer DEFAULT 0 NOT NULL,
  "last_protocol_message_id" uuid REFERENCES "issue_protocol_messages"("id") ON DELETE SET NULL,
  "last_transition_at" timestamp with time zone DEFAULT now() NOT NULL,
  "blocked_phase" text,
  "blocked_code" text,
  "blocked_by_message_id" uuid REFERENCES "issue_protocol_messages"("id") ON DELETE SET NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "issue_protocol_threads_company_issue_idx" ON "issue_protocol_threads" ("company_id", "issue_id");
--> statement-breakpoint
CREATE INDEX "issue_protocol_threads_issue_type_idx" ON "issue_protocol_threads" ("issue_id", "thread_type");
--> statement-breakpoint
CREATE UNIQUE INDEX "issue_protocol_messages_thread_seq_idx" ON "issue_protocol_messages" ("thread_id", "seq");
--> statement-breakpoint
CREATE INDEX "issue_protocol_messages_issue_seq_idx" ON "issue_protocol_messages" ("company_id", "issue_id", "seq");
--> statement-breakpoint
CREATE INDEX "issue_protocol_messages_issue_created_idx" ON "issue_protocol_messages" ("issue_id", "created_at");
--> statement-breakpoint
CREATE INDEX "issue_protocol_messages_type_idx" ON "issue_protocol_messages" ("company_id", "message_type", "created_at");
--> statement-breakpoint
CREATE INDEX "issue_protocol_recipients_message_idx" ON "issue_protocol_recipients" ("message_id");
--> statement-breakpoint
CREATE INDEX "issue_protocol_recipients_lookup_idx" ON "issue_protocol_recipients" ("company_id", "recipient_role", "recipient_id");
--> statement-breakpoint
CREATE INDEX "issue_protocol_artifacts_message_idx" ON "issue_protocol_artifacts" ("message_id");
--> statement-breakpoint
CREATE INDEX "issue_protocol_artifacts_kind_idx" ON "issue_protocol_artifacts" ("company_id", "artifact_kind");
--> statement-breakpoint
CREATE UNIQUE INDEX "issue_review_cycles_issue_cycle_uq" ON "issue_review_cycles" ("issue_id", "cycle_number");
--> statement-breakpoint
CREATE INDEX "issue_review_cycles_issue_opened_idx" ON "issue_review_cycles" ("issue_id", "opened_at");
--> statement-breakpoint
CREATE INDEX "issue_review_cycles_reviewer_idx" ON "issue_review_cycles" ("company_id", "reviewer_agent_id", "closed_at");
--> statement-breakpoint
CREATE INDEX "issue_protocol_violations_issue_status_idx" ON "issue_protocol_violations" ("company_id", "issue_id", "status");
--> statement-breakpoint
CREATE INDEX "issue_protocol_violations_code_idx" ON "issue_protocol_violations" ("company_id", "violation_code", "created_at");
--> statement-breakpoint
CREATE INDEX "issue_protocol_violations_message_idx" ON "issue_protocol_violations" ("message_id");
--> statement-breakpoint
CREATE INDEX "issue_protocol_state_company_state_idx" ON "issue_protocol_state" ("company_id", "workflow_state");
--> statement-breakpoint
CREATE INDEX "issue_protocol_state_tech_lead_idx" ON "issue_protocol_state" ("company_id", "tech_lead_agent_id", "workflow_state");
--> statement-breakpoint
CREATE INDEX "issue_protocol_state_engineer_idx" ON "issue_protocol_state" ("company_id", "primary_engineer_agent_id", "workflow_state");
--> statement-breakpoint
CREATE INDEX "issue_protocol_state_reviewer_idx" ON "issue_protocol_state" ("company_id", "reviewer_agent_id", "workflow_state");
