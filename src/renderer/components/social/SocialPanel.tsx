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
  onAddAndLogin: (platform: SocialPlatform, requireApproval: boolean) => Promise<void>;
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
  companyId: _companyId,
  onAddAndLogin,
  onDelete,
  onLogin,
  onOpenPath,
  onCancelAction,
  onNavigate,
}: SocialPanelProps) {
  const t = useT();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [activeTab, setActiveTab] = useState<"accounts" | "history">("accounts");

  const handleAddAndLogin = useCallback(async (platform: SocialPlatform, requireApproval: boolean) => {
    await onAddAndLogin(platform, requireApproval);
    setShowAddDialog(false);
  }, [onAddAndLogin]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
            <Megaphone size={20} weight="fill" className="text-primary" />
          </div>
          <div>
            <h2 className="text-[16px] font-bold text-foreground">{t("social.socialMedia")}</h2>
            <p className="text-[12px] text-muted-foreground">
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

      <div className="rounded-lg border border-[color:var(--primary)] border-opacity-20 bg-accent px-4 py-3">
        <div className="flex items-start gap-2 text-[12px] text-primary">
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

      <div className="flex gap-1 rounded-lg bg-muted p-1">
        <button
          type="button"
          onClick={() => setActiveTab("accounts")}
          className={`flex-1 rounded-lg px-3 py-1.5 text-[12px] font-medium transition ${
            activeTab === "accounts"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Accounts ({accounts.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("history")}
          className={`flex-1 rounded-lg px-3 py-1.5 text-[12px] font-medium transition ${
            activeTab === "history"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Action History ({actions.length})
        </button>
      </div>

      {activeTab === "accounts" ? (
        accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
            <Megaphone size={32} className="mb-3 text-muted-foreground" />
            <div className="text-[14px] font-medium text-muted-foreground">{t("social.noAccounts")}</div>
            <div className="mt-1 text-[12px] text-muted-foreground">
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
            onAddAndLogin={(platform, requireApproval) => void handleAddAndLogin(platform, requireApproval)}
            onClose={() => setShowAddDialog(false)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
