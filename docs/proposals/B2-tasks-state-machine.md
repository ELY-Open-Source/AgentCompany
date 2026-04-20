# Proposal B2: tasks 状态机重构为 phase enum + task_leases 表

> 来源：问题.md B2（行 45-64）、附录 F 样本 1（行 424-441）、样本 2（行 444-457）
> 状态：proposed（待 B5 eval harness 就绪后实施）
> 提出：Roundtable 2026-04-20（Linus + Karpathy + Steve Jobs）
> Owner: TBD
> 估计工时：3-4 周（与 C1 共享 migration 窗口）
> Blocking dependencies：B1（pi 版本收敛，已完成）、B5（eval harness 建立，仍 blocked by user constraint）

## 问题陈述

单张 `tasks` 表并行持有 5 个锁/状态字段，彼此之间没有代数约束：
- `status`（枚举：backlog / todo / in_progress / done / blocked / …）
- `active_run_id`（当前运行的 run id）
- `checkout_run_id`（正在抢占执行权的 run id）
- `execution_locked_at`（执行锁 timestamp）
- `active_session_id`（pi agent session id）

这 5 列的合法组合本应由状态机约束，实际由散落在 10+ 处的 SQL 片段手动维护。`src/main/database/tasks-status.ts:160-189` 的 `checkoutTask` 函数 CAS 条件里已经被迫加了补丁分支：

```sql
AND (
  status IN ('todo', 'backlog')
  OR (status = 'in_progress' AND active_run_id IS NULL)
)
```

这个 `OR (status = 'in_progress' AND active_run_id IS NULL)` 分支是"从 orphan 状态恢复"的补丁。代码注释自己承认：

> "recovers from a specific orphan: finishRun has cleared active_run_id and checkout_run_id but the status transition never fired … without the reclaim, heartbeat picks the task and then loops on `checkout_race_lost` forever"

进一步证据：
- `src/main/database-base.ts:369-387` 的 `interruptStaleRuns`：只清 `active_run_id`、把 agents 设为 idle、释放 workspace lock。**没清** `checkout_run_id` 和 `execution_locked_at`。
- `src/main/database-base.ts:389-400` 的 `recoverStaleLocks`：用 15 分钟 cutoff 清 `checkout_run_id` 和 `execution_locked_at`。
- 两条独立路径各写各的字段，顺序错位就出现「status=in_progress，active_run_id=null，checkout_run_id=null」的 zombie。

## 根因分析

Linus 视角（好品味原则第一条）："特殊情况就是你数据结构错了"。

当前设计把"执行权 lease"的元数据打散到 tasks 表的多个列里，违反了**最基本的关系代数**：tasks 是实体，执行权是有起止时间的租约，这是两个有独立生命周期的东西。把它们塞在同一行就必然出现：

1. **部分更新问题**：清 lease 时必须同时清 `active_run_id` / `checkout_run_id` / `execution_locked_at`，任何一处漏掉就是 zombie。
2. **状态组合爆炸**：5 个字段理论组合数是 5! = 120 种（真实合法的只有 ~6 种），SQL 层无法约束。
3. **多 writer 竞态**：`interruptStaleRuns` 和 `recoverStaleLocks` 各自只负责一部分字段，顺序依赖靠 code review 维持。
4. **补丁放大效应**：`checkoutTask` 的 OR 分支注释里写得很清楚——"如果不补，heartbeat 就会永远循环 checkout_race_lost"。这不是"修"，这是给错的数据结构打绷带。

问题的根源是：**tasks 表承担了两个职责**——"我是什么任务"（entity）和"我现在被谁锁着"（lease）。这两个职责必须拆开。

## 设计方案

### 新 schema

```sql
-- 主表：只保留任务本身的语义
ALTER TABLE tasks ADD COLUMN phase TEXT NOT NULL
  CHECK (phase IN ('backlog', 'ready', 'running', 'awaiting_review', 'done', 'blocked'));
-- 删除：active_run_id, checkout_run_id, execution_locked_at, active_session_id, status（等迁移完成）

-- 新表：租约独立生命周期
CREATE TABLE task_leases (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES runs(id),
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  session_id TEXT,
  -- 显式外键 + 唯一约束，SQL 层强制"一个 task 同时只能有一个 lease"
  UNIQUE (task_id)
);
CREATE INDEX idx_task_leases_expires ON task_leases(expires_at);
```

### 状态机语义

| phase | 合法来源 phase | lease 是否存在 | 触发条件 |
|------|---------|---------|---------|
| `backlog` | (init) / `blocked` 清除 | 否 | 任务初建 |
| `ready` | `backlog` | 否 | 需求就绪 |
| `running` | `ready` | **必须有** | `checkoutTask` 成功 |
| `awaiting_review` | `running` | 否（finishRun 释放） | deliverable 产出 |
| `done` | `awaiting_review` | 否 | 审核通过 |
| `blocked` | 任何（除 done） | 否 | 显式 block |

**关键不变式**：`phase = 'running'` ⇔ `task_leases` 存在对应行。SQL 层面用 trigger 强制。

### 单一状态迁移函数

```ts
// src/main/database/tasks-status.ts（重写）
export function advanceTaskPhase(
  taskId: string,
  from: TaskPhase,
  to: TaskPhase,
  ctx: { runId?: string; sessionId?: string; ts?: number }
): { ok: true } | { ok: false; reason: string } {
  return db.transaction(() => {
    // 1. CAS 写 tasks.phase
    // 2. 根据 from/to 组合插入/删除 task_leases 行
    // 3. 违反不变式直接 throw（let it crash）
  })();
}
```

**所有**状态迁移都走这一个函数，禁止直接 `UPDATE tasks SET status = ...`。改造 call sites:
- `src/main/database/tasks-status.ts`（checkoutTask, finishRun, interruptRun）
- `src/main/database-base.ts:369-400`（interruptStaleRuns, recoverStaleLocks）
- `src/main/orchestration/scheduler.ts`、`task-runner.ts`、`heartbeat.ts` 的所有 tasks 写路径

### 删除 OR 补丁

重构后，`checkoutTask` 变成：

```sql
UPDATE tasks SET phase = 'running' WHERE id = ? AND phase = 'ready';
INSERT INTO task_leases (task_id, run_id, acquired_at, expires_at, session_id) VALUES (?, ?, ?, ?, ?);
```

没有 OR，没有 orphan。如果 `interruptRun` 漏清 lease，trigger 会在下次 advanceTaskPhase 时直接报 constraint violation——**让它 crash，不掩盖**。

## Migration 计划

1. **v49 migration**（dual-write 阶段，1 周）
   - 新建 `task_leases` 表（空）
   - 新增 `tasks.phase` 列，默认值从 `status` 映射：`backlog→backlog, todo→ready, in_progress+active_run_id→running, …`
   - 应用层所有写路径同时写 `phase` 和旧 `status`，写 lease 同时写 `active_run_id`/`checkout_run_id`
2. **backfill**（自动）
   - v49 启动时一次性 SQL：根据旧 5 列反推 phase + 插入 lease 行
   - 写 validation：phase = running ⇔ lease 存在；不成立直接 crash（暴露现存 orphan）
3. **v50 switch-read**（2 周后）
   - 所有读路径切到 `phase` + `task_leases` JOIN
   - 确认 telemetry 没有新 404/500
4. **v51 drop-old**（4 周后）
   - 删 `active_run_id`、`checkout_run_id`、`execution_locked_at`、`active_session_id`、`status` 列
   - 删 `checkoutTask` 的 OR 分支（届时代码里已不存在）

## 风险与回滚

| 风险 | 触发条件 | 回滚方法 |
|------|---------|---------|
| backfill 发现现存 orphan | v49 启动时 assertion fail | v49 migration 提供 `--heal-orphans` flag，根据最后活跃 run 推断正确 phase |
| dual-write 导致写冲突 | 并发 advanceTaskPhase vs 旧路径 | v49 → v50 之间禁止 `UPDATE tasks SET status = ...`（ESLint rule + SQL trigger 拦截） |
| switch-read 性能回退 | JOIN 开销增加 | 给 `task_leases(task_id)` 建 UNIQUE 索引（schema 已含） |
| 测试 fixture 不同步 | tests/unit 里的 stub 数据没 phase 列 | 所有测试 fixture 走 `makeTaskRecord()` helper 统一生成 |

**真回滚路径**：v51 前每一步都可降级——任何时候发现新 schema 有 bug，停止应用层双写、所有读切回旧列，v49 migration 可以通过删 `task_leases` 表 + 清 `phase` 列回到原状态。

## 验证标准

**前置依赖：B5 eval harness 必须先就绪**（Karpathy 强烈反对无 eval 下做状态机改动）。

具体验证：
1. **契约测试**：构造 30+ 种非法状态组合，验证 `advanceTaskPhase` 全部拒绝
2. **并发 fuzz**：2 个 worker 同时 checkoutTask 同一个 task，只有一个成功
3. **崩溃恢复**：kill -9 worker，下次启动 `recoverStaleLocks` 能清掉过期 lease
4. **行为 eval**：相同 company 输入，v48 和 v51 产出的 run trace 在 agent 行为层一致（tool calls / state transitions 序列）
5. **Telemetry 指标**：生产环境 `checkout_race_lost` 发生率不增，`sqlite_busy` 不增

## 不在范围

- **不重构 runs 表**：runs 的 status 机自身健康，本 proposal 只动 tasks。
- **不改 IPC 契约**：renderer 看到的仍是 `TaskRecord.status`，由 map 层从 phase/lease 合成。
- **不做 per-agent quota**：执行权限流控是另一件事，走独立 proposal。
- **不引入分布式锁**：SQLite 单 writer 前提不变，B4 的 single-writer actor 是独立 proposal。
- **不做 phase transition 审计 log**：需要的话另开 event 表，和本 proposal 解耦。

## 参考文件清单

- `src/main/database/tasks-status.ts:160-189`（checkoutTask + OR 补丁）
- `src/main/database-base.ts:369-387`（interruptStaleRuns 只清一半字段）
- `src/main/database-base.ts:389-400`（recoverStaleLocks 另一半字段）
- `src/main/database-base.ts:49-51`（作者自白 pass-through 架构）
- `src/main/database/migrations/`（48 个既有 migration 作为 v49/v50/v51 的 template）
- `src/main/orchestration/scheduler.ts`（heartbeat 写路径）
- `src/main/worker/worker-runner.ts:239` 附近（worker 回写 run 状态）

## 附：为什么现在修而不是等

`checkoutTask` 的 OR 补丁在生产环境就是**一个 agent 完全卡死并持续烧钱**——每次 heartbeat 唤醒都重新尝试 checkout，每次失败产生日志 / 事件 / cost 记录。数据结构错误导致 agent 静默陷入死循环，这是最糟糕的一类 bug：不 crash，不报错，只是不前进。用户付钱看着 agent 原地踏步。

每多拖一周，新 call site 就多一批——数据结构错误会 viral 扩散。把 5 列乱象标准化后，后续所有 feature（new phase、priority、deadline）都受益。

## 附：gating matrix

| Gate | 条件 | 放行判断人 |
|------|------|----------|
| G1 | B5 eval harness 可以 record baseline behavior | Roundtable |
| G2 | v49 dual-write 测试环境跑 48 小时无 assertion fail | Owner |
| G3 | v50 switch-read 灰度 1 个 company 7 天 | Owner |
| G4 | v51 drop-old 前所有 call site 静态 scan 无 `status IN ('todo', 'backlog')` | Linus |
| G5 | `checkoutTask` OR 分支删除后 telemetry `checkout_race_lost` 连续 14 天为 0 | Karpathy |

## 附：与其他 proposal 的耦合

| 相关 | 关系 |
|------|-----|
| B1（pi 版本 pin） | 已完成 | 
| B4（single-writer actor） | 互补：B4 收敛"谁能写"，B2 收敛"写什么语义" |
| C1（AppDatabase pass-through） | 共享 migration 窗口：两者都需要改 DB 访问 call site，codemod 可同时改 |
| C6（error taxonomy） | B2 的 let-it-crash 依赖 C6 的 error 分类来决定 crash vs retry |

## 附：反模式对比（before / after）

**Before**（`src/main/database/tasks-status.ts:160-189`）：
```sql
UPDATE tasks
SET checkout_run_id = ?, execution_locked_at = ?, status = 'in_progress', updated_at = ?
WHERE id = ?
  AND checkout_run_id IS NULL
  AND (
    status IN ('todo', 'backlog')
    OR (status = 'in_progress' AND active_run_id IS NULL)  -- orphan 恢复补丁
  );
```

**After**（B2 完成后）：
```sql
-- 原子操作 1：phase 转移
UPDATE tasks SET phase = 'running' WHERE id = ? AND phase = 'ready';
-- 原子操作 2：插入 lease（UNIQUE 约束防止重复）
INSERT INTO task_leases (task_id, run_id, acquired_at, expires_at, session_id) VALUES (?, ?, ?, ?, ?);
```

两个 statement 走一个 transaction；UNIQUE(task_id) 约束让"同一个 task 同时只有一个 lease"成为 SQL 层不变式，无需应用层 CAS。

## 附：涉及 SQL 片段清单（待改造）

- `src/main/database/tasks-status.ts:160-189` checkoutTask
- `src/main/database/tasks-status.ts` finishRun（释放 lease）
- `src/main/database-base.ts:369-387` interruptStaleRuns
- `src/main/database-base.ts:389-400` recoverStaleLocks
- `src/main/orchestration/scheduler.ts` 的 wake writer
- `src/main/orchestration/heartbeat.ts` markHeartbeatAt（touch lease.expires_at）
- `src/main/worker/worker-runner.ts` 的 finishRun 回调

每处都从"直接 UPDATE 5 列"改为"调 `advanceTaskPhase`"。改造 PR 按文件拆，每个 PR 跑 typecheck + 单测。

## 附：为什么不选其他方案

考虑过的替代设计：

**方案 A（直接拆 leases 表）**：当前 proposal 采用。优点：SQL 层可强约束；缺点：需要 dual-write migration。

**方案 B（保留 5 列但用 check constraint）**：SQLite check constraint 表达力有限，无法精确表达"running 时 active_run_id 非空且 checkout_run_id 也非空"这类跨列约束。

**方案 C（单独一个 state machine 中间层 service）**：应用层约束比 SQL 层约束弱——任何代码绕过 service 直接 SQL 就失效。

方案 A 是唯一把约束放在数据结构层的。

## 附：phase 枚举外的状态跟踪

某些运行态信息仍需要但不属于 phase 枚举：
- `blocked_reason`（为什么 block）
- `awaiting_review_since`（等待审核已多久）
- `attempted_count`（重试次数）

这些存在 tasks 的辅助列或独立表——独立于 phase enum，不参与 CAS。

## Phase 2 considerations

> 追加时间：2026-04-20（Roundtable T1 Linus/Jobs review 之后）
> 状态：Phase 1（步骤 1/5–5/5）已完成并加了一轮 follow-up 修补（advanceTaskStatus lease 清理 + interruptStaleRuns scoping + ESLint 规则加固）。下面这组问题在 Phase 1 明确不动。

### Phase 1 实际形态

- v50 migration 加了 `tasks.phase` 列 + `task_leases` 表 + status→phase TRIGGER。
- 所有 status 写路径走 `advanceTaskStatus` / `checkoutTask` / `releaseTaskLock` / `renewTaskLease` / `saveTask` / `recoverStaleLocks` / `interruptStaleRuns`。每处都显式写 lease（INSERT / UPDATE / DELETE）并由 TRIGGER 镜像 status→phase。
- Dev-mode 启动时跑 `verifyPhaseConsistency` 报告任何 legacy 列 vs 新 phase/lease 之间的分歧行。
- ESLint `no-restricted-syntax` 规则现在抓 `UPDATE tasks SET ...status =` 的所有字面量变体以及 `UPDATE tasks SET ${...}` 的 template head；所有 5 处灰度写点都带 rationale 注释。
- 读路径**没有切**到 phase / task_leases（Round 2 共识"only dual-write, no switch-read"）。

### 未决的架构争论

**Linus ask：删掉 status→phase TRIGGER，改为显式双写。**

论点：TRIGGER 是隐式耦合，任何新写路径都"顺带"改 phase，容易让人忘记也要处理 lease。显式双写把"我在改 status + 改 phase + 改 lease"三件事放在同一段代码里，review 时一眼能看全。

反论点：现状是 TRIGGER + consistency probe 双层护栏。TRIGGER 保证 `phase` 永远跟 `status` 同步（SQL 层强制），probe 在 dev 里暴露 `phase` vs `lease` 分歧。如果在 Phase 1 window 里删 TRIGGER，就要在 aba6fa3 往后的 5 个 commit 里把每个写点都加一遍显式 phase 更新——改动面大、易漏、测试信心低。Round 2 共识是 Phase 1 只做 dual-write，TRIGGER 留到 Phase 2 专门评估。

**决定**：Phase 1 不动 TRIGGER。Phase 2 开始时重新评估，届时已有 fixture + 行为基线，可以用明确的 test coverage 证伪"删 TRIGGER 会引入 regression"。

**Jobs ask：Phase 2 把读路径切到 phase / task_leases。**

论点：Dual-write 只是过渡态；只要读路径还看 legacy `status` / `active_run_id` / `checkout_run_id` 三列，phase 和 lease 就只是"给自己看的影子"，不会暴露业务错误。

反论点：切读之前必须有 eval 基线能证明"同一 company 输入下 v50 dual-write 模式 和 v51 read-from-phase 模式的 agent 行为序列一致"。B5 eval harness 是 blocking dependency（见顶部），在 fixture 录好之前切读是盲切。

**决定**：Phase 2 前 B5 eval harness 必须就绪。

### Phase 2 entry criteria

以下全部满足才进 Phase 2：

1. **B5 eval harness 能录一批 run trace 作为 baseline**：选 3 个 company 模板，每个跑一轮完整 sprint，记录 tool call 序列 + state transition 序列。
2. **Phase 1 dev-mode probe 连续 7 天 0 divergence**：启动时 `verifyPhaseConsistency` 的 `inconsistent` 字段必须持续为 0。如果还有分歧，说明 Phase 1 还没收敛，不该往前走。
3. **Phase 1 所有 grandfathered 写点都有 test 覆盖**：`advanceTaskStatus` lease 清理、`checkoutTask` lease 写入、`interruptStaleRuns` scoping、`recoverStaleLocks` lease 清理。T1 follow-up 已补齐 `advanceTaskStatus`，其余在 Phase 2 开工前补齐。
4. **TRIGGER vs 显式双写定案**：Phase 2 第一个 commit 要么保留 TRIGGER 并写 contract test 钉死 `status ⇔ phase` 不变式，要么删 TRIGGER 并把显式 phase 更新加到所有写点。两条路径都是可验证的；Phase 2 开工时用 review 投票选一条。

### Phase 3 drop-old-columns gate

Phase 2 完成（所有读路径切到 phase / task_leases）并运行 14 天、`checkout_race_lost` 计数连续为 0 之后才进 Phase 3：

1. **静态扫描确认没有新的 legacy 列 reader**：`status IN ('todo', 'backlog')`、`checkout_run_id`、`execution_locked_at`、`active_run_id` 全站搜索 0 命中（migrations 除外）。
2. **ESLint 规则升级为 `error`**：任何新增的 legacy 列引用直接 fail build。
3. **灰度 1 个 company 7 天**：观察 `sqlite_busy` 不增、`checkout_race_lost` 不增、renderer 没有新 404/500。
4. **v51 migration 删列**：`active_run_id`、`checkout_run_id`、`execution_locked_at`、`active_session_id`、`status`（如保留则降为 derived view）。删列前自动备份一次。

### 明确不在 Phase 2 scope

- **M7 Phase 2 call-site switch**：Round 2 共识 M7 只做 Phase 1。Phase 2 开工时如需重开，走独立 proposal。
- **B4 single-writer actor**：互补 proposal，独立推进。
- **IPC 契约改动**：renderer 看到的仍是 `TaskRecord.status`，由 map 层从 phase/lease 合成。
