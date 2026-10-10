import { ErrorText } from "../shared/ErrorText";
import { AccountSyncNote } from "../pages/connectors/AccountSyncNote";
import { SignInStatus } from "../pages/connectors/SignInStatus";
import { useMemo } from "react";
import type { AppSnapshot } from "../../../shared/domain";
import { Button } from "../shared/ui";
import { ToolkitCatalog } from "../pages/connectors/ToolkitCatalog";
import { useConnectorCatalog } from "../pages/connectors/useConnectorCatalog";
import { IntegrationKeyRow } from "../pages/settings/IntegrationKeysPanel";
import { connectorsEnabled } from "../shared/routes";
import { DEFAULT_CONNECTOR_ACCOUNT_LABEL } from "../../../shared/commands";
import type { SnapshotActions } from "./useSnapshot";
import { t } from "../i18n/i18n";

/**
 * The post-launch onboarding step: the operator saves their own Composio and
 * logo.dev keys, then connects the toolkits their Composio project enables.
 * Skipping leaves Connectors out of the app until a Composio key is saved.
 */
export function ConnectorsStep({
  orgId,
  snapshot,
  actions,
  onFinish,
}: {
  orgId: string;
  snapshot: AppSnapshot;
  actions: SnapshotActions;
  onFinish: () => void;
}) {
  const enabled = connectorsEnabled(snapshot);
  const composioSavedAt = snapshot.integrationKeys.find((key) => key.name === "composio")?.updatedAt;
  return (
    <div className="form-grid">
      <h2 className="page-h1">{t("Connectors")}</h2>
      {snapshot.integrationKeys.map((status) => <IntegrationKeyRow key={status.name} status={status} actions={actions} />)}
      {enabled && <ConnectorChoices key={composioSavedAt} orgId={orgId} snapshot={snapshot} actions={actions} />}
      <div className="modal-actions" style={{ marginTop: 4 }}>
        <Button tone="primary" onClick={onFinish}>{enabled ? t("Finish") : t("Skip")}</Button>
      </div>
    </div>
  );
}

function ConnectorChoices({ orgId, snapshot, actions }: { orgId: string; snapshot: AppSnapshot; actions: SnapshotActions }) {
  const { catalog, busySlug, connectError, signIn, accountSync, syncAccounts, stopWaiting, checkAgain, connect, retry } = useConnectorCatalog(orgId, actions);
  const connectedSlugs = useMemo(
    () =>
      new Set(
        snapshot.connectorAccounts
          .filter((account) => account.orgId === orgId && account.status === "ACTIVE")
          .map((account) => account.toolkitSlug),
      ),
    [snapshot.connectorAccounts, orgId],
  );

  return (
    <>
      {catalog.phase === "error" && <ErrorText message={catalog.message} action={{ label: t("Retry"), onClick: retry }} />}
      {catalog.phase === "ready" && (
        <div style={{ maxHeight: 420, overflowY: "auto", paddingRight: 4 }}>
          <ToolkitCatalog
            entries={catalog.entries}
            connectedSlugs={connectedSlugs}
            busySlug={busySlug}
            onConnect={(slug) => connect(slug, DEFAULT_CONNECTOR_ACCOUNT_LABEL)}
          />
        </div>
      )}
      {signIn && <SignInStatus signIn={signIn} onStop={stopWaiting} onCheckAgain={checkAgain} />}
      <AccountSyncNote sync={accountSync} onRetry={syncAccounts} />
      {connectError && <ErrorText message={connectError} />}
    </>
  );
}
