/**
 * Data returned for each skill found in a GitHub repository.
 */
export interface GitHubSkillData {
  skillMdPath: string;
  markdown: string;
  inventory: string[];
  owner: string;
  repo: string;
}

interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
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
    const sha = (await response.text()).trim();
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
    const treeData = (await treeResponse.json()) as {
      tree?: Array<{ path: string; type: string }>;
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

    for (const skillMdPath of skillMdPaths) {
      try {
        // Download content via raw.githubusercontent.com (no API rate limit)
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${skillMdPath}`;
        const contentResponse = await fetch(rawUrl);
        if (!contentResponse.ok) {
          logger?.warn(`Failed to download ${rawUrl}: ${contentResponse.status}`);
          continue;
        }
        const markdown = await contentResponse.text();

        // Collect sibling files in the same directory (or subdirectories)
        const skillDir =
          skillMdPath === "SKILL.md"
            ? ""
            : skillMdPath.slice(0, skillMdPath.lastIndexOf("/"));
        const prefix = skillDir ? `${skillDir}/` : "";
        const inventory = allPaths.filter(
          (p) => p !== skillMdPath && (prefix ? p.startsWith(prefix) : !p.includes("/")),
        );

        skills.push({
          skillMdPath,
          markdown,
          inventory,
          owner,
          repo,
        });
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
