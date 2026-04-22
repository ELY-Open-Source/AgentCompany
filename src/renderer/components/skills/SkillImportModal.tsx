import { useState, useCallback } from "react";
import {
  FolderSimple,
  GithubLogo,
  Globe,
  Link,
} from "../ui/icons";
import { Modal, ActionButton, Input } from "../ui";
import { useAppStore } from "../../state/store";
import { useT } from "../../i18n";
import { describeDesktopError, formatDesktopResultError } from "../../lib/desktop";

type TabId = "github" | "local" | "url" | "skills_sh";

function isValidGithubSource(value: string): boolean {
  return /^(https:\/\/github\.com\/[\w.-]+\/[\w.-]+|[\w.-]+\/[\w.-]+)/.test(value.trim());
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function SkillImportModal({
  open,
  onClose,
  companyId,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  onImported: () => void;
}) {
  const t = useT();
  const tabs: { id: TabId; label: string; icon: typeof GithubLogo }[] = [
    { id: "github", label: t("skillImport.tabGithub"), icon: GithubLogo },
    { id: "local", label: t("skillImport.tabLocal"), icon: FolderSimple },
    { id: "url", label: t("skillImport.tabUrl"), icon: Link },
    { id: "skills_sh", label: t("skillImport.tabSkillsSh"), icon: Globe },
  ];
  const addToast = useAppStore((s) => s.addToast);
  const [activeTab, setActiveTab] = useState<TabId>("github");
  const [source, setSource] = useState("");
  const [isImporting, setIsImporting] = useState(false);

  const resetForm = useCallback(() => {
    setSource("");
    setActiveTab("github");
    setIsImporting(false);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const handleBrowse = useCallback(async () => {
    const result = await window.agentCompany.pickDirectory();
    if (result.ok && result.data) {
      setSource(result.data);
    }
  }, []);

  const canImport = (() => {
    const trimmed = source.trim();
    if (!trimmed) return false;
    switch (activeTab) {
      case "github":
        return isValidGithubSource(trimmed);
      case "url":
        return isValidUrl(trimmed);
      case "local":
        return trimmed.length > 0;
      case "skills_sh":
        return trimmed.length > 0;
      default:
        return false;
    }
  })();

  const handleImport = useCallback(async () => {
    const trimmed = source.trim();
    if (!trimmed) return;

    setIsImporting(true);
    try {
      const result = await window.agentCompany.importSkill(companyId, trimmed);
      if (result.ok) {
        const count = result.data.length;
        addToast(t("skillImport.imported").replace("{n}", String(count)));
        onImported();
        handleClose();
      } else {
        addToast(formatDesktopResultError(result.error), "danger");
      }
    } catch (error) {
      addToast(describeDesktopError(error), "danger");
    } finally {
      setIsImporting(false);
    }
  }, [source, companyId, addToast, onImported, handleClose, t]);

  const placeholder: Record<TabId, string> = {
    github: t("skillImport.placeholderGithub"),
    local: t("skillImport.placeholderLocal"),
    url: t("skillImport.placeholderUrl"),
    skills_sh: t("skillImport.placeholderSkillsSh"),
  };

  return (
    <Modal open={open} title={t("skillImport.title")} onClose={handleClose} width="560px">
      <div className="space-y-5">
        {/* Tab bar */}
        <div className="flex gap-1 border-b border-border">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium transition-colors ${
                  isActive
                    ? "border-b-2 border-[color:var(--primary)] text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => {
                  setActiveTab(tab.id);
                  setSource("");
                }}
              >
                <Icon size={14} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="space-y-3">
          {activeTab === "local" ? (
            <div className="flex gap-2">
              <div className="flex-1">
                <Input value={source} onChange={setSource} placeholder={placeholder.local} />
              </div>
              <ActionButton label={t("skillImport.browse")} onClick={() => void handleBrowse()} />
            </div>
          ) : (
            <Input value={source} onChange={setSource} placeholder={placeholder[activeTab]} />
          )}

          {activeTab === "skills_sh" && (
            <p className="text-[12px] text-muted-foreground">
              {t("skillImport.skillsShHelp")}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <ActionButton label={t("skillImport.cancel")} onClick={handleClose} />
          <ActionButton
            label={t("skillImport.import")}
            tone="accent"
            onClick={() => void handleImport()}
            loading={isImporting}
            disabled={!canImport}
          />
        </div>
      </div>
    </Modal>
  );
}
