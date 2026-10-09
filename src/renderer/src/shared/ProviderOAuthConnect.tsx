import { useEffect, useState } from "react";
import type { StartProviderOAuthInput } from "../../../shared/commands";
import { Button, Icon } from "./ui";
import { t } from "../i18n/i18n";

type Phase = "idle" | "running" | "done" | "error";

/**
 * Runs a provider's native OAuth login (device-code / PKCE) and reports the
 * outcome. The browser opens automatically; for the device flow the user code
 * is shown here, which is the only interactive instruction required.
 */
export function ProviderOAuthConnect({
  providerKey,
  label,
  buildInput,
  onComplete,
}: {
  providerKey: string;
  label: string;
  buildInput: () => StartProviderOAuthInput;
  onComplete: (secret: string | null) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [prompt, setPrompt] = useState<{ url: string; userCode: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      window.agentCompany.subscribe((event) => {
        if (event.type !== "provider-oauth" || event.providerKey !== providerKey) return;
        if (event.phase === "authorize" && event.url) setPrompt({ url: event.url, userCode: event.userCode ?? null });
      }),
    [providerKey],
  );

  const run = () => {
    setPhase("running");
    setPrompt(null);
    setError(null);
    void window.agentCompany.startProviderOAuth(buildInput()).then((result) => {
      if (result.ok) {
        setPhase("done");
        onComplete(result.data.secret);
      } else {
        setPhase("error");
        setError(result.error.message);
      }
    });
  };

  const cancel = () => void window.agentCompany.cancelProviderOAuth({ providerKey });

  if (phase === "running") {
    return (
      <div className="oauth-connect">
        <div className="oauth-connect-row">
          <span className="spinner" aria-hidden />
          <span>{t("Waiting for {label} sign-in", { label })}</span>
          <button type="button" className="link-button" onClick={cancel}>{t("Cancel")}</button>
        </div>
        {prompt && (
          <div className="oauth-connect-code">
            {prompt.userCode
              ? t("Enter code {code} at {url}", { code: prompt.userCode, url: prompt.url })
              : t("Finish signing in in the browser window that opened.")}
          </div>
        )}
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="oauth-connect-row done">
        <Icon name="check" color="var(--green)" />
        <span>{t("Signed in to {label}", { label })}</span>
        <button type="button" className="link-button" onClick={run}>{t("Sign in again")}</button>
      </div>
    );
  }

  return (
    <div className="oauth-connect">
      <Button tone="primary" onClick={run}>{t("Sign in with {label}", { label })}</Button>
      {error && <div className="oauth-connect-error">{error}</div>}
    </div>
  );
}
