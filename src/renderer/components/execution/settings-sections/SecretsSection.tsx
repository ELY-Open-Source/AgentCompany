import { useState } from "react";
import { Trash } from "../../ui/icons";
import type { SecretRecord } from "@shared/types";
import { ActionButton, ConfirmDialog, EmptyState, Eyebrow } from "../../ui";
import { formatTime } from "../../../lib/formatters";
import { useT } from "../../../i18n";
import { unwrap } from "../../../lib/desktop";
import { describeActionError } from "../execution-utils";
import { useAppStore } from "../../../state/store";

interface SecretsSectionProps {
  secrets: SecretRecord[];
  companyId: string;
  onSaved: () => Promise<void>;
}

/**
 * Per-company secret bindings. Secrets are deleted via a confirm
 * dialog because deletions break downstream connectors that still
 * reference them; the dialog surfaces that cost in its copy.
 */
export function SecretsSection({ secrets, companyId, onSaved }: SecretsSectionProps) {
  const t = useT();
  const addToast = useAppStore((s) => s.addToast);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const target = secrets.find((entry) => entry.id === confirmId) ?? null;

  const handleDelete = async (id: string) => {
    setDeleteError(null);
    try {
      unwrap(await window.agentCompany.deleteSecret({ id, companyId }));
      setConfirmId(null);
      addToast(t("settings.secretDeleted"), "success");
      await onSaved();
    } catch (err) {
      setDeleteError(describeActionError(err));
    }
  };

  return (
    <div>
      <ConfirmDialog
        open={confirmId !== null}
        title={t("settings.deleteSecretTitle")}
        message={t("settings.deleteSecretConfirm").replace("{name}", target?.name ?? "")}
        errorMessage={deleteError}
        onConfirm={() => confirmId && void handleDelete(confirmId)}
        onCancel={() => {
          setDeleteError(null);
          setConfirmId(null);
        }}
      />
      <Eyebrow className="mb-3">
        {t("exec.secrets")} ({secrets.length})
      </Eyebrow>
      {secrets.length === 0 ? (
        <EmptyState title={t("exec.noSecretsStored")} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <HeaderCell>{t("exec.secretName")}</HeaderCell>
                <HeaderCell>{t("exec.secretDescription")}</HeaderCell>
                <HeaderCell>{t("exec.secretBackendCol")}</HeaderCell>
                <HeaderCell>{t("exec.secretUpdated")}</HeaderCell>
                <HeaderCell />
              </tr>
            </thead>
            <tbody>
              {secrets.map((secret) => (
                <tr key={secret.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 font-medium text-foreground">{secret.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{secret.description || "—"}</td>
                  <td className="px-4 py-3 font-mono text-muted-foreground">{secret.backend}</td>
                  <td className="px-4 py-3 font-mono text-muted-foreground">{formatTime(secret.updatedAt)}</td>
                  <td className="px-4 py-3">
                    <ActionButton
                      label={t("settings.delete")}
                      tone="danger"
                      icon={Trash}
                      onClick={() => setConfirmId(secret.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HeaderCell({ children }: { children?: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </th>
  );
}
