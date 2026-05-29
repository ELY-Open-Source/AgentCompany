import { useMemo, useState } from "react";
import { Button, Icon, Segmented } from "../shared/ui";
import { TopbarActions } from "../shared/TopbarActions";
import type { FileObjectRecord } from "../../../shared/domain";
import type { PageProps } from "./types";
import { activeOrgId, formatBytes } from "./types";
import { FilesTree } from "./files/FilesTree";
import { FilesTable } from "./files/FilesTable";
import { FilesGrid, PinnedCard } from "./files/FilesGrid";
import {
  collectAgentFiles,
  collectDepartments,
  fileGrantCount,
  filterFiles,
  labelFor,
  resolveOwnerName,
  type Section,
  type ViewMode,
} from "./files/file-helpers";

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

  const upload = () => {
    void window.agentCompany.importFile({ orgId }).then((result) => {
      if (!result.ok) throw new Error(result.error.message);
    });
  };
  const openFile = (file: FileObjectRecord) => {
    void window.agentCompany.openFile({ orgId, fileId: file.id }).then((result) => {
      if (!result.ok) throw new Error(result.error.message);
    });
  };
  const togglePin = (file: FileObjectRecord) =>
    void actions.run(() => window.agentCompany.setFilePinned({ orgId, fileId: file.id, pinned: !file.pinned }));

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
          <Button tone="primary" onClick={upload}>
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
                    onOpen={() => openFile(file)}
                    onUnpin={() => togglePin(file)}
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
              onOpen={openFile}
              onTogglePin={togglePin}
            />
          ) : (
            <FilesGrid
              files={visibleFiles}
              grants={fileAccessGrants}
              employees={employees}
              agents={agents}
              onOpen={openFile}
              onTogglePin={togglePin}
            />
          )}
        </div>
      </div>
    </div>
  );
}
