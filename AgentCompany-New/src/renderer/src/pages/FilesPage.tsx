import { Button, Icon, IconButton } from "../shared/ui";
import type { FileObjectRecord } from "../../../shared/domain";
import type { PageProps } from "./types";
import { activeOrgId } from "./types";

export function FilesPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const files = snapshot.files.filter((item) => item.orgId === orgId);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "200px minmax(0, 1fr)", gap: 24 }}>
      <aside>
        <div className="section-label">Library</div>
        <TreeItem icon="folder" label="All files" count={files.length} active />
        <TreeItem icon="social" label="Recent" />
        <TreeItem icon="check" label="Pinned" />
      </aside>
      <div className="page">
        <div className="row" style={{ marginBottom: 24 }}>
          <div>
            <h1 className="page-h1">Files</h1>
            <p className="page-sub" style={{ marginBottom: 0 }}>{files.length} files · {formatBytes(files.reduce((sum, file) => sum + file.sizeBytes, 0))}</p>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <Button tone="primary" onClick={() => void actions.run(() => window.agentCompany.importFile({ orgId }))}>
              <Icon name="upload" /> Upload
            </Button>
          </div>
        </div>
        <div className="section-label">All files</div>
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-row" style={{ gridTemplateColumns: "3fr 1fr 1.4fr 1fr 40px", background: "var(--panel-2)", color: "var(--text-3)", fontSize: 11 }}>
            <div>Name</div><div>Size</div><div>Checksum</div><div>Added</div><div />
          </div>
          {files.length === 0 ? (
            <div style={{ padding: 18, color: "var(--text-3)" }}>No files</div>
          ) : files.map((file) => <FileRow key={file.id} file={file} />)}
        </div>
      </div>
    </div>
  );
}

function TreeItem({
  icon,
  label,
  count,
  active = false,
}: {
  icon: string;
  label: string;
  count?: number;
  active?: boolean;
}) {
  return (
    <div className={`nav-item ${active ? "active" : ""}`}>
      <Icon name={icon} />
      <span>{label}</span>
      {typeof count === "number" && <span className="nav-badge">{count}</span>}
    </div>
  );
}

function FileRow({ file }: { file: FileObjectRecord }) {
  return (
    <div className="table-row" style={{ gridTemplateColumns: "3fr 1fr 1.4fr 1fr 40px" }}>
      <div className="row">
        <FileIcon kind={file.kind} />
        <span style={{ fontWeight: 480 }}>{file.name}</span>
      </div>
      <div className="num" style={{ color: "var(--text-3)", fontSize: 12 }}>{formatBytes(file.sizeBytes)}</div>
      <div className="num" style={{ color: "var(--text-3)", fontSize: 12 }}>{file.sha256.slice(0, 12)}</div>
      <div style={{ color: "var(--text-3)", fontSize: 12 }}>{new Date(file.createdAt).toLocaleDateString()}</div>
      <IconButton icon="more" label="More" />
    </div>
  );
}

function FileIcon({ kind }: { kind: string }) {
  const colors: Record<string, string> = {
    md: "#52525b",
    pdf: "#d23b3b",
    img: "#c87d12",
    sheet: "#2f9e58",
    doc: "#5e6ad2",
  };
  if (kind === "folder") return <Icon name="folder" />;
  return (
    <span
      style={{
        width: 22,
        height: 22,
        display: "grid",
        placeItems: "center",
        borderRadius: 4,
        background: `${colors[kind] ?? "#a1a1aa"}14`,
        color: colors[kind] ?? "#52525b",
        fontSize: 8,
        fontWeight: 700,
      }}
    >
      {kind.slice(0, 3).toUpperCase()}
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
