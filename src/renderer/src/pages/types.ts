import type {
  AppSnapshot,
  EmployeeRecord,
  OrganizationRecord,
} from "../../../shared/domain";
import type { SnapshotActions } from "../app/useSnapshot";
import type { RouteId } from "../shared/Shell";
import { t } from "../i18n/i18n";

/** One object a page should open when navigated to: a task, run, approval, workspace, or the goal or project to scope work by. */
export interface Focus {
  kind: "task" | "run" | "approval" | "goal" | "project" | "workspace";
  id: string;
}

export interface PageProps {
  snapshot: AppSnapshot;
  actions: SnapshotActions;
  navigate: (route: RouteId, focus?: Focus) => void;
  /** What the page was opened for; pages remount per navigation, so they read it once. */
  focus: Focus | null;
}

export function activeOrgId(snapshot: AppSnapshot): string {
  const id = snapshot.activeOrgId;
  if (!id) throw new Error("Active organization is required.");
  return id;
}

export function requireActiveOrganization(snapshot: AppSnapshot): OrganizationRecord {
  const orgId = activeOrgId(snapshot);
  const organization = snapshot.organizations.find((item) => item.id === orgId);
  if (!organization) throw new Error("Active organization is missing.");
  return organization;
}

export function requireActiveEmployee(snapshot: AppSnapshot): EmployeeRecord {
  const orgId = activeOrgId(snapshot);
  const employee = snapshot.employees.find((item) => item.orgId === orgId);
  if (!employee) throw new Error("Active employee is missing.");
  return employee;
}

export function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}


export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function formatRelative(iso: string, reference: Date = new Date()): string {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return "—";
  const diff = reference.getTime() - target;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return t("just now");
  if (minutes < 60) return t("{n}m ago", { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("{n}h ago", { n: hours });
  const days = Math.round(hours / 24);
  if (days < 7) return t("{n}d ago", { n: days });
  const weeks = Math.round(days / 7);
  if (weeks < 5) return t("{n}w ago", { n: weeks });
  return new Date(iso).toLocaleDateString();
}

/** The active org's period statistics; the snapshot carries one entry per org. */
export function requireUsageStats(stats: AppSnapshot["usageStats"], orgId: string): AppSnapshot["usageStats"][number] {
  const found = stats.find((item) => item.orgId === orgId);
  if (!found) throw new Error(`No usage statistics for organization ${orgId}.`);
  return found;
}
