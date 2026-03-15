import path from "node:path";
import { isKnowledgeSummarySourceType } from "@squadrail/shared";
import type { RetrievalHitView } from "../issue-retrieval.js";
import { classifyOrganizationalArtifact } from "../retrieval-evidence-guards.js";

const ISSUE_IDENTIFIER_PATTERN = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/gi;

export function uniqueNonEmpty(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ordered.push(trimmed);
  }
  return ordered;
}

export function compactWhitespace(value: string, max = 220) {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= max) return compacted;
  return `${compacted.slice(0, max - 1)}...`;
}

export function truncateRetrievalSegment(value: string, max: number) {
  const compacted = value.replace(/\s+/g, " ").trim();
  if (compacted.length <= max) return compacted;
  return `${compacted.slice(0, Math.max(0, max - 3))}...`;
}

export function normalizeHintPath(value: string) {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  return path.posix.normalize(normalized);
}

export function basenameWithoutExtension(filePath: string) {
  const base = path.posix.basename(filePath);
  return base.replace(/\.[^.]+$/, "");
}

export function normalizeIssueIdentifier(value: string) {
  return value.trim().toUpperCase();
}

export function isIssueIdentifier(value: string) {
  const normalized = value.trim();
  if (normalized.length === 0) return false;
  ISSUE_IDENTIFIER_PATTERN.lastIndex = 0;
  return ISSUE_IDENTIFIER_PATTERN.test(normalized);
}

export function extractIssueIdentifiers(values: Array<string | null | undefined>) {
  const identifiers: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || value.trim().length === 0) continue;
    for (const match of value.matchAll(ISSUE_IDENTIFIER_PATTERN)) {
      const identifier = match[0]?.trim();
      if (identifier) identifiers.push(normalizeIssueIdentifier(identifier));
    }
    ISSUE_IDENTIFIER_PATTERN.lastIndex = 0;
  }
  return uniqueNonEmpty(identifiers);
}

export function metadataStringArray(metadata: Record<string, unknown>, keys: string[]) {
  const values: string[] = [];
  for (const key of keys) {
    const candidate = metadata[key];
    if (!Array.isArray(candidate)) continue;
    for (const item of candidate) {
      if (typeof item === "string" && item.trim().length > 0) {
        values.push(item.trim());
      }
    }
  }
  return uniqueNonEmpty(values);
}

function readMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function classifyReuseArtifactKind(hit: RetrievalHitView) {
  const artifactClass = classifyOrganizationalArtifact(hit);
  const messageType = readMetadataString(hit.documentMetadata, "messageType");
  if (messageType === "CLOSE_TASK") return "close";
  if (hit.sourceType === "code" || hit.sourceType === "test_report" || isKnowledgeSummarySourceType(hit.sourceType)) {
    return "fix";
  }
  if (artifactClass === "review") return "review";
  return "decision";
}
