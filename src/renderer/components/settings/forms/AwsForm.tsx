import { useState } from "react";
import { ActionButton, Input, Select } from "../../ui";
import { useT } from "../../../i18n";

interface Props {
  connectorId: string;
  onSaved?: () => void;
}

type AuthMode = "profile" | "iam" | "bearer";

export function AwsForm({ connectorId, onSaved }: Props) {
  const t = useT();
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
      setError(t("form.aws.errProfileRequired"));
      return;
    }
    if (
      authMode === "iam" &&
      (accessKeyId.trim().length === 0 || secretAccessKey.trim().length === 0)
    ) {
      setError(t("form.aws.errIamRequired"));
      return;
    }
    if (authMode === "bearer" && bearerToken.trim().length === 0) {
      setError(t("form.aws.errBearerRequired"));
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
      className="space-y-3"
    >
      <Select
        label={t("form.aws.authMode")}
        value={authMode}
        onChange={(v) => setAuthMode(v as AuthMode)}
        disabled={busy}
        options={[
          { value: "profile", label: t("form.aws.authProfile") },
          { value: "iam", label: t("form.aws.authIam") },
          { value: "bearer", label: t("form.aws.authBearer") },
        ]}
      />
      <Input label={t("form.aws.region")} value={region} onChange={setRegion} disabled={busy} placeholder="us-east-1" />
      {authMode === "profile" ? (
        <Input label={t("form.aws.profileName")} value={awsProfile} onChange={setAwsProfile} disabled={busy} placeholder="default" />
      ) : null}
      {authMode === "iam" ? (
        <>
          <Input label={t("form.aws.accessKeyId")} value={accessKeyId} onChange={setAccessKeyId} disabled={busy} />
          <Input label={t("form.aws.secretAccessKey")} type="password" value={secretAccessKey} onChange={setSecretAccessKey} disabled={busy} />
          <Input label={t("form.aws.sessionToken")} type="password" value={sessionToken} onChange={setSessionToken} disabled={busy} />
        </>
      ) : null}
      {authMode === "bearer" ? (
        <Input label={t("form.aws.bearerToken")} type="password" value={bearerToken} onChange={setBearerToken} disabled={busy} />
      ) : null}
      <details className="rounded-md border border-border/50 px-3 py-2 text-[12px]">
        <summary className="cursor-pointer select-none text-muted-foreground">{t("form.aws.advanced")}</summary>
        <div className="mt-3 space-y-2">
          <label className="flex items-center gap-2 text-[12px] text-foreground">
            <input
              type="checkbox"
              checked={forceCache}
              onChange={(event) => setForceCache(event.target.checked)}
              disabled={busy}
            />
            {t("form.aws.forceCache")}
          </label>
          <Input
            label={t("form.aws.endpointUrl")}
            type="url"
            value={endpointUrl}
            onChange={setEndpointUrl}
            disabled={busy}
            placeholder="https://bedrock-runtime.your-region.amazonaws.com"
          />
          <label className="flex items-center gap-2 text-[12px] text-foreground">
            <input
              type="checkbox"
              checked={skipAuth}
              onChange={(event) => setSkipAuth(event.target.checked)}
              disabled={busy}
            />
            {t("form.aws.skipAuth")}
          </label>
          <label className="flex items-center gap-2 text-[12px] text-foreground">
            <input
              type="checkbox"
              checked={forceHttp1}
              onChange={(event) => setForceHttp1(event.target.checked)}
              disabled={busy}
            />
            {t("form.aws.forceHttp1")}
          </label>
        </div>
      </details>
      {error ? (
        <div role="alert" className="rounded-md border border-[color:var(--destructive)] bg-destructive-muted px-3 py-2 text-[11px] text-destructive">
          {error}
        </div>
      ) : null}
      <ActionButton
        type="submit"
        label={busy ? t("form.saving") : t("form.save")}
        tone="accent"
        disabled={busy}
        loading={busy}
      />
    </form>
  );
}
