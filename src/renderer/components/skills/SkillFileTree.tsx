import {
  CaretDown,
  CaretRight,
  FileCode,
  FileText,
  FolderOpen,
  FolderSimple,
} from "@phosphor-icons/react";
import type { FileInventoryEntry } from "@shared/types";

export type SkillTreeNode = {
  name: string;
  path: string | null;
  kind: "dir" | "file";
  fileKind?: FileInventoryEntry["kind"];
  children: SkillTreeNode[];
};

const BASE_INDENT = 16;
const STEP_INDENT = 24;

export function buildTree(entries: FileInventoryEntry[]): SkillTreeNode[] {
  const root: SkillTreeNode = { name: "", path: null, kind: "dir", children: [] };

  for (const entry of entries) {
    const segments = entry.path.split("/").filter(Boolean);
    let current = root;
    let currentPath = "";
    for (const [index, segment] of segments.entries()) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const isLeaf = index === segments.length - 1;
      let next = current.children.find((child) => child.name === segment);
      if (!next) {
        next = {
          name: segment,
          path: isLeaf ? entry.path : currentPath,
          kind: isLeaf ? "file" : "dir",
          fileKind: isLeaf ? entry.kind : undefined,
          children: [],
        };
        current.children.push(next);
      }
      current = next;
    }
  }

  function sortNode(node: SkillTreeNode) {
    node.children.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1;
      if (left.name === "SKILL.md") return -1;
      if (right.name === "SKILL.md") return 1;
      return left.name.localeCompare(right.name);
    });
    node.children.forEach(sortNode);
  }

  sortNode(root);
  return root.children;
}

function fileIcon(kind: FileInventoryEntry["kind"] | undefined) {
  if (kind === "script" || kind === "reference") return FileCode;
  return FileText;
}

export function SkillFileTree({
  nodes,
  selectedPath,
  expandedDirs,
  onToggleDir,
  onSelectPath,
  depth = 0,
}: {
  nodes: SkillTreeNode[];
  selectedPath: string;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onSelectPath: (path: string) => void;
  depth?: number;
}) {
  return (
    <div>
      {nodes.map((node) => {
        const expanded = node.kind === "dir" && node.path ? expandedDirs.has(node.path) : false;

        if (node.kind === "dir") {
          const FolderIcon = expanded ? FolderOpen : FolderSimple;
          const ChevronIcon = expanded ? CaretDown : CaretRight;
          return (
            <div key={node.path ?? node.name}>
              <button
                type="button"
                className="flex min-h-9 w-full items-center gap-2 text-left text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground"
                style={{ paddingLeft: `${BASE_INDENT + depth * STEP_INDENT}px` }}
                onClick={() => node.path && onToggleDir(node.path)}
              >
                <FolderIcon size={14} className="shrink-0" />
                <span className="min-w-0 truncate">{node.name}</span>
                <ChevronIcon size={12} className="ml-auto mr-3 shrink-0 opacity-60" />
              </button>
              {expanded && (
                <SkillFileTree
                  nodes={node.children}
                  selectedPath={selectedPath}
                  expandedDirs={expandedDirs}
                  onToggleDir={onToggleDir}
                  onSelectPath={onSelectPath}
                  depth={depth + 1}
                />
              )}
            </div>
          );
        }

        const FileIcon = fileIcon(node.fileKind);
        const isSelected = node.path === selectedPath;
        return (
          <button
            key={node.path ?? node.name}
            type="button"
            className={`flex min-h-9 w-full items-center gap-2 text-left text-[13px] hover:bg-muted ${
              isSelected
                ? "text-foreground font-medium"
                : "text-muted-foreground"
            }`}
            style={{ paddingLeft: `${BASE_INDENT + depth * STEP_INDENT}px` }}
            onClick={() => node.path && onSelectPath(node.path)}
          >
            <FileIcon size={14} className="shrink-0" />
            <span className="min-w-0 truncate">{node.name}</span>
          </button>
        );
      })}
    </div>
  );
}
