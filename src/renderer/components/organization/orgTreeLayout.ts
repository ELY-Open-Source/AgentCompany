import type { AgentRecord } from "@shared/types";

export const CARD_W = 220;
export const CARD_H = 110;
export const GAP_X = 32;
export const GAP_Y = 80;
export const CHART_PADDING = 60;

export interface OrgTreeNode {
  agent: AgentRecord;
  children: OrgTreeNode[];
}

export interface LayoutNode {
  agent: AgentRecord;
  x: number;
  y: number;
  children: LayoutNode[];
}

export function buildOrgTree(agents: AgentRecord[]): OrgTreeNode[] {
  const agentIds = new Set(agents.map((a) => a.id));
  const childrenMap = new Map<string, AgentRecord[]>();
  const roots: AgentRecord[] = [];
  for (const agent of agents) {
    if (!agent.reportsTo || !agentIds.has(agent.reportsTo)) {
      roots.push(agent);
    } else {
      const list = childrenMap.get(agent.reportsTo) ?? [];
      list.push(agent);
      childrenMap.set(agent.reportsTo, list);
    }
  }
  function toNode(agent: AgentRecord): OrgTreeNode {
    const kids = childrenMap.get(agent.id) ?? [];
    return { agent, children: kids.map(toNode) };
  }
  return roots.map(toNode);
}

export function subtreeWidth(node: OrgTreeNode): number {
  if (node.children.length === 0) return CARD_W;
  const childrenW = node.children.reduce((sum, c) => sum + subtreeWidth(c), 0);
  const gaps = (node.children.length - 1) * GAP_X;
  return Math.max(CARD_W, childrenW + gaps);
}

function layoutTree(node: OrgTreeNode, x: number, y: number): LayoutNode {
  const totalW = subtreeWidth(node);
  const layoutChildren: LayoutNode[] = [];
  if (node.children.length > 0) {
    const childrenW = node.children.reduce((sum, c) => sum + subtreeWidth(c), 0);
    const gaps = (node.children.length - 1) * GAP_X;
    let cx = x + (totalW - childrenW - gaps) / 2;
    for (const child of node.children) {
      const cw = subtreeWidth(child);
      layoutChildren.push(layoutTree(child, cx, y + CARD_H + GAP_Y));
      cx += cw + GAP_X;
    }
  }
  return { agent: node.agent, x: x + (totalW - CARD_W) / 2, y, children: layoutChildren };
}

export function layoutForest(roots: OrgTreeNode[]): LayoutNode[] {
  let x = CHART_PADDING;
  return roots.map((root) => {
    const w = subtreeWidth(root);
    const node = layoutTree(root, x, CHART_PADDING);
    x += w + GAP_X;
    return node;
  });
}

export function flattenLayout(nodes: LayoutNode[]): LayoutNode[] {
  const result: LayoutNode[] = [];
  function walk(n: LayoutNode) { result.push(n); n.children.forEach(walk); }
  nodes.forEach(walk);
  return result;
}

export function collectEdges(nodes: LayoutNode[]): Array<{ parent: LayoutNode; child: LayoutNode }> {
  const edges: Array<{ parent: LayoutNode; child: LayoutNode }> = [];
  function walk(n: LayoutNode) { for (const c of n.children) { edges.push({ parent: n, child: c }); walk(c); } }
  nodes.forEach(walk);
  return edges;
}

export const statusDotColor: Record<string, string> = {
  running: "var(--accent)",
  active: "var(--success)",
  paused: "var(--warn)",
  idle: "var(--muted)",
  error: "var(--danger)",
  terminated: "var(--muted)",
  pending_approval: "var(--warn)",
};

export const adapterLabels: Record<string, string> = {
  claude_local: "Claude",
  codex_local: "Codex",
  gemini_local: "Gemini",
};
