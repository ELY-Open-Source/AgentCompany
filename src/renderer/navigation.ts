import type { SectionId } from "@shared/types";
import {
  BookOpen,
  Briefcase,
  CalendarBlank,
  ChartLine,
  ChatCircle,
  ClockCounterClockwise,
  CurrencyCircleDollar,
  FileText,
  FolderOpen,
  Gear,
  Kanban,
  ListChecks,
  Megaphone,
  MonitorPlay,
  Plugs,
  PuzzlePiece,
  ShieldCheck,
  SquaresFour,
  Target,
  Timer,
  Tray,
  UserPlus,
  UsersThree,
} from "./components/ui/icons";

export type NavItemDef = { id: SectionId; labelKey: string; icon: typeof SquaresFour };
export type NavGroupDef = { id: string; items: NavItemDef[] };
type SectionNavItemMap = { [K in SectionId]: NavItemDef & { id: K } };

export const SECTION_NAV_ITEM_DEFS = {
  overview: { id: "overview", labelKey: "nav.overview", icon: SquaresFour },
  inbox: { id: "inbox", labelKey: "nav.inbox", icon: Tray },
  standup: { id: "standup", labelKey: "nav.standup", icon: Timer },
  performance: { id: "performance", labelKey: "nav.performance", icon: ChartLine },
  runs: { id: "runs", labelKey: "nav.runs", icon: MonitorPlay },
  connectors: { id: "connectors", labelKey: "nav.connectors", icon: Plugs },
  agents: { id: "agents", labelKey: "nav.agents", icon: UsersThree },
  hiring: { id: "hiring", labelKey: "nav.hiring", icon: UserPlus },
  goals: { id: "goals", labelKey: "nav.goals", icon: Target },
  projects: { id: "projects", labelKey: "nav.projects", icon: Kanban },
  tasks: { id: "tasks", labelKey: "nav.work", icon: ListChecks },
  approvals: { id: "approvals", labelKey: "nav.approvals", icon: ShieldCheck },
  costs: { id: "costs", labelKey: "nav.costs", icon: CurrencyCircleDollar },
  activity: { id: "activity", labelKey: "nav.activity", icon: ClockCounterClockwise },
  workspaces: { id: "workspaces", labelKey: "nav.workspaces", icon: FolderOpen },
  social: { id: "social", labelKey: "nav.social", icon: Megaphone },
  skills: { id: "skills", labelKey: "nav.skills", icon: PuzzlePiece },
  automation: { id: "automation", labelKey: "nav.automation", icon: Briefcase },
  communication: { id: "communication", labelKey: "nav.communication", icon: ChatCircle },
  documents: { id: "documents", labelKey: "nav.documents", icon: FileText },
  knowledge: { id: "knowledge", labelKey: "nav.knowledge", icon: BookOpen },
  meetings: { id: "meetings", labelKey: "nav.meetings", icon: CalendarBlank },
  sprints: { id: "sprints", labelKey: "nav.sprints", icon: Kanban },
  settings: { id: "settings", labelKey: "nav.settings", icon: Gear },
} as const satisfies SectionNavItemMap;

export const SECTION_NAV_IDS = Object.keys(SECTION_NAV_ITEM_DEFS) as SectionId[];

export const SIDEBAR_NAV_GROUP_DEFS = [
  {
    id: "company",
    items: [
      SECTION_NAV_ITEM_DEFS.overview,
      SECTION_NAV_ITEM_DEFS.inbox,
      SECTION_NAV_ITEM_DEFS.standup,
      SECTION_NAV_ITEM_DEFS.performance,
    ],
  },
  {
    id: "organization",
    items: [
      SECTION_NAV_ITEM_DEFS.agents,
      SECTION_NAV_ITEM_DEFS.hiring,
      SECTION_NAV_ITEM_DEFS.goals,
      SECTION_NAV_ITEM_DEFS.projects,
    ],
  },
  {
    id: "execution",
    items: [
      SECTION_NAV_ITEM_DEFS.tasks,
      SECTION_NAV_ITEM_DEFS.approvals,
      SECTION_NAV_ITEM_DEFS.runs,
      SECTION_NAV_ITEM_DEFS.costs,
      SECTION_NAV_ITEM_DEFS.activity,
    ],
  },
  {
    id: "operations",
    items: [
      SECTION_NAV_ITEM_DEFS.workspaces,
      SECTION_NAV_ITEM_DEFS.documents,
      SECTION_NAV_ITEM_DEFS.knowledge,
      SECTION_NAV_ITEM_DEFS.automation,
      SECTION_NAV_ITEM_DEFS.connectors,
    ],
  },
  {
    id: "collaboration",
    items: [
      SECTION_NAV_ITEM_DEFS.communication,
      SECTION_NAV_ITEM_DEFS.meetings,
      SECTION_NAV_ITEM_DEFS.sprints,
      SECTION_NAV_ITEM_DEFS.social,
      SECTION_NAV_ITEM_DEFS.skills,
    ],
  },
] as const satisfies readonly NavGroupDef[];

export const SETTINGS_NAV_ITEM_DEF = SECTION_NAV_ITEM_DEFS.settings;

export const DASHBOARD_NAV_TARGETS = [
  "approvals",
  "runs",
  "communication",
  "costs",
] as const satisfies readonly SectionId[];
