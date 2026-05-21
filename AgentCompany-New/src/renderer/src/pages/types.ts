import type { AppSnapshot } from "../../../shared/domain";
import type { SnapshotActions } from "../app/useSnapshot";

export interface PageProps {
  snapshot: AppSnapshot;
  actions: SnapshotActions;
}

export function activeOrgId(snapshot: AppSnapshot): string {
  const id = snapshot.activeOrgId;
  if (!id) throw new Error("Active organization is required.");
  return id;
}

export function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
    .format(cents / 100);
}
