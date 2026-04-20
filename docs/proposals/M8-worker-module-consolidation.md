# Proposal M8: worker/ 13 文件整合为 3 文件（entry / runtime / observability）

> 来源：问题.md M8（行 266-270）、附录 C（行 396-397）
> 状态：proposed
> 提出：Roundtable 2026-04-20（Linus + Karpathy + Steve Jobs）
> Owner: TBD
> 估计工时：1 周
> Blocking dependencies：无

## 问题陈述

`src/main/worker/` 当前 13 个文件：

| 文件 | 行数近似 | 职责 |
|------|---------|------|
| circuit-breaker.ts | 80+ | run 失败熔断 |
| failure-escalation.ts | 60+ | 失败升级通知 |
| log-redactor.ts | 50+ | log 敏感信息遮蔽 |
| pi-agent-factory.ts | 131 | 组装 pi agent |
| run-event-recorder.ts | 100+ | run event 写入 DB |
| run-log-filter.ts | 40+ | log 过滤 |
| worker-crash-recovery.ts | 80+ | 崩溃恢复 |
| worker-entry.ts | 50+ | 进程入口 |
| worker-helpers.ts | 100+ | 杂项 utility |
| worker-message-handler.ts | 150+ | IPC 消息分发 |
| worker-rpc.ts | 60+ | RPC 框架 |
| worker-runner.ts | 239 | 主 run loop |
| worker-types.ts | 80+ | 类型定义 |

问题：
1. **边界模糊**：`circuit-breaker` / `failure-escalation` / `log-redactor` / `run-log-filter` 四个"辅助"模块互相引用，存在**跨文件 silent dependency**（比如 failure-escalation 读 circuit-breaker 的状态）
2. **helpers 是垃圾筐**：`worker-helpers.ts` 什么都有——典型的 catch-all 反模式
3. **13 个文件对 ~1200 行总量是过度切分**：平均每个文件 ~90 行，跨文件跳转成本高
4. **职责不在文件名上**：`worker-entry.ts` / `worker-runner.ts` / `worker-message-handler.ts` 三个都像"入口"，实际职责谁是谁需要打开文件才知道

## 根因分析

Linus 视角（第七条：解法是否最简）：**一件事切十三片是过度工程**。

正确的切分标准不是"这段代码看起来像独立功能"，而是"这段代码的变更频率和变更原因与其他代码是否不同"。当前 worker 的所有文件几乎**同一批人、同一时间、同一原因**被修改——每次 pi-agent-core 升级或 bug fix 都在改多个文件。这表明它们本质是**一个模块**被过早分裂。

Karpathy 视角补充：worker 是 agent 跑 run 的核心路径，逻辑密度高——分文件反而让跟踪执行流程更难（"log redactor 在 worker-entry 之后还是之前跑的？"）。

## 设计方案

### 新结构：3 文件 + 1 types

```
src/main/worker/
├── worker-types.ts         # 保留 (类型定义)
├── worker-entry.ts         # 进程入口 + crash recovery + message dispatch
├── worker-runtime.ts       # pi agent 组装 + run loop + circuit breaker + failure escalation
└── worker-observability.ts # log redactor + log filter + run-event recorder
```

### 职责划分

**worker-entry.ts**（原 worker-entry + worker-message-handler + worker-rpc + worker-crash-recovery + worker-helpers 里的入口相关）
- Electron utility process entry point
- 初始化 IPC（与 main 的 duplex channel）
- 接收 inbound messages、分发到 runtime
- 处理崩溃恢复（重启后 resume run state）
- 进程级别 helper

**worker-runtime.ts**（原 worker-runner + pi-agent-factory + circuit-breaker + failure-escalation）
- 组装 pi agent（hooks / context compactor / cost writer 等）
- 启动和驱动 agent loop
- 失败检测（circuit breaker）
- 失败升级（重试策略 / 通知 main）
- 这些是**紧密耦合**的——一个 run 的生命周期线性经过它们

**worker-observability.ts**（原 log-redactor + run-log-filter + run-event-recorder）
- Log 敏感信息遮蔽
- Log level 过滤
- Run event 持久化到 DB
- 这些都是"run 执行的副作用输出"，职责统一

**worker-types.ts**（不动）
- 保留所有跨文件共享的类型

### 单文件结构建议

每个合并后的文件内部用 section comment 分 region：

```ts
// worker-runtime.ts

// ============================================================================
// pi agent factory
// ============================================================================
export function createPiAgent(...) { ... }

// ============================================================================
// Circuit breaker
// ============================================================================
class CircuitBreaker { ... }

// ============================================================================
// Run loop
// ============================================================================
export async function runWorker(...) {
  const agent = createPiAgent(...);
  const breaker = new CircuitBreaker(...);
  // ...
}
```

这样读者打开一个文件就能线性看完 run 的全生命周期，不用跳 5 个文件。

## Migration 计划

1. **Phase 1（1 天）**：创建新 3 文件空壳，逐步把内容从 13 个旧文件搬过去
2. **Phase 2（2 天）**：搬运过程中修 import path——外部消费者（service-graph / orchestration）的 import 从 13 个路径收敛到 3 个
3. **Phase 3（1 天）**：删除旧 13 个文件
4. **Phase 4（1 天）**：`pnpm typecheck` + 相关单测跑完
5. **Phase 5（1 天）**：观察 log output 是否有 regression（redactor / filter 的行为是否保持）

## 风险与回滚

| 风险 | 触发条件 | 回滚方法 |
|------|---------|---------|
| 循环 import | 合并后某些函数互相依赖 | 合并过程本就在消除循环，如发现循环则进一步合并或拆新文件 |
| Log redactor 规则失效 | 合并时漏搬某个 regex | 搬前先列完整 redact rule 清单，合并后 diff |
| Circuit breaker 状态丢失 | 重构过程中某状态字段遗漏 | 单测覆盖 circuit breaker 开/合/半开三态 |
| 外部 consumer 的 import 路径 | service-graph 引用 13 个 worker 文件中某些 | 先全改 import，再删旧文件 |

**回滚路径**：用 `git mv` 做文件合并，所有改动在一个大 PR，如发现问题 revert 一键回到 13 文件结构。

## 验证标准

1. **Typecheck 全绿**：pnpm typecheck 通过
2. **Worker 启动正常**：desktop app 启动后能看到 worker utility process 正常上线
3. **Run 执行完整**：手动跑一个 run，验证 tool call / log / cost 记录都正确
4. **Log 行为不变**：同样的 agent 输出，redacted log 应和 migration 前字节级一致
5. **Crash recovery 可用**：kill worker 进程，主进程重启 worker 后能 resume 运行中的 run

## 不在范围

- **不改 worker 行为**：只是文件重组，功能完全一致
- **不重写 pi-agent-factory 内部逻辑**：hook 注册顺序和参数都保留
- **不改 IPC 协议**：main ↔ worker 的消息格式不动
- **不引入新的 utility process**：browser automation 的独立 utility process 走 M9
- **不拆分 worker 到独立 package**：当前仓库内结构即可

## 参考文件清单

合并前 13 个文件：
- `src/main/worker/circuit-breaker.ts`
- `src/main/worker/failure-escalation.ts`
- `src/main/worker/log-redactor.ts`
- `src/main/worker/pi-agent-factory.ts`
- `src/main/worker/run-event-recorder.ts`
- `src/main/worker/run-log-filter.ts`
- `src/main/worker/worker-crash-recovery.ts`
- `src/main/worker/worker-entry.ts`
- `src/main/worker/worker-helpers.ts`
- `src/main/worker/worker-message-handler.ts`
- `src/main/worker/worker-rpc.ts`
- `src/main/worker/worker-runner.ts`
- `src/main/worker/worker-types.ts`

外部消费者（import 路径需更新）：
- `src/main/service-graph.ts`
- `src/main/orchestration/scheduler.ts`
- `src/main/orchestration/task-runner.ts`

## 附：为什么现在修

文件数量的治理成本**线性增长**——13 个文件比 3 个文件多 10 倍"哪个文件负责什么"的认知负担。每次新 feature 加 worker 里的 hook 或 recovery 逻辑，都要先判断"应该加到哪个文件"。

**AI coding agent 尤其受影响**——agent 写代码前要扫完 13 个文件才知道 worker 现有结构。合并到 3 个文件后，一次读完就能动手。这直接缩短每个 worker 相关任务的 time-to-PR。

M8 和 M10（agent-runtime hooks 聚合）有类似 pattern——都是"过度切分的模块要合回来"。两件事可以同一个 sprint 做。

## 附：gating matrix

| Gate | 条件 | 放行判断人 |
|------|------|----------|
| G1 | 新 3 文件结构覆盖旧 13 文件所有导出符号 | Linus |
| G2 | 外部 import 路径全部更新（grep `from "\.\./worker/"` 只出现 3 个模块名） | Linus |
| G3 | worker 启动 / run 执行 / crash recovery 三大路径验证 | Owner |
| G4 | Log output 字节级 diff 与合并前一致 | Karpathy |
| G5 | Lines per file < 800（可读性上限） | Linus |

## 附：文件内部 region 结构

**worker-runtime.ts** 的 section 顺序：

```
// ============================================================================
// Circuit breaker (state machine: closed / open / half-open)
// ============================================================================

// ============================================================================
// Failure escalation (retry policy + incident creation)
// ============================================================================

// ============================================================================
// Pi agent factory (assemble hooks + options)
// ============================================================================

// ============================================================================
// Run loop (main entry: runWorker)
// ============================================================================
```

读者按顺序线性理解一个 run 的生命周期：通过 circuit breaker 检查 → 构造 agent → 进 run loop → 失败时走 escalation。

## 附：反模式对比

**Before**：
- `worker-runner.ts` 引用 `circuit-breaker.ts`、`failure-escalation.ts`、`pi-agent-factory.ts`
- `pi-agent-factory.ts` 引用 `log-redactor.ts`
- `worker-crash-recovery.ts` 引用 `run-event-recorder.ts`
- 13 文件组成不可见的依赖图

**After**：
- 3 文件 + 1 types，依赖方向清晰：`entry.ts → runtime.ts → observability.ts`
- 单向依赖，无循环
- 新 reader 打开 `runtime.ts` 就能读懂 run 怎么跑

## 附：为什么不选其他方案

**方案 A（当前 proposal）**：合并到 3 文件。

**方案 B（保留文件但拆到 5-6 个更合理的模块）**：仍然分散，没解决根本问题。

**方案 C（全合到单一 worker.ts 大文件）**：过度合并，单文件过大（>2000 行）不利于 review。

方案 A 平衡了"单 responsibility 原则"和"可读性"。

## 附：合并映射表

| 原文件 | 合并到 | 原职责 |
|-------|-------|-------|
| worker-entry.ts | worker-entry.ts | 进程入口 |
| worker-crash-recovery.ts | worker-entry.ts | Crash 恢复 |
| worker-message-handler.ts | worker-entry.ts | IPC 分发 |
| worker-rpc.ts | worker-entry.ts | RPC 框架 |
| worker-helpers.ts | worker-entry.ts + worker-runtime.ts | 杂项（分拆归属） |
| worker-runner.ts | worker-runtime.ts | Run loop |
| pi-agent-factory.ts | worker-runtime.ts | Agent 组装 |
| circuit-breaker.ts | worker-runtime.ts | 熔断 |
| failure-escalation.ts | worker-runtime.ts | 失败升级 |
| log-redactor.ts | worker-observability.ts | Redact |
| run-log-filter.ts | worker-observability.ts | Filter |
| run-event-recorder.ts | worker-observability.ts | Event 记录 |
| worker-types.ts | worker-types.ts | 不变 |

合并后 ~1200 行分布：entry ~400, runtime ~500, observability ~200, types ~100。
