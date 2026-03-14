import {
  buildDefaultTeamBlueprintPreviewRequest,
  resolveTeamBlueprintParameterEditors,
  type TeamBlueprintParameterHints,
  type TeamBlueprintPreviewRequest,
} from "@squadrail/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type TeamBlueprintParameterEditorProps = {
  blueprint: { parameterHints: TeamBlueprintParameterHints };
  value?: TeamBlueprintPreviewRequest;
  defaultValue?: TeamBlueprintPreviewRequest;
  onChange: (next: TeamBlueprintPreviewRequest) => void;
  disabled?: boolean;
  title?: string;
  description?: string;
  compact?: boolean;
};

type TeamBlueprintParameterChange = {
  key: keyof TeamBlueprintPreviewRequest;
  label: string;
  before: string;
  after: string;
};

function resolveRequest(
  blueprint: { parameterHints: TeamBlueprintParameterHints },
  value?: TeamBlueprintPreviewRequest,
  defaultValue?: TeamBlueprintPreviewRequest,
): {
  projectCount: number;
  engineerPairsPerProject: number;
  includePm: boolean;
  includeQa: boolean;
  includeCto: boolean;
} {
  const defaults = buildDefaultTeamBlueprintPreviewRequest(blueprint, defaultValue);
  return {
    projectCount: value?.projectCount ?? defaults.projectCount ?? 1,
    engineerPairsPerProject: value?.engineerPairsPerProject ?? defaults.engineerPairsPerProject ?? 1,
    includePm: Boolean(value?.includePm ?? defaults.includePm ?? false),
    includeQa: Boolean(value?.includeQa ?? defaults.includeQa ?? false),
    includeCto: Boolean(value?.includeCto ?? defaults.includeCto ?? false),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function boolText(value: boolean) {
  return value ? "On" : "Off";
}

export function describeTeamBlueprintParameterChanges(
  blueprint: { parameterHints: TeamBlueprintParameterHints },
  value?: TeamBlueprintPreviewRequest,
  defaultValue?: TeamBlueprintPreviewRequest,
): TeamBlueprintParameterChange[] {
  const editors = resolveTeamBlueprintParameterEditors(blueprint.parameterHints);
  const defaults = resolveRequest(blueprint, undefined, defaultValue);
  const current = resolveRequest(blueprint, value, defaultValue);
  const changes: TeamBlueprintParameterChange[] = [];

  if (defaults.projectCount !== current.projectCount) {
    changes.push({
      key: "projectCount",
      label: editors.projectCount.label,
      before: String(defaults.projectCount),
      after: String(current.projectCount),
    });
  }
  if (defaults.engineerPairsPerProject !== current.engineerPairsPerProject) {
    changes.push({
      key: "engineerPairsPerProject",
      label: editors.engineerPairsPerProject.label,
      before: String(defaults.engineerPairsPerProject),
      after: String(current.engineerPairsPerProject),
    });
  }
  if (defaults.includePm !== current.includePm) {
    changes.push({
      key: "includePm",
      label: editors.includePm.label,
      before: boolText(defaults.includePm),
      after: boolText(current.includePm),
    });
  }
  if (defaults.includeQa !== current.includeQa) {
    changes.push({
      key: "includeQa",
      label: editors.includeQa.label,
      before: boolText(defaults.includeQa),
      after: boolText(current.includeQa),
    });
  }
  if (defaults.includeCto !== current.includeCto) {
    changes.push({
      key: "includeCto",
      label: editors.includeCto.label,
      before: boolText(defaults.includeCto),
      after: boolText(current.includeCto),
    });
  }

  return changes;
}

export function TeamBlueprintParameterEditor({
  blueprint,
  value,
  defaultValue,
  onChange,
  disabled = false,
  title = "Parameter editing",
  description = "Adjust the reusable team shape before generating the preview diff.",
  compact = false,
}: TeamBlueprintParameterEditorProps) {
  const editors = resolveTeamBlueprintParameterEditors(blueprint.parameterHints);
  const current = resolveRequest(blueprint, value, defaultValue);

  function updateNumber(
    key: "projectCount" | "engineerPairsPerProject",
    nextRawValue: string,
  ) {
    const parsed = Number.parseInt(nextRawValue, 10);
    if (!Number.isFinite(parsed)) return;
    const editor = editors[key];
    onChange({
      ...current,
      [key]: clamp(parsed, editor.min, editor.max),
    });
  }

  function updateToggle(key: "includePm" | "includeQa" | "includeCto", checked: boolean) {
    onChange({
      ...current,
      [key]: checked,
    });
  }

  function resetToDefaults() {
    onChange(buildDefaultTeamBlueprintPreviewRequest(blueprint, defaultValue));
  }

  const parameterChanges = describeTeamBlueprintParameterChanges(blueprint, current, defaultValue);

  return (
    <div className={cn("space-y-4 rounded-md border border-border px-4 py-4", compact && "px-3 py-3")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <Button size="sm" variant="outline" disabled={disabled} onClick={resetToDefaults}>
          Reset defaults
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="font-medium text-foreground">{editors.projectCount.label}</span>
          <Input
            aria-label={editors.projectCount.label}
            type="number"
            min={editors.projectCount.min}
            max={editors.projectCount.max}
            step={editors.projectCount.step}
            value={String(current.projectCount)}
            disabled={disabled}
            onChange={(event) => updateNumber("projectCount", event.target.value)}
          />
          <span className="block text-xs text-muted-foreground">{editors.projectCount.description}</span>
        </label>

        <label className="space-y-2 text-sm">
          <span className="font-medium text-foreground">{editors.engineerPairsPerProject.label}</span>
          <Input
            aria-label={editors.engineerPairsPerProject.label}
            type="number"
            min={editors.engineerPairsPerProject.min}
            max={editors.engineerPairsPerProject.max}
            step={editors.engineerPairsPerProject.step}
            value={String(current.engineerPairsPerProject)}
            disabled={disabled}
            onChange={(event) => updateNumber("engineerPairsPerProject", event.target.value)}
          />
          <span className="block text-xs text-muted-foreground">{editors.engineerPairsPerProject.description}</span>
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {([
          ["includePm", editors.includePm, blueprint.parameterHints.supportsPm, current.includePm],
          ["includeQa", editors.includeQa, blueprint.parameterHints.supportsQa, current.includeQa],
          ["includeCto", editors.includeCto, blueprint.parameterHints.supportsCto, current.includeCto],
        ] as const).map(([key, editor, supported, checked]) => {
          const checkboxDisabled = disabled || !supported || !editor.editable;
          return (
            <div key={key} className="rounded-md border border-border bg-muted/20 px-3 py-3">
              <div className="flex items-start gap-3">
                <Checkbox
                  aria-label={editor.label}
                  checked={checked}
                  disabled={checkboxDisabled}
                  onCheckedChange={(next) => updateToggle(key, Boolean(next))}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{editor.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{editor.description}</div>
                  {!supported && (
                    <div className="mt-2 text-[11px] text-muted-foreground">This blueprint does not provide this lane.</div>
                  )}
                  {supported && !editor.editable && (
                    <div className="mt-2 text-[11px] text-muted-foreground">Fixed by blueprint policy.</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-md border border-border bg-muted/20 px-3 py-3">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Default delta</div>
        {parameterChanges.length === 0 ? (
          <div className="mt-2 text-sm text-muted-foreground">Using the blueprint defaults for preview/apply.</div>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-foreground">
            {parameterChanges.map((change) => (
              <li key={change.key}>
                {change.label}: <span className="text-muted-foreground">{change.before}</span> → {change.after}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
