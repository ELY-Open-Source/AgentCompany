# Proposal M7: CEO 模式状态机化（resolveCeoMode 单一真源）

> 来源：问题.md M7（行 260-264）
> 状态：proposed（依赖 B5 + C4）
> 提出：Roundtable 2026-04-20（Linus + Karpathy + Steve Jobs）
> Owner: TBD
> 估计工时：1.5 周
> Blocking dependencies：B5（eval harness）、C4（initial-user-turn 精简）

## 问题陈述

CEO 当前处于哪个模式，由**两处独立逻辑**各自决定：

**位置 1**：`src/main/prompt-builder/ceo-modes/` 下 5 个 markdown 文件
- `awaiting-hire.en.md`
- `awaiting-org.en.md`
- `operating.en.md`
- `proactive-footer.en.md`
- `team-building.en.md`

加载逻辑在 runtime 靠**字符串匹配**——某段代码根据 company/CEO 状态推出一个 mode 名，然后按文件名拼路径读 markdown。

**位置 2**：`src/main/orchestration/initial-user-turn.ts:62-83`
- 独立判断 CEO 是否 "zero active reports"
- 独立判断是否"awaiting hire approval"
- 独立决定发什么 cue

**两处都在决定 "CEO 现在该做什么"，互相不知道对方存在**。结果是：`ceo-modes` 文件可能说当前是 `operating` 模式（有团队在运行），而 `initial-user-turn` 同时决定发 "your team is empty" 的 cue——内部打架。

## 根因分析

Linus 视角：**同一件事（CEO 当前状态）被两个代码位置各自计算**——这是第一性的违规。状态应该是单一 source of truth。

当前设计把 "mode" 当成一个**魔法字符串**在 prompt-builder 和 initial-user-turn 之间传递（甚至不是显式传，而是两边各自推），没有一个函数说"this is where CEO mode is decided"。

加载 markdown 的路径也是隐式约定——`ceo-modes/team-building.en.md` 的命名约定没有 schema 保证，漏一个文件、写错一个 mode 名、加新 mode 时忘了建对应文件，都是静默失败。

Karpathy 视角：**模式分支是 agent 行为最关键的决策点**——CEO 在 team-building / operating / awaiting-* 下的应答完全不同。这种分支必须**集中**并有 eval 覆盖每个分支。

## 设计方案

### 单一 resolveCeoMode 函数

新建 `src/main/orchestration/ceo-mode.ts`：

```ts
export type CeoMode =
  | "team_building"    // 无 active report，需要 hire
  | "awaiting_hire"    // 已提交 hire approval，等人批
  | "awaiting_org"     // 组织架构待确认
  | "operating"        // 正常运行态
  ;

export interface CeoModeContext {
  agent: AgentRecord;
  company: CompanyRecord;
  activeAgents: AgentRecord[];
  pendingApprovals: ApprovalRecord[];
  executionMode: ExecutionMode;
}

export function resolveCeoMode(ctx: CeoModeContext): CeoMode {
  if (ctx.agent.role !== "ceo") {
    throw new Error("resolveCeoMode called on non-CEO agent");
  }

  const activeReports = ctx.activeAgents.filter(a => a.ceoId === ctx.agent.id && a.status !== "terminated");
  const pendingHires = ctx.pendingApprovals.filter(a => a.kind === "hire_agent");

  if (activeReports.length === 0 && pendingHires.length === 0) {
    return "team_building";
  }
  if (activeReports.length === 0 && pendingHires.length > 0) {
    return "awaiting_hire";
  }
  if (ctx.company.orgStatus === "pending_review") {
    return "awaiting_org";
  }
  return "operating";
}
```

**所有**判断 CEO 模式的代码都必须调这个函数。

### Prompt-builder 从 mode 映射到片段

```ts
// src/main/prompt-builder/ceo-modes/index.ts（新增）
const modeToSlug: Record<CeoMode, string> = {
  team_building: "team-building",
  awaiting_hire: "awaiting-hire",
  awaiting_org: "awaiting-org",
  operating: "operating",
};

export function loadCeoModePrompt(mode: CeoMode, locale: AppLocale): string {
  const slug = modeToSlug[mode];
  // 加载 `ceo-modes/{slug}.{locale}.md`
}
```

通过 TypeScript 枚举保证 mode 和 markdown 文件的一一对应——加新 mode 必须加枚举 + 对应 markdown，编译期强制。

### initial-user-turn 走 resolveCeoMode

`src/main/orchestration/initial-user-turn.ts` 不再重复判断 CEO 状态，调 `resolveCeoMode(ctx)`：

```ts
const mode = resolveCeoMode(modeCtx);
const cue = getCeoModeCue(mode, trigger);
```

这样 prompt-builder 里的 markdown 和 initial-user-turn 的 cue **通过同一个 mode 驱动**——永远一致。

### proactive-footer 归类

当前的 `proactive-footer.en.md` 不是一个 mode——它是所有 CEO 模式共享的 footer。应该：
- 重命名目录结构：`ceo-modes/{mode}.md` 专门装 mode-specific
- 另起 `ceo-shared/proactive-footer.md` 放共享片段
- 避免把 footer 误当作第 5 个模式

## Migration 计划

1. **Phase 0（前置）**：B5 eval harness + C4 完成
2. **Phase 1（2 天）**：实现 `resolveCeoMode` 函数 + 单测（不动 call site）
3. **Phase 2（3 天）**：prompt-builder 从 mode enum 加载 markdown，删除字符串拼接
4. **Phase 3（3 天）**：initial-user-turn 重构——删除自行判断逻辑，全走 `resolveCeoMode`
5. **Phase 4（3 天）**：eval 对比——相同 CEO 状态下行为一致性
6. **Phase 5（1 天）**：重组目录——proactive-footer 从 ceo-modes 移出

## 风险与回滚

| 风险 | 触发条件 | 回滚方法 |
|------|---------|---------|
| 模式分类漏 corner case | awaiting_hire 和 awaiting_org 同时成立 | resolveCeoMode 函数里明确 priority + 单测覆盖 |
| eval 发现行为偏移 | 新 mode decision 逻辑和旧隐式判断不等价 | 保留旧 initial-user-turn 分支 flag，对比 N 轮 run |
| Markdown 内容过期 | enum 加了新 mode 但没写 markdown | 加载时 assert 文件存在，启动 fail fast |
| Locale 缺失 | `awaiting-hire.zh.md` 不存在但 locale=zh | fallback 到 `.en.md` + telemetry 告警 |

## 验证标准

1. **Typecheck 保证完整性**：新增 mode 必须同时更新 enum + modeToSlug map + markdown 文件，否则编译 fail
2. **Eval 行为对比**：每个 mode 至少 3 种代表性 company 状态，新旧行为 99% 一致
3. **Call site 归一**：`grep -rn "team_building\|awaiting_hire\|operating" src/main/` 只在 `ceo-mode.ts` 里出现枚举定义，其他地方通过 import 使用
4. **Markdown coverage**：所有 mode 在所有支持的 locale 下都有文件，启动时校验通过
5. **Initial-user-turn 简化**：`initial-user-turn.ts` 行数降低（假设从 159 行 → < 100 行）

## 不在范围

- **不重写 ceo-modes 的 prompt 内容**：只是让加载机制严谨，具体文字走 Owner 业务决策
- **不加新 mode**：当前 4 个 mode 足够（proactive-footer 不是 mode）
- **不改 non-CEO agent 的模式逻辑**：他们没有这种 mode 概念
- **不做 mode transition 审计 log**：有需要另开 event 表
- **不做 mode-specific tool gating**：tool 可用性和 mode 解耦（不同 mode 可用相同 tool，只是 prompt 引导不同）

## 参考文件清单

- `src/main/prompt-builder/ceo-modes/awaiting-hire.en.md`
- `src/main/prompt-builder/ceo-modes/awaiting-org.en.md`
- `src/main/prompt-builder/ceo-modes/operating.en.md`
- `src/main/prompt-builder/ceo-modes/proactive-footer.en.md`（将重组）
- `src/main/prompt-builder/ceo-modes/team-building.en.md`
- `src/main/orchestration/initial-user-turn.ts:62-83`（重复逻辑）
- `src/main/prompt-builder/system-prompt.ts`（mode 注入点）
- `src/main/database/agents.ts`（CEO 状态 query）
- `src/main/database/approvals.ts`（pending hire approval query）

## 附：为什么现在修

C4 已经把 initial-user-turn 的"实现细节泄漏"修了——如果不顺便做 M7，就会出现 initial-user-turn 变干净了但还在自行判断 mode 的状态。一次做完，两件事共享同一个 resolveCeoMode 函数，改 prompt 的团队只需要 reason about 一个真源。

M7 也是未来扩展 CEO 行为的基础——如果要加 "awaiting_funding" / "pivoting" 之类的新模式，没有 state machine 就是继续堆字符串判断。

## 附：gating matrix

| Gate | 条件 | 放行判断人 |
|------|------|----------|
| G1 | B5 eval harness 可 record CEO 在各 mode 下的 baseline 行为 | Karpathy |
| G2 | `resolveCeoMode` 单测覆盖 4 种 mode × 边缘状态 | Linus |
| G3 | prompt-builder 通过 enum 加载 markdown，启动时验证文件存在 | Owner |
| G4 | initial-user-turn 重构后行为 eval 与 baseline 一致 | Karpathy |
| G5 | proactive-footer 从 ceo-modes 目录移出，路径调整不破坏现有 prompt | Owner |

## 附：state machine 扩展指南

未来加新 mode 的最小改动点：

1. `src/main/orchestration/ceo-mode.ts` 的 `CeoMode` enum 增加成员
2. `resolveCeoMode` 函数加对应 if 分支
3. `ceo-modes/<new-mode>.en.md`（+ 其他 locale）新建
4. `modeToSlug` 映射加一行
5. 对新 mode 写单测（至少 1 个 positive + 1 个 negative case）

TypeScript 会强制 1-4 的完整性——漏一步编译 fail。

## 附：反模式对比

**Before**（`initial-user-turn.ts:62-83` + `ceo-modes/*.md` 两处各自判断）：
```ts
// 位置 1: initial-user-turn.ts
if (activeReports.length === 0) {
  return teamBuildingCue;
}

// 位置 2: prompt-builder/system-prompt.ts (加载 ceo-modes)
const modeFile = loadCeoModeFile(company, agent);  // 内部逻辑不一致
```

**After**（单一真源）：
```ts
const mode = resolveCeoMode(ctx);
const cue = getCeoModeCue(mode, trigger);
const modeSection = loadCeoModePrompt(mode, locale);
```

两处都 derive from mode，保证一致。

## 附：为什么不选其他方案

**方案 A（当前 proposal）**：enum + resolve 函数 + markdown 映射。

**方案 B（把 mode 存 DB）**：不必要——mode 完全由当前状态 derive，存 DB 反而要维护一致性。

**方案 C（把 markdown 内容放代码里）**：失去给产品经理 / 业务 owner 迭代 prompt 的低成本路径。

方案 A 保留 markdown 灵活性同时让加载逻辑类型安全。

## 附：mode priority 排序规则

`resolveCeoMode` 判断顺序（先匹配即返回）：

1. `team_building`：无 active report + 无 pending hire
2. `awaiting_hire`：无 active report + 有 pending hire
3. `awaiting_org`：有 active report + org 待 review
4. `operating`：默认

顺序基于"外部依赖度"——团队空时必须先 team_building，其次考虑组织结构审查，最后才是运行态。单测覆盖所有 transition：

| from → to | 条件 | 覆盖点 |
|----------|------|-------|
| team_building → awaiting_hire | 提交 hire approval | unit |
| awaiting_hire → team_building | hire approval 被拒 | unit |
| awaiting_hire → operating | hire approval 通过 | unit |
| operating → awaiting_org | org review 触发 | unit |
| awaiting_org → operating | org review 通过 | unit |

## 附：proactive-footer 重组说明

`ceo-modes/proactive-footer.en.md` 当前存在于 ceo-modes 目录但不是 mode。重组：

```
Before:
ceo-modes/
├── awaiting-hire.en.md
├── awaiting-org.en.md
├── operating.en.md
├── proactive-footer.en.md  ← 伪 mode
└── team-building.en.md

After:
ceo-modes/                    ← 真 modes
├── awaiting-hire.en.md
├── awaiting-org.en.md
├── operating.en.md
└── team-building.en.md
ceo-shared/                   ← 跨 mode 共享片段
└── proactive-footer.en.md
```

`system-prompt.ts` 加载 mode 片段后，独立拼接 `ceo-shared/proactive-footer.en.md`。
