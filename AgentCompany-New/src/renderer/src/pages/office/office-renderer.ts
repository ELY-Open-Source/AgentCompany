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
  deskX: number;
  deskY: number;
  faceColor: string;
  shirtColor: string;
  frame: number;
  facing: number;
}

const WALL_H = 120;
const TILE = 24;
const DESK_W = 100;
const DESK_H = 48;
const CHAR_H = 44;

const WALL = "#3a3a4a";
const WALL_TILE = "#424252";
const FLOOR = "#4a4a5a";
const FLOOR_TILE = "#52526a";
const DESK_TOP = "#8b7355";
const DESK_LEG = "#6b5335";
const MONITOR_BODY = "#555";
const MONITOR_SCREEN = "#222";
const MONITOR_ACTIVE = "#1a3a2a";

export function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, agents: OfficeAgent[], time: number) {
  drawFloor(ctx, w, h);
  drawWall(ctx, w);
  drawWallDecorations(ctx, w, time);

  const groups = groupByDepartment(agents);
  let col = 0;
  let row = 0;
  const cols = Math.max(1, Math.floor((w - 40) / (DESK_W + 60)));
  for (const [, group] of groups) {
    for (const agent of group) {
      agent.deskX = 60 + (col % cols) * (DESK_W + 60);
      agent.deskY = WALL_H + 40 + row * (DESK_H + 90);
      if (agent.status !== "idle") {
        agent.targetX = agent.deskX + DESK_W / 2;
        agent.targetY = agent.deskY + DESK_H + 8;
      }
      col++;
      if (col % cols === 0) row++;
    }
    if (col % cols !== 0) { row++; col = Math.ceil(col / cols) * cols; }
  }

  for (const [, group] of groups) {
    for (const agent of group) drawDeskUnit(ctx, agent, time);
  }

  const sorted = [...agents].sort((a, b) => a.y - b.y);
  for (const agent of sorted) drawCharacter(ctx, agent, time);
}

function drawFloor(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = FLOOR;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = FLOOR_TILE;
  ctx.lineWidth = 0.5;
  for (let x = 0; x < w; x += TILE) { ctx.beginPath(); ctx.moveTo(x, WALL_H); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = WALL_H; y < h; y += TILE) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
}

function drawWall(ctx: CanvasRenderingContext2D, w: number) {
  ctx.fillStyle = WALL;
  ctx.fillRect(0, 0, w, WALL_H);
  ctx.strokeStyle = WALL_TILE;
  ctx.lineWidth = 0.5;
  for (let x = 0; x < w; x += TILE) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WALL_H); ctx.stroke(); }
  for (let y = 0; y < WALL_H; y += TILE / 2) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.fillStyle = "#333";
  ctx.fillRect(0, WALL_H - 4, w, 4);
}

function drawWallDecorations(ctx: CanvasRenderingContext2D, w: number, time: number) {
  drawCityWindow(ctx, 30, 12, 90, 70);
  if (w > 400) drawCityWindow(ctx, w - 130, 12, 90, 70);
  drawClock(ctx, w / 2, 50, 28, time);
  if (w > 600) drawWhiteboard(ctx, w / 2 + 80, 14, 120, 76);
  if (w > 300) drawPainting(ctx, 160, 16, 60, 50);
}

function drawCityWindow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = "#1a1a3a";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#666";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.stroke();
  for (let bx = x + 8; bx < x + w - 8; bx += 14) {
    for (let by = y + h - 50; by < y + h - 6; by += 8) {
      ctx.fillStyle = Math.random() > 0.4 ? "#ff9" : "#553";
      ctx.fillRect(bx, by, 4, 4);
    }
  }
  ctx.fillStyle = "#446";
  ctx.fillRect(x + 2, y + 2, 8, 8);
  ctx.fillStyle = "#ff8";
  ctx.beginPath(); ctx.arc(x + 6, y + 6, 4, 0, Math.PI * 2); ctx.fill();
}

function drawClock(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, time: number) {
  ctx.fillStyle = "#eee";
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 2;
  ctx.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    ctx.fillStyle = "#333";
    ctx.fillRect(cx + Math.cos(a) * (r - 5) - 1, cy + Math.sin(a) * (r - 5) - 1, 2, 2);
  }
  const min = (time * 0.001) % (Math.PI * 2);
  const hr = min / 12;
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(hr - Math.PI / 2) * (r * 0.5), cy + Math.sin(hr - Math.PI / 2) * (r * 0.5)); ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(min - Math.PI / 2) * (r * 0.7), cy + Math.sin(min - Math.PI / 2) * (r * 0.7)); ctx.stroke();
}

function drawWhiteboard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = "#f5f5f0";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = "#333";
  ctx.font = "bold 7px monospace";
  ctx.fillText("TODO", x + 6, y + 12);
  ctx.font = "6px monospace";
  ctx.fillStyle = "#555";
  const items = ["Review PRD", "Ship v1.0", "Fix bug #42", "Deploy staging"];
  items.forEach((item, i) => ctx.fillText(`• ${item}`, x + 6, y + 22 + i * 10));
}

function drawPainting(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = "#654";
  ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
  ctx.fillStyle = "#1a2a3a";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#2a4a3a";
  ctx.fillRect(x, y + h * 0.6, w, h * 0.4);
  ctx.fillStyle = "#ff8";
  ctx.beginPath(); ctx.arc(x + w * 0.7, y + h * 0.25, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#888";
  ctx.font = "6px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("EMPLOYEE", x + w / 2, y + h + 10);
  ctx.fillText("OF THE MONTH", x + w / 2, y + h + 18);
  ctx.textAlign = "start";
}

function drawDeskUnit(ctx: CanvasRenderingContext2D, agent: OfficeAgent, _time: number) {
  const dx = agent.deskX;
  const dy = agent.deskY;
  ctx.fillStyle = DESK_TOP;
  ctx.fillRect(dx, dy, DESK_W, 6);
  ctx.fillStyle = DESK_LEG;
  ctx.fillRect(dx + 4, dy + 6, 4, DESK_H - 6);
  ctx.fillRect(dx + DESK_W - 8, dy + 6, 4, DESK_H - 6);
  ctx.fillRect(dx + DESK_W / 2 - 2, dy + 6, 4, DESK_H - 10);

  const mx = dx + DESK_W / 2 - 16;
  const my = dy - 28;
  ctx.fillStyle = MONITOR_BODY;
  ctx.fillRect(mx, my, 32, 24);
  ctx.fillStyle = agent.status === "active" ? MONITOR_ACTIVE : MONITOR_SCREEN;
  ctx.fillRect(mx + 2, my + 2, 28, 18);
  ctx.fillStyle = MONITOR_BODY;
  ctx.fillRect(mx + 13, my + 24, 6, 4);
  ctx.fillRect(mx + 8, my + 28, 16, 2);

  if (agent.status === "active" && agent.task) {
    ctx.fillStyle = "#4f8";
    ctx.font = "5px monospace";
    const taskText = agent.task.slice(0, 18);
    ctx.fillText(taskText, mx + 4, my + 12);
  }

  ctx.fillStyle = "#666";
  ctx.fillRect(dx + DESK_W / 2 - 12, dy - 2, 24, 3);
  ctx.fillRect(dx + DESK_W / 2 - 14, dy - 3, 2, 4);
  ctx.fillRect(dx + DESK_W / 2 + 12, dy - 3, 2, 4);

  if (agent.status !== "idle") {
    ctx.fillStyle = "#86654a";
    ctx.fillRect(dx + DESK_W - 20, dy - 8, 8, 8);
    ctx.fillStyle = "#f5f5f0";
    ctx.fillRect(dx + DESK_W - 19, dy - 7, 6, 4);
    ctx.fillStyle = "#86654a";
    ctx.fillRect(dx + DESK_W - 17, dy - 2, 2, 2);
  }
}

function drawCharacter(ctx: CanvasRenderingContext2D, agent: OfficeAgent, time: number) {
  const x = Math.round(agent.x);
  const y = Math.round(agent.y);
  const active = agent.status === "active" || agent.status === "thinking";
  const bob = active ? Math.sin(time * 0.003 + agent.frame) * 1.5 : 0;

  ctx.fillStyle = "#222";
  ctx.beginPath();
  ctx.arc(x - 10, y - CHAR_H + 6 + bob, 12, Math.PI, 0);
  ctx.lineTo(x + 10, y - CHAR_H + 6 + bob);
  ctx.arc(x + 10, y - CHAR_H + 6 + bob, 12, 0, Math.PI, true);
  ctx.fill();

  ctx.fillStyle = agent.faceColor;
  ctx.beginPath(); ctx.arc(x, y - CHAR_H + 10 + bob, 10, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.fillRect(x - 4, y - CHAR_H + 8 + bob, 3, 3);
  ctx.fillRect(x + 1, y - CHAR_H + 8 + bob, 3, 3);
  ctx.fillStyle = "#111";
  ctx.fillRect(x - 3, y - CHAR_H + 9 + bob, 2, 2);
  ctx.fillRect(x + 2, y - CHAR_H + 9 + bob, 2, 2);

  ctx.fillStyle = "#222";
  ctx.fillRect(x - 14, y - CHAR_H + 4 + bob, 4, 10);
  ctx.fillRect(x + 10, y - CHAR_H + 4 + bob, 4, 10);
  ctx.beginPath(); ctx.arc(x - 12, y - CHAR_H + 4 + bob, 5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 12, y - CHAR_H + 4 + bob, 5, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = agent.shirtColor;
  roundRect(ctx, x - 10, y - CHAR_H + 20 + bob, 20, 16, 3);

  ctx.fillStyle = agent.faceColor;
  ctx.fillRect(x - 12, y - CHAR_H + 22 + bob, 4, 10);
  ctx.fillRect(x + 8, y - CHAR_H + 22 + bob, 4, 10);

  ctx.fillStyle = "#444";
  ctx.fillRect(x - 6, y - CHAR_H + 36 + bob, 5, 8);
  ctx.fillRect(x + 1, y - CHAR_H + 36 + bob, 5, 8);
  ctx.fillStyle = "#333";
  ctx.fillRect(x - 7, y - CHAR_H + 43 + bob, 6, 3);
  ctx.fillRect(x + 1, y - CHAR_H + 43 + bob, 6, 3);

  if (active) {
    ctx.fillStyle = agent.status === "active" ? "#34d399" : "#818cf8";
    ctx.beginPath(); ctx.arc(x + 12, y - CHAR_H + 2 + bob, 3, 0, Math.PI * 2); ctx.fill();
  }

  if (agent.task && active) drawSpeechBubble(ctx, x, y - CHAR_H - 10, agent.task.slice(0, 24));

  ctx.fillStyle = "#ccc";
  ctx.font = "9px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(agent.name.split(" ")[0], x, y + 6);
  ctx.textAlign = "start";
}

function drawSpeechBubble(ctx: CanvasRenderingContext2D, x: number, y: number, text: string) {
  ctx.font = "7px monospace";
  const tw = ctx.measureText(text).width + 12;
  const bx = x - tw / 2;
  ctx.fillStyle = "#fff";
  roundRect(ctx, bx, y - 14, tw, 16, 4);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(x - 3, y + 2);
  ctx.lineTo(x, y + 7);
  ctx.lineTo(x + 3, y + 2);
  ctx.fill();
  ctx.fillStyle = "#333";
  ctx.textAlign = "center";
  ctx.fillText(text, x, y - 3);
  ctx.textAlign = "start";
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.fill();
}

function groupByDepartment(agents: OfficeAgent[]): Map<string, OfficeAgent[]> {
  const m = new Map<string, OfficeAgent[]>();
  for (const a of agents) {
    if (!m.has(a.department)) m.set(a.department, []);
    m.get(a.department)!.push(a);
  }
  return m;
}
