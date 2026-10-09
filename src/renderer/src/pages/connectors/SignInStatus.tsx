import { Button } from "../../shared/ui";
import { t } from "../../i18n/i18n";
import type { SignIn } from "./useConnectorCatalog";

/** Says where a connector sign-in stands: waiting (with how many checks), connected, timed out, or failed. */
export function SignInStatus({ signIn, onStop, onCheckAgain }: { signIn: SignIn; onStop: () => void; onCheckAgain: () => void }) {
  const name = signIn.slug;
  const failed = signIn.phase === "failed" || signIn.phase === "timed_out";
  return (
    <div role={failed ? "alert" : "status"} className="row" style={{ gap: 10, fontSize: "var(--fs-body)", marginBottom: 14, color: failed ? "var(--red)" : "var(--text-2)" }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        {signIn.phase === "waiting" && t("Waiting for the {name} sign-in in your browser (check {check} of {checks}).", { name, check: signIn.check, checks: signIn.checks })}
        {signIn.phase === "connected" && t("{name} ({label}) is connected.", { name, label: signIn.label })}
        {signIn.phase === "timed_out" && t("{name} ({label}) is still not connected. If you finished signing in, check again; otherwise connect again.", { name, label: signIn.label })}
        {signIn.phase === "failed" && t("Connecting {name} ({label}) failed: {reason}", { name, label: signIn.label, reason: signIn.message })}
      </span>
      {signIn.phase === "waiting" && <Button size="small" onClick={onStop}>{t("Stop waiting")}</Button>}
      {signIn.phase === "timed_out" && <Button size="small" onClick={onCheckAgain}>{t("Check again")}</Button>}
    </div>
  );
}
