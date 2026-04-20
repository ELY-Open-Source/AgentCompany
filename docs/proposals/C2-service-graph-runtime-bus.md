# Proposal C2: service-graph LateBinding 替换为 RuntimeBus（事件总线）

> 来源：问题.md C2（行 129-145）、附录 F 样本 6（行 511-530）
> 状态：proposed（待 B4 完成后实施）
> 提出：Roundtable 2026-04-20（Linus + Karpathy + Steve Jobs）
> Owner: TBD
> 估计工时：3 周
> Blocking dependencies：B4（single-writer actor 先稳定并发模型）

## 问题陈述

`src/main/service-graph.ts:110-113` 存在 4 个 `LateBinding` 占位符：

```ts
const orchestrationRef = new LateBinding<...>("orchestrationService");
const automationRef    = new LateBinding<...>("automationService");
const browserActionRef = new LateBinding<...>("browserActionService");
const updaterRef       = new LateBinding<...>("updaterService");
```

注释里已经承认这是为了解决循环依赖：

> "worker needs orchestration (for dispatchRunToWorker), orchestration needs worker (for enqueueWorkerRun), orchestration needs automation (for dispatchAutomation), automation/orchestration need browser-action…"

`LateBinding.get()` 在未绑定时抛异常——**启动顺序错一步整棚塌**，且 runtime 无法静态验证调用安全。

进一步证据（`src/main/service-graph.ts:174-191` 的 RuntimeMessageInjector 构造）：

```ts
runtimeMessageInjector = new RuntimeMessageInjector({
  db,
  runtimeBridge: piRuntimeRef.current.runtimeBridge,
  postToWorker: (message) => {
    const worker = workerService?.getWorker();
    if (!worker) throw new Error("Worker is not initialised — cannot deliver steer message.");
    worker.postMessage(message);
  },
  getWakeAgent: () => {
    if (!orchestrationRef.isAssigned()) return null;
    const orch = orchestrationRef.get();
    return (agentId, companyId, trigger) => orch.wakeAgentIfPossible(agentId, companyId, trigger);
  },
  logger,
});
```

两个 callback（`postToWorker` / `getWakeAgent`）每次调用都要重新检查 binding 状态——这不是依赖注入，是运行时祈祷。

## 根因分析

Linus 视角（好品味原则第一条 + 第七条）：**循环依赖不能靠 lazy 解决，说明模块边界切错了**。

4 个服务互相咬尾巴：
```
worker ──dispatchRun──> orchestration
orchestration ──enqueueRun──> worker
orchestration ──dispatchAutomation──> automation
automation ──wakeAgent──> orchestration
automation ──dispatchAction──> browserAction
browserAction ──wakeAgent──> orchestration
```

这不是 4 个服务，这是**一个分布式系统**被错误地拆成 4 个互相调用的同步对象。真正的解法是**反转依赖方向**——让所有服务都依赖一个**事件/命令总线**，服务之间不直接持有彼此的引用。

LateBinding 的问题：
1. **编译期错误 → 运行时错误**：bind 错了、漏 bind、bind 顺序错，TypeScript 编译全绿，应用启动崩
2. **init 顺序依赖人工维护**：`service-graph.ts:120-265` 的 `set()` 顺序是 review 出来的，新增服务必须重新排雷
3. **调用位置静态不可达**：搜 `dispatchRunToWorker` 的消费者只能 grep 到 `.get().dispatchRunToWorker`，IDE rename 无法跟踪
4. **测试无法 mock**：注入一个假 LateBinding 要复制整个 binding 容器，测试设置成本高

## 设计方案

### RuntimeBus 接口

```ts
// src/main/runtime/runtime-bus.ts
export interface RuntimeBus {
  // 命令投递（fire-and-forget 或返回 ack Promise）
  dispatch<K extends CommandKind>(kind: K, payload: CommandPayload<K>): Promise<CommandAck<K>>;

  // 订阅特定命令类型（service 注册自己能处理什么）
  subscribe<K extends CommandKind>(kind: K, handler: CommandHandler<K>): () => void;

  // 事件广播（1 对 N，无 ack）
  emit<K extends EventKind>(kind: K, payload: EventPayload<K>): void;

  // 事件订阅
  on<K extends EventKind>(kind: K, listener: EventListener<K>): () => void;
}
```

### 命令类型表（强类型 contract）

```ts
export type CommandKind =
  | "run.dispatch"          // worker ← orchestration
  | "run.enqueue"           // orchestration ← worker
  | "agent.wake"            // orchestration ← automation/browserAction/...
  | "automation.dispatch"   // automation ← orchestration
  | "browserAction.dispatch"// browserAction ← automation/orchestration
  | "steer.postToWorker"    // worker ← runtimeMessageInjector
  | "updater.check";        // updater ← main/menu

export interface CommandPayloadMap {
  "run.dispatch": { runId: string; agentId: string; companyId: string };
  "run.enqueue": { runId: string; ... };
  "agent.wake": { agentId: string; companyId: string; trigger: AgentTrigger };
  "automation.dispatch": { ruleId: string; ... };
  "browserAction.dispatch": { actionId: string; ... };
  "steer.postToWorker": { message: WorkerInboundMessage };
  "updater.check": { manual: boolean };
}
```

### 服务改造

Before（`service-graph.ts:174-191`）：

```ts
runtimeMessageInjector = new RuntimeMessageInjector({
  db,
  postToWorker: (msg) => workerService?.getWorker()?.postMessage(msg),
  getWakeAgent: () => orchestrationRef.isAssigned() ? orchestrationRef.get().wakeAgentIfPossible : null,
  ...
});
```

After：

```ts
runtimeMessageInjector = new RuntimeMessageInjector({ db, bus, logger });

// RuntimeMessageInjector 内部：
async steer(runId: string, message: string) {
  await this.bus.dispatch("steer.postToWorker", { message: { ... } });
}
async wakeAgent(agentId: string, companyId: string, trigger: AgentTrigger) {
  await this.bus.dispatch("agent.wake", { agentId, companyId, trigger });
}
```

### 服务注册

```ts
// service-graph.ts（重写后，清晰 linear init）
const bus = new InProcessRuntimeBus();

const workerService = new WorkerService({ db, bus, ... });
workerService.register();  // 内部订阅 "run.dispatch", "steer.postToWorker"

const orchestrationService = new OrchestrationService({ db, bus, ... });
orchestrationService.register();  // 订阅 "run.enqueue", "agent.wake"

const automationService = new AutomationService({ db, bus, ... });
automationService.register();  // 订阅 "automation.dispatch"

const browserActionService = new BrowserActionService({ db, bus, ... });
browserActionService.register();  // 订阅 "browserAction.dispatch"

// 所有服务已注册，可以开始 dispatch
await orchestrationService.start();
```

没有 LateBinding。没有回调地狱。没有"isAssigned 检查"。注册完 = 可用。

### InProcessRuntimeBus 实现

```ts
export class InProcessRuntimeBus implements RuntimeBus {
  private handlers = new Map<CommandKind, CommandHandler<CommandKind>>();
  private listeners = new Map<EventKind, Set<EventListener<EventKind>>>();

  subscribe<K>(kind: K, handler: CommandHandler<K>): () => void {
    if (this.handlers.has(kind)) {
      throw new Error(`Command kind "${kind}" already has a handler — commands are 1:1`);
    }
    this.handlers.set(kind, handler);
    return () => this.handlers.delete(kind);
  }

  async dispatch<K>(kind: K, payload: CommandPayload<K>): Promise<CommandAck<K>> {
    const handler = this.handlers.get(kind);
    if (!handler) {
      throw new Error(`No handler registered for "${kind}"`);
    }
    return await handler(payload);
  }
  // emit/on 类似
}
```

**关键约束**：`dispatch` 要求 handler 必须存在（不像 LateBinding 可以延迟到调用时 crash，这里是 register 完就保证可用）。

## Migration 计划

1. **Phase 1（1 周）**：新建 `src/main/runtime/runtime-bus.ts` + 类型表，不动现有代码。
2. **Phase 2（1 周）**：一个服务一个服务地迁移到 bus：
   - 先迁 worker ↔ orchestration（最核心的循环）
   - 再迁 automation
   - 最后迁 browserAction 和 updater
   每次迁移一个服务，保留 LateBinding 直到全部迁完。
3. **Phase 3（3 天）**：迁完后删 `LateBinding` 类 + `service-graph.ts:110-113` 的 ref 段落 + 所有 `.get()` / `.isAssigned()` 调用。
4. **Phase 4（2 天）**：把 service-graph.ts 从 284 行的 callback 森林重写成 linear init（预计 < 100 行）。
5. **Phase 5（持续）**：新增服务必须通过 bus 交互，ESLint rule 禁止直接 import 另一个服务类。

## 风险与回滚

| 风险 | 触发条件 | 回滚方法 |
|------|---------|---------|
| 性能回退 | bus dispatch 多一次 async hop | 可能的 10μs 级开销，远低于 SQLite 写本身；不可接受时改为 sync dispatch（subscribe 仍是 sync handler） |
| 类型体操复杂 | CommandPayloadMap 泛型推导 | 类型系统验证过类似 pattern（Redux toolkit 的 PayloadAction），成熟方案 |
| 初始化循环未发现 | 某服务订阅 + 自己 dispatch 同一 kind | bus 内部加检测：handler 执行时记 call stack，发现 reentrant 直接抛 |
| 测试 mock 成本 | 需要 mock bus | 反而更容易——测试用 `new InProcessRuntimeBus()` 即可，精确订阅需要的 kind |

回滚路径：phase 2 每个服务迁移是独立 PR，任何一个发现问题可 revert；phase 3 前 LateBinding 仍在，语义层面完全兼容。

## 验证标准

1. **Typecheck**：CommandKind ↔ Payload 类型约束强制 compile-time 正确
2. **Linear init**：`service-graph.ts` 行数 < 100，无 LateBinding / 无 callback / 无 isAssigned
3. **契约测试**：每个 CommandKind 配 fixture，验证 payload shape 稳定
4. **集成测试**：启动顺序随机化 N 次，应用都能正常起（验证无启动顺序依赖）
5. **Static scan**：`grep -rn "LateBinding\|isAssigned" src/` 无命中

## 不在范围

- **不做跨进程 bus**：renderer/main 之间继续走 IPC，bus 只管 main 进程内部。
- **不做 event sourcing**：bus 不持久化 event history，任何需要审计的事件仍走 DB。
- **不改 pi runtime 对接**：pi runtime 仍走 piRuntimeRef 方式，本 proposal 只动 4 个自研服务。
- **不引入 RxJS / reactive library**：简单 EventEmitter 模式足够。
- **不做 priority queue**：所有 command 同等优先级；需要 backpressure 走 B4 的 writer actor。

## 参考文件清单

- `src/main/service-graph.ts:110-113`（4 个 LateBinding）
- `src/main/service-graph.ts:120-265`（人工排序的 init）
- `src/main/service-graph.ts:174-191`（RuntimeMessageInjector callback 地狱）
- `src/main/service-graph.ts:258-263`（LateBinding set 段落）
- `src/main/orchestration/orchestration-service.ts`（消费者）
- `src/main/worker/worker-runner.ts`（消费者）
- `src/main/automation-service.ts`（消费者）
- `src/main/browser/browser-action-service.ts`（消费者）

## 附：为什么不是现在立刻修

B4（single-writer actor）必须先做——否则 bus dispatch 内部触发数据库写时会继续多 writer 抢锁，C2 的改进被淹没。先把"谁写 DB"的契约收敛，再解决"谁叫谁"的契约。

C2 本身是**"让下一个 AI 能读懂这个项目"**的前提——现在的 service-graph.ts 是 AI coding agent 最容易读错的文件之一（circular reference + lazy binding + callback 三重混淆）。修完后，新 feature 接入服务的时间从"读半天 graph 再写"降到"开一个 subscribe"。

Steve Jobs 视角：LateBinding 是"技术上可行但用起来很差"的典型——它让架构师觉得自己聪明，让所有后来者困惑。好的设计应该让**无需理解 init 顺序**就能加新服务。

## 附：gating matrix

| Gate | 条件 | 放行判断人 |
|------|------|----------|
| G1 | B4 single-writer actor 完成 | Linus |
| G2 | RuntimeBus 接口 + CommandKind 枚举固化 | Linus |
| G3 | 4 个循环服务全部迁移到 bus | Owner |
| G4 | service-graph.ts 行数 < 100 | Linus |
| G5 | 启动顺序随机化测试 N 次全绿 | Owner |
