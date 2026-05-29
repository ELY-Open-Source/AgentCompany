import { Icon, Pill } from "../../shared/ui";
import type { FileObjectRecord } from "../../../../shared/domain";
import { FILE_COLOR_MAP, parseScanLabels } from "./file-helpers";

export function FileIcon({ kind, big = false }: { kind: string; big?: boolean }) {
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

export function ScanLabelStrip({ file }: { file: FileObjectRecord }) {
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
