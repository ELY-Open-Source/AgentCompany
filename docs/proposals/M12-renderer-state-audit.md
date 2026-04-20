# Proposal M12: renderer 状态层审查（IPC 契约化后做）

> 来源：问题.md M12（行 290-294）、附录 D（行 403-408）
> 状态：proposed
> 提出：Roundtable 2026-04-20（Linus + Karpathy + Steve Jobs）
> Owner: TBD
> 估计工时：3-4 周
> Blocking dependencies：**M2（IPC 契约化）必须先完成**

## 问题陈述

104 个 IPC channel（见 M2）基本都在给 renderer 推状态：
- profile snapshot
- task list
- run events
- browser actions
- approvals
- messages
- …

renderer 如何 debounce、merge、避免 stale read，**本次 review 未深入**——但缺乏契约层的前提下几乎必然有一致性 bug。

典型问题猜测（需 M2 完成后验证）：
1. **Race condition**：两个 IPC response 几乎同时到达，后到覆盖先到，但语义上应该合并
2. **Stale read**：renderer 发 request → main 返回 → 中间 main 已经又写了一次 → renderer 拿到 stale snapshot
3. **过度 refetch**：renderer 没有合适的 cache，每次切换页面都重 fetch（浪费 IPC round trip）
4. **Event dedup**：同一个 run event 被多个订阅路径接收，渲染时重复展示
5. **Optimistic update 回滚**：renderer 本地 optimistic 更新，但 main 拒绝后没有正确回滚

## 根因分析

当前未知——本 proposal 承认**review 没覆盖 renderer**。

Linus 视角推测：104 个 channel × N 种 payload shape × 若干订阅者 = 巨大的状态空间。没有类型契约（M2 未完成）时，renderer 层的一致性问题**无法静态证明也无法系统性测试**。M2 是前置条件——契约化后才能逐个 channel audit。

Karpathy 视角补充：renderer 的 UI state 错乱直接让用户看到 "agent 跑着但 UI 显示闲置" 或 "approval 已批但列表还在" 等典型 bug。这种 bug 很难用 unit test 捕捉，需要 e2e 验证 + state invariant checking。

## 设计方案

本 proposal 是**审查方案**而不是修复方案——具体修法要等审查结果。

### 审查范围

`src/renderer/` 全部代码，重点：
1. **状态管理库**：目前是 zustand（从 `package.json` 看到依赖）
2. **IPC 订阅点**：`useEffect` 里调 `window.api.invoke` / 订阅 event 的位置
3. **数据合并逻辑**：event 到达时如何 merge 到 store
4. **缓存策略**：哪些数据缓存、TTL 多少、如何失效
5. **Optimistic update**：哪些 action 先改 UI 再等 ack

### 审查 checklist

| 项 | 检查内容 |
|----|---------|
| 1 | 每个 zustand store 的 state shape 是否 type-safe（借助 M2 的 IpcOutput 类型） |
| 2 | 每个 IPC invoke 的 response 处理，是否考虑 race（后到请求覆盖先到请求） |
| 3 | 每个 event subscription，是否 dedup（同一 event 不同路径接收） |
| 4 | Optimistic update 的回滚逻辑完备性 |
| 5 | 组件 unmount 时 subscription cleanup |
| 6 | 跨 route 切换时 store 是否 reset（避免显示上一个 company 的数据） |
| 7 | 长列表的 virtualization（react-virtual 已在依赖里，实际使用覆盖度） |
| 8 | Loading / error / empty 三种边界态覆盖 |

### 预期产出

审查结束后产出 `docs/proposals/M12-renderer-findings.md`，按严重度列出发现的具体问题，每条给修复 proposal（可能演化为独立 proposal）。

### 审查方法

1. **静态**：
   - grep `window.api.invoke` 找所有 call site
   - grep `useEffect` + IPC 调用 找订阅点
   - 对照 M2 的 IpcChannels 一一核对 shape
2. **动态**：
   - 启动 app，开 React DevTools 看 zustand store 状态
   - 触发典型场景（agent run、approval flow、task update），观察 state transition
   - 故意制造 race（背景 run 发 event + 前景用户交互）
3. **e2e**：
   - 用 Playwright（tests/e2e 已配置）写 invariant 检查脚本：
     - 任何时刻 UI 显示的 "pending approvals" 数量 = main 进程 DB 查询结果
     - 任何时刻 UI 显示的 "active runs" = DB runs where status=running

## Migration 计划（审查后）

审查阶段：

1. **Phase 1（1 周）**：静态扫描 + 形成 findings 列表
2. **Phase 2（1 周）**：动态测试 + Playwright invariant script
3. **Phase 3（1 周）**：按严重度归类，高严重度的 findings 进入后续 sprint 修复
4. **Phase 4（1-2 周）**：根据 findings 可能派生出新的 proposal（例如"renderer-state-race-fixes"）

## 风险与回滚

| 风险 | 触发条件 | 回滚方法 |
|------|---------|---------|
| 审查范围失控 | 发现问题太多，sprint 无法覆盖 | 按严重度分批，每个 sprint 处理一类 |
| 修复引入新 bug | 动 renderer state 逻辑 | 每类修复独立 PR + e2e 验证 |
| M2 没完成就启动 | 契约化未完成导致审查无类型依据 | 不做，等 M2 |

## 验证标准（审查阶段）

1. **覆盖率**：grep 可见所有 `window.api.invoke` 都被审查
2. **Findings 数**：产出具体 finding 列表（预估 20-40 条）
3. **E2E invariant**：至少 5 条关键 invariant 被 playwright 脚本覆盖
4. **修复 backlog**：高优先 finding 进入下个 sprint

## 不在范围

- **不做 renderer 架构重写**：只是审查 + 针对性修复
- **不换状态管理库**：zustand 保留
- **不改 UI 设计**：只审数据流
- **不重构 route 层**：url routing 逻辑独立
- **不做 A/B 测试设施**：UI 实验独立 proposal

## 参考文件清单

- `src/renderer/`（全部，待审查）
- `src/preload/index.ts`（IPC bridge）
- `src/main/ipc-*.ts`（main 侧 handler）
- `tests/e2e/playwright.config.ts`（e2e 测试配置）
- M2 契约表（前置依赖）

## 附：为什么现在放一个"审查 proposal" 而不是修复 proposal

本次代码 review（2026-04-20）**明确跳过了 renderer 深入**——review report 也坦白了这点。列 M12 不是占位，是承认"这里有未知的坑"。

**第一性原理**：不能在没契约（M2）的前提下审 renderer 状态——审的结论无法落成 executable 测试。必须等 M2 完成后，renderer 层的问题才有具体形状。

M12 也是 IPC-related 所有 proposal 的收官——M2 完成 + M12 审查完 + 修复完，整个 main ↔ renderer 的契约面才算治理完整。

Karpathy 视角：Agent 的 UI 呈现错误（"agent 跑完了但还在 spinner"）直接伤害产品 perception——用户不会分辨是 LLM bug 还是 state bug，一律认为"这 agent 不可靠"。所以 renderer state 治理的优先级实际比列 M 级更高，但依赖链强迫它排在后面。

## 附：审查输出模板

审查结束后 `docs/proposals/M12-renderer-findings.md` 的结构：

```markdown
# M12 Findings (<date>)

## 🔴 Critical findings
### F-01: <具体问题>
- 文件：src/renderer/xxx.tsx:<行号>
- 重现：<最小重现步骤>
- 影响：<用户层面影响>
- 建议修复：<简短描述>

## 🟠 Major findings
...

## 🟡 Minor findings
...

## Covered e2e invariants
1. <invariant 1>
2. <invariant 2>
...
```

## 附：gating matrix

| Gate | 条件 | 放行判断人 |
|------|------|----------|
| G1 | M2 IPC 契约化完成 | Linus |
| G2 | 审查 checklist 8 项全覆盖 | Owner |
| G3 | Findings 列表产出并分类（≥20 条） | Linus |
| G4 | e2e invariant 脚本 ≥5 条可运行 | Karpathy |
| G5 | 高优先 findings 进入下 sprint 修复 | Owner |

## 附：关键 invariant 候选

e2e playwright 要覆盖的状态不变式：

1. UI "pending approvals" count = DB approvals where status = 'pending'
2. UI "active runs" = DB runs where status = 'running'
3. Task card 显示的 phase = DB tasks.phase（B2 完成后）
4. Agent message 未读数 = DB agent_message_reads 未读行数
5. 某 company 被切换后，UI 不应残留前一 company 数据
6. Approval 批准后，UI 应在 1s 内从 pending 列表消失
7. Task 从 todo → in_progress 时，spinner 应立即显示
8. Browser action 执行中，main 进程可见 subprocess status = running

## 附：为什么现在不做 proposal 只做审查

当前 review 团队（Linus + Karpathy + Jobs）**没有覆盖 renderer**——贸然给出修复 proposal 等于凭想象出方案。本 proposal 诚实承认这是"审查准备"阶段，具体修复待发现。

## 附：为什么不选其他方案

**方案 A（当前 proposal）**：先审查后修复，M2 做前置。

**方案 B（一次性 renderer 重写）**：风险极大——renderer 代码量不小，重写周期长，期间 UI 完全不可用。

**方案 C（按路由逐 page 重写）**：逻辑上可行，但 findings 可能跨 page（例如多个 page 用同一个 bug store），按 page 重写解决不了。

方案 A 是发现问题 → 针对性修复的稳妥路径。

## 附：常见 renderer state 反模式（待审查时排查）

审查重点观察以下 pattern：

1. **useEffect 里 invoke 没 AbortController**：组件 unmount 但 promise 仍 resolve，导致 "setState on unmounted component"
2. **event listener 没 cleanup**：`ipcRenderer.on("xxx", h)` 返回的 listener 没在 `useEffect` 清理
3. **派生 state 存 store**：本可以 derive 的数据写入 store，引入一致性问题
4. **Optimistic update 没 rollback**：`store.setState({ ... })` 后 invoke 失败，UI 保持错误态
5. **同一 data 多次 fetch**：切换 tab 每次重 fetch，没有 cache 或 cache 失效策略不当
6. **Route 切换 store 不 reset**：上一个 company 的数据残留到当前 company 视图
7. **Event dedup 缺失**：同一 run_event 被多个路径转发到 renderer，渲染时重复
8. **List 未 virtualize**：大列表渲染全量 DOM，滚动卡顿

审查时对每个 store 和每个大组件逐项核查。

## 附：playwright e2e invariant 脚本骨架

```ts
// tests/e2e/invariants.spec.ts（M12 产出）
test("pending approvals UI = DB", async ({ page, electronMain }) => {
  await page.goto("/approvals");
  const uiCount = await page.locator("[data-testid=pending-approval]").count();
  const dbCount = await electronMain.evaluate(() =>
    db.approvals.count({ status: "pending" })
  );
  expect(uiCount).toBe(dbCount);
});

test("active runs UI = DB", async ({ page, electronMain }) => {
  await page.goto("/runs");
  const uiRunning = await page.locator("[data-status=running]").count();
  const dbRunning = await electronMain.evaluate(() =>
    db.runs.count({ status: "running" })
  );
  expect(uiRunning).toBe(dbRunning);
});

// ... 至少 5 条 invariant
```

## 附：renderer store 梳理（待 M2 完成后形成清单）

M2 完成后，M12 审查第一步：把每个 zustand store 列出来 + 它订阅的 IPC channel 映射，形成：

| Store | 订阅 channel | 更新策略 | 发现的问题 |
|-------|------------|---------|----------|
| agentsStore | `agents/list` + `agents/updated` event | ? | 待审 |
| tasksStore | `tasks/list` + `tasks/updated` event | ? | 待审 |
| ... | ... | ... | ... |

## 附：e2e harness 运行频率

- PR 触发：快速 invariant（< 30s 跑完的子集）
- 夜间 build：全量 invariant + soak test（5 分钟持续交互）
- Release gate：全量 + manual QA pass

M12 审查结束后产出的 invariant 脚本会同时塞进这三层。
