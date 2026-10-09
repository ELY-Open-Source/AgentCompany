import { isBusinessTask } from "./work/task-helpers";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { PageProps } from "./types";
import { activeOrgId, requireActiveEmployee } from "./types";
import { hashString, renderOffice, type RenderPerson } from "./office/office-renderer";
import { OfficeSimulation, cameraFor, type MoveInput } from "./office/simulation";
import { AgentDetailCard } from "./office/AgentDetailCard";
import { officeStateLabel } from "../i18n/labels";
import { cardPositionFor, CARD_FALLBACK_H } from "./office/agent-card-position";
import { isoFrame, isoPixelSize, pickAt, toIso, type IsoFrame } from "./office/iso";
import { dayPart, season } from "../shared/palette-clock";
import { pixelScale } from "../shared/pixel-scale";
import type { Camera, OfficeAgentInput } from "./office/office-types";
import { officeStatus } from "./office/agent-state";
import { t } from "../i18n/i18n";

const FPS_INTERVAL = 1000 / 24;

const KEY_BINDINGS: Record<string, keyof MoveInput> = {
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

export function OfficePage({ snapshot }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const employee = requireActiveEmployee(snapshot);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const keysRef = useRef<MoveInput>({ up: false, down: false, left: false, right: false });
  const cameraRef = useRef<Camera>({ x: 0, y: 0 });
  /** How the last frame mapped plan to screen, for turning clicks into picks. */
  const viewRef = useRef<{ frame: IsoFrame; pixel: number } | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const cardBoxRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const simRef = useRef<OfficeSimulation | null>(null);
  if (simRef.current === null) simRef.current = new OfficeSimulation();

  const inputs = useMemo<OfficeAgentInput[]>(() => {
    const orgAgents = snapshot.agents
      .filter((agent) => agent.orgId === orgId && agent.lifecycle === "active")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const allTasks = snapshot.tasks.filter((task) => task.orgId === orgId);
    const orgTasks = allTasks.filter(isBusinessTask);
    return orgAgents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      title: agent.title,
      department: agent.department,
      roleLevel: agent.roleLevel,
      status: officeStatus(agent.id, { runs: snapshot.taskRuns, tasks: allTasks, approvals: snapshot.approvals }),
      taskTitle: orgTasks.find((task) => task.assigneeAgentId === agent.id && task.status === "in_progress")?.title ?? null,
    }));
  }, [snapshot.agents, snapshot.tasks, snapshot.approvals, snapshot.taskRuns, orgId]);

  useEffect(() => {
    simRef.current!.sync(inputs);
  }, [inputs]);

  const selectedAgent = selectedId ? inputs.find((input) => input.id === selectedId) ?? null : null;

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (selectedIdRef.current) setSelectedId(null);
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, []);

  useEffect(() => {
    simRef.current!.syncPlayer(employee.id, employee.displayName);
  }, [employee.id, employee.displayName]);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
    const onKeyDown = (event: KeyboardEvent) => {
      const key = KEY_BINDINGS[event.code];
      if (!key || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      event.preventDefault();
      keysRef.current[key] = true;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const key = KEY_BINDINGS[event.code];
      if (!key) return;
      keysRef.current[key] = false;
    };
    const releaseAll = () => {
      keysRef.current = { up: false, down: false, left: false, right: false };
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseAll);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let running = true;
    let raf = 0;
    let lastFrame = 0;
    const scene = document.createElement("canvas");

    const tick = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      const elapsed = now - lastFrame;
      if (elapsed < FPS_INTERVAL) return;
      lastFrame = now;

      const viewW = canvas.clientWidth;
      const viewH = canvas.clientHeight;
      if (viewW === 0 || viewH === 0) return;
      const dpr = window.devicePixelRatio || 1;
      const backingW = Math.round(viewW * dpr);
      const backingH = Math.round(viewH * dpr);
      if (canvas.width !== backingW || canvas.height !== backingH) {
        canvas.width = backingW;
        canvas.height = backingH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const sim = simRef.current!;
      sim.step(elapsed, keysRef.current);
      const frame = isoFrame(sim.plan.world);
      const pixel = isoPixelSize(dpr);
      const focus = sim.player ? { x: sim.player.x, y: sim.player.y } : { x: sim.plan.world.w / 2, y: sim.plan.world.h / 2 };
      const camera = cameraFor(frame.size, viewW / pixel, viewH / pixel, toIso(frame, focus));
      cameraRef.current = camera;
      viewRef.current = { frame, pixel };
      const people: RenderPerson[] = sim.agents.map((agent) => ({
        id: agent.input.id,
        name: agent.input.name,
        state: agent.input.status.state,
        x: agent.x,
        y: agent.y,
        desk: agent.isCeo ? sim.plan.ceoDesk : sim.plan.desks[agent.deskIndex!].bounds,
        isCeo: agent.isCeo,
        isPlayer: false,
        animSeed: hashString(agent.input.id) % 100,
        appearance: agent.appearance,
        facing: agent.facing,
        walkPhase: agent.walkPhase,
        carrying: agent.carrying,
      }));
      if (sim.player) {
        people.push({
          id: `board:${sim.player.employeeId}`,
          name: sim.player.name,
          state: "idle",
          x: sim.player.x,
          y: sim.player.y,
          desk: null,
          isCeo: false,
          isPlayer: true,
          animSeed: hashString(sim.player.employeeId) % 100,
          appearance: sim.player.appearance,
          facing: sim.player.facing,
          walkPhase: sim.player.walkPhase,
          carrying: null,
        });
      }
      const clock = new Date();
      renderOffice(ctx, scene, {
        frame,
        plan: sim.plan,
        camera,
        pixel,
        fontScale: pixelScale(dpr),
        viewW,
        viewH,
        people,
        timeMs: now,
        clock,
        dayPart: dayPart(clock),
        season: season(clock),
        selectedId: selectedIdRef.current,
      });

      // The detail card rides beside its agent, even while they walk.
      const cardBox = cardBoxRef.current;
      const selected = selectedIdRef.current
        ? sim.agents.find((agent) => agent.input.id === selectedIdRef.current) ?? null
        : null;
      if (cardBox && selected) {
        const cardH = cardBox.offsetHeight || CARD_FALLBACK_H;
        const feet = toIso(frame, selected);
        const position = cardPositionFor({ x: (feet.x - camera.x) * pixel, y: (feet.y - camera.y) * pixel }, { x: 0, y: 0 }, viewW, viewH, cardH);
        cardBox.style.transform = `translate(${position.left}px, ${position.top}px)`;
        cardBox.style.visibility = "visible";
      }
    };

    raf = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  /** The agent drawn under the pointer, picked in the same iso pixels the frame was drawn in. */
  const agentAt = (event: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const view = viewRef.current;
    if (!canvas || !view) return null;
    const bounds = canvas.getBoundingClientRect();
    const point = {
      x: (event.clientX - bounds.left) / view.pixel + Math.round(cameraRef.current.x),
      y: (event.clientY - bounds.top) / view.pixel + Math.round(cameraRef.current.y),
    };
    return pickAt(view.frame, simRef.current!.agents, point);
  };

  const onCanvasClick = (event: MouseEvent<HTMLCanvasElement>) => {
    const hit = agentAt(event);
    setSelectedId(hit ? hit.input.id : null);
  };

  const onCanvasMouseMove = (event: MouseEvent<HTMLCanvasElement>) => {
    event.currentTarget.style.cursor = agentAt(event) ? "pointer" : "default";
  };

  return (
    <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={t("Office floor. People here: {count}. The person list in the toolbar shows each of them.", { count: inputs.length })}
        onClick={onCanvasClick}
        onMouseMove={onCanvasMouseMove}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      {selectedAgent && (
        <div ref={cardBoxRef} style={{ position: "absolute", left: 0, top: 0, willChange: "transform", visibility: "hidden" }}>
          <AgentDetailCard agent={selectedAgent} onClose={() => setSelectedId(null)} />
        </div>
      )}
      <div className="office-toolbar" role="toolbar" aria-label={t("Office tools")}>
        <select
          className="input"
          aria-label={t("Show a person")}
          value={selectedId ?? ""}
          onChange={(event) => setSelectedId(event.target.value || null)}
          style={{ width: 200 }}
        >
          <option value="">{t("Show a person…")}</option>
          {inputs.map((input) => <option key={input.id} value={input.id}>{t("{name}, {activity}", { name: input.name, activity: officeStateLabel(input.status.state) })}</option>)}
        </select>
      </div>
    </div>
  );
}
