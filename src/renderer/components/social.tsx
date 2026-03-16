import { useCallback, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  Browser,
  Camera,
  ChatCircle,
  Eye,
  Globe,
  Heart,
  MagnifyingGlass,
  Megaphone,
  PaperPlaneTilt,
  Plus,
  Robot,
  ShieldCheck,
  SignIn,
  Trash,
  UserPlus,
  Warning,
  X,
} from "@phosphor-icons/react";
import type { BrowserActionRecord, SectionId, SocialAccountRecord, SocialPlatform } from "@shared/types";
import { ActionButton, Input } from "./ui";

/* ------------------------------------------------------------------ */
/*  Platform Config                                                    */
/* ------------------------------------------------------------------ */

const platformConfig: Record<SocialPlatform, { label: string; color: string; bgColor: string; icon: string }> = {
  twitter: { label: "Twitter / X", color: "#1DA1F2", bgColor: "#1DA1F210", icon: "𝕏" },
  linkedin: { label: "LinkedIn", color: "#0A66C2", bgColor: "#0A66C210", icon: "in" },
  instagram: { label: "Instagram", color: "#E4405F", bgColor: "#E4405F10", icon: "IG" },
  facebook: { label: "Facebook", color: "#1877F2", bgColor: "#1877F210", icon: "fb" },
  reddit: { label: "Reddit", color: "#FF4500", bgColor: "#FF450010", icon: "r/" },
  youtube: { label: "YouTube", color: "#FF0000", bgColor: "#FF000010", icon: "YT" },
  tiktok: { label: "TikTok", color: "#000000", bgColor: "#00000010", icon: "TT" },
  bluesky: { label: "Bluesky", color: "#0085FF", bgColor: "#0085FF10", icon: "🦋" },
  other: { label: "Other", color: "#6B7280", bgColor: "#6B728010", icon: "🌐" },
};

const actionTypeLabels: Record<string, { label: string; icon: React.ElementType }> = {
  post: { label: "Post", icon: PaperPlaneTilt },
  reply: { label: "Reply", icon: ChatCircle },
  like: { label: "Like", icon: Heart },
  follow: { label: "Follow", icon: UserPlus },
  browse_feed: { label: "Browse Feed", icon: Eye },
  screenshot: { label: "Screenshot", icon: Camera },
  navigate: { label: "Navigate", icon: Globe },
  search: { label: "Search", icon: MagnifyingGlass },
  dm: { label: "Direct Message", icon: ChatCircle },
  custom_script: { label: "Custom Script", icon: Browser },
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ------------------------------------------------------------------ */
/*  Social Account Card                                                */
/* ------------------------------------------------------------------ */

function AccountCard({
  account,
  onLogin,
  onDelete,
  onClick,
}: {
  account: SocialAccountRecord;
  onLogin: () => void;
  onDelete: () => void;
  onClick: () => void;
}) {
  const platform = platformConfig[account.platform] ?? platformConfig.other;
  const isLoggedIn = account.status === "logged_in" || account.status === "active";

  return (
    <div className="group flex items-center gap-3 rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3 transition hover:border-[color:var(--line-strong)] hover:shadow-sm">
      {/* Platform icon */}
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-[14px] font-bold"
        style={{ backgroundColor: platform.bgColor, color: platform.color }}
      >
        {platform.icon}
      </div>

      {/* Info */}
      <button type="button" onClick={onClick} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-[color:var(--text)]">{account.displayName || account.accountName}</span>
          <span
            className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]"
            style={{ backgroundColor: platform.bgColor, color: platform.color }}
          >
            {platform.label}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[color:var(--muted)]">
          <span>@{account.accountName}</span>
          {account.requireApproval ? (
            <span className="flex items-center gap-1 text-[color:var(--warn)]">
              <ShieldCheck size={10} />
              Approval required
            </span>
          ) : null}
          {account.lastUsedAt ? <span>Last used {timeAgo(account.lastUsedAt)}</span> : null}
        </div>
      </button>

      {/* Status + Actions */}
      <div className="flex items-center gap-2">
        <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
          isLoggedIn
            ? "bg-[color:var(--success-soft)] text-[color:var(--success)]"
            : account.status === "login_required"
              ? "bg-[color:var(--warn-soft)] text-[color:var(--warn)]"
              : account.status === "suspended"
                ? "bg-[color:var(--danger-soft)] text-[color:var(--danger)]"
                : "bg-[color:var(--panel-soft)] text-[color:var(--muted)]"
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${
            isLoggedIn ? "bg-[color:var(--success)]"
            : account.status === "login_required" ? "bg-[color:var(--warn)]"
            : account.status === "suspended" ? "bg-[color:var(--danger)]"
            : "bg-[color:var(--muted)]"
          }`} />
          {account.status === "logged_in" ? "Logged In" : account.status === "active" ? "Active" : account.status.replace("_", " ")}
        </span>

        {account.status === "login_required" ? (
          <button
            type="button"
            onClick={onLogin}
            className="flex items-center gap-1 rounded-[6px] bg-[color:var(--accent)] px-2.5 py-1.5 text-[10px] font-semibold text-white transition hover:opacity-90"
          >
            <SignIn size={12} />
            Login
          </button>
        ) : null}

        <button
          type="button"
          onClick={onDelete}
          className="rounded-[6px] p-1.5 text-[color:var(--muted)] opacity-0 transition hover:bg-[color:var(--danger-soft)] hover:text-[color:var(--danger)] group-hover:opacity-100"
        >
          <Trash size={14} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Add Account Dialog                                                 */
/* ------------------------------------------------------------------ */

function AddAccountDialog({
  onAdd,
  onClose,
}: {
  onAdd: (platform: SocialPlatform, accountName: string, displayName: string, requireApproval: boolean) => void;
  onClose: () => void;
}) {
  const [platform, setPlatform] = useState<SocialPlatform>("twitter");
  const [accountName, setAccountName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [requireApproval, setRequireApproval] = useState(true);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-[420px] rounded-[14px] border border-[color:var(--line)] bg-[color:var(--panel)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-[16px] font-bold text-[color:var(--text)]">Add Social Account</h3>
          <button type="button" onClick={onClose} className="rounded-[6px] p-1 text-[color:var(--muted)] hover:bg-[color:var(--panel-soft)]">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Platform selector */}
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-[color:var(--muted-strong)]">Platform</label>
            <div className="grid grid-cols-3 gap-1.5">
              {(Object.entries(platformConfig) as [SocialPlatform, typeof platformConfig.twitter][]).map(([key, config]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPlatform(key)}
                  className={`flex items-center gap-2 rounded-[8px] border px-3 py-2 text-[11px] font-medium transition ${
                    platform === key
                      ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--accent)]"
                      : "border-[color:var(--line)] text-[color:var(--muted)] hover:border-[color:var(--line-strong)]"
                  }`}
                >
                  <span style={{ color: config.color }}>{config.icon}</span>
                  {config.label}
                </button>
              ))}
            </div>
          </div>

          <Input
            label="Username / Handle"
            value={accountName}
            onChange={setAccountName}
            placeholder={platform === "twitter" ? "elonmusk" : "your-username"}
          />

          <Input
            label="Display Name (optional)"
            value={displayName}
            onChange={setDisplayName}
            placeholder="Your display name"
          />

          {/* Approval toggle */}
          <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-3">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={requireApproval}
                onChange={(e) => setRequireApproval(e.target.checked)}
                className="h-4 w-4 rounded border-[color:var(--line)] accent-[color:var(--accent)]"
              />
              <div>
                <div className="text-[12px] font-medium text-[color:var(--text)]">Require Board Approval for Posts</div>
                <div className="mt-0.5 text-[10px] text-[color:var(--muted)]">
                  Agents must get approval before publishing content to this account
                </div>
              </div>
            </label>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] px-4 py-2 text-[12px] font-medium text-[color:var(--muted)] transition hover:bg-[color:var(--panel-soft)]"
          >
            Cancel
          </button>
          <ActionButton
            label="Add Account"
            onClick={() => {
              if (accountName.trim()) {
                onAdd(platform, accountName.trim(), displayName.trim(), requireApproval);
              }
            }}
            icon={Plus}
            tone="accent"
            disabled={!accountName.trim()}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Browser Action History                                             */
/* ------------------------------------------------------------------ */

function ActionHistory({ actions, agents }: { actions: BrowserActionRecord[]; agents: Array<{ id: string; name: string }> }) {
  if (actions.length === 0) {
    return (
      <div className="py-8 text-center text-[13px] text-[color:var(--muted)]">
        No browser actions yet. Agents will create actions when working on social media tasks.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {actions.slice(0, 30).map((action) => {
        const config = actionTypeLabels[action.actionType] ?? actionTypeLabels.custom_script;
        const Icon = config.icon;
        const agent = agents.find((a) => a.id === action.agentId);
        const isSuccess = action.status === "succeeded";
        const isFailed = action.status === "failed";
        const isRunning = action.status === "running";

        return (
          <div
            key={action.id}
            className="flex items-center gap-3 rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-2.5 text-[12px]"
          >
            <Icon size={16} className={
              isSuccess ? "text-[color:var(--success)]"
              : isFailed ? "text-[color:var(--danger)]"
              : isRunning ? "text-[color:var(--accent)]"
              : "text-[color:var(--muted)]"
            } />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-[color:var(--text)]">{config.label}</span>
                {agent ? (
                  <span className="flex items-center gap-1 text-[color:var(--muted)]">
                    <Robot size={10} />
                    {agent.name}
                  </span>
                ) : null}
              </div>
              {action.resultSummary ? (
                <div className="mt-0.5 truncate text-[11px] text-[color:var(--muted)]">{action.resultSummary}</div>
              ) : null}
              {action.errorMessage ? (
                <div className="mt-0.5 truncate text-[11px] text-[color:var(--danger)]">{action.errorMessage}</div>
              ) : null}
            </div>
            <div className="shrink-0 text-[10px] text-[color:var(--muted)]">
              {timeAgo(action.createdAt)}
            </div>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold ${
              isSuccess ? "bg-[color:var(--success-soft)] text-[color:var(--success)]"
              : isFailed ? "bg-[color:var(--danger-soft)] text-[color:var(--danger)]"
              : isRunning ? "bg-[color:var(--accent-soft)] text-[color:var(--accent)]"
              : action.status === "approval_required" ? "bg-[color:var(--warn-soft)] text-[color:var(--warn)]"
              : "bg-[color:var(--panel-soft)] text-[color:var(--muted)]"
            }`}>
              {action.status.replace("_", " ")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Social Accounts Panel                                         */
/* ------------------------------------------------------------------ */

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
  onNavigate: (section: SectionId, entityId?: string) => void;
}

export function SocialAccountsPanel({
  accounts,
  actions,
  agents,
  companyId,
  onSave,
  onDelete,
  onLogin,
  onNavigate,
}: SocialPanelProps) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [activeTab, setActiveTab] = useState<"accounts" | "history">("accounts");

  const handleAdd = useCallback(async (platform: SocialPlatform, accountName: string, displayName: string, requireApproval: boolean) => {
    await onSave({ companyId, platform, accountName, displayName, requireApproval });
    setShowAddDialog(false);
  }, [companyId, onSave]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[color:var(--accent-soft)]">
            <Megaphone size={20} weight="fill" className="text-[color:var(--accent)]" />
          </div>
          <div>
            <h2 className="text-[16px] font-bold text-[color:var(--text)]">Social Media</h2>
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

      {/* Info banner */}
      <div className="rounded-[10px] border border-[color:var(--accent)] border-opacity-20 bg-[color:var(--accent-soft)] px-4 py-3">
        <div className="flex items-start gap-2 text-[12px] text-[color:var(--accent)]">
          <Browser size={16} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">How it works</div>
            <div className="mt-1 text-[11px] opacity-80">
              Add your social media accounts here. Click "Login" to open a browser where you can sign in.
              Your session is saved locally so marketing agents can post content, reply to users, and browse feeds
              using Playwright browser automation. All actions are logged and can require Board approval.
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
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

      {/* Content */}
      {activeTab === "accounts" ? (
        accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-[color:var(--line)] py-16 text-center">
            <Megaphone size={32} className="mb-3 text-[color:var(--muted)]" />
            <div className="text-[14px] font-medium text-[color:var(--muted-strong)]">No social accounts</div>
            <div className="mt-1 text-[12px] text-[color:var(--muted)]">
              Add your first social media account to enable marketing automation
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
                onClick={() => {/* future: account detail view */}}
              />
            ))}
          </div>
        )
      ) : (
        <ActionHistory actions={actions} agents={agents} />
      )}

      {/* Add Account Dialog */}
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
