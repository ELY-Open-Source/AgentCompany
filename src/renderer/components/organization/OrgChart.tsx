import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Heartbeat } from "@phosphor-icons/react";
import type { AgentRecord } from "@shared/types";
import { getAgentInitials } from "../../lib/formatters";
import { EmptyState } from "../ui";
import { useT } from "../../i18n";
import { buildOrgTree, layoutForest, flattenLayout, collectEdges, statusDotColor, adapterLabels, CARD_W, CARD_H, CHART_PADDING } from "./orgTreeLayout";

export function OrgChart({ agents, onSelectAgent }: { agents: AgentRecord[]; onSelectAgent?: (agentId: string) => void }) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const orgTree = useMemo(() => buildOrgTree(agents), [agents]);
  const layout = useMemo(() => layoutForest(orgTree), [orgTree]);
  const allNodes = useMemo(() => flattenLayout(layout), [layout]);
  const edges = useMemo(() => collectEdges(layout), [layout]);
  const bounds = useMemo(() => {
    if (allNodes.length === 0) return { width: 800, height: 600 };
    let maxX = 0, maxY = 0;
    for (const n of allNodes) { maxX = Math.max(maxX, n.x + CARD_W); maxY = Math.max(maxY, n.y + CARD_H); }
    return { width: maxX + CHART_PADDING, height: maxY + CHART_PADDING };
  }, [allNodes]);

  const hasInitialized = useRef(false);
  useEffect(() => {
    if (hasInitialized.current || allNodes.length === 0 || !containerRef.current) return;
    hasInitialized.current = true;
    const cW = containerRef.current.clientWidth;
    const cH = containerRef.current.clientHeight;
    const fitZoom = Math.min((cW - 40) / bounds.width, (cH - 40) / bounds.height, 1);
    setZoom(fitZoom);
    setPan({ x: (cW - bounds.width * fitZoom) / 2, y: (cH - bounds.height * fitZoom) / 2 });
  }, [allNodes, bounds]);

  const fitToScreen = useCallback(() => {
    if (!containerRef.current) return;
    const cW = containerRef.current.clientWidth;
    const cH = containerRef.current.clientHeight;
    const fitZoom = Math.min((cW - 40) / bounds.width, (cH - 40) / bounds.height, 1);
    setZoom(fitZoom);
    setPan({ x: (cW - bounds.width * fitZoom) / 2, y: (cH - bounds.height * fitZoom) / 2 });
  }, [bounds]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("[data-org-card]")) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setPan({ x: dragStart.current.panX + (e.clientX - dragStart.current.x), y: dragStart.current.panY + (e.clientY - dragStart.current.y) });
  }, [dragging]);
  const handleMouseUp = useCallback(() => setDragging(false), []);
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const nz = Math.min(Math.max(zoom * (e.deltaY < 0 ? 1.1 : 0.9), 0.2), 2);
    const s = nz / zoom;
    setPan({ x: mx - s * (mx - pan.x), y: my - s * (my - pan.y) });
    setZoom(nz);
  }, [zoom, pan]);

  if (agents.length === 0) return <EmptyState title={t("org.noAgentsToDisplay")} detail={t("org.noAgentsToDisplayDetail")} />;

  const zoomIn = () => { const nz = Math.min(zoom * 1.2, 2); const c = containerRef.current; if (c) { const cx = c.clientWidth / 2; const cy = c.clientHeight / 2; const s = nz / zoom; setPan({ x: cx - s * (cx - pan.x), y: cy - s * (cy - pan.y) }); } setZoom(nz); };
  const zoomOut = () => { const nz = Math.max(zoom * 0.8, 0.2); const c = containerRef.current; if (c) { const cx = c.clientWidth / 2; const cy = c.clientHeight / 2; const s = nz / zoom; setPan({ x: cx - s * (cx - pan.x), y: cy - s * (cy - pan.y) }); } setZoom(nz); };

  return (
    <div ref={containerRef} className="relative min-h-[400px] h-[clamp(400px,60vh,720px)] w-full overflow-hidden rounded-[8px] border border-[color:var(--line)] bg-[color:var(--bg)]" style={{ cursor: dragging ? "grabbing" : "grab" }} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} onWheel={handleWheel}>
      <div className="absolute right-3 top-3 z-10 flex flex-col gap-1">
        {[{ label: "+", ariaLabel: "Zoom in", action: zoomIn }, { label: "\u2212", ariaLabel: "Zoom out", action: zoomOut }, { label: "Fit", ariaLabel: "Fit chart to screen", action: fitToScreen }].map((btn) => (
          <button key={btn.ariaLabel} className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[color:var(--line)] bg-[color:var(--panel)] text-[12px] text-[color:var(--text)] transition hover:bg-[color:var(--panel-soft)]" onClick={btn.action} aria-label={btn.ariaLabel}>{btn.label}</button>
        ))}
      </div>
      <svg className="pointer-events-none absolute inset-0" style={{ width: "100%", height: "100%" }}>
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {edges.map(({ parent, child }) => {
            const x1 = parent.x + CARD_W / 2, y1 = parent.y + CARD_H, x2 = child.x + CARD_W / 2, y2 = child.y;
            const midY = (y1 + y2) / 2;
            const isChildRunning = child.agent.status === "running";
            return <path key={`${parent.agent.id}-${child.agent.id}`} d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`} fill="none" stroke={isChildRunning ? "var(--success)" : "var(--line-strong)"} strokeWidth={isChildRunning ? 2 : 1.5} strokeDasharray={isChildRunning ? "6 3" : "none"} opacity={isChildRunning ? 0.8 : 0.5} />;
          })}
        </g>
      </svg>
      <div className="absolute inset-0" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0" }}>
        {allNodes.map((node) => {
          const dotColor = statusDotColor[node.agent.status] ?? "#a3a3a3";
          const connectorLabel = adapterLabels[node.agent.connectorId] ?? node.agent.connectorId;
          const initials = getAgentInitials(node.agent.name);
          const isRunning = node.agent.status === "running";
          const isActive = node.agent.status === "active" || isRunning;
          const isError = node.agent.status === "error";
          const isPending = node.agent.status === "pending_approval";
          const isCEO = node.children.length > 0 && !node.agent.reportsTo;
          return (
            <div key={node.agent.id} data-org-card className={`absolute cursor-pointer select-none rounded-[8px] border bg-[color:var(--panel)] shadow-sm transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 ${isRunning ? "border-[color:var(--success)] shadow-[0_0_12px_rgba(74,222,128,0.15)]" : isError ? "border-[color:var(--danger)] border-opacity-50" : isPending ? "border-[color:var(--warn)] border-dashed" : "border-[color:var(--line)] hover:border-[color:var(--line-strong)]"}`} style={{ left: node.x, top: node.y, width: CARD_W, minHeight: CARD_H }} onClick={() => onSelectAgent?.(node.agent.id)}>
              <div className={`rounded-t-[7px] ${isCEO ? "h-[4px] bg-[color:var(--accent)]" : node.children.length > 0 ? "h-[3px] bg-[color:var(--warn)]" : "h-[2px] bg-[color:var(--muted)] opacity-30"}`} />
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="relative shrink-0">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-full text-[13px] font-bold ${isActive ? "bg-[color:var(--success-soft)] text-[color:var(--success)]" : isError ? "bg-[color:var(--danger-soft)] text-[color:var(--danger)]" : "bg-[color:var(--panel-soft)] text-[color:var(--muted-strong)]"}`}>{initials}</div>
                  {isRunning ? (
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5" aria-hidden="true">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-40" style={{ backgroundColor: dotColor, willChange: "transform" }} />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-[color:var(--panel)]" style={{ backgroundColor: dotColor }} />
                    </span>
                  ) : (
                    <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[color:var(--panel)]" style={{ backgroundColor: dotColor }} aria-hidden="true" />
                  )}
                  <span className="sr-only">{`Status: ${node.agent.status}`}</span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col items-start">
                  <span className="truncate text-[14px] font-semibold leading-tight text-[color:var(--text)]">{node.agent.name}</span>
                  <span className="mt-0.5 text-[11px] leading-tight text-[color:var(--muted)]">{node.agent.title || node.agent.role}</span>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="rounded bg-[color:var(--panel-soft)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{connectorLabel}</span>
                    {node.agent.heartbeatEnabled ? <Heartbeat size={10} className="text-[color:var(--success)]" /> : null}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
