import { useEffect, useState } from "react";
import type { DesktopEvent } from "@shared/types";
import { ActionButton, Modal } from "../../ui";
import { useT } from "../../../i18n";

const desktop = (typeof window !== "undefined" ? window.agentCompany : null) as
  | (Window["agentCompany"] | null);

type PendingPrompt =
  | {
      kind: "prompt";
      connectorId: string;
      requestId: string;
      message: string;
      placeholder?: string;
      allowEmpty?: boolean;
    }
  | {
      kind: "manual-code";
      connectorId: string;
      requestId: string;
      authUrl?: string;
      instructions?: string;
    };

/**
 * Listens for `oauth:prompt-request` and `oauth:manual-code-request` push
 * events and renders a single modal at a time. The modal collects the input
 * and replies via `submitOAuthPrompt` / `submitOAuthManualCode`.
 */
export function OAuthPromptDialog() {
  const t = useT();
  const [pending, setPending] = useState<PendingPrompt | null>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!desktop) return;
    const unsubscribe = desktop.subscribe((event: DesktopEvent) => {
      if (event.type === "oauth:prompt-request") {
        setPending({
          kind: "prompt",
          connectorId: event.connectorId,
          requestId: event.requestId,
          message: event.message,
          placeholder: event.placeholder,
          allowEmpty: event.allowEmpty,
        });
        setValue("");
      } else if (event.type === "oauth:manual-code-request") {
        setPending({
          kind: "manual-code",
          connectorId: event.connectorId,
          requestId: event.requestId,
          authUrl: event.authUrl,
          instructions: event.instructions,
        });
        setValue("");
      }
    });
    return unsubscribe;
  }, []);

  const handleSubmit = async () => {
    if (!desktop || !pending) return;
    if (pending.kind === "prompt") {
      const trimmed = value;
      if (!pending.allowEmpty && trimmed.trim().length === 0) return;
      await desktop.submitOAuthPrompt({
        connectorId: pending.connectorId,
        requestId: pending.requestId,
        value: trimmed,
      });
    } else {
      if (value.trim().length === 0) return;
      await desktop.submitOAuthManualCode({
        connectorId: pending.connectorId,
        requestId: pending.requestId,
        code: value.trim(),
      });
    }
    setPending(null);
    setValue("");
  };

  const handleCancel = async () => {
    if (!desktop || !pending) return;
    await desktop.cancelOAuth({ connectorId: pending.connectorId });
    setPending(null);
    setValue("");
  };

  const isManualCode = pending?.kind === "manual-code";
  const title = isManualCode ? t("oauth.finishSignIn") : t("oauth.providerNeedsInfo");
  const submitDisabled = !pending
    ? true
    : value.trim().length === 0 && !(pending.kind === "prompt" && pending.allowEmpty);

  return (
    <Modal open={pending !== null} onClose={() => void handleCancel()} title={title} width="28rem">
      {pending ? (
        <>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {pending.connectorId}
          </div>

          {isManualCode ? (
            <div className="mb-5 text-[13px] leading-relaxed text-muted-foreground">
              <ol className="list-decimal space-y-2 pl-5 marker:text-[11px] marker:font-mono marker:text-muted-foreground/70">
                <li>
                  {pending.authUrl ? (
                    <>
                      {t("oauth.openAuthPage")}{" "}
                      <a
                        href={pending.authUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-foreground underline decoration-dotted underline-offset-4 hover:text-accent-foreground"
                      >
                        {t("oauth.theAuthPage")}
                      </a>{" "}
                      {t("oauth.authAction")} <strong className="text-foreground">{t("oauth.authorizeButton")}</strong>.
                    </>
                  ) : (
                    <>{t("oauth.fallbackInstruction")}</>
                  )}
                </li>
                <li>{t("oauth.copyCode")}</li>
                <li>{t("oauth.pasteAndSubmit")} <strong className="text-foreground">{t("oauth.submit")}</strong>.</li>
              </ol>
            </div>
          ) : (
            <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
              {(pending as { message: string }).message}
            </p>
          )}

          <input
            autoFocus
            type={isManualCode ? "password" : "text"}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={isManualCode ? t("oauth.authCodePlaceholder") : pending.placeholder}
            aria-label={isManualCode ? t("oauth.authCodeAria") : (pending as { message: string }).message}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleSubmit();
            }}
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-[13px] text-foreground outline-none ring-0 transition-colors placeholder:text-muted-foreground/50 focus:border-foreground/40"
            autoComplete="off"
            spellCheck={false}
          />

          <div className="mt-5 flex items-center justify-end gap-2">
            <ActionButton label={t("oauth.cancel")} onClick={() => void handleCancel()} />
            <ActionButton label={t("oauth.submit")} tone="accent" onClick={() => void handleSubmit()} disabled={submitDisabled} />
          </div>
        </>
      ) : null}
    </Modal>
  );
}
