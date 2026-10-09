/** What one check of the account row says about the sign-in that created `newAccountId`: done, failed for good, or not yet. */
export function judgeSignIn(
  account: { id: string; status: string; pendingAccountId: string | null } | undefined,
  newAccountId: string,
): { outcome: "connected" } | { outcome: "failed"; message: string } | { outcome: "waiting" } {
  if (!account || account.pendingAccountId === newAccountId) return { outcome: "waiting" };
  // A reconnect that never took over leaves the earlier account in place; that is not this sign-in succeeding.
  if (account.id !== newAccountId) return { outcome: "failed", message: "The new sign-in did not complete; the earlier connection is kept." };
  if (account.status === "ACTIVE" && !account.pendingAccountId) return { outcome: "connected" };
  if (account.status === "FAILED" || account.status === "EXPIRED") return { outcome: "failed", message: `The account is ${account.status.toLowerCase()}.` };
  return { outcome: "waiting" };
}
