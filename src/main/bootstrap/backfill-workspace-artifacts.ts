import { existsSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { AppDatabase } from "../database";

/**
 * One-shot rescan that surfaces files written by cognitive runs whose
 * artifact projector was suppressed by the pre-`observationPath` bug
 * (regression of T1, fixed in commit 2c12c1a).
 *
 * The post-fix projector observes per-run via mtime baselines. Files
 * that already existed on disk before the projector was repaired never
 * advance their mtime past the new run's baseline, so they remain
 * invisible to subsequent runs — they are real deliverables that the
 * DocumentCenter still does not list. This module walks every company
 * primary workspace once at startup, applies the same registrability
 * filter as `artifact-projector.ts`, and upserts a `work_products` row
 * for each file that is missing one.
 *
 * Idempotent through `findWorkProductByExternalId` — a file that was
 * already projected by some earlier run will short-circuit on lookup
 * and be skipped. Bounded by `MAX_BACKFILL_FILES_PER_WORKSPACE` so a
 * pathological workspace tree cannot lock the bootstrap path.
 *
 * Gated by a one-time settings flag (`artifact_rescan_v1_done`) so a
 * second startup does not re-walk every workspace tree on disk; the
 * projector handles all subsequent file activity.
 */

const SETTINGS_FLAG_KEY = "artifact_rescan_v1_done";
const MAX_BACKFILL_FILES_PER_WORKSPACE = 5_000;
const SKIP_DIR_NAMES: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "out",
  ".cache",
  ".pnpm-store",
]);
const IGNORED_PATH_SEGMENTS: readonly string[] = [
  "/.git/",
  "/node_modules/",
  "/.next/",
  "/dist/",
  "/build/",
  "/out/",
  "/.cache/",
  "/.pnpm-store/",
  "/.DS_Store",
];
const IGNORED_EXACT_NAMES: ReadonlySet<string> = new Set([
  ".DS_Store",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  ".gitignore",
]);
const IGNORED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".lock",
  ".log",
  ".map",
  ".min.js",
  ".min.css",
]);

interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export interface BackfillWorkspaceArtifactsDeps {
  db: AppDatabase;
  logger: Logger;
}

export interface BackfillWorkspaceArtifactsResult {
  /** True when the rescan ran (first launch after the fix). */
  ran: boolean;
  /** Files inspected across every company workspace. */
  filesScanned: number;
  /** Files inserted as work_products (previously missing rows). */
  filesInserted: number;
  /** Files skipped because a row already existed (idempotency). */
  filesAlreadyTracked: number;
  /** Files skipped by the registrability filter. */
  filesIgnored: number;
}

export function backfillWorkspaceArtifacts(
  deps: BackfillWorkspaceArtifactsDeps,
): BackfillWorkspaceArtifactsResult {
  const empty: BackfillWorkspaceArtifactsResult = {
    ran: false,
    filesScanned: 0,
    filesInserted: 0,
    filesAlreadyTracked: 0,
    filesIgnored: 0,
  };
  const flag = deps.db.settings.getSetting(SETTINGS_FLAG_KEY);
  if (flag === "true") return empty;

  let filesScanned = 0;
  let filesInserted = 0;
  let filesAlreadyTracked = 0;
  let filesIgnored = 0;

  const snapshot = deps.db.snap.listSnapshot();
  for (const company of snapshot.companies) {
    const observation = deps.db.workspacesMod.getCompanyObservationWorkspace(company.id);
    if (!observation) continue;
    const workspaceRoot = observation.localPath;
    if (!workspaceRoot || !existsSync(workspaceRoot)) continue;
    let stat;
    try {
      stat = statSync(workspaceRoot);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const stack: string[] = [workspaceRoot];
    let countForThisWorkspace = 0;
    while (stack.length > 0) {
      if (countForThisWorkspace >= MAX_BACKFILL_FILES_PER_WORKSPACE) {
        deps.logger.warn(
          `[backfill-workspace-artifacts] hit per-workspace cap (${MAX_BACKFILL_FILES_PER_WORKSPACE}) for company=${company.id} workspace=${observation.id}; remaining files will be picked up by future runs as they are touched`,
        );
        break;
      }
      const dir = stack.pop();
      if (!dir) break;
      let entries: { name: string; isDirectory: () => boolean; isSymbolicLink: () => boolean }[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const abs = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          if (SKIP_DIR_NAMES.has(entry.name)) continue;
          stack.push(abs);
          continue;
        }
        try {
          const fileStat = statSync(abs);
          if (!fileStat.isFile()) continue;
        } catch {
          continue;
        }
        filesScanned += 1;
        countForThisWorkspace += 1;

        const rel = relative(workspaceRoot, abs);
        if (rel.length === 0) {
          filesIgnored += 1;
          continue;
        }
        const probe = `/${rel}/`;
        if (IGNORED_PATH_SEGMENTS.some((seg) => probe.includes(seg))) {
          filesIgnored += 1;
          continue;
        }
        const lastSlash = rel.lastIndexOf("/");
        const basename = lastSlash >= 0 ? rel.slice(lastSlash + 1) : rel;
        if (IGNORED_EXACT_NAMES.has(basename)) {
          filesIgnored += 1;
          continue;
        }
        const dot = basename.lastIndexOf(".");
        if (dot > 0) {
          const ext = basename.slice(dot).toLowerCase();
          if (IGNORED_EXTENSIONS.has(ext)) {
            filesIgnored += 1;
            continue;
          }
          const prevDot = basename.lastIndexOf(".", dot - 1);
          if (prevDot > 0) {
            const compound = basename.slice(prevDot).toLowerCase();
            if (IGNORED_EXTENSIONS.has(compound)) {
              filesIgnored += 1;
              continue;
            }
          }
        }

        const existing = deps.db.documentsMod.findWorkProductByExternalId(
          company.id,
          "filesystem",
          rel,
          observation.id,
        );
        if (existing) {
          filesAlreadyTracked += 1;
          continue;
        }
        const title = lastSlash >= 0 ? rel.slice(lastSlash + 1) : rel;
        deps.db.documentsMod.createWorkProduct({
          companyId: company.id,
          taskId: null,
          workspaceId: observation.id,
          type: "file",
          provider: "filesystem",
          externalId: rel,
          title,
          url: null,
        });
        filesInserted += 1;
      }
    }
  }

  deps.db.settings.setSetting(SETTINGS_FLAG_KEY, "true");
  deps.logger.info(
    `[backfill-workspace-artifacts] scanned=${filesScanned} inserted=${filesInserted} already-tracked=${filesAlreadyTracked} ignored=${filesIgnored}`,
  );
  return {
    ran: true,
    filesScanned,
    filesInserted,
    filesAlreadyTracked,
    filesIgnored,
  };
}
