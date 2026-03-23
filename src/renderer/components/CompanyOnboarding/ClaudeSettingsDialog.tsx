import { X } from "@phosphor-icons/react";
import type { AppLocale } from "@shared/locale";

interface ClaudeSettingsDialogProps {
  claudeApiKey: string;
  setClaudeApiKey: (v: string) => void;
  claudeBaseUrl: string;
  setClaudeBaseUrl: (v: string) => void;
  claudeModel: string;
  setClaudeModel: (v: string) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
  currentLocale: AppLocale;
}

export function ClaudeSettingsDialog({
  claudeApiKey,
  setClaudeApiKey,
  claudeBaseUrl,
  setClaudeBaseUrl,
  claudeModel,
  setClaudeModel,
  onSave,
  onClose,
  saving,
  currentLocale,
}: ClaudeSettingsDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color:var(--bg)]/72 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-[420px] rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-[16px] font-semibold text-[color:var(--text)]">Claude Code {currentLocale === "zh" ? "设置" : "Settings"}</h3>
          <button type="button" onClick={onClose} className="rounded-[6px] p-1 text-[color:var(--muted)] transition hover:text-[color:var(--text)]"><X size={16} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-strong)]">API Key</label>
            <input
              type="password"
              className="focus-ring w-full rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-2.5 text-[13px] text-[color:var(--text)] placeholder:text-[color:var(--muted)]"
              value={claudeApiKey}
              onChange={(e) => setClaudeApiKey(e.target.value)}
              placeholder="sk-ant-..."
            />
            <div className="mt-1 text-[11px] text-[color:var(--muted)]">{currentLocale === "zh" ? "留空使用订阅认证" : "Leave empty to use subscription auth"}</div>
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-strong)]">Base URL</label>
            <input
              className="focus-ring w-full rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-2.5 text-[13px] text-[color:var(--text)] placeholder:text-[color:var(--muted)]"
              value={claudeBaseUrl}
              onChange={(e) => setClaudeBaseUrl(e.target.value)}
              placeholder="https://api.anthropic.com"
            />
            <div className="mt-1 text-[11px] text-[color:var(--muted)]">{currentLocale === "zh" ? "留空使用默认端点" : "Leave empty for default endpoint"}</div>
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-strong)]">Model</label>
            <input
              className="focus-ring w-full rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-2.5 text-[13px] text-[color:var(--text)] placeholder:text-[color:var(--muted)]"
              value={claudeModel}
              onChange={(e) => setClaudeModel(e.target.value)}
              placeholder="claude-sonnet-4-20250514"
            />
            <div className="mt-1 text-[11px] text-[color:var(--muted)]">{currentLocale === "zh" ? "留空使用连接器默认模型" : "Leave empty for connector default"}</div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-[8px] px-4 py-2 text-[13px] font-medium text-[color:var(--muted)] transition hover:text-[color:var(--text)]">
            {currentLocale === "zh" ? "取消" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-[8px] bg-[color:var(--accent)] px-4 py-2 text-[13px] font-medium text-[color:var(--text-on-accent)] transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? (currentLocale === "zh" ? "保存中..." : "Saving...") : (currentLocale === "zh" ? "保存" : "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}
