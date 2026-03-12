import { z } from "zod";

export const operatingAlertSeveritySchema = z.enum(["medium", "high", "critical"]);
export const operatingAlertDestinationTypeSchema = z.enum(["generic_webhook", "slack_webhook"]);

export const operatingAlertDestinationConfigSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(120),
  type: operatingAlertDestinationTypeSchema,
  url: z.string().trim().url(),
  enabled: z.boolean().optional().default(true),
  authHeaderName: z.string().trim().min(1).max(120).optional().nullable(),
  authHeaderValue: z.string().trim().min(1).max(500).optional().nullable(),
}).strict();

export const updateOperatingAlertsConfigSchema = z.object({
  enabled: z.boolean().optional(),
  minSeverity: operatingAlertSeveritySchema.optional(),
  cooldownMinutes: z.number().int().min(1).max(24 * 60).optional(),
  destinations: z.array(operatingAlertDestinationConfigSchema).max(10).optional(),
}).strict();

export type UpdateOperatingAlertsConfig = z.infer<typeof updateOperatingAlertsConfigSchema>;

export const sendOperatingAlertTestSchema = z.object({
  severity: operatingAlertSeveritySchema.optional().default("high"),
  summary: z.string().trim().min(1).max(200).optional(),
  detail: z.string().trim().min(1).max(2_000).optional(),
}).strict();

export type SendOperatingAlertTest = z.infer<typeof sendOperatingAlertTestSchema>;
