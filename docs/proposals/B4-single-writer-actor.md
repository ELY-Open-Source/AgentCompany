# Proposal B4: 所有 mutation 集中到 single-writer actor（main 进程串行 queue）

> 来源：问题.md B4（行 83-94）、附录 G 第 5 行（行 559）
> 状态：proposed（待 B2 完成后实施）
> 提出：Roundtable 2026-04-20（Linus + Karpathy + Steve Jobs）
> Owner: TBD
> 估计工时：2 周
> Blocking dependencies：B2（phase/lease 重构先稳住数据结构）

## 问题陈述

项目只有一个 `DatabaseSync` 连接（`src/main/database-base.ts` 的 `openConnection` 在 main 进程初始化一次），但并发 writer 至少有 4 类：

1. **Scheduler 周期唤醒**（`src/main/orchestration/scheduler.ts`、`scheduler-heartbeat.ts`）
2. **Task runner dispatch**（`src/main/orchestration/task-runner.ts`）
3. **Heartbeat 周期写**（`src/main/orchestration/heartbeat.ts` 的 `markHeartbeatAt`）
4. **Worker 回调 run 状态**（`src/main/worker/worker-runner.ts`）
5. **Automation service 触发**（`src/main/automation-service.ts`）
6. **Backup 任务**（`src/main/database-backup.ts` 或类似）

所有 writer 都走 `transaction(BEGIN IMMEDIATE)`。`src/main/database-base.ts:433-440` 的连接配置只有 `busy_timeout=5000`，`database-base.ts:442-452` 的 `transaction` 包装**没有任何重试**。

后果：
- 高压场景下 `BEGIN IMMEDIATE` 会互相串行等 5 秒
- 一旦串行等待链超过 5 秒，事务被 `SQLITE_BUSY` 反弹
- 对调用方：可能表现为"事务成功"但实际回滚，或抛 raw `SQLITE_BUSY` 没人 catch
- 线上没有 `SQLITE_BUSY` 计数 telemetry，问题完全不可观测

## 根因分析

Linus 视角：**SQLite 不是并发数据库**。WAL 模式下读可以并发，写永远只有一个。这不是 bug，是 SQLite 的 design goal。

当前项目的错误是：**把 SQLite 当 Postgres 用**——4+ 个异步来源各自 `BEGIN IMMEDIATE`，期望 SQLite 帮你协调。SQLite 的"协调"机制就是让你排队等 5 秒然后报错。`busy_timeout` 不是并发控制，它只是延后 crash。

这里有三个独立问题叠加：

1. **没有 single-writer 约束**：代码层面没人负责串行化写请求。
2. **没有读写分离**：读请求和写请求共用同一连接，读也在抢 writer lock。
3. **没有重试 / 退避**：事务失败直接抛，上层是否处理不确定（B4 和 C6 的 silent catch 问题叠加）。

Karpathy 视角补充：agent 规模一大（10+ agent concurrent）就会被这个问题困住——不是功能不够，是基础设施撑不住。而且这种问题**在 dev 环境永远复现不了**，因为 dev 只有 1-2 个 agent，排队等 5 秒根本触达不到。

## 设计方案

### 架构：Writer Actor + Reader Pool

```
┌─────────────────────────────────────────────────┐
│  Main process                                   │
│                                                 │
│  ┌──────────────┐    ┌────────────────────┐   │
│  │  WriterActor │◄───│  enqueueWrite(fn)  │   │
│  │  (async      │    │  from any caller   │   │
│  │   queue)     │    └────────────────────┘   │
│  │              │                              │
│  │  single      │◄── scheduler / heartbeat /   │
│  │  writer      │    worker / automation / …   │
│  │  connection  │                              │
│  └──────┬───────┘                              │
│         │                                       │
│  ┌──────▼───────────┐                          │
│  │  SQLite (WAL)    │                          │
│  └──────▲───────────┘                          │
│         │                                       │
│  ┌──────┴───────────┐                          │
│  │  ReaderPool      │                          │
│  │  (readonly: true │                          │
│  │   connections)   │                          │
│  └──────────────────┘                          │
└─────────────────────────────────────────────────┘
```

### 实现

**1. WriterActor（新文件 `src/main/database/writer-actor.ts`）**

```ts
type WriteJob<T> = () => T;

class WriterActor {
  private queue: Array<{ job: WriteJob<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];
  private running = false;
  private db: DatabaseSync;  // 独占的 writer 连接

  async enqueue<T>(job: WriteJob<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ job: job as WriteJob<unknown>, resolve: resolve as (v: unknown) => void, reject });
      if (!this.running) this.drain();
    });
  }

  private drain() {
    this.running = true;
    while (this.queue.length > 0) {
      const { job, resolve, reject } = this.queue.shift()!;
      try {
        // 单连接独占，不需要 BEGIN IMMEDIATE 抢锁
        resolve(this.db.transaction(job)());
      } catch (e) {
        reject(e);
      }
    }
    this.running = false;
  }
}
```

**关键语义**：
- 写永远串行（actor 内部 FIFO queue）
- 写不再等 busy_timeout——因为没人和它抢
- 任何 writer 都必须走 `writerActor.enqueue(() => db.transaction(...))`

**2. ReaderPool**

```ts
// src/main/database/reader-pool.ts
export function openReader(dbPath: string): DatabaseSync {
  return new DatabaseSync(dbPath, { readOnly: true });
}
```

Readers 走独立 connection，`readOnly: true`。N 个 reader 可以并发读（WAL 保证）。

**3. 改造所有 mutation call sites**

| 文件 | 当前写法 | 改造后 |
|------|---------|--------|
| `src/main/orchestration/scheduler.ts` | `db.transaction(...)` | `writerActor.enqueue(() => ...)` |
| `src/main/orchestration/heartbeat.ts` | `db.run("update ...")` | `writerActor.enqueue(() => db.run(...))` |
| `src/main/worker/worker-runner.ts` | 回调直接写 | `writerActor.enqueue(...)` |
| `src/main/automation-service.ts` | rule fire 写 db | `writerActor.enqueue(...)` |
| `src/main/database-base.ts:442-452` | `transaction(fn)` | 保留但改为 reader 专用，writer 入口走 actor |

**4. ESLint rule 强制**

自定义规则：`no-direct-db-write`——禁止在非 `writer-actor.ts` 文件中调用 `db.prepare(...).run(...)`（除非 `readonly: true` 明确标注）。

### Backpressure

队列长度超过阈值（例如 100）时：
- 记 telemetry `writer_queue_depth`
- 超过 1000 直接拒绝新入队，抛 `WriterBusyError`
- 让上游（scheduler / worker）自己决定是否降频

## Migration 计划

1. **Phase 1（1 周）**：新增 writer-actor.ts 和 reader-pool.ts，不改任何 call site。
2. **Phase 2（3 天）**：找出所有 `db.prepare` + `.run` 的 mutation 调用（grep），按文件分批 migrate 到 `writerActor.enqueue`。每批一个 PR，各跑一次 typecheck。
3. **Phase 3（2 天）**：把 read-heavy 的 service（dashboard / list view）切到 reader pool。
4. **Phase 4（1 天）**：打开 ESLint rule，禁止新代码绕过 actor。
5. **Phase 5（持续监测）**：telemetry 观察 writer queue depth p99，1 周后把 busy_timeout 下调到 500ms（writer actor 内部串行后根本不该触达）。

不需要 schema migration——这是纯代码结构重构。

## 风险与回滚

| 风险 | 触发条件 | 回滚方法 |
|------|---------|---------|
| Deadlock | actor 内部 job 等待另一个 actor job | 禁止 job 内再调 `enqueue`（ESLint rule + runtime 检查） |
| 吞吐下降 | 串行化本来并行的写 | SQLite 写本来就是串行的，只是从"互等 5 秒"变成"排队"，p99 延迟会降不会升 |
| Queue 堆积 | 某个 slow query 堵住 actor | backpressure + telemetry 告警 |
| Reader 读到 stale | WAL 下 reader 看到的是自己 snapshot 的数据 | 读写分离的固有语义，UI 层通过 IPC event 推送更新 |

回滚路径：任何阶段发现问题，把 `writerActor.enqueue(fn)` 改回 `fn()` 直接跑——actor 只是 queue，不改事务语义。

## 验证标准

1. **压力测试**：启动 20 个 agent 同时跑 run，观察 `writer_queue_depth` p99 < 50
2. **SQLITE_BUSY 消失**：生产 telemetry 跑一周，`SQLITE_BUSY` 计数应归零（因为不再有多 writer 抢锁）
3. **行为 eval**（前置 B5）：相同 workload 下，改造前后 run 完成率 / tool call 序列一致
4. **Deadlock 单测**：actor 内部 `enqueue` 嵌套直接抛错，不允许死锁发生
5. **Reader 隔离**：kill writer actor 期间，reader 仍能正常服务 read-only IPC

## 不在范围

- **不改 SQLite 版本或 WAL 参数**：现有 WAL + checkpoint 策略保留。
- **不引入 Postgres / 分布式数据库**：SQLite 单机单 writer 是 desktop app 的合理选择。
- **不做 per-company 分片**：单 actor 足够处理单 desktop 的量，分片是未来的事。
- **不重写 transaction 语义**：`db.transaction(fn)()` 包装保留，只是入口走 actor。
- **不改 IPC**：renderer 还是通过 IPC 触发 mutation，只是 handler 内部走 actor。

## 参考文件清单

- `src/main/database-base.ts:433-440`（连接配置 busy_timeout=5000）
- `src/main/database-base.ts:442-452`（transaction 无重试）
- `src/main/orchestration/scheduler.ts`（wake writer）
- `src/main/orchestration/scheduler-heartbeat.ts`（heartbeat writer）
- `src/main/orchestration/task-runner.ts`（dispatch writer）
- `src/main/orchestration/heartbeat.ts`（markHeartbeatAt writer）
- `src/main/worker/worker-runner.ts`（run status writer）
- `src/main/automation-service.ts`（rule fire writer）

## 附：为什么现在修

**现在**的触发器是 company 规模——10+ agent 并发运行时 SQLite 写队列 5 秒 busy_timeout 很容易击穿。此时 transaction rollback 对 caller 表现为"我写成功了"，但数据库里没变化——这种 **silent data loss** 是生产事故的标准剧本。

团队一旦有第一个「我明明 save 了啊」的用户工单，排查成本是正式修一次的 5 倍：要查 log、查 SQLITE_BUSY、复现并发条件。不如现在一次性把并发模型收敛掉。

B4 同时是 B2 的防线——B2 的 phase/lease 重构把 tasks 写路径集中了，但其他表（runs / agents / approvals）的写路径如果还散装，多 writer 竞态就会在那里继续发作。

## 附：反模式对比

**Before**（当前）：
```ts
// src/main/orchestration/heartbeat.ts（示意）
db.prepare("UPDATE runs SET last_heartbeat_at = ? WHERE id = ?").run(now, runId);
// 这条语句在 worker 并发写 runs 表时会抢 SQLite writer lock，busy_timeout=5000 内没抢到就抛
```

**After**：
```ts
await writerActor.enqueue(() => {
  db.prepare("UPDATE runs SET last_heartbeat_at = ? WHERE id = ?").run(now, runId);
});
// 串行入队——永远不抢锁；latency = queue wait + 单次 SQL 时间
```

## 附：gating matrix

| Gate | 条件 | 放行判断人 |
|------|------|----------|
| G1 | B2 phase/lease 已上线，tasks 写路径已收敛 | Owner |
| G2 | Writer actor 跑 stress test：1000 concurrent enqueue，0 失败 | Linus |
| G3 | ESLint rule 运行后，grep `db.prepare.*\.run` 只出现在 writer-actor.ts 和 reader-pool.ts | Linus |
| G4 | 生产 telemetry `writer_queue_depth` p99 < 50 连续 7 天 | Karpathy |
| G5 | `SQLITE_BUSY` 出现次数降到 0 连续 14 天 | Owner |

## 附：backpressure 和降级策略

队列深度观察区间：

| 深度范围 | 行为 | telemetry |
|---------|------|----------|
| 0-10 | 正常 | 采样 1% 记录 |
| 11-50 | 正常但记录 | 100% 记录 queue_depth |
| 51-100 | 触发 warn | telemetry.alert_warn |
| 101-500 | 触发 degraded 模式——scheduler 降频 | telemetry.alert_error |
| >500 | 拒绝新入队（throw WriterBusyError） | telemetry.alert_critical |

降级模式下 scheduler 的 wake 频率从 1s 降到 5s，给 actor 喘息空间。恢复由 queue_depth < 30 自动触发。

## 附：为什么不选其他方案

**方案 A（当前 proposal）**：Single-writer actor in-process queue。优点：实现最简；缺点：所有写串行，p99 有队列 latency。

**方案 B（readonly connection pool + write connection pool 各自有锁）**：复杂度高；SQLite 多 writer 连接仍然只有一个真 writer，pool 意义不大。

**方案 C（每个 service 自己带 queue）**：控制分散；依然要协调多 queue 之间的依赖，复杂度翻倍。

**方案 D（换 Postgres）**：超出 scope；desktop 单机不需要外部 DB。

方案 A 成本最低收益最高。
