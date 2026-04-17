import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

export async function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const content = await readFile(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key]) continue;
    const rawValue = line.slice(separatorIndex + 1).trim();
    if (!rawValue) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}
