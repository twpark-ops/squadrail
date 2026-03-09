import { z } from "zod";

export const dashboardRecoveryActionSchema = z.object({
  actionType: z.enum(["resolve_violations", "post_recovery_note"]),
  issueIds: z.array(z.string().uuid()).min(1).max(50),
  recoveryTypes: z.array(z.enum(["violation", "timeout", "integrity"])).max(3).optional(),
  noteBody: z.string().trim().min(1).max(4000).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.actionType === "post_recovery_note" && !value.noteBody?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["noteBody"],
      message: "noteBody is required when posting a recovery note",
    });
  }
});

export type DashboardRecoveryAction = z.infer<typeof dashboardRecoveryActionSchema>;
