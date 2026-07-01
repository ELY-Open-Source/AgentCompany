export interface OfficeAgent {
  id: string;
  name: string;
  role: string;
  department: string;
  status: "active" | "thinking" | "busy" | "idle";
  task: string | null;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  faceColor: string;
  shirtColor: string;
  frame: number;
}

const WALL_H = 110;
const DESK_W = 90;
const DESK_SPACING = 140;
const ROW_H = 160;

const WALL = "#3a3a4a";
const FLOOR = "#484858";

export function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, agents: OfficeAgent[], time: number) {
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = FLOOR;
  ctx.fillRect(0, 0, w, h);

  drawWall(ctx, w);
  drawWallDecor(ctx, w, time);
  drawFloorGrid(ctx, w, h);

  const cols = Math.max(2, Math.floor((w - 40) / DESK_SPACING));

  for (let i = 0; i < agents.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const dx = 50 + col * DESK_SPACING;
    const dy = WALL_H + 30 + row * ROW_H;
    drawDesk(ctx, dx, dy, agents[i]);
  }

  const sorted = [...agents].sort((a, b) => a.y - b.y);
  for (const agent of sorted) drawCharacter(ctx, agent, time);
}

export function layoutPositions(count: number, viewW: number): Array<{ x: number; y: number }> {
  const cols = Math.max(2, Math.floor((viewW - 40) / DESK_SPACING));
  return Array.from({ length: count }, (_, i) => ({
    x: 50 + (i % cols) * DESK_SPACING + DESK_W / 2,
    y: WALL_H + 30 + Math.floor(i / cols) * ROW_H + 70,
  }));
}

function drawWall(ctx: CanvasRenderingContext2D, w: number) {
  ctx.fillStyle = WALL;
  ctx.fillRect(0, 0, w, WALL_H);
  ctx.strokeStyle = "#42425a";
  ctx.lineWidth = 0.5;
  for (let x = 0; x < w; x += 24) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WALL_H); ctx.stroke();
  }
  for (let y = 0; y < WALL_H; y += 12) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  ctx.fillStyle = "#333";
  ctx.fillRect(0, WALL_H - 3, w, 3);
}

function drawFloorGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.strokeStyle = "rgba(255,255,255,0.03)";
  ctx.lineWidth = 0.5;
  for (let x = 0; x < w; x += 24) { ctx.beginPath(); ctx.moveTo(x, WALL_H); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = WALL_H; y < h; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
}

function drawWallDecor(ctx: CanvasRenderingContext2D, w: number, time: number) {
  drawWindow(ctx, 20, 10, 80, 60, time);
  if (w > 500) drawWindow(ctx, w - 110, 10, 80, 60, time);
  drawClock(ctx, Math.min(w / 2, 300), 45, 22, time);
  if (w > 400) drawBoard(ctx, Math.min(w / 2 + 60, w - 160), 12, 100, 70);
}

function drawWindow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, time: number) {
  ctx.fillStyle = "#1a1a3a";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#666";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);
  ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.stroke();
  const seed = Math.floor(time * 0.0001);
  for (let bx = x + 6; bx < x + w - 6; bx += 10) {
    for (let by = y + h - 40; by < y + h - 4; by += 7) {
      const on = ((bx * 7 + by * 13 + seed) % 5) > 1;
      ctx.fillStyle = on ? "#ffa" : "#334";
      ctx.fillRect(bx, by, 3, 3);
    }
  }
  ctx.fillStyle = "#ff8";
  ctx.beginPath(); ctx.arc(x + w * 0.75, y + 12, 5, 0, Math.PI * 2); ctx.fill();
}

function drawClock(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, time: number) {
  ctx.fillStyle = "#eee";
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const min = (time * 0.0005) % (Math.PI * 2);
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(min / 12 - Math.PI / 2) * r * 0.5, cy + Math.sin(min / 12 - Math.PI / 2) * r * 0.5); ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(min - Math.PI / 2) * r * 0.7, cy + Math.sin(min - Math.PI / 2) * r * 0.7); ctx.stroke();
}

function drawBoard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = "#f5f5f0";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = "#333";
  ctx.font = "bold 7px monospace";
  ctx.fillText("TODO", x + 5, y + 12);
  ctx.font = "6px monospace";
  ctx.fillStyle = "#555";
  const items = ["Review PRD", "Ship v1.0", "Fix bug #42", "Deploy"];
  for (let i = 0; i < items.length; i++) ctx.fillText(`• ${items[i]}`, x + 5, y + 22 + i * 10);
}

function drawDesk(ctx: CanvasRenderingContext2D, x: number, y: number, agent: OfficeAgent) {
  const active = agent.status === "active" || agent.status === "thinking";
  const mx = x + DESK_W / 2 - 14;
  const my = y - 26;
  ctx.fillStyle = "#555";
  ctx.fillRect(mx, my, 28, 20);
  ctx.fillStyle = active ? "#1a3a2a" : "#222";
  ctx.fillRect(mx + 2, my + 2, 24, 14);
  if (active && agent.task) {
    ctx.fillStyle = "#4f8";
    ctx.font = "5px monospace";
    ctx.fillText(agent.task.slice(0, 16), mx + 3, my + 10);
  }
  ctx.fillStyle = "#555";
  ctx.fillRect(mx + 11, my + 20, 6, 3);
  ctx.fillRect(mx + 6, my + 23, 16, 2);

  ctx.fillStyle = "#8b7355";
  ctx.fillRect(x, y, DESK_W, 5);
  ctx.fillStyle = "#6b5335";
  ctx.fillRect(x + 4, y + 5, 3, 30);
  ctx.fillRect(x + DESK_W - 7, y + 5, 3, 30);

  ctx.fillStyle = "#666";
  ctx.fillRect(x + DESK_W / 2 - 10, y - 2, 20, 3);

  if (active) {
    ctx.fillStyle = "#86654a";
    ctx.fillRect(x + DESK_W - 16, y - 7, 7, 7);
    ctx.fillStyle = "#f5f0e8";
    ctx.fillRect(x + DESK_W - 15, y - 6, 5, 3);
  }
}

function drawCharacter(ctx: CanvasRenderingContext2D, agent: OfficeAgent, time: number) {
  const x = Math.round(agent.x);
  const y = Math.round(agent.y);
  const active = agent.status === "active" || agent.status === "thinking";
  const bob = active ? Math.sin(time * 0.003 + agent.frame) * 1.5 : 0;

  ctx.fillStyle = "#222";
  ctx.beginPath(); ctx.arc(x - 9, y - 36 + bob, 10, Math.PI, 0); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 9, y - 36 + bob, 10, Math.PI, 0, true); ctx.fill();
  ctx.fillRect(x - 9, y - 36 + bob, 18, 5);
  ctx.beginPath(); ctx.arc(x - 12, y - 34 + bob, 4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 12, y - 34 + bob, 4, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = agent.faceColor;
  ctx.beginPath(); ctx.arc(x, y - 30 + bob, 9, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.fillRect(x - 4, y - 32 + bob, 3, 3);
  ctx.fillRect(x + 1, y - 32 + bob, 3, 3);
  ctx.fillStyle = "#111";
  ctx.fillRect(x - 3, y - 31 + bob, 2, 2);
  ctx.fillRect(x + 2, y - 31 + bob, 2, 2);

  ctx.fillStyle = agent.shirtColor;
  ctx.fillRect(x - 9, y - 20 + bob, 18, 14);

  ctx.fillStyle = agent.faceColor;
  ctx.fillRect(x - 11, y - 18 + bob, 3, 8);
  ctx.fillRect(x + 8, y - 18 + bob, 3, 8);

  ctx.fillStyle = "#444";
  ctx.fillRect(x - 5, y - 6 + bob, 4, 7);
  ctx.fillRect(x + 1, y - 6 + bob, 4, 7);
  ctx.fillStyle = "#333";
  ctx.fillRect(x - 6, y + 1 + bob, 5, 3);
  ctx.fillRect(x + 1, y + 1 + bob, 5, 3);

  if (active) {
    ctx.fillStyle = agent.status === "active" ? "#34d399" : "#818cf8";
    ctx.beginPath(); ctx.arc(x + 11, y - 40 + bob, 3, 0, Math.PI * 2); ctx.fill();
  }

  if (agent.task && active) {
    const text = agent.task.slice(0, 20);
    ctx.font = "7px sans-serif";
    const tw = ctx.measureText(text).width + 10;
    const bx = x - tw / 2;
    const by = y - 50 + bob;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(bx + 3, by); ctx.lineTo(bx + tw - 3, by); ctx.arcTo(bx + tw, by, bx + tw, by + 3, 3);
    ctx.lineTo(bx + tw, by + 13); ctx.arcTo(bx + tw, by + 16, bx + tw - 3, by + 16, 3);
    ctx.lineTo(bx + 3, by + 16); ctx.arcTo(bx, by + 16, bx, by + 13, 3);
    ctx.lineTo(bx, by + 3); ctx.arcTo(bx, by, bx + 3, by, 3);
    ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 3, by + 16); ctx.lineTo(x, by + 20); ctx.lineTo(x + 3, by + 16); ctx.fill();
    ctx.fillStyle = "#333";
    ctx.textAlign = "center";
    ctx.fillText(text, x, by + 11);
    ctx.textAlign = "start";
  }

  ctx.fillStyle = "#bbb";
  ctx.font = "9px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(agent.name.split(" ")[0], x, y + 10);
  ctx.textAlign = "start";
}
