import { useState } from "react";
import { motion } from "framer-motion";
import { SignIn, X } from "@phosphor-icons/react";
import type { SocialPlatform } from "@shared/types";
import { ActionButton } from "../ui";
import { platformConfig } from "./social-config";

interface AddAccountDialogProps {
  onAddAndLogin: (platform: SocialPlatform, requireApproval: boolean) => void;
  onClose: () => void;
}

export function AddAccountDialog({ onAddAndLogin, onClose }: AddAccountDialogProps) {
  const [platform, setPlatform] = useState<SocialPlatform>("twitter");
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
        className="w-full max-w-[420px] rounded-lg border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-[16px] font-bold text-foreground">Add Social Account</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-muted">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Platform</label>
            <div className="max-h-[240px] overflow-y-auto rounded-lg border border-border p-1.5">
              <div className="grid grid-cols-3 gap-1.5">
                {(Object.entries(platformConfig) as [SocialPlatform, typeof platformConfig.twitter][]).map(([key, config]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPlatform(key)}
                    className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition ${
                      platform === key
                        ? "border-[color:var(--primary)] bg-accent text-primary"
                        : "border-border text-muted-foreground hover:border-border"
                    }`}
                  >
                    <span style={{ color: config.color }}>
                      <config.icon size={14} />
                    </span>
                    <span className="truncate">{config.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted px-4 py-3">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={requireApproval}
                onChange={(e) => setRequireApproval(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-[color:var(--primary)]"
              />
              <div>
                <div className="text-[12px] font-medium text-foreground">Require Board Approval for Posts</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  Agents must get approval before publishing content to this account
                </div>
              </div>
            </label>
          </div>

          <div className="rounded-lg bg-accent px-4 py-3 text-[11px] text-muted-foreground">
            A browser window will open for you to sign in. Your username and profile info will be detected automatically after login.
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-[12px] font-medium text-muted-foreground transition hover:bg-muted"
          >
            Cancel
          </button>
          <ActionButton
            label="Login"
            onClick={() => onAddAndLogin(platform, requireApproval)}
            icon={SignIn}
            tone="accent"
          />
        </div>
      </motion.div>
    </motion.div>
  );
}
