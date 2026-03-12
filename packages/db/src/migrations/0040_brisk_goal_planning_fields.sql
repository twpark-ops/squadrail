ALTER TABLE "goals" ADD COLUMN "progress_percent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "target_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "sprint_name" text;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "capacity_target_points" integer;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "capacity_committed_points" integer;
