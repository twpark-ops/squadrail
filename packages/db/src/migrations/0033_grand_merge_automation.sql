ALTER TABLE "issue_merge_candidates"
ADD COLUMN "automation_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;
