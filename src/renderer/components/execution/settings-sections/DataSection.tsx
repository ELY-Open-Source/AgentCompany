import { useState } from "react";
import { ArrowClockwise, ClockCounterClockwise, Download } from "../../ui/icons";
import type { ProfileSnapshot } from "@shared/types";
import { ActionButton, Eyebrow, InlineNotice } from "../../ui";
import { useT } from "../../../i18n";
import { unwrap } from "../../../lib/desktop";
import { describeActionError } from "../execution-utils";
import { useAppStore } from "../../../state/store";

interface DataSectionProps {
  snapshot: ProfileSnapshot;
  onSaved: () => Promise<void>;
}

/**
 * Data & release operations — profile backup/restore, update check,
 * secret backend info. These are the high-blast-radius actions:
 * Restore replaces the active profile on disk, so it is visually
 * separated from Backup and the ephemeral update check. No single
 * "Save" button — granular auto-save happens in GeneralSection.
 */
export function DataSection({ snapshot, onSaved }: DataSectionProps) {
  const t = useT();
  const addToast = useAppStore((s) => s.addToast);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<"check" | "backup" | "restore" | null>(null);

  const clearBanners = () => {
    setNotice(null);
    setError(null);
  };

  const handleCheckForUpdates = async () => {
    clearBanners();
    setLoading("check");
    try {
      const started = unwrap(await window.agentCompany.checkForUpdates());
      setNotice(started ? t("settings.updateCheckStarted") : t("settings.updateCheckSkipped"));
    } catch (err) {
      setError(describeActionError(err));
    } finally {
      setLoading(null);
    }
  };

  const handleBackup = async () => {
    clearBanners();
    setLoading("backup");
    try {
      const backupPath = unwrap(await window.agentCompany.backupProfile());
      if (backupPath) {
        setNotice(t("settings.profileBackupAt").replace("{path}", backupPath));
        addToast(t("settings.profileBackupCreated"), "success");
      }
    } catch (err) {
      setError(describeActionError(err));
    } finally {
      setLoading(null);
    }
  };

  const handleRestore = async () => {
    clearBanners();
    if (!window.confirm(t("settings.restoreConfirm"))) return;
    setLoading("restore");
    try {
      const restored = unwrap(await window.agentCompany.restoreProfile());
      if (!restored) return;
      await onSaved();
      setNotice(t("settings.profileRestored"));
      addToast(t("settings.profileRestored"), "success");
    } catch (err) {
      setError(describeActionError(err));
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      {error ? <InlineNotice message={error} /> : null}
      {!error && notice ? <InlineNotice message={notice} tone="success" /> : null}

      <div>
        <Eyebrow className="mb-3">{t("settings.updates")}</Eyebrow>
        <ActionButton
          label={t("exec.checkForUpdates")}
          icon={Download}
          onClick={() => void handleCheckForUpdates()}
          loading={loading === "check"}
        />
      </div>

      <div>
        <Eyebrow className="mb-3">{t("settings.backupRestore")}</Eyebrow>
        <div className="grid gap-3 md:grid-cols-2">
          <ActionButton
            label={t("exec.backupProfile")}
            icon={ClockCounterClockwise}
            onClick={() => void handleBackup()}
            loading={loading === "backup"}
          />
          <ActionButton
            label={t("exec.restoreProfile")}
            tone="danger"
            icon={ArrowClockwise}
            onClick={() => void handleRestore()}
            loading={loading === "restore"}
          />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">{t("settings.restoreHint")}</p>
      </div>

      <div>
        <Eyebrow className="mb-3">{t("exec.profile")}</Eyebrow>
        <div className="space-y-2">
          <ReadOnlyRow label={t("exec.profilePath")} value={snapshot.profilePath} mono />
          <ReadOnlyRow label={t("exec.secretBackend")} value={snapshot.backend.secretBackend} />
        </div>
      </div>
    </div>
  );
}

function ReadOnlyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-[12px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={`truncate text-foreground ${mono ? "font-mono text-[11px]" : ""}`}>{value}</span>
    </div>
  );
}
