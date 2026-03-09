import { useState } from "react";
import { Copy, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "../context/ToastContext";
import type { DashboardBriefSnapshot } from "@squadrail/shared";
import type { IssueTaskBrief } from "@squadrail/shared";

interface BriefPanelV2Props {
  briefs: Partial<Record<string, DashboardBriefSnapshot>>;
  className?: string;
}

const scopeLabels: Record<string, string> = {
  engineer: "Engineer",
  reviewer: "Reviewer",
  tech_lead: "Tech Lead",
  closure: "Closure",
};

const scopeColors: Record<string, string> = {
  engineer: "bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-950 dark:text-blue-100 dark:border-blue-800",
  reviewer: "bg-purple-100 text-purple-900 border-purple-300 dark:bg-purple-950 dark:text-purple-100 dark:border-purple-800",
  tech_lead: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-100 dark:border-amber-800",
  closure: "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-100 dark:border-emerald-800",
};

/**
 * Enhanced brief panel with syntax highlighting and collapsible sections
 */
export function BriefPanelV2({ briefs, className }: BriefPanelV2Props) {
  const { pushToast } = useToast();
  const [expandedScopes, setExpandedScopes] = useState<Set<string>>(
    new Set(Object.keys(briefs).filter(k => briefs[k]))
  );

  const toggleScope = (scope: string) => {
    const newExpanded = new Set(expandedScopes);
    if (newExpanded.has(scope)) {
      newExpanded.delete(scope);
    } else {
      newExpanded.add(scope);
    }
    setExpandedScopes(newExpanded);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    pushToast({ title: "Copied to clipboard", tone: "success" });
  };

  const orderedScopes = ["engineer", "reviewer", "tech_lead", "closure"];
  const availableBriefs = orderedScopes.filter(scope => briefs[scope]);

  if (availableBriefs.length === 0) {
    return (
      <div className={cn("py-12 text-center text-sm text-muted-foreground", className)}>
        No briefs available yet
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {orderedScopes.map(scope => {
        const brief = briefs[scope];
        if (!brief) return null;

        const isExpanded = expandedScopes.has(scope);

        return (
          <Collapsible
            key={scope}
            open={isExpanded}
            onOpenChange={() => toggleScope(scope)}
          >
            <div className="border rounded-xl overflow-hidden bg-card">
              {/* Header */}
              <CollapsibleTrigger asChild>
                <button className="w-full px-6 py-4 flex items-center justify-between gap-4 hover:bg-accent/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <span className={cn(
                      "px-3 py-1 rounded-full text-xs font-semibold border",
                      scopeColors[scope] || "bg-muted text-foreground"
                    )}>
                      {scopeLabels[scope] || scope}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      Version {brief.briefVersion}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {brief.createdAt && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(brief.createdAt).toLocaleString()}
                      </span>
                    )}
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </button>
              </CollapsibleTrigger>

              {/* Content */}
              <CollapsibleContent>
                <div className="px-6 py-4 border-t">
                  {/* Preview */}
                  <div>
                    <h4 className="text-sm font-semibold mb-2">Preview</h4>
                    <div className="relative group">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute top-0 right-0 h-6 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => copyToClipboard(brief.preview)}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      <pre className="p-4 rounded-lg bg-muted/50 border text-xs overflow-x-auto leading-relaxed">
                        <code>{brief.preview}</code>
                      </pre>
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        );
      })}
    </div>
  );
}
