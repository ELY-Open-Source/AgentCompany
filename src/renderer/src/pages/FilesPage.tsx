import { useRevealObject } from "../shared/reveal";
import { oneOf, usePersistentState } from "../shared/view-state";
import { useMemo } from "react";
import { Button, Icon, Segmented } from "../shared/ui";
import { TopbarActions } from "../shared/TopbarActions";
import { FILE_SCAN_STATE, type FileObjectRecord, type FileScanState } from "../../../shared/domain";
import { MenuLabel, MenuRow, Popover } from "../shared/Popover";
import type { PageProps } from "./types";
import { activeOrgId, formatBytes } from "./types";
import { t } from "../i18n/i18n";
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

const isSection = (value: unknown): value is Section => {
  if (typeof value !== "object" || value === null) return false;
  const section = value as { kind?: unknown; value?: unknown };
  if (section.kind === "all" || section.kind === "recent" || section.kind === "pinned") return true;
  return (section.kind === "department" || section.kind === "agent") && typeof section.value === "string";
};

export function FilesPage({ snapshot, actions, focus }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const employees = snapshot.employees.filter((employee) => employee.orgId === orgId);
  const agents = snapshot.agents.filter((agent) => agent.orgId === orgId);
  // Older contents of a rewritten file stay attachable by id but are not listed.
  const files = useMemo(() => snapshot.files.filter((file) => file.orgId === orgId && !file.supersededAt), [snapshot.files, orgId]);
  const fileAccessGrants = useMemo(
    () => snapshot.fileAccessGrants.filter((grant) => grant.orgId === orgId),
    [snapshot.fileAccessGrants, orgId],
  );
  const fileFocus = focus?.kind === "file" ? focus.id : null;
  const [section, setSection] = usePersistentState<Section>(`${orgId}:files.section`, { kind: "all" }, isSection, fileFocus ? { kind: "all" } : undefined);
  useRevealObject(fileFocus);
  const [view, setView] = usePersistentState<ViewMode>(`${orgId}:files.view`, "list", oneOf(["grid", "list"] as const));
  const [scanFilter, setScanFilter] = usePersistentState<FileScanState | "all">(`${orgId}:files.scan`, "all", (value): value is FileScanState | "all" => typeof value === "string", fileFocus ? "all" : undefined);

  const departments = collectDepartments(files, agents);
  const filesByAgent = collectAgentFiles(files, agents);
  const sectionFiles = filterFiles(files, section, agents);
  const visibleFiles = scanFilter === "all" ? sectionFiles : sectionFiles.filter((file) => file.scanState === scanFilter);
  const pinnedFiles = files.filter((file) => file.pinned);
  const totalBytes = visibleFiles.reduce((sum, file) => sum + file.sizeBytes, 0);

  const upload = () => {
    void window.agentCompany.importFile({ orgId }).then((result) => {
      if (!result.ok) throw new Error(result.error.message);
      if (result.data.failures.length > 0) throw new Error(result.data.failures.map((failure) => `${failure.name}: ${failure.reason}`).join("; "));
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
          <FilesFilter scan={scanFilter} onScan={setScanFilter} />
          <Segmented<ViewMode>
            label={t("Layout")}
            value={view}
            onChange={setView}
            options={[
              { id: "grid", label: t("Grid") },
              { id: "list", label: t("List") },
            ]}
          />
          <Button tone="primary" onClick={upload}>
            <Icon name="upload" /> {t("Upload")}
          </Button>
        </TopbarActions>
        <h1 className="page-h1">{t("Files")}</h1>
        <p className="page-sub">
          {visibleFiles.length === 1 ? t("{n} file", { n: visibleFiles.length }) : t("{n} files", { n: visibleFiles.length })} · {formatBytes(totalBytes)}
        </p>

        <div className="pane-scroll" style={{ paddingBottom: 40 }}>
          {pinnedFiles.length > 0 && section.kind === "all" && (
            <>
              <div className="section-label" style={{ marginBottom: 10 }}>{t("Pinned")}</div>
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
            <div style={{ marginLeft: "auto", fontSize: "var(--fs-body)", color: "var(--text-3)" }}>{t("Modified")} ↓</div>
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

function FilesFilter({
  scan,
  onScan,
}: {
  scan: FileScanState | "all";
  onScan: (next: FileScanState | "all") => void;
}) {
  const options: ReadonlyArray<{ id: FileScanState | "all"; label: string }> = [
    { id: "all", label: t("All files") },
    { id: FILE_SCAN_STATE.APPROVED, label: t("No findings") },
    { id: FILE_SCAN_STATE.BLOCKED, label: t("Blocked") },
  ];
  return (
    <Popover
      trigger={({ toggle }) => (
        <button type="button" className="button ghost" aria-label={t("Filter files")} onClick={toggle}>
          <Icon name="filter" color={scan !== "all" ? "var(--accent)" : "currentColor"} />
        </button>
      )}
    >
      {() => (
        <>
          <MenuLabel>{t("Scan status")}</MenuLabel>
          {options.map((option) => (
            <MenuRow key={option.id} active={scan === option.id} onClick={() => onScan(option.id)}>
              {option.label}
              {scan === option.id && <span className="menu-check"><Icon name="check" /></span>}
            </MenuRow>
          ))}
        </>
      )}
    </Popover>
  );
}
