import { useEffect, useMemo, useRef } from "react";
import { Avatar } from "../../shared/ui";
import type { AgentRecord, EmployeeRecord } from "../../../../shared/domain";

const NODE_W = 208;
const NODE_H = 64;
const H_GAP = 24;
const V_GAP = 44;
const LEVEL_H = NODE_H + V_GAP;

interface LayoutNode {
  id: string;
  name: string;
  role: string;
  human: boolean;
  agentId: string | null;
  children: LayoutNode[];
  x: number;
  y: number;
  width: number;
}

interface Edge {
  px: number;
  py: number;
  cx: number;
  cy: number;
}

/**
 * Hierarchical reporting tree with a real layout pass: each subtree's width is
 * measured bottom-up, children are laid out left-to-right, and every parent is
 * centered over the span of its reports. Connectors are orthogonal elbows. The
 * whole chart is sized to its content and scrolls horizontally when wide.
 */
export function OrgChartTree({
  boardChair,
  agents,
  onSelectAgent,
}: {
  boardChair: EmployeeRecord | null;
  agents: AgentRecord[];
  onSelectAgent: (agentId: string) => void;
}) {
  const layout = useMemo(() => buildLayout(boardChair, agents), [boardChair, agents]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootX = layout?.root.x ?? 0;

  // Open the chart looking at the top of the company, not a wall of whitespace.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, rootX - el.clientWidth / 2);
  }, [rootX]);

  if (!layout) return null;
  const { root, width, height } = layout;
  const nodes = flatten(root);
  const edges = collectEdges(root);

  return (
    <div ref={scrollRef} className="org-scroll">
      <div className="org-canvas" style={{ position: "relative", width, height, margin: "20px auto 4px" }}>
        <svg width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} aria-hidden="true">
          {edges.map((edge, index) => (
            <path key={index} d={elbow(edge)} stroke="var(--border-strong)" fill="none" strokeWidth={1} />
          ))}
        </svg>
        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            className={`org-node-card ${node.human ? "human" : ""}`.trim()}
            style={{ left: node.x - NODE_W / 2, top: node.y, width: NODE_W, height: NODE_H }}
            onClick={() => { if (node.agentId) onSelectAgent(node.agentId); }}
            disabled={!node.agentId}
          >
            <Avatar name={node.name} bot={!node.human} size="sm" />
            <span className="org-node-text">
              <span className="org-node-name">{node.name}</span>
              <span className="org-node-role">{node.role}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function buildLayout(
  boardChair: EmployeeRecord | null,
  agents: AgentRecord[],
): { root: LayoutNode; width: number; height: number } | null {
  const known = new Set(agents.map((agent) => agent.id));
  const byManager = new Map<string, AgentRecord[]>();
  for (const agent of agents) {
    const key = agent.managerAgentId && known.has(agent.managerAgentId) ? agent.managerAgentId : "__root__";
    const siblings = byManager.get(key) ?? [];
    siblings.push(agent);
    byManager.set(key, siblings);
  }

  const toNode = (agent: AgentRecord): LayoutNode => ({
    id: agent.id,
    name: agent.name,
    role: agent.title || agent.role,
    human: false,
    agentId: agent.id,
    children: (byManager.get(agent.id) ?? []).map(toNode),
    x: 0,
    y: 0,
    width: 0,
  });

  const roots = (byManager.get("__root__") ?? []).map(toNode);
  if (!boardChair && roots.length === 0) return null;

  const root: LayoutNode = boardChair
    ? { id: boardChair.id, name: boardChair.displayName, role: boardChair.role, human: true, agentId: null, children: roots, x: 0, y: 0, width: 0 }
    : roots.length === 1
      ? roots[0]
      : { id: "__org__", name: "Organization", role: "Reporting lines", human: false, agentId: null, children: roots, x: 0, y: 0, width: 0 };

  measure(root);
  let maxDepth = 0;
  const place = (node: LayoutNode, left: number, depth: number) => {
    maxDepth = Math.max(maxDepth, depth);
    node.y = depth * LEVEL_H;
    if (node.children.length === 0) {
      node.x = left + NODE_W / 2;
      return;
    }
    const span = childrenSpan(node.children);
    let cursor = left + (node.width - span) / 2;
    for (const child of node.children) {
      place(child, cursor, depth + 1);
      cursor += child.width + H_GAP;
    }
    node.x = (node.children[0].x + node.children[node.children.length - 1].x) / 2;
  };
  place(root, 0, 0);

  return { root, width: root.width, height: (maxDepth + 1) * LEVEL_H - V_GAP };
}

function measure(node: LayoutNode): number {
  if (node.children.length === 0) {
    node.width = NODE_W;
    return node.width;
  }
  const span = node.children.reduce((total, child) => total + measure(child), 0) + (node.children.length - 1) * H_GAP;
  node.width = Math.max(NODE_W, span);
  return node.width;
}

function childrenSpan(children: LayoutNode[]): number {
  return children.reduce((total, child) => total + child.width, 0) + (children.length - 1) * H_GAP;
}

function flatten(node: LayoutNode): LayoutNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

function collectEdges(node: LayoutNode): Edge[] {
  return node.children.flatMap((child) => [
    { px: node.x, py: node.y + NODE_H, cx: child.x, cy: child.y },
    ...collectEdges(child),
  ]);
}

function elbow(edge: Edge): string {
  const midY = edge.py + V_GAP / 2;
  return `M ${edge.px} ${edge.py} L ${edge.px} ${midY} L ${edge.cx} ${midY} L ${edge.cx} ${edge.cy}`;
}
