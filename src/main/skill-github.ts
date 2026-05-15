import { readResponseBytesWithLimit, readResponseWithLimit } from "./skills/read-response-with-limit.js";

export interface GitHubSkillFileData {
  path: string;
  content: Uint8Array;
  mode: string | null;
}

/**
 * Data returned for each skill found in a GitHub repository.
 */
export interface GitHubSkillData {
  skillMdPath: string;
  markdown: string;
  files: GitHubSkillFileData[];
  owner: string;
  repo: string;
}

interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/** 2 MB — generous upper bound for a single SKILL.md (markdown) file. */
export const MAX_SKILL_BYTES = 2 * 1024 * 1024;

/** 8 MB — upper bound for a single non-SKILL.md package file. */
export const MAX_SKILL_FILE_BYTES = 8 * 1024 * 1024;

/** 32 MB — aggregate upper bound for all materialized files from a skill pack. */
export const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

/** 10 MB — upper bound for the recursive git tree JSON response. */
const MAX_TREE_BYTES = 10 * 1024 * 1024;

interface GitHubTreeEntry {
  path: string;
  type: string;
  mode?: string;
}

function encodeGitHubBlobPath(filePath: string): string {
  if (filePath.includes("\0") || filePath.includes("\\") || filePath.startsWith("/") || /^[A-Za-z]:/.test(filePath)) {
    throw new Error(`Invalid GitHub skill file path: ${filePath}`);
  }
  const parts = filePath.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new Error(`Invalid GitHub skill file path: ${filePath}`);
  }
  return parts.map((part) => encodeURIComponent(part)).join("/");
}

function rawGitHubUrl(owner: string, repo: string, ref: string, filePath: string): string {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${encodeGitHubBlobPath(filePath)}`;
}

function assertTotalSkillBytes(totalBytes: number): void {
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new Error(
      `Skill pack exceeded aggregate limit of ${MAX_TOTAL_BYTES} bytes`,
    );
  }
}

/**
 * Resolve the latest commit SHA for a given ref (branch, tag, or HEAD).
 * Returns the 40-character hex SHA on success, null on error.
 */
export async function resolveGitHubCommitSha(
  owner: string,
  repo: string,
  ref?: string,
  logger?: Logger,
): Promise<string | null> {
  const target = ref || "HEAD";
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(target)}`;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/vnd.github.sha" },
    });
    if (!response.ok) {
      if (response.status === 403) {
        const resetHeader = response.headers.get("X-RateLimit-Reset");
        logger?.warn(
          `GitHub API rate limit hit for ${owner}/${repo}`,
          resetHeader ? `resets at ${new Date(Number(resetHeader) * 1000).toISOString()}` : "",
        );
      } else {
        logger?.warn(`GitHub commit resolve failed: ${response.status} for ${owner}/${repo}@${target}`);
      }
      return null;
    }
    const sha = (await readResponseWithLimit(response, MAX_SKILL_BYTES)).trim();
    return /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
  } catch (err) {
    logger?.error("GitHub commit resolve network error:", err);
    return null;
  }
}

/**
 * Fetch all SKILL.md files from a GitHub repository via the REST API.
 *
 * 1. GET the recursive git tree to find all SKILL.md paths
 * 2. Optionally filter to a specific skill slug directory
 * 3. Download each SKILL.md via raw.githubusercontent.com
 * 4. Collect sibling files as file inventory
 */
export async function fetchGitHubSkills(
  owner: string,
  repo: string,
  ref: string,
  requestedSlug: string | null,
  logger?: Logger,
): Promise<{ skills: GitHubSkillData[]; commitSha: string }> {
  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
  try {
    const treeResponse = await fetch(treeUrl, {
      headers: { Accept: "application/json" },
    });
    if (!treeResponse.ok) {
      logger?.warn(`GitHub tree fetch failed: ${treeResponse.status} for ${owner}/${repo}@${ref}`);
      return { skills: [], commitSha: ref };
    }
    const treeData = JSON.parse(await readResponseWithLimit(treeResponse, MAX_TREE_BYTES)) as {
      tree?: GitHubTreeEntry[];
      sha?: string;
    };
    const treeSha = typeof treeData.sha === "string" ? treeData.sha : ref;
    const allEntries = (treeData.tree ?? []).filter(
      (entry) => entry.type === "blob" && typeof entry.path === "string",
    );
    const allPaths = allEntries.map((entry) => entry.path);

    // Find SKILL.md files (at root or nested)
    let skillMdPaths = allPaths.filter(
      (p) => p.endsWith("/SKILL.md") || p === "SKILL.md",
    );

    // Filter to requested slug directory if provided
    if (requestedSlug) {
      skillMdPaths = skillMdPaths.filter((p) => {
        const dir = p === "SKILL.md" ? "" : p.slice(0, p.lastIndexOf("/"));
        const dirName = dir.split("/").pop() ?? "";
        return dirName.toLowerCase() === requestedSlug.toLowerCase();
      });
    }

    if (skillMdPaths.length === 0) {
      logger?.info(`No SKILL.md files found in ${owner}/${repo}@${ref}`);
      return { skills: [], commitSha: treeSha };
    }

    const skills: GitHubSkillData[] = [];
    let totalBytes = 0;

    for (const skillMdPath of skillMdPaths) {
      try {
        let skillBytes = 0;
        // Download content via raw.githubusercontent.com (no API rate limit)
        const rawUrl = rawGitHubUrl(owner, repo, ref, skillMdPath);
        const contentResponse = await fetch(rawUrl);
        if (!contentResponse.ok) {
          logger?.warn(`Failed to download ${rawUrl}: ${contentResponse.status}`);
          continue;
        }
        const remainingBudget = MAX_TOTAL_BYTES - totalBytes - skillBytes;
        const perFileCap = Math.min(MAX_SKILL_BYTES, Math.max(0, remainingBudget));
        if (perFileCap === 0) {
          throw new Error(
            `Skill pack exceeded aggregate limit of ${MAX_TOTAL_BYTES} bytes`,
          );
        }
        const markdown = await readResponseWithLimit(contentResponse, perFileCap);
        skillBytes += Buffer.byteLength(markdown, "utf-8");
        assertTotalSkillBytes(totalBytes + skillBytes);

        // Collect sibling files in the same directory (or subdirectories)
        const skillDir =
          skillMdPath === "SKILL.md"
            ? ""
            : skillMdPath.slice(0, skillMdPath.lastIndexOf("/"));
        const prefix = skillDir ? `${skillDir}/` : "";
        const inventoryEntries = allEntries.filter(
          (entry) => entry.path !== skillMdPath && (prefix ? entry.path.startsWith(prefix) : !entry.path.includes("/")),
        );
        const files: GitHubSkillFileData[] = [];

        for (const entry of inventoryEntries) {
          const fileRemainingBudget = MAX_TOTAL_BYTES - totalBytes - skillBytes;
          const fileCap = Math.min(MAX_SKILL_FILE_BYTES, Math.max(0, fileRemainingBudget));
          if (fileCap === 0) {
            throw new Error(
              `Skill pack exceeded aggregate limit of ${MAX_TOTAL_BYTES} bytes`,
            );
          }
          const fileUrl = rawGitHubUrl(owner, repo, ref, entry.path);
          const fileResponse = await fetch(fileUrl);
          if (!fileResponse.ok) {
            throw new Error(`Failed to download ${fileUrl}: ${fileResponse.status}`);
          }
          const content = await readResponseBytesWithLimit(fileResponse, fileCap);
          skillBytes += content.byteLength;
          assertTotalSkillBytes(totalBytes + skillBytes);
          files.push({
            path: entry.path,
            content,
            mode: entry.mode ?? null,
          });
        }

        skills.push({
          skillMdPath,
          markdown,
          files,
          owner,
            repo,
        });
        totalBytes += skillBytes;
      } catch (err) {
        logger?.error(`Error downloading skill ${skillMdPath}:`, err);
        continue;
      }
    }

    return { skills, commitSha: treeSha };
  } catch (err) {
    logger?.error(`GitHub tree fetch network error for ${owner}/${repo}:`, err);
    return { skills: [], commitSha: ref };
  }
}
