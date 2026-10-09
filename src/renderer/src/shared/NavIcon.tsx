import { Icon, type IconName } from "./Icon";
import type { RouteId } from "./Shell";

/** One pixel glyph per navigation surface. */
const NAV_ICONS: Record<RouteId, IconName> = {
  home: "home",
  work: "work",
  team: "team",
  chat: "chat",
  runs: "send",
  files: "folder",
  library: "book",
  approvals: "approve",
  connectors: "plug",
  office: "building",
  settings: "settings",
};

export function NavIcon({ route }: { route: RouteId }) {
  return <Icon name={NAV_ICONS[route]} />;
}
