import { forwardRef, useCallback, type ReactNode, type KeyboardEvent, type ChangeEvent } from "react";
import { PaperPlaneTilt } from "@phosphor-icons/react";
import { ActionButton, InlineNotice } from "../../ui";

export interface ComposerShellProps {
  value: string;
  onChange: (value: string, event: ChangeEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  placeholder: string;
  sending: boolean;
  error?: string | null;
  shortcutHint?: string;
  sendLabel?: string;
  sendDisabled?: boolean;
  leading?: ReactNode;
  belowHeader?: ReactNode;
  onKeyDownExtra?: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  textareaAriaLabel?: string;
  rows?: number;
}

function SendButton({ sending, disabled, onClick, label }: { sending: boolean; disabled: boolean; onClick: () => void; label: string }) {
  return (
    <ActionButton
      label={label}
      icon={PaperPlaneTilt}
      tone="accent"
      iconOnly
      loading={sending}
      disabled={disabled}
      onClick={onClick}
    />
  );
}

export const ComposerShell = forwardRef<HTMLTextAreaElement, ComposerShellProps>(function ComposerShell(
  {
    value,
    onChange,
    onSend,
    placeholder,
    sending,
    error = null,
    shortcutHint,
    sendLabel = "Send message",
    sendDisabled,
    leading,
    belowHeader,
    onKeyDownExtra,
    textareaAriaLabel,
    rows = 2,
  },
  ref,
) {
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      onChange(event.target.value, event);
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (onKeyDownExtra && onKeyDownExtra(event)) return;
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onSend();
      }
    },
    [onKeyDownExtra, onSend],
  );

  const disabled = sendDisabled ?? !value.trim();

  return (
    <>
      {error ? <div className="mb-3"><InlineNotice message={error} /></div> : null}
      {belowHeader}
      <div className="relative flex items-end gap-2">
        {leading}
        <textarea
          ref={ref}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={textareaAriaLabel ?? placeholder}
          rows={rows}
          className="min-h-[40px] min-w-0 flex-1 resize-none rounded-lg border border-border bg-muted px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <SendButton sending={sending} disabled={disabled} onClick={onSend} label={sendLabel} />
      </div>
      {shortcutHint ? <div className="mt-1 text-[11px] text-muted-foreground">{shortcutHint}</div> : null}
    </>
  );
});
