import { useMemo } from "react";
import { cn } from "../lib/utils";

type DiffOp =
  | { kind: "equal"; leftLineNumber: number; rightLineNumber: number; text: string }
  | { kind: "remove"; leftLineNumber: number; text: string }
  | { kind: "add"; rightLineNumber: number; text: string };

type DiffRow = {
  kind: "equal" | "remove" | "add" | "change";
  leftLineNumber: number | null;
  leftText: string | null;
  rightLineNumber: number | null;
  rightText: string | null;
};

function buildLcsTable(left: string[], right: string[]) {
  const table = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      table[leftIndex]![rightIndex] = left[leftIndex] === right[rightIndex]
        ? (table[leftIndex + 1]![rightIndex + 1] ?? 0) + 1
        : Math.max(table[leftIndex + 1]![rightIndex] ?? 0, table[leftIndex]![rightIndex + 1] ?? 0);
    }
  }
  return table;
}

function computeLineDiff(leftText: string, rightText: string): DiffRow[] {
  const left = leftText.split(/\r?\n/);
  const right = rightText.split(/\r?\n/);
  const lcs = buildLcsTable(left, right);
  const ops: DiffOp[] = [];

  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      ops.push({
        kind: "equal",
        leftLineNumber: leftIndex + 1,
        rightLineNumber: rightIndex + 1,
        text: left[leftIndex] ?? "",
      });
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    if ((lcs[leftIndex + 1]![rightIndex] ?? 0) >= (lcs[leftIndex]![rightIndex + 1] ?? 0)) {
      ops.push({
        kind: "remove",
        leftLineNumber: leftIndex + 1,
        text: left[leftIndex] ?? "",
      });
      leftIndex += 1;
    } else {
      ops.push({
        kind: "add",
        rightLineNumber: rightIndex + 1,
        text: right[rightIndex] ?? "",
      });
      rightIndex += 1;
    }
  }

  while (leftIndex < left.length) {
    ops.push({
      kind: "remove",
      leftLineNumber: leftIndex + 1,
      text: left[leftIndex] ?? "",
    });
    leftIndex += 1;
  }

  while (rightIndex < right.length) {
    ops.push({
      kind: "add",
      rightLineNumber: rightIndex + 1,
      text: right[rightIndex] ?? "",
    });
    rightIndex += 1;
  }

  const rows: DiffRow[] = [];
  let pendingRemoved: Array<Extract<DiffOp, { kind: "remove" }>> = [];
  let pendingAdded: Array<Extract<DiffOp, { kind: "add" }>> = [];

  const flushPending = () => {
    const paired = Math.max(pendingRemoved.length, pendingAdded.length);
    for (let index = 0; index < paired; index += 1) {
      const removed = pendingRemoved[index] ?? null;
      const added = pendingAdded[index] ?? null;
      rows.push({
        kind: removed && added ? "change" : removed ? "remove" : "add",
        leftLineNumber: removed?.leftLineNumber ?? null,
        leftText: removed?.text ?? null,
        rightLineNumber: added?.rightLineNumber ?? null,
        rightText: added?.text ?? null,
      });
    }
    pendingRemoved = [];
    pendingAdded = [];
  };

  for (const op of ops) {
    if (op.kind === "equal") {
      flushPending();
      rows.push({
        kind: "equal",
        leftLineNumber: op.leftLineNumber,
        leftText: op.text,
        rightLineNumber: op.rightLineNumber,
        rightText: op.text,
      });
      continue;
    }
    if (op.kind === "remove") pendingRemoved.push(op);
    if (op.kind === "add") pendingAdded.push(op);
  }
  flushPending();

  return rows;
}

function cellTone(kind: DiffRow["kind"], side: "left" | "right") {
  if (kind === "equal") return "bg-background";
  if (kind === "change") return side === "left" ? "bg-rose-50" : "bg-emerald-50";
  if (kind === "remove") return side === "left" ? "bg-rose-50" : "bg-muted/20";
  return side === "right" ? "bg-emerald-50" : "bg-muted/20";
}

interface MarkdownDiffViewProps {
  baselineLabel: string;
  candidateLabel: string;
  baselineText: string;
  candidateText: string;
}

export function MarkdownDiffView({
  baselineLabel,
  candidateLabel,
  baselineText,
  candidateText,
}: MarkdownDiffViewProps) {
  const rows = useMemo(
    () => computeLineDiff(baselineText, candidateText),
    [baselineText, candidateText],
  );

  return (
    <div className="rounded-md border border-border bg-background">
      <div className="grid grid-cols-2 border-b border-border bg-muted/30">
        <div className="border-r border-border px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {baselineLabel}
        </div>
        <div className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {candidateLabel}
        </div>
      </div>
      <div className="max-h-[340px] overflow-auto">
        {rows.length === 0 ? (
          <div className="px-3 py-6 text-sm text-muted-foreground">No diff to display.</div>
        ) : (
          rows.map((row, index) => (
            <div key={`${row.leftLineNumber ?? "x"}:${row.rightLineNumber ?? "y"}:${index}`} className="grid grid-cols-2 border-b border-border/60 last:border-b-0">
              <div className={cn("border-r border-border px-3 py-2 font-mono text-xs", cellTone(row.kind, "left"))}>
                <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3">
                  <span className="text-muted-foreground">{row.leftLineNumber ?? ""}</span>
                  <pre className="whitespace-pre-wrap break-words text-foreground">{row.leftText ?? ""}</pre>
                </div>
              </div>
              <div className={cn("px-3 py-2 font-mono text-xs", cellTone(row.kind, "right"))}>
                <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3">
                  <span className="text-muted-foreground">{row.rightLineNumber ?? ""}</span>
                  <pre className="whitespace-pre-wrap break-words text-foreground">{row.rightText ?? ""}</pre>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
