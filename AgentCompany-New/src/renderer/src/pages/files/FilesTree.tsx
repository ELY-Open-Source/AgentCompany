import { Icon } from "../../shared/ui";
import type { AgentRecord, FileObjectRecord } from "../../../../shared/domain";
import { isRecent, type Section } from "./file-helpers";

export function FilesTree({
  files,
  pinnedFiles,
  section,
  departments,
  filesByAgent,
  onChange,
}: {
  files: FileObjectRecord[];
  pinnedFiles: FileObjectRecord[];
  section: Section;
  departments: Array<{ name: string; count: number }>;
  filesByAgent: Array<{ agent: AgentRecord; count: number }>;
  onChange: (next: Section) => void;
}) {
  const recent = files.filter((file) => isRecent(file.createdAt));
  return (
    <aside style={{ overflowY: "auto", minHeight: 0, paddingBottom: 40 }}>
      <div className="section-label">Library</div>
      <TreeItem
        icon="folder"
        label="All files"
        count={files.length}
        active={section.kind === "all"}
        onClick={() => onChange({ kind: "all" })}
      />
      <TreeItem
        icon="sparkle"
        label="Recent"
        count={recent.length}
        active={section.kind === "recent"}
        onClick={() => onChange({ kind: "recent" })}
      />
      <TreeItem
        icon="pin"
        label="Pinned"
        count={pinnedFiles.length}
        active={section.kind === "pinned"}
        onClick={() => onChange({ kind: "pinned" })}
      />
      {departments.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 22 }}>Spaces</div>
          {departments.map((department) => (
            <TreeItem
              key={department.name}
              icon="folder"
              label={department.name}
              count={department.count}
              active={section.kind === "department" && section.value === department.name}
              onClick={() => onChange({ kind: "department", value: department.name })}
            />
          ))}
        </>
      )}
      {filesByAgent.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 22 }}>By agent</div>
          {filesByAgent.map(({ agent, count }) => (
            <TreeItem
              key={agent.id}
              icon="bot"
              label={agent.name}
              count={count}
              active={section.kind === "agent" && section.value === agent.id}
              onClick={() => onChange({ kind: "agent", value: agent.id })}
            />
          ))}
        </>
      )}
    </aside>
  );
}

function TreeItem({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`nav-item ${active ? "active" : ""}`.trim()} onClick={onClick}>
      <Icon name={icon} size={14} />
      <span>{label}</span>
      <span className="nav-badge num">{count}</span>
    </button>
  );
}
