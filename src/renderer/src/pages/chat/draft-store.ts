import { useSyncExternalStore } from "react";
import { setUnsaved } from "../../shared/unsaved";
import type { Draft } from "./ChatComposer";

/** Unsent drafts per conversation, kept outside the page so leaving Messages and coming back loses nothing. */
let drafts: Record<string, Draft> = {};
const listeners = new Set<() => void>();
const UNSENT = Symbol("chat-drafts");

function syncUnsaved(): void {
  const unsent = Object.values(drafts).some((draft) => draft.body.trim() !== "" || draft.attachmentFileIds.length > 0);
  setUnsaved(UNSENT, unsent ? "app" : null);
}

export function setDrafts(update: (current: Record<string, Draft>) => Record<string, Draft>): void {
  drafts = update(drafts);
  syncUnsaved();
  for (const listener of listeners) listener();
}

/** Records live typing in place, re-rendering nothing: the composer shows its own text, the store only needs to know it is unsent. */
export function noteTyping(spaceId: string, body: string): void {
  drafts[spaceId] = { attachmentFileIds: drafts[spaceId]?.attachmentFileIds ?? [], body };
  syncUnsaved();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDrafts(): Record<string, Draft> {
  return useSyncExternalStore(subscribe, () => drafts);
}
