import { useState } from "react";
import { motion } from "framer-motion";
import { Plus, X } from "@phosphor-icons/react";
import type { SocialPlatform } from "@shared/types";
import { ActionButton, Input } from "../ui";
import { platformConfig } from "./social-config";

interface AddAccountDialogProps {
  onAdd: (platform: SocialPlatform, accountName: string, displayName: string, requireApproval: boolean) => void;
  onClose: () => void;
}

export function AddAccountDialog({ onAdd, onClose }: AddAccountDialogProps) {
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
        className="w-full max-w-[420px] rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-[16px] font-bold text-[color:var(--text)]">Add Social Account</h3>
          <button type="button" onClick={onClose} className="rounded-[6px] p-1 text-[color:var(--muted)] hover:bg-[color:var(--panel-soft)]">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
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
                  <span style={{ color: config.color }}>
                    <config.icon size={14} />
                  </span>
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
