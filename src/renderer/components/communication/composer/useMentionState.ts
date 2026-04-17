import { useCallback, useState } from "react";
import type { AgentRecord } from "@shared/types";
import { measureCaret } from "./useCaretMeasurement";

export interface MentionState {
  active: boolean;
  query: string;
  startIndex: number;
  caretTop: number;
  caretLeft: number;
}

const INITIAL_MENTION: MentionState = {
  active: false,
  query: "",
  startIndex: -1,
  caretTop: 0,
  caretLeft: 0,
};

export function useMentionState({
  setBody,
  focusTextarea,
}: {
  setBody: (update: (prev: string) => string) => void;
  focusTextarea: () => void;
}) {
  const [mentionState, setMentionState] = useState<MentionState>(INITIAL_MENTION);

  const dismiss = useCallback(() => {
    setMentionState((s) => ({ ...s, active: false, query: "", startIndex: -1 }));
  }, []);

  const detect = useCallback(
    (value: string, textarea: HTMLTextAreaElement) => {
      const cursorPos = textarea.selectionStart;
      const windowStart = Math.max(0, cursorPos - 50);
      const windowText = value.slice(windowStart, cursorPos);
      const match = windowText.match(/(?:^|\s)@(\w*)$/);
      if (match) {
        const query = match[1];
        const atIndex = windowStart + match.index! + (match[0].startsWith("@") ? 0 : 1);
        const { top, left, lineHeight } = measureCaret(textarea, atIndex);
        setMentionState({
          active: true,
          query,
          startIndex: atIndex,
          caretTop: top + lineHeight,
          caretLeft: left,
        });
        return;
      }
      dismiss();
    },
    [dismiss],
  );

  const selectAgent = useCallback(
    (agent: AgentRecord | null) => {
      if (!agent) {
        dismiss();
        return;
      }
      setBody((prev) => {
        const before = prev.slice(0, mentionState.startIndex);
        const after = prev.slice(mentionState.startIndex + mentionState.query.length + 1);
        return `${before}@${agent.name} ${after}`;
      });
      dismiss();
      focusTextarea();
    },
    [mentionState, setBody, focusTextarea, dismiss],
  );

  return { mentionState, detect, selectAgent };
}
