import { useCallback, useEffect, useState } from "react";
import {
  ArrowsClockwise,
  FolderSimple,
  GithubLogo,
  Globe,
  Link,
  PuzzlePiece,
  Trash,
} from "../ui/icons";
import type { AgentRecord, SkillRecord, SkillUpdateStatus } from "@shared/types";
import { useAppStore } from "../../state/store";
import { ActionButton, StatusPill, Eyebrow } from "../ui";
import { SkillAgentToggles } from "./SkillAgentToggles";
import { buildTree, SkillFileTree } from "./SkillFileTree";
import { useT, type TranslationFn } from "../../i18n";
import { formatDesktopResultError } from "../../lib/desktop";

const sourceIconMap: Record<string, typeof GithubLogo> = {
  github: GithubLogo,
  local_path: FolderSimple,
  url: Link,
  skills_sh: Globe,
  managed: PuzzlePiece,
};

function sourceLabel(kind: string, t: TranslationFn): string {
  switch (kind) {
    case "github":
      return t("skill.source.github");
    case "local_path":
      return t("skill.source.localPath");
    case "url":
      return t("skill.source.url");
    case "skills_sh":
      return t("skill.source.skillsSh");
    case "managed":
      return t("skill.source.managed");
    default:
      return kind;
  }
}

const trustToneMap: Record<string, string> = {
  markdown_only: "ready",
  assets: "pending",
  scripts_executables: "error",
};

function trustLabel(level: string, t: TranslationFn): string {
  switch (level) {
    case "markdown_only":
      return t("skill.trust.markdownOnly");
    case "assets":
      return t("skill.trust.assets");
    case "scripts_executables":
      return t("skill.trust.scripts");
    default:
      return level;
  }
}

function stripFrontmatter(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return normalized.trim();
  const closing = normalized.indexOf("\n---\n", 4);
  if (closing < 0) return normalized.trim();
  return normalized.slice(closing + 5).trim();
}

function shortRef(ref: string | null | undefined, t: TranslationFn): string {
  if (!ref) return t("skill.untracked");
  return ref.length > 7 ? ref.slice(0, 7) : ref;
}

export function SkillDetail({
  companyId,
  skillId,
  agents,
  onDeleted,
  onRefresh: _onRefresh,
}: {
  companyId: string;
  skillId: string;
  agents: AgentRecord[];
  onDeleted: () => void;
  onRefresh: () => void;
}) {
  const t = useT();
  const addToast = useAppStore((s) => s.addToast);
  const selectedSkillFilePath = useAppStore((s) => s.selectedSkillFilePath);
  const setSelectedSkillFilePath = useAppStore((s) => s.setSelectedSkillFilePath);

  const [detail, setDetail] = useState<SkillRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [updateStatus, setUpdateStatus] = useState<SkillUpdateStatus | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [skillMarkdown, setSkillMarkdown] = useState<string | null>(null);
  const [markdownError, setMarkdownError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDetail(null);
    setUpdateStatus(null);
    setSelectedSkillFilePath("SKILL.md");
    setExpandedDirs(new Set());

    async function load() {
      const result = await window.agentCompany.getSkillDetail(companyId, skillId);
      if (cancelled) return;
      setLoading(false);
      if (result.ok) {
        setDetail(result.data);
      } else {
        addToast(formatDesktopResultError(result.error), "danger");
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [companyId, skillId, addToast, setSelectedSkillFilePath]);

  useEffect(() => {
    if (!detail) return;
    let cancelled = false;
    setSkillMarkdown(null);
    setMarkdownError(null);
    async function load(companyIdArg: string, slugArg: string) {
      const result = await window.agentCompany.getSkillMarkdown(companyIdArg, slugArg);
      if (cancelled) return;
      if (result.ok) {
        setSkillMarkdown(result.data);
      } else {
        setMarkdownError(result.error.message);
      }
    }
    void load(detail.companyId, detail.slug);
    return () => { cancelled = true; };
  }, [detail]);

  const handleCheckUpdate = useCallback(async () => {
    if (!detail) return;
    setCheckingUpdate(true);
    const result = await window.agentCompany.checkSkillUpdate(companyId, skillId);
    setCheckingUpdate(false);
    if (result.ok) {
      setUpdateStatus(result.data);
    } else {
      addToast(formatDesktopResultError(result.error), "danger");
    }
  }, [companyId, skillId, detail, addToast]);

  const handleDelete = useCallback(async () => {
    const result = await window.agentCompany.deleteSkill(companyId, skillId);
    if (result.ok) {
      addToast(t("skill.deleted"), "success");
      onDeleted();
    } else {
      addToast(formatDesktopResultError(result.error), "danger");
    }
  }, [companyId, skillId, addToast, onDeleted, t]);

  const handleToggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-muted-foreground">
        <div className="text-[13px]">{t("skill.loading")}</div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-muted-foreground">
        <div className="text-[13px]">{t("skill.notFound")}</div>
      </div>
    );
  }

  const SourceIcon = sourceIconMap[detail.sourceType] ?? PuzzlePiece;
  const treeNodes = buildTree(detail.fileInventory ?? []);
  const isGitHubSource = detail.sourceType === "github" || detail.sourceType === "skills_sh";

  // Determine content for the file viewer
  const isSkillMd = selectedSkillFilePath === "SKILL.md";
  const fileContent = isSkillMd
    ? (markdownError
        ? markdownError
        : skillMarkdown === null
          ? t("skill.loading")
          : stripFrontmatter(skillMarkdown))
    : null;

  const selectedFileEntry = !isSkillMd
    ? (detail.fileInventory ?? []).find((f) => f.path === selectedSkillFilePath)
    : null;

  return (
    <div className="min-w-0">
      {/* Header section */}
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-start gap-3">
          <SourceIcon size={20} className="mt-1 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h1 className="text-[20px] font-semibold leading-tight text-foreground">
              {detail.name}
            </h1>
            {detail.description ? (
              <p className="mt-1 max-w-3xl text-[13px] text-muted-foreground">
                {detail.description}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Metadata row */}
      <div className="space-y-3 border-b border-border px-5 pt-4 pb-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px]">
          {/* Source */}
          <div className="flex items-center gap-2">
            <Eyebrow>{t("skill.source")}</Eyebrow>
            <span className="flex items-center gap-1.5">
              <SourceIcon size={14} className="text-muted-foreground" />
              <span className="text-foreground">{sourceLabel(detail.sourceType, t)}</span>
            </span>
          </div>

          {/* Trust level */}
          <div className="flex items-center gap-2">
            <Eyebrow>{t("skill.trust")}</Eyebrow>
            <StatusPill status={trustToneMap[detail.trustLevel] ?? "default"} />
            <span className="text-foreground">{trustLabel(detail.trustLevel, t)}</span>
          </div>

          {/* Compatibility */}
          <div className="flex items-center gap-2">
            <Eyebrow>{t("skill.compat")}</Eyebrow>
            <span className="text-foreground">{detail.compatibility || "all"}</span>
          </div>

          {/* Ref (for GitHub sources) */}
          {isGitHubSource ? (
            <div className="flex items-center gap-2">
              <Eyebrow>{t("skill.ref")}</Eyebrow>
              <span className="font-mono text-[12px] text-foreground">{shortRef(detail.sourceRef, t)}</span>
            </div>
          ) : null}
        </div>

        {/* Update check row */}
        {isGitHubSource ? (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <ActionButton
              label={t("skill.checkForUpdates")}
              icon={ArrowsClockwise}
              loading={checkingUpdate}
              onClick={() => void handleCheckUpdate()}
            />
            {updateStatus?.hasUpdate ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-[12px] font-medium text-primary">
                {t("skill.updateAvailable")}: {shortRef(updateStatus.currentRef, t)} &rarr; {shortRef(updateStatus.latestRef, t)}
              </span>
            ) : updateStatus && !updateStatus.hasUpdate ? (
              <span className="text-[12px] text-muted-foreground">{t("skill.upToDate")}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* File viewer section */}
      <div className="min-h-[560px]">
        {/* File tree sidebar + content */}
        <div className="grid grid-cols-[12rem_minmax(0,1fr)]">
          {/* File tree sidebar */}
          <div className="border-r border-border py-2">
            {treeNodes.length > 0 ? (
              <SkillFileTree
                nodes={treeNodes}
                selectedPath={selectedSkillFilePath}
                expandedDirs={expandedDirs}
                onToggleDir={handleToggleDir}
                onSelectPath={setSelectedSkillFilePath}
              />
            ) : (
              <p className="px-3 py-2 text-[12px] text-muted-foreground">{t("skill.noFiles")}</p>
            )}
          </div>

          {/* Content area */}
          <div className="p-4">
            {/* File path bar */}
            <div className="mb-3 flex items-center gap-1 text-[12px] text-muted-foreground">
              {selectedSkillFilePath.split("/").map((segment, i, arr) => (
                <span key={`${segment}-${i}`} className="flex items-center gap-1">
                  {i > 0 ? <span className="opacity-40">/</span> : null}
                  <span className={i === arr.length - 1 ? "font-medium text-foreground" : ""}>
                    {segment}
                  </span>
                </span>
              ))}
            </div>

            {/* Content */}
            {isSkillMd ? (
              <pre className="rounded-lg bg-card p-4 font-mono text-[13px] text-foreground overflow-auto whitespace-pre-wrap">
                {fileContent}
              </pre>
            ) : selectedFileEntry ? (
              <div className="rounded-lg bg-card p-4 text-[13px] text-muted-foreground">
                <p className="font-medium text-foreground">{selectedFileEntry.path}</p>
                <p className="mt-1">{t("skill.kind")}: {selectedFileEntry.kind}</p>
                <p className="mt-1 text-[12px] italic">{t("skill.previewUnavailable")}</p>
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">{t("skill.selectFile")}</p>
            )}
          </div>
        </div>
      </div>

      {/* Agent assignments section */}
      <div className="border-t border-border px-5 py-4">
        <Eyebrow tone="primary" className="mb-3">{t("skill.agentAssignments")}</Eyebrow>
        <SkillAgentToggles mode="skill" companyId={companyId} skillId={skillId} agents={agents} />
      </div>

      {/* Delete section */}
      <div className="border-t border-border px-5 py-4">
        {confirmingDelete ? (
          <div className="flex items-center gap-3">
            <p className="text-[13px] text-destructive">
              {t("skill.deleteConfirm").replace("{name}", detail.name)}
            </p>
            <ActionButton
              label={t("skill.confirmDelete")}
              tone="danger"
              onClick={() => void handleDelete()}
            />
            <ActionButton
              label={t("skill.cancel")}
              onClick={() => setConfirmingDelete(false)}
            />
          </div>
        ) : (
          <ActionButton
            label={t("skill.deleteSkill")}
            tone="danger"
            icon={Trash}
            onClick={() => setConfirmingDelete(true)}
          />
        )}
      </div>
    </div>
  );
}
