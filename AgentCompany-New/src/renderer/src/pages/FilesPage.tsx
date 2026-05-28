import { useMemo, useState } from "react";
import { Avatar, Button, Icon, IconButton, Pill, Segmented } from "../shared/ui";
import { TopbarActions } from "../shared/TopbarActions";
import type {
  AgentRecord,
  EmployeeRecord,
  FileAccessGrantRecord,
  FileObjectRecord,
} from "../../../shared/domain";
import type { PageProps } from "./types";
import { activeOrgId, formatBytes, formatRelative } from "./types";

type ViewMode = "grid" | "list";
type Section =
  | { kind: "all" }
  | { kind: "recent" }
  | { kind: "pinned" }
  | { kind: "department"; value: string }
  | { kind: "agent"; value: string };

const FILE_COLOR_MAP: Record<string, { color: string; label: string }> = {
  doc: { color: "#5e6ad2", label: "DOC" },
  sheet: { color: "#2f9e58", label: "XLS" },
  md: { color: "#52525b", label: "MD" },
  pdf: { color: "#d23b3b", label: "PDF" },
  img: { color: "#c87d12", label: "IMG" },
  folder: { color: "#a1a1aa", label: "" },
};

export function FilesPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const employees = snapshot.employees.filter((employee) => employee.orgId === orgId);
  const agents = snapshot.agents.filter((agent) => agent.orgId === orgId);
  const files = useMemo(() => snapshot.files.filter((file) => file.orgId === orgId), [snapshot.files, orgId]);
  const fileAccessGrants = useMemo(
    () => snapshot.fileAccessGrants.filter((grant) => grant.orgId === orgId),
    [snapshot.fileAccessGrants, orgId],
  );
  const [section, setSection] = useState<Section>({ kind: "all" });
  const [view, setView] = useState<ViewMode>("list");

  const departments = collectDepartments(agents);
  const filesByAgent = collectAgentFiles(files, agents);
  const visibleFiles = filterFiles(files, section, agents);
  const pinnedFiles = files.filter((file) => file.pinned);
  const totalBytes = visibleFiles.reduce((sum, file) => sum + file.sizeBytes, 0);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(160px, 200px) minmax(0, 1fr)", gap: 24, height: "100%", minHeight: 0, padding: "28px 32px 0" }}>
      <FilesTree
        files={files}
        pinnedFiles={pinnedFiles}
        section={section}
        departments={departments}
        filesByAgent={filesByAgent}
        onChange={setSection}
      />

      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <TopbarActions>
          <Button tone="ghost"><Icon name="filter" size={13} /></Button>
          <Segmented<ViewMode>
            value={view}
            onChange={setView}
            options={[
              { id: "grid", label: "Grid" },
              { id: "list", label: "List" },
            ]}
          />
          <Button tone="primary" onClick={() => void actions.run(() => window.agentCompany.importFile({ orgId }))}>
            <Icon name="upload" size={13} /> Upload
          </Button>
        </TopbarActions>
        <h1 className="page-h1">Files</h1>
        <p className="page-sub">
          {visibleFiles.length} {visibleFiles.length === 1 ? "file" : "files"} · {formatBytes(totalBytes)}
        </p>

        <div className="pane-scroll" style={{ paddingBottom: 40 }}>
        {pinnedFiles.length > 0 && section.kind === "all" && (
          <>
            <div className="section-label" style={{ marginBottom: 10 }}>Pinned</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12, marginBottom: 28 }}>
              {pinnedFiles.slice(0, 8).map((file) => (
                <PinnedCard
                  key={file.id}
                  file={file}
                  ownerName={resolveOwnerName(file, employees, agents)}
                  grantCount={fileGrantCount(file.id, fileAccessGrants)}
                  onUnpin={() => void actions.run(() => window.agentCompany.setFilePinned({ orgId, fileId: file.id, pinned: false }))}
                />
              ))}
            </div>
          </>
        )}

        <div className="row" style={{ marginBottom: 10 }}>
          <div className="section-label">{labelFor(section)}</div>
          <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)" }}>Modified ↓</div>
        </div>

        {view === "list" ? (
          <FilesTable
            files={visibleFiles}
            grants={fileAccessGrants}
            employees={employees}
            agents={agents}
            onTogglePin={(file) => void actions.run(() => window.agentCompany.setFilePinned({ orgId, fileId: file.id, pinned: !file.pinned }))}
          />
        ) : (
          <FilesGrid
            files={visibleFiles}
            grants={fileAccessGrants}
            employees={employees}
            agents={agents}
            onTogglePin={(file) => void actions.run(() => window.agentCompany.setFilePinned({ orgId, fileId: file.id, pinned: !file.pinned }))}
          />
        )}
        </div>
      </div>
    </div>
  );
}

function FilesTree({
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

function FilesTable({
  files,
  grants,
  employees,
  agents,
  onTogglePin,
}: {
  files: FileObjectRecord[];
  grants: FileAccessGrantRecord[];
  employees: EmployeeRecord[];
  agents: AgentRecord[];
  onTogglePin: (file: FileObjectRecord) => void;
}) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div
        className="table-row head"
        style={{ gridTemplateColumns: "minmax(0, 2.7fr) minmax(70px, 0.7fr) minmax(0, 1.2fr) minmax(94px, 0.8fr) minmax(88px, 0.8fr) 56px" }}
      >
        <div>Name</div><div>Size</div><div>Owner</div><div>Access</div><div>Modified</div><div />
      </div>
      {files.map((file, index) => (
        <FileRow
          key={file.id}
          file={file}
          owner={resolveOwnerName(file, employees, agents)}
          grantCount={fileGrantCount(file.id, grants)}
          last={index === files.length - 1}
          onTogglePin={() => onTogglePin(file)}
        />
      ))}
    </div>
  );
}

function FilesGrid({
  files,
  grants,
  employees,
  agents,
  onTogglePin,
}: {
  files: FileObjectRecord[];
  grants: FileAccessGrantRecord[];
  employees: EmployeeRecord[];
  agents: AgentRecord[];
  onTogglePin: (file: FileObjectRecord) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
      {files.map((file) => (
        <PinnedCard
          key={file.id}
          file={file}
          ownerName={resolveOwnerName(file, employees, agents)}
          grantCount={fileGrantCount(file.id, grants)}
          onUnpin={() => onTogglePin(file)}
        />
      ))}
    </div>
  );
}

function FileRow({
  file,
  owner,
  grantCount,
  last,
  onTogglePin,
}: {
  file: FileObjectRecord;
  owner: string;
  grantCount: number;
  last: boolean;
  onTogglePin: () => void;
}) {
  return (
    <div
      className="table-row"
      style={{
        gridTemplateColumns: "minmax(0, 2.7fr) minmax(70px, 0.7fr) minmax(0, 1.2fr) minmax(94px, 0.8fr) minmax(88px, 0.8fr) 56px",
        borderBottom: last ? "none" : "1px solid var(--border-soft)",
      }}
    >
      <div className="row" style={{ gap: 10, minWidth: 0 }}>
        <FileIcon kind={file.kind} />
        <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
          <span style={{ fontWeight: 480, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
          <span className="mono" style={{ color: "var(--text-3)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            sha:{shortChecksum(file.sha256)} · obj:{shortObjectRef(file.storagePath)}
          </span>
        </div>
        {file.pinned && <Pill tone="violet" dot>Pinned</Pill>}
      </div>
      <div className="num mono" style={{ color: "var(--text-3)", fontSize: 12 }}>{formatBytes(file.sizeBytes)}</div>
      <div className="row" style={{ gap: 8, minWidth: 0 }}>
        <Avatar name={owner} size="sm" bot={isAgentOwner(file)} />
        <span style={{ color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{owner}</span>
      </div>
      <div className="row" style={{ gap: 6, minWidth: 0 }}>
        <Pill tone={file.scanState === "approved" ? "green" : "red"}>{file.scanState === "approved" ? "Clean" : "Blocked"}</Pill>
        <span className="mono" style={{ color: "var(--text-3)", fontSize: 11 }}>{grantCount}</span>
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 12 }}>{formatRelative(file.updatedAt ?? file.createdAt)}</div>
      <div style={{ textAlign: "right" }}>
        <IconButton icon={file.pinned ? "pin" : "more"} label={file.pinned ? "Unpin" : "More"} onClick={onTogglePin} />
      </div>
    </div>
  );
}

function PinnedCard({
  file,
  ownerName,
  grantCount,
  onUnpin,
}: {
  file: FileObjectRecord;
  ownerName: string;
  grantCount: number;
  onUnpin: () => void;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--panel)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 0,
      }}
    >
      <div className="row" style={{ gap: 10 }}>
        <FileIcon kind={file.kind} big />
        <button
          type="button"
          aria-label={file.pinned ? "Unpin" : "Pin"}
          onClick={onUnpin}
          style={{ marginLeft: "auto", padding: 4, border: 0, background: "transparent", color: file.pinned ? "var(--accent)" : "var(--text-4)", cursor: "pointer" }}
        >
          <Icon name="pin" size={14} />
        </button>
      </div>
      <div style={{ fontSize: 13, fontWeight: 540, letterSpacing: "-0.005em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {file.name}
      </div>
      <div className="mono" style={{ color: "var(--text-3)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        sha:{shortChecksum(file.sha256)} · obj:{shortObjectRef(file.storagePath)}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <Pill tone={file.scanState === "approved" ? "green" : "red"}>{file.scanState === "approved" ? "Clean" : "Blocked"}</Pill>
        <span className="mono" style={{ color: "var(--text-3)", fontSize: 11 }}>{grantCount}</span>
      </div>
      <ScanLabelStrip file={file} />
      <div className="row" style={{ gap: 8, marginTop: "auto", minWidth: 0 }}>
        <Avatar name={ownerName} size="sm" bot={isAgentOwner(file)} />
        <span style={{ fontSize: 11, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {formatRelative(file.updatedAt ?? file.createdAt)} · {ownerName.split(" ")[0]}
        </span>
      </div>
    </div>
  );
}

function ScanLabelStrip({ file }: { file: FileObjectRecord }) {
  const labels = parseScanLabels(file).slice(0, 2);
  if (labels.length === 0) return null;
  return (
    <div className="row" style={{ gap: 5, minWidth: 0, flexWrap: "wrap" }}>
      {labels.map((label) => (
        <Pill key={label}>{label}</Pill>
      ))}
    </div>
  );
}

function FileIcon({ kind, big = false }: { kind: string; big?: boolean }) {
  const map = FILE_COLOR_MAP[kind] ?? FILE_COLOR_MAP.doc;
  if (!map) throw new Error("File color map default missing.");
  if (kind === "folder") {
    return (
      <div style={{ width: big ? 28 : 22, height: big ? 28 : 22, display: "grid", placeItems: "center", color: "var(--text-3)" }}>
        <Icon name="folder" size={big ? 22 : 17} />
      </div>
    );
  }
  const label = map.label || kind.slice(0, 3).toUpperCase();
  return (
    <span
      className="mono"
      style={{
        width: big ? 28 : 22,
        height: big ? 28 : 22,
        borderRadius: big ? 6 : 4,
        background: `${map.color}14`,
        color: map.color,
        display: "grid",
        placeItems: "center",
        fontSize: big ? 9 : 8,
        fontWeight: 700,
        letterSpacing: 0.5,
      }}
    >
      {label}
    </span>
  );
}

function collectDepartments(agents: AgentRecord[]): Array<{ name: string; count: number }> {
  const seen = new Map<string, number>();
  for (const agent of agents) {
    if (!agent.department) continue;
    seen.set(agent.department, (seen.get(agent.department) ?? 0) + 1);
  }
  return [...seen.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

function collectAgentFiles(files: FileObjectRecord[], agents: AgentRecord[]): Array<{ agent: AgentRecord; count: number }> {
  const out: Array<{ agent: AgentRecord; count: number }> = [];
  for (const agent of agents) {
    const count = files.filter((file) => file.ownerType === "agent" && file.ownerId === agent.id).length;
    if (count > 0) out.push({ agent, count });
  }
  return out.sort((a, b) => b.count - a.count);
}

function filterFiles(files: FileObjectRecord[], section: Section, agents: AgentRecord[]): FileObjectRecord[] {
  if (section.kind === "all") return files;
  if (section.kind === "pinned") return files.filter((file) => file.pinned);
  if (section.kind === "recent") return files.filter((file) => isRecent(file.createdAt));
  if (section.kind === "agent") return files.filter((file) => file.ownerType === "agent" && file.ownerId === section.value);
  if (section.kind === "department") {
    const departmentAgents = new Set(agents.filter((agent) => agent.department === section.value).map((agent) => agent.id));
    return files.filter((file) => file.ownerType === "agent" && file.ownerId !== null && departmentAgents.has(file.ownerId));
  }
  return files;
}

function fileGrantCount(fileId: string, grants: FileAccessGrantRecord[]): number {
  return grants.filter((grant) => grant.fileId === fileId).length;
}

function parseScanLabels(file: FileObjectRecord): string[] {
  const parsed: unknown = JSON.parse(file.scanLabelsJson);
  if (!Array.isArray(parsed) || parsed.some((label) => typeof label !== "string")) {
    throw new Error("File scan labels are invalid.");
  }
  return parsed;
}

function shortChecksum(value: string): string {
  if (!/^[a-f0-9]{8,}$/i.test(value)) throw new Error("File checksum is invalid.");
  return value.slice(0, 8);
}

function shortObjectRef(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) throw new Error("File object reference is invalid.");
  return parts.slice(-2).join("/");
}

function isRecent(iso: string): boolean {
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  return Date.now() - new Date(iso).getTime() <= sevenDays;
}

function isAgentOwner(file: FileObjectRecord): boolean {
  return file.ownerType === "agent";
}

function resolveOwnerName(file: FileObjectRecord, employees: EmployeeRecord[], agents: AgentRecord[]): string {
  if (file.ownerType === "employee" && file.ownerId) {
    const employee = employees.find((item) => item.id === file.ownerId);
    if (employee) return employee.displayName;
  }
  if (file.ownerType === "agent" && file.ownerId) {
    const agent = agents.find((item) => item.id === file.ownerId);
    if (agent) return agent.name;
  }
  return "System";
}

function labelFor(section: Section): string {
  if (section.kind === "all") return "All files";
  if (section.kind === "recent") return "Recent";
  if (section.kind === "pinned") return "Pinned";
  if (section.kind === "agent") return "By agent";
  return section.value;
}
