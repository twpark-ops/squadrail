import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "@/lib/router";
import { useCompany } from "../context/CompanyContext";
import { toCompanyRelativePath } from "../lib/company-routes";
import { readJsonStorageAlias, writeJsonStorageAlias } from "../lib/storage-aliases";

const STORAGE_KEY = "squadrail.companyPaths";
const LEGACY_STORAGE_KEY = "squadrail.companyPaths";
const GLOBAL_SEGMENTS = new Set(["auth", "invite", "board-claim", "docs"]);

function getCompanyPaths(): Record<string, string> {
  return readJsonStorageAlias<Record<string, string>>(STORAGE_KEY, LEGACY_STORAGE_KEY, {});
}

function saveCompanyPath(companyId: string, path: string) {
  const paths = getCompanyPaths();
  paths[companyId] = path;
  writeJsonStorageAlias(STORAGE_KEY, LEGACY_STORAGE_KEY, paths);
}

function isRememberableCompanyPath(path: string): boolean {
  const pathname = path.split("?")[0] ?? "";
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return true;
  const [root] = segments;
  if (GLOBAL_SEGMENTS.has(root!)) return false;
  return true;
}

/**
 * Remembers the last visited page per company and navigates to it on company switch.
 * Falls back to /overview if no page was previously visited for a company.
 */
export function useCompanyPageMemory() {
  const { selectedCompanyId, selectedCompany, selectionSource } = useCompany();
  const location = useLocation();
  const navigate = useNavigate();
  const prevCompanyId = useRef<string | null>(selectedCompanyId);

  // Save current path for current company on every location change.
  // Uses prevCompanyId ref so we save under the correct company even
  // during the render where selectedCompanyId has already changed.
  const fullPath = location.pathname + location.search;
  useEffect(() => {
    const companyId = prevCompanyId.current;
    const relativePath = toCompanyRelativePath(fullPath);
    if (companyId && isRememberableCompanyPath(relativePath)) {
      saveCompanyPath(companyId, relativePath);
    }
  }, [fullPath]);

  // Navigate to saved path when company changes
  useEffect(() => {
    if (!selectedCompanyId) return;

    if (
      prevCompanyId.current !== null &&
      selectedCompanyId !== prevCompanyId.current
    ) {
      if (selectionSource !== "route_sync" && selectedCompany) {
        const paths = getCompanyPaths();
        const savedPath = paths[selectedCompanyId];
        const relativePath = savedPath ? toCompanyRelativePath(savedPath) : "/overview";
        const targetPath = isRememberableCompanyPath(relativePath) ? relativePath : "/overview";
        navigate(`/${selectedCompany.issuePrefix}${targetPath}`, { replace: true });
      }
    }
    prevCompanyId.current = selectedCompanyId;
  }, [selectedCompany, selectedCompanyId, selectionSource, navigate]);
}
