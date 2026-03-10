import { Link } from "@/lib/router";
import { Command, Menu, Search } from "lucide-react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useSidebar } from "../context/SidebarContext";
import { useCompany } from "../context/CompanyContext";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Fragment } from "react";

export function BreadcrumbBar() {
  const { breadcrumbs } = useBreadcrumbs();
  const { toggleSidebar, isMobile } = useSidebar();
  const { selectedCompany } = useCompany();

  const currentLabel = breadcrumbs[breadcrumbs.length - 1]?.label ?? "Workspace";
  const parentCrumbs = breadcrumbs.slice(0, -1);

  function openSearch() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
  }

  const menuButton = isMobile && (
    <Button
      variant="outline"
      size="icon-sm"
      className="mr-2 shrink-0 rounded-[0.95rem] border-border bg-card/80"
      onClick={toggleSidebar}
      aria-label="Open sidebar"
    >
      <Menu className="h-5 w-5" />
    </Button>
  );

  return (
    <div className="shrink-0 border-b border-border/80 bg-[color-mix(in_oklab,var(--background)_88%,var(--card))] px-4 py-3 backdrop-blur-xl dark:bg-[color-mix(in_oklab,var(--background)_92%,black)] md:px-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {menuButton}
          <div className="min-w-0 rounded-[1.2rem] border border-border/80 bg-card/78 px-3 py-2 shadow-[0_10px_24px_rgba(15,23,42,0.04)] dark:bg-card/90 dark:shadow-[0_14px_22px_rgba(4,8,18,0.22)]">
            <div className="flex min-w-0 items-center gap-2.5">
              {selectedCompany && (
                <span className="shrink-0 rounded-full border border-primary/12 bg-primary/8 px-2.5 py-1 font-['IBM_Plex_Mono'] text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/90">
                  {selectedCompany.issuePrefix}
                </span>
              )}
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {selectedCompany?.name ?? "Workspace"}
                  </div>
                  <span className="shrink-0 rounded-full border border-border bg-background/78 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {currentLabel}
                  </span>
                </div>
                {parentCrumbs.length > 0 && (
                  <Breadcrumb className="mt-1 min-w-0 overflow-hidden">
                    <BreadcrumbList className="flex-nowrap">
                      {parentCrumbs.map((crumb, i) => (
                        <Fragment key={i}>
                          {i > 0 && <BreadcrumbSeparator />}
                          <BreadcrumbItem className="shrink-0 text-[11px] text-muted-foreground">
                            {crumb.href ? (
                              <BreadcrumbLink asChild>
                                <Link to={crumb.href}>{crumb.label}</Link>
                              </BreadcrumbLink>
                            ) : (
                              <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                            )}
                          </BreadcrumbItem>
                        </Fragment>
                      ))}
                    </BreadcrumbList>
                  </Breadcrumb>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full border-border bg-card/82 text-muted-foreground shadow-[0_10px_18px_rgba(15,23,42,0.04)] hover:border-primary/20 hover:bg-accent hover:text-foreground dark:bg-card/92 dark:shadow-[0_12px_18px_rgba(4,8,18,0.24)]"
            onClick={openSearch}
          >
            <Search className="mr-2 h-4 w-4" />
            Command
            <span className="ml-2 inline-flex items-center rounded-md border border-border bg-background px-1.5 py-0.5 font-['IBM_Plex_Mono'] text-[10px]">
              <Command className="mr-1 h-3 w-3" />
              K
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
