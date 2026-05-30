import { useEffect, useRef, useState } from "react";
import type { AppSnapshot, OrganizationRecord } from "../../../shared/domain";
import { Icon } from "./Icon";

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

  const initial = orgInitial(active.name);
  const orgs = snapshot.organizations;

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
        aria-label={`${active.name} — switch organization`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="brand-mark">{initial}</span>
        <span className="brand-name">{active.name}</span>
        <Icon name="chevronDown" size={12} color="var(--text-3)" />
      </button>
      {open && (
        <div role="menu" className="org-menu">
          <div className="org-menu-section-label">Organizations</div>
          {orgs.map((org) => (
            <OrgRow
              key={org.id}
              org={org}
              active={org.id === activeOrgId}
              onSelect={() => handleSelect(org.id)}
              confirming={confirmingDelete === org.id}
              onAskDelete={() => setConfirmingDelete(org.id)}
              onCancelDelete={() => setConfirmingDelete(null)}
              onConfirmDelete={() => handleDelete(org.id)}
            />
          ))}
          <div className="org-menu-divider" />
          <button
            type="button"
            role="menuitem"
            className="org-menu-action"
            onClick={() => {
              setOpen(false);
              setConfirmingDelete(null);
              onNew();
            }}
          >
            <Icon name="plus" size={13} color="var(--text-2)" />
            <span>New organization</span>
          </button>
        </div>
      )}
    </div>
  );
}

function OrgRow({
  org,
  active,
  onSelect,
  confirming,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  org: OrganizationRecord;
  active: boolean;
  onSelect: () => void;
  confirming: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const initial = orgInitial(org.name);
  if (confirming) {
    return (
      <div className="org-menu-confirm">
        <div className="org-menu-confirm-title">Delete “{org.name}”?</div>
        <div className="org-menu-confirm-hint">All agents, work, chats, and files are permanently removed.</div>
        <div className="org-menu-confirm-actions">
          <button type="button" className="org-menu-confirm-no" onClick={onCancelDelete}>Cancel</button>
          <button type="button" className="org-menu-confirm-yes" onClick={onConfirmDelete}>Delete</button>
        </div>
      </div>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      className={`org-menu-row ${active ? "active" : ""}`.trim()}
      onClick={onSelect}
    >
      <span className="brand-mark sm">{initial}</span>
      <span className="org-menu-name">{org.name}</span>
      {active && <Icon name="check" size={12} color="var(--text-1)" />}
      <span
        role="button"
        aria-label={`Delete ${org.name}`}
        className="org-menu-delete"
        onClick={(event) => {
          event.stopPropagation();
          onAskDelete();
        }}
      >
        <Icon name="x" size={12} color="var(--text-3)" />
      </span>
    </button>
  );
}
