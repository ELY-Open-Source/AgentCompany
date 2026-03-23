import { useCallback, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { Browser, Megaphone, Plus } from "@phosphor-icons/react";
import type { BrowserActionRecord, SocialAccountRecord, SocialPlatform } from "@shared/types";
import { ActionButton } from "../ui";
import { useT } from "../../i18n";
import { AccountCard } from "./AccountCard";
import { AddAccountDialog } from "./AddAccountDialog";
import { ActionHistory } from "./ActionHistory";

interface SocialPanelProps {
  accounts: SocialAccountRecord[];
  actions: BrowserActionRecord[];
  agents: Array<{ id: string; name: string }>;
  companyId: string;
  onSave: (input: {
    companyId: string;
    platform: SocialPlatform;
    accountName: string;
    displayName: string;
    requireApproval: boolean;
  }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onLogin: (accountId: string) => Promise<void>;
  onOpenPath: (path: string) => Promise<void>;
  onCancelAction: (actionId: string) => Promise<void>;
  onNavigate: (section: "tasks" | "approvals", entityId: string) => void;
}

export function SocialAccountsPanel({
  accounts,
  actions,
  agents,
  companyId,
  onSave,
  onDelete,
  onLogin,
  onOpenPath,
  onCancelAction,
  onNavigate,
}: SocialPanelProps) {
  const t = useT();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [activeTab, setActiveTab] = useState<"accounts" | "history">("accounts");

  const handleAdd = useCallback(async (platform: SocialPlatform, accountName: string, displayName: string, requireApproval: boolean) => {
    await onSave({ companyId, platform, accountName, displayName, requireApproval });
    setShowAddDialog(false);
  }, [companyId, onSave]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-[color:var(--accent-soft)]">
            <Megaphone size={20} weight="fill" className="text-[color:var(--accent)]" />
          </div>
          <div>
            <h2 className="text-[16px] font-bold text-[color:var(--text)]">{t("social.socialMedia")}</h2>
            <p className="text-[12px] text-[color:var(--muted)]">
              {accounts.length} account{accounts.length !== 1 ? "s" : ""} connected
            </p>
          </div>
        </div>
        <ActionButton
          label="Add Account"
          onClick={() => setShowAddDialog(true)}
          icon={Plus}
          tone="accent"
        />
      </div>

      <div className="rounded-[8px] border border-[color:var(--accent)] border-opacity-20 bg-[color:var(--accent-soft)] px-4 py-3">
        <div className="flex items-start gap-2 text-[12px] text-[color:var(--accent)]">
          <Browser size={16} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">How it works</div>
            <div className="mt-1 text-[11px] opacity-80">
              Add your social media accounts here. Click "Login" to open a browser where you can sign in.
              Your session is saved locally so marketing agents can post content, reply to users, and browse feeds
              using browser automation. All actions are logged and can require Board approval.
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-1 rounded-[8px] bg-[color:var(--panel-soft)] p-1">
        <button
          type="button"
          onClick={() => setActiveTab("accounts")}
          className={`flex-1 rounded-[6px] px-3 py-1.5 text-[12px] font-medium transition ${
            activeTab === "accounts"
              ? "bg-[color:var(--panel)] text-[color:var(--text)] shadow-sm"
              : "text-[color:var(--muted)] hover:text-[color:var(--text)]"
          }`}
        >
          Accounts ({accounts.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("history")}
          className={`flex-1 rounded-[6px] px-3 py-1.5 text-[12px] font-medium transition ${
            activeTab === "history"
              ? "bg-[color:var(--panel)] text-[color:var(--text)] shadow-sm"
              : "text-[color:var(--muted)] hover:text-[color:var(--text)]"
          }`}
        >
          Action History ({actions.length})
        </button>
      </div>

      {activeTab === "accounts" ? (
        accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[8px] border border-dashed border-[color:var(--line)] py-16 text-center">
            <Megaphone size={32} className="mb-3 text-[color:var(--muted)]" />
            <div className="text-[14px] font-medium text-[color:var(--muted-strong)]">{t("social.noAccounts")}</div>
            <div className="mt-1 text-[12px] text-[color:var(--muted)]">
              {t("social.noAccountsDesc")}
            </div>
            <div className="mt-4">
              <ActionButton
                label="Add Account"
                onClick={() => setShowAddDialog(true)}
                icon={Plus}
                tone="accent"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                onLogin={() => void onLogin(account.id)}
                onDelete={() => void onDelete(account.id)}
              />
            ))}
          </div>
        )
      ) : (
        <ActionHistory
          actions={actions}
          agents={agents}
          onOpenPath={onOpenPath}
          onCancelAction={onCancelAction}
          onNavigate={onNavigate}
        />
      )}

      <AnimatePresence>
        {showAddDialog ? (
          <AddAccountDialog
            onAdd={(platform, accountName, displayName, requireApproval) => void handleAdd(platform, accountName, displayName, requireApproval)}
            onClose={() => setShowAddDialog(false)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
