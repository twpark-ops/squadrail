ALTER TABLE "issue_protocol_state"
  ADD COLUMN "qa_agent_id" uuid REFERENCES "public"."agents"("id") ON DELETE set null;

CREATE INDEX "issue_protocol_state_qa_idx"
  ON "issue_protocol_state" ("company_id", "qa_agent_id", "workflow_state");
