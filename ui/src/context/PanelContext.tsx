import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { readStorageAlias, writeStorageAlias } from "../lib/storage-aliases";

const STORAGE_KEY = "squadrail:panel-visible";
const LEGACY_STORAGE_KEY = "squadrail:panel-visible";

interface PanelContextValue {
  panelContent: ReactNode | null;
  panelVisible: boolean;
  openPanel: (content: ReactNode) => void;
  closePanel: () => void;
  setPanelVisible: (visible: boolean) => void;
  togglePanelVisible: () => void;
}

const PanelContext = createContext<PanelContextValue | null>(null);

function readPreference(): boolean {
  const raw = readStorageAlias(STORAGE_KEY, LEGACY_STORAGE_KEY);
  return raw === null ? true : raw === "true";
}

function writePreference(visible: boolean) {
  writeStorageAlias(STORAGE_KEY, LEGACY_STORAGE_KEY, String(visible));
}

export function PanelProvider({ children }: { children: ReactNode }) {
  const [panelContent, setPanelContent] = useState<ReactNode | null>(null);
  const [panelVisible, setPanelVisibleState] = useState(readPreference);

  const openPanel = useCallback((content: ReactNode) => {
    setPanelContent(content);
  }, []);

  const closePanel = useCallback(() => {
    setPanelContent(null);
  }, []);

  const setPanelVisible = useCallback((visible: boolean) => {
    setPanelVisibleState(visible);
    writePreference(visible);
  }, []);

  const togglePanelVisible = useCallback(() => {
    setPanelVisibleState((prev) => {
      const next = !prev;
      writePreference(next);
      return next;
    });
  }, []);

  return (
    <PanelContext.Provider
      value={{ panelContent, panelVisible, openPanel, closePanel, setPanelVisible, togglePanelVisible }}
    >
      {children}
    </PanelContext.Provider>
  );
}

export function usePanel() {
  const ctx = useContext(PanelContext);
  if (!ctx) {
    throw new Error("usePanel must be used within PanelProvider");
  }
  return ctx;
}
