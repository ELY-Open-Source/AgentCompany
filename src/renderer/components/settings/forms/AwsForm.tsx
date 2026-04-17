import { useState } from "react";
import {
  FIELD_INPUT,
  FIELD_LABEL,
  FIELD_SELECT,
  FORM_BUTTON,
  FORM_ERROR,
  FORM_FIELDSET,
} from "./form-shared";

interface Props {
  connectorId: string;
  onSaved?: () => void;
}

type AuthMode = "profile" | "iam" | "bearer";

export function AwsForm({ connectorId, onSaved }: Props) {
  const [authMode, setAuthMode] = useState<AuthMode>("profile");
  const [region, setRegion] = useState("us-east-1");
  const [awsProfile, setAwsProfile] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [bearerToken, setBearerToken] = useState("");
  const [forceCache, setForceCache] = useState(false);
  const [endpointUrl, setEndpointUrl] = useState("");
  const [skipAuth, setSkipAuth] = useState(false);
  const [forceHttp1, setForceHttp1] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const desktop = window.agentCompany;
    if (!desktop) return;
    if (authMode === "profile" && awsProfile.trim().length === 0) {
      setError("AWS profile name required.");
      return;
    }
    if (
      authMode === "iam" &&
      (accessKeyId.trim().length === 0 || secretAccessKey.trim().length === 0)
    ) {
      setError("Access key id and secret access key required for IAM auth.");
      return;
    }
    if (authMode === "bearer" && bearerToken.trim().length === 0) {
      setError("Bearer token required.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await desktop.saveCredential({
      connectorId,
      payload: {
        kind: "aws",
        value: {
          authMode,
          region: region.trim() || "us-east-1",
          awsProfile: authMode === "profile" ? awsProfile.trim() : undefined,
          accessKeyId: authMode === "iam" ? accessKeyId.trim() : undefined,
          secretAccessKey: authMode === "iam" ? secretAccessKey.trim() : undefined,
          sessionToken:
            authMode === "iam" && sessionToken.trim() ? sessionToken.trim() : undefined,
          bearerToken: authMode === "bearer" ? bearerToken.trim() : undefined,
          forceCache,
          endpointUrl: endpointUrl.trim() || undefined,
          skipAuth,
          forceHttp1,
        },
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onSaved?.();
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
      className={FORM_FIELDSET}
    >
      <div>
        <label className={FIELD_LABEL}>Auth mode</label>
        <select
          value={authMode}
          onChange={(event) => setAuthMode(event.target.value as AuthMode)}
          disabled={busy}
          className={FIELD_SELECT}
        >
          <option value="profile">AWS profile (~/.aws/credentials)</option>
          <option value="iam">IAM access key + secret</option>
          <option value="bearer">Bedrock bearer token</option>
        </select>
      </div>
      <div>
        <label className={FIELD_LABEL}>AWS region</label>
        <input
          type="text"
          value={region}
          onChange={(event) => setRegion(event.target.value)}
          disabled={busy}
          className={FIELD_INPUT}
          placeholder="us-east-1"
        />
      </div>
      {authMode === "profile" ? (
        <div>
          <label className={FIELD_LABEL}>Profile name</label>
          <input
            type="text"
            value={awsProfile}
            onChange={(event) => setAwsProfile(event.target.value)}
            disabled={busy}
            className={FIELD_INPUT}
            placeholder="default"
          />
        </div>
      ) : null}
      {authMode === "iam" ? (
        <>
          <div>
            <label className={FIELD_LABEL}>Access key id</label>
            <input
              type="text"
              value={accessKeyId}
              onChange={(event) => setAccessKeyId(event.target.value)}
              disabled={busy}
              className={FIELD_INPUT}
              autoComplete="off"
            />
          </div>
          <div>
            <label className={FIELD_LABEL}>Secret access key</label>
            <input
              type="password"
              value={secretAccessKey}
              onChange={(event) => setSecretAccessKey(event.target.value)}
              disabled={busy}
              className={FIELD_INPUT}
              autoComplete="off"
            />
          </div>
          <div>
            <label className={FIELD_LABEL}>Session token (optional)</label>
            <input
              type="password"
              value={sessionToken}
              onChange={(event) => setSessionToken(event.target.value)}
              disabled={busy}
              className={FIELD_INPUT}
              autoComplete="off"
            />
          </div>
        </>
      ) : null}
      {authMode === "bearer" ? (
        <div>
          <label className={FIELD_LABEL}>Bearer token</label>
          <input
            type="password"
            value={bearerToken}
            onChange={(event) => setBearerToken(event.target.value)}
            disabled={busy}
            className={FIELD_INPUT}
            autoComplete="off"
          />
        </div>
      ) : null}
      <details className="rounded-md border border-border/50 px-3 py-2 text-[12px]">
        <summary className="cursor-pointer select-none text-muted-foreground">Advanced</summary>
        <div className="mt-3 space-y-2">
          <label className="flex items-center gap-2 text-[12px] text-foreground">
            <input
              type="checkbox"
              checked={forceCache}
              onChange={(event) => setForceCache(event.target.checked)}
              disabled={busy}
            />
            Force prompt cache (AWS_BEDROCK_FORCE_CACHE)
          </label>
          <div>
            <label className={FIELD_LABEL}>Endpoint URL (optional)</label>
            <input
              type="url"
              value={endpointUrl}
              onChange={(event) => setEndpointUrl(event.target.value)}
              disabled={busy}
              className={FIELD_INPUT}
              placeholder="https://bedrock-runtime.your-region.amazonaws.com"
            />
          </div>
          <label className="flex items-center gap-2 text-[12px] text-foreground">
            <input
              type="checkbox"
              checked={skipAuth}
              onChange={(event) => setSkipAuth(event.target.checked)}
              disabled={busy}
            />
            Skip auth (AWS_BEDROCK_SKIP_AUTH)
          </label>
          <label className="flex items-center gap-2 text-[12px] text-foreground">
            <input
              type="checkbox"
              checked={forceHttp1}
              onChange={(event) => setForceHttp1(event.target.checked)}
              disabled={busy}
            />
            Force HTTP/1.1 (AWS_BEDROCK_FORCE_HTTP1)
          </label>
        </div>
      </details>
      {error ? <div className={FORM_ERROR}>{error}</div> : null}
      <button type="submit" disabled={busy} className={FORM_BUTTON}>
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
