import { useState } from "react";
import { SignIn } from "../ui/icons";
import type { SocialPlatform } from "@shared/types";
import { ActionButton, Modal } from "../ui";
import { useT } from "../../i18n";
import { platformConfig } from "./social-config";

interface AddAccountDialogProps {
  onAddAndLogin: (platform: SocialPlatform, requireApproval: boolean) => void;
  onClose: () => void;
}

export function AddAccountDialog({ onAddAndLogin, onClose }: AddAccountDialogProps) {
  const t = useT();
  const [platform, setPlatform] = useState<SocialPlatform>("twitter");
  const [requireApproval, setRequireApproval] = useState(true);

  return (
    <Modal open onClose={onClose} title={t("social.addAccountTitle")} width="420px">
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">{t("social.platformLabel")}</label>
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
              <div className="text-[12px] font-medium text-foreground">{t("social.requireApprovalTitle")}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {t("social.requireApprovalBody")}
              </div>
            </div>
          </label>
        </div>

        <div className="rounded-lg bg-accent px-4 py-3 text-[11px] text-muted-foreground">
          {t("social.signInHint")}
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <ActionButton label={t("social.cancel")} onClick={onClose} />
        <ActionButton
          label={t("social.loginButton")}
          onClick={() => onAddAndLogin(platform, requireApproval)}
          icon={SignIn}
          tone="accent"
        />
      </div>
    </Modal>
  );
}
