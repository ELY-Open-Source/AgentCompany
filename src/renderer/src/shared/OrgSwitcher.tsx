import { useEffect, useRef, useState } from "react";
import type { AppSnapshot, OrganizationRecord } from "../../../shared/domain";
import { Icon } from "./Icon";
import { CascadeMenu, CascadeRow } from "./CascadeMenu";
import { t } from "../i18n/i18n";

function orgInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

interface OrgSwitcherProps {
  snapshot: AppSnapshot;
  activeOrgId: string;
  onSelect: (orgId: string) => void;
  onNew: () => void;
  onDelete: (orgId: string) => void;
}

export function OrgSwitcher({ snapshot, activeOrgId, onSelect, onNew, onDelete }: OrgSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const active = snapshot.organizations.find((org) => org.id === activeOrgId);
  if (!active) throw new Error("Active organization missing from snapshot.");

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setConfirmingDelete(null);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const orgs = snapshot.organizations;
  const confirmingOrg = confirmingDelete ? orgs.find((org) => org.id === confirmingDelete) ?? null : null;

  const handleSelect = (orgId: string) => {
    setOpen(false);
    setConfirmingDelete(null);
    if (orgId !== activeOrgId) onSelect(orgId);
  };

  const handleDelete = (orgId: string) => {
    setOpen(false);
    setConfirmingDelete(null);
    onDelete(orgId);
  };

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        className="sidebar-org"
        aria-label={t("{name} — switch organization", { name: active.name })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="brand-mark">{orgInitial(active.name)}</span>
        <span className="brand-name">{active.name}</span>
        <Icon name="chevronDown" size={14} color="var(--text-3)" />
      </button>
      {open && (confirmingOrg ? (
        <div role="menu" className="org-menu">
          <div className="org-menu-confirm">
            <div className="org-menu-confirm-title">{t("Delete “{name}”?", { name: confirmingOrg.name })}</div>
            <div className="org-menu-confirm-hint">{t("All agents, work, chats, and files are permanently removed.")}</div>
            <div className="org-menu-confirm-actions">
              <button type="button" className="org-menu-confirm-no" onClick={() => setConfirmingDelete(null)}>{t("Cancel")}</button>
              <button type="button" className="org-menu-confirm-yes" onClick={() => handleDelete(confirmingOrg.id)}>{t("Delete")}</button>
            </div>
          </div>
        </div>
      ) : (
        <CascadeMenu className="org-menu">
          <div className="org-menu-section-label">{t("Organizations")}</div>
          {orgs.map((org) => (
            <CascadeRow
              key={org.id}
              id={org.id}
              submenu={(close) => (
                <OrgActions
                  org={org}
                  isActive={org.id === activeOrgId}
                  onSwitch={() => { close(); handleSelect(org.id); }}
                  onDelete={() => { close(); setConfirmingDelete(org.id); }}
                />
              )}
            >
              <button
                type="button"
                role="menuitem"
                className={`org-menu-row ${org.id === activeOrgId ? "active" : ""}`.trim()}
                onClick={() => handleSelect(org.id)}
              >
                <span className="brand-mark sm">{orgInitial(org.name)}</span>
                <span className="org-menu-name">{org.name}</span>
                {org.id === activeOrgId && <Icon name="check" size={14} color="var(--text-1)" />}
                <span className="org-menu-chevron"><Icon name="chevron" size={14} /></span>
              </button>
            </CascadeRow>
          ))}
          <div className="org-menu-divider" />
          <button
            type="button"
            role="menuitem"
            className="org-menu-action"
            onClick={() => { setOpen(false); setConfirmingDelete(null); onNew(); }}
          >
            <span className="icon-box" style={{ width: 18, height: 18 }}><Icon name="plus" size={16} color="var(--text-2)" /></span>
            <span>{t("New organization")}</span>
          </button>
        </CascadeMenu>
      ))}
    </div>
  );
}

function OrgActions({
  org,
  isActive,
  onSwitch,
  onDelete,
}: {
  org: OrganizationRecord;
  isActive: boolean;
  onSwitch: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <div className="org-menu-section-label">{org.name}</div>
      {!isActive && (
        <button type="button" role="menuitem" className="org-menu-action" onClick={onSwitch}>
          <span className="icon-box" style={{ width: 18, height: 18 }}><Icon name="arrowRight" size={16} color="var(--text-2)" /></span>
          <span>{t("Switch to this org")}</span>
        </button>
      )}
      <button type="button" role="menuitem" className="org-menu-action danger" onClick={onDelete}>
        <span className="icon-box" style={{ width: 18, height: 18 }}><Icon name="x" size={16} color="var(--red)" /></span>
        <span>{t("Delete organization")}</span>
      </button>
    </>
  );
}
