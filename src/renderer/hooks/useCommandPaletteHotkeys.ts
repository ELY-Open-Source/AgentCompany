import { useEffect } from "react";
import { useAppStore } from "../state/store";
import type { PaletteAction } from "./useUIController";

interface CommandPaletteHotkeysOptions {
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  setCommandPaletteSearch: (value: string) => void;
  setSelectedPaletteIndex: (index: number) => void;
  paletteActions: PaletteAction[];
  selectedPaletteIndex: number;
  navigateTo: (section: PaletteAction["section"], entityId?: string) => void;
  commandPaletteSearch: string;
}

export function useCommandPaletteHotkeys({
  commandPaletteOpen,
  setCommandPaletteOpen,
  setCommandPaletteSearch,
  setSelectedPaletteIndex,
  paletteActions,
  selectedPaletteIndex,
  navigateTo,
  commandPaletteSearch,
}: CommandPaletteHotkeysOptions) {
  useEffect(() => {
    function onGlobalKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
        if (!commandPaletteOpen) {
          setCommandPaletteSearch("");
          setSelectedPaletteIndex(0);
        }
      }
    }
    document.addEventListener("keydown", onGlobalKey);
    return () => document.removeEventListener("keydown", onGlobalKey);
  }, [commandPaletteOpen, setCommandPaletteOpen, setCommandPaletteSearch, setSelectedPaletteIndex]);

  useEffect(() => {
    if (!commandPaletteOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { setCommandPaletteOpen(false); setCommandPaletteSearch(""); setSelectedPaletteIndex(0); return; }
      if (paletteActions.length === 0) return;
      if (event.key === "ArrowDown") { event.preventDefault(); setSelectedPaletteIndex((useAppStore.getState().selectedPaletteIndex + 1) % paletteActions.length); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setSelectedPaletteIndex((useAppStore.getState().selectedPaletteIndex - 1 + paletteActions.length) % paletteActions.length); return; }
      if (event.key !== "Enter") return;
      event.preventDefault();
      const selectedAction = paletteActions[Math.min(selectedPaletteIndex, paletteActions.length - 1)];
      if (!selectedAction) return;
      navigateTo(selectedAction.section, selectedAction.entityId);
      setCommandPaletteOpen(false);
      setCommandPaletteSearch("");
      setSelectedPaletteIndex(0);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [commandPaletteOpen, navigateTo, paletteActions, selectedPaletteIndex, setCommandPaletteOpen, setCommandPaletteSearch, setSelectedPaletteIndex]);

  useEffect(() => {
    if (!commandPaletteOpen) return;
    setSelectedPaletteIndex(0);
  }, [commandPaletteOpen, commandPaletteSearch, setSelectedPaletteIndex]);
}
