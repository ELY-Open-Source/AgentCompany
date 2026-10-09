import type { ProviderCatalogEntry } from "../../../../shared/domain";

export function composeSecret(entry: ProviderCatalogEntry, form: FormData): string {
  const raw = String(form.get("secret") ?? "").trim();
  if (entry.authType !== "cloud") return raw;
  const payload = {
    baseUrl: String(form.get("cloudBaseUrl") ?? "").trim(),
    region: String(form.get("cloudRegion") ?? "").trim(),
    projectId: String(form.get("cloudProject") ?? "").trim(),
    deployment: String(form.get("cloudDeployment") ?? "").trim(),
    secret: raw,
    ...(raw === "" && form.get("keepSavedSecret") === "1" ? { keepSavedSecret: true } : {}),
  };
  return JSON.stringify(payload);
}
