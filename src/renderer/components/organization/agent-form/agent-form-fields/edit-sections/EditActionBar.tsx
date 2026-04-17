import { useState } from "react";
import { Pencil, Trash } from "../../../../ui/icons";
import type { AgentRecord } from "@shared/types";
import { ActionButton } from "../../../../ui";
import { ConfirmDelete } from "../../../helpers";
import { useT } from "../../../../../i18n";

interface EditActionBarProps {
  agent: AgentRecord;
  pendingApproval: boolean;
  isRootAgent: boolean;
  isDirty: boolean;
  selectedConnectorIssue: string | null;
  saveError: string | null;
  onSave: () => Promise<void> | void;
  onCancel: () => void;
  onDelete: () => Promise<void> | void;
}

/**
 * Primary / secondary / destructive actions for the agent Edit modal.
 *
 * - Save is disabled until the form is dirty, so users see whether their
 *   changes have been captured without needing to click Save to find out.
 * - Cancel closes the modal; the caller controls what "close" means
 *   (typically clearing the selectedAgentId state).
 * - Delete is gated behind both an inline ConfirmDelete AND the
 *   `isRootAgent` guard; root agents (no reportsTo) must have their
 *   direct reports reassigned before they can be removed.
 */
export function EditActionBar({
  agent,
  pendingApproval,
  isRootAgent,
  isDirty,
  selectedConnectorIssue,
  saveError,
  onSave,
  onCancel,
  onDelete,
}: EditActionBarProps) {
  const t = useT();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div className="border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <ActionButton
          label={t("agent.saveChanges")}
          tone="accent"
          icon={Pencil}
          disabled={pendingApproval || !isDirty || !!selectedConnectorIssue}
          onClick={() => void onSave()}
        />
        <ActionButton
          label={t("common.cancel")}
          tone="default"
          onClick={onCancel}
        />
        <div className="ml-auto">
          {confirmingDelete ? (
            <ConfirmDelete
              entityLabel={agent.name}
              onConfirm={() => void onDelete()}
              onCancel={() => setConfirmingDelete(false)}
            />
          ) : (
            <ActionButton
              label={t("agent.form.delete")}
              tone="danger"
              icon={Trash}
              disabled={pendingApproval || isRootAgent}
              onClick={() => setConfirmingDelete(true)}
            />
          )}
        </div>
      </div>
      {pendingApproval ? (
        <p className="mt-3 text-[12px] text-muted-foreground">{t("agent.form.pendingReadOnly")}</p>
      ) : null}
      {isRootAgent && !pendingApproval ? (
        <p className="mt-3 text-[12px] text-muted-foreground">{t("agent.form.rootDeleteBlocked")}</p>
      ) : null}
      {saveError ? <p className="mt-3 text-[12px] text-destructive">{saveError}</p> : null}
    </div>
  );
}
