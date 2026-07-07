import {
  Briefcase,
  Buildings2,
  ChatRoundDots,
  DocumentText2,
  Folder,
  Gear,
  Home,
  Plug2,
  Send,
  ShieldCheck,
  Users,
} from "reicon-react";
import type { RouteId } from "./Shell";

/** One glyph per navigation surface, from the Reicon set. */
const NAV_ICONS: Record<RouteId, typeof Home> = {
  home: Home,
  work: Briefcase,
  team: Users,
  chat: ChatRoundDots,
  runs: Send,
  files: Folder,
  approvals: ShieldCheck,
  docs: DocumentText2,
  connectors: Plug2,
  office: Buildings2,
  settings: Gear,
};

export function NavIcon({ route, size = 18 }: { route: RouteId; size?: number }) {
  const Glyph = NAV_ICONS[route];
  return <Glyph size={size} />;
}
