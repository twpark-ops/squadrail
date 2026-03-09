import type { TranscriptEntry } from "@squadrail/adapter-utils";

export function parseOpenClawStdoutLine(line: string, ts: string): TranscriptEntry[] {
  return [{ kind: "stdout", ts, text: line }];
}
