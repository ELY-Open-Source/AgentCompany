import { useEffect, useState } from "react";
import type { StartProviderOAuthInput } from "../../../shared/commands";
import { Button, Icon } from "./ui";

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
  const [instruction, setInstruction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      window.agentCompany.subscribe((event) => {
        if (event.type !== "provider-oauth" || event.providerKey !== providerKey) return;
        if (event.phase === "authorize" && event.instructions) setInstruction(event.instructions);
      }),
    [providerKey],
  );

  const run = () => {
    setPhase("running");
    setInstruction(null);
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
          <span>Waiting for {label} sign-in</span>
          <button type="button" className="link-button" onClick={cancel}>Cancel</button>
        </div>
        {instruction && <div className="oauth-connect-code">{instruction}</div>}
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="oauth-connect-row done">
        <Icon name="check" size={14} color="var(--green)" />
        <span>Signed in to {label}</span>
        <button type="button" className="link-button" onClick={run}>Redo</button>
      </div>
    );
  }

  return (
    <div className="oauth-connect">
      <Button tone="primary" onClick={run}>Sign in with {label}</Button>
      {error && <div className="oauth-connect-error">{error}</div>}
    </div>
  );
}
