import type {
  AgentRecord,
  EmployeeRecord,
  FileAccessGrantRecord,
  FileObjectRecord,
} from "../../../../shared/domain";
import { t } from "../../i18n/i18n";

export type ViewMode = "grid" | "list";

export type Section =
  | { kind: "all" }
  | { kind: "recent" }
  | { kind: "pinned" }
  | { kind: "department"; value: string }
  | { kind: "agent"; value: string };

export const FILE_COLOR_MAP: Record<string, { color: string; label: string }> = {
  doc: { color: "#5e6ad2", label: "DOC" },
  sheet: { color: "#2f9e58", label: "XLS" },
  md: { color: "#52525b", label: "MD" },
  pdf: { color: "#d23b3b", label: "PDF" },
  img: { color: "#c87d12", label: "IMG" },
  folder: { color: "#a1a1aa", label: "" },
};

/** Departments shown in the file tree carry a FILE count, not an agent count:
 * the badge must equal what opening the section reveals. Departments with no
 * files are omitted so the tree never advertises a folder that opens empty. */
export function collectDepartments(files: FileObjectRecord[], agents: AgentRecord[]): Array<{ name: string; count: number }> {
  const departmentByAgent = new Map(agents.map((agent) => [agent.id, agent.department]));
  const counts = new Map<string, number>();
  for (const file of files) {
    if (file.ownerType !== "agent" || !file.ownerId) continue;
    const department = departmentByAgent.get(file.ownerId);
    if (!department) continue;
    counts.set(department, (counts.get(department) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

export function collectAgentFiles(files: FileObjectRecord[], agents: AgentRecord[]): Array<{ agent: AgentRecord; count: number }> {
  const out: Array<{ agent: AgentRecord; count: number }> = [];
  for (const agent of agents) {
    const count = files.filter((file) => file.ownerType === "agent" && file.ownerId === agent.id).length;
    if (count > 0) out.push({ agent, count });
  }
  return out.sort((a, b) => b.count - a.count);
}

export function filterFiles(files: FileObjectRecord[], section: Section, agents: AgentRecord[]): FileObjectRecord[] {
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

export function fileGrantCount(fileId: string, grants: FileAccessGrantRecord[]): number {
  return grants.filter((grant) => grant.fileId === fileId).length;
}

export function parseScanLabels(file: FileObjectRecord): string[] {
  const parsed: unknown = JSON.parse(file.scanLabelsJson);
  if (!Array.isArray(parsed) || parsed.some((label) => typeof label !== "string")) {
    throw new Error("File scan labels are invalid.");
  }
  return parsed;
}

export function shortChecksum(value: string): string {
  if (!/^[a-f0-9]{8,}$/i.test(value)) throw new Error("File checksum is invalid.");
  return value.slice(0, 8);
}

export function shortObjectRef(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) throw new Error("File object reference is invalid.");
  return parts.slice(-2).join("/");
}

export function isRecent(iso: string): boolean {
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  return Date.now() - new Date(iso).getTime() <= sevenDays;
}

export function isAgentOwner(file: FileObjectRecord): boolean {
  return file.ownerType === "agent";
}

export function resolveOwnerName(file: FileObjectRecord, employees: EmployeeRecord[], agents: AgentRecord[]): string {
  if (file.ownerType === "employee" && file.ownerId) {
    const employee = employees.find((item) => item.id === file.ownerId);
    if (employee) return employee.displayName;
  }
  if (file.ownerType === "agent" && file.ownerId) {
    const agent = agents.find((item) => item.id === file.ownerId);
    if (agent) return agent.name;
  }
  return t("System");
}

export function labelFor(section: Section): string {
  if (section.kind === "all") return t("All files");
  if (section.kind === "recent") return t("Recent");
  if (section.kind === "pinned") return t("Pinned");
  if (section.kind === "agent") return t("By agent");
  return section.value;
}
