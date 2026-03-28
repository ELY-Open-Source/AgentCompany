import { ShieldCheck, SignIn, Trash } from "@phosphor-icons/react";
import type { SocialAccountRecord } from "@shared/types";
import { timeAgo } from "../../lib/formatters";
import { platformConfig } from "./social-config";

interface AccountCardProps {
  account: SocialAccountRecord;
  onLogin: () => void;
  onDelete: () => void;
  onClick?: () => void;
}

export function AccountCard({ account, onLogin, onDelete, onClick }: AccountCardProps) {
  const platform = platformConfig[account.platform] ?? platformConfig.other;
  const isLoggedIn = account.status === "logged_in" || account.status === "active";
  const PlatformIcon = platform.icon;
  const cardContent = (
    <>
      <div className="flex items-center gap-2">
        <span className="truncate text-[13px] font-bold text-foreground">{account.displayName || account.accountName}</span>
        <span
          className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]"
          style={{ backgroundColor: platform.bgColor, color: platform.color }}
        >
          {platform.label}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">@{account.accountName}</span>
        {account.requireApproval ? (
          <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
            <ShieldCheck size={10} />
            Approval required
          </span>
        ) : null}
        {account.lastUsedAt ? <span>Last used {timeAgo(account.lastUsedAt)}</span> : null}
      </div>
    </>
  );

  return (
    <div className="group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3.5 transition duration-150 hover:border-border hover:shadow-md hover:-translate-y-px">
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: platform.bgColor, color: platform.color }}
      >
        <PlatformIcon size={18} weight="fill" />
      </div>

      {onClick ? (
        <button type="button" onClick={onClick} className="min-w-0 flex-1 text-left">
          {cardContent}
        </button>
      ) : (
        <div className="min-w-0 flex-1 text-left">{cardContent}</div>
      )}

      <div className="flex items-center gap-2">
        <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
          isLoggedIn
            ? "bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400"
            : account.status === "login_required"
              ? "bg-yellow-100 dark:bg-yellow-900/50 text-yellow-600 dark:text-yellow-400"
              : account.status === "suspended"
                ? "bg-red-100 dark:bg-red-900/50 text-destructive"
                : "bg-muted text-muted-foreground"
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${
            isLoggedIn ? "bg-green-600 dark:bg-green-400"
            : account.status === "login_required" ? "bg-yellow-600 dark:bg-yellow-400"
            : account.status === "suspended" ? "bg-destructive"
            : "bg-[color:var(--muted-foreground)]"
          }`} />
          {account.status === "logged_in" ? "Logged In" : account.status === "active" ? "Active" : account.status.replace("_", " ")}
        </span>

        {account.status === "login_required" ? (
          <button
            type="button"
            onClick={onLogin}
            className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-[10px] font-semibold text-primary-foreground transition hover:opacity-90"
          >
            <SignIn size={12} />
            Login
          </button>
        ) : null}

        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete account"
          className="rounded-lg p-1.5 text-muted-foreground opacity-0 transition hover:bg-red-100 dark:bg-red-900/50 hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <Trash size={14} />
        </button>
      </div>
    </div>
  );
}
