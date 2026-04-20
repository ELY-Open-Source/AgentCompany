# Proposal M9: browser / automation 拆出独立 utility process

> 来源：问题.md M9（行 272-276）、附录 I 第 3 条（行 589-590）
> 状态：proposed
> 提出：Roundtable 2026-04-20（Linus + Karpathy + Steve Jobs）
> Owner: TBD
> 估计工时：3 周
> Blocking dependencies：C2（RuntimeBus 就绪后，跨进程 dispatch 更容易）

## 问题陈述

`src/main/browser/` 和 `src/main/automation/` 两个子系统目前运行在主进程：
- `browser/` 跑 Electron 的 BrowserWindow / BrowserView，做网页自动化（填表单、点按钮、截图）
- `automation/` 跑 rule engine，触发 browser actions 或其他 side effects

后果：
1. **Crash blast radius 大**：browser page crash / 内存泄漏直接拖垮 main 进程，整个 desktop app 挂掉
2. **事件循环阻塞**：自动化脚本跑长时间同步操作（例如等待 CAPTCHA）时，main 进程 UI IPC 都受影响
3. **Cloudflare / CAPTCHA 等防爬虫对抗**：反爬逻辑跑在 main 进程意味着主程序有"机器人"指纹，可能被下游服务整体封禁
4. **资源占用不可见**：browser 内存和 CPU 混在 main 进程里，不便于监控 / 限额
5. **Attack surface**：自动化脚本触达外部网站，一旦被攻击（XSS / sandbox escape）直接污染 main 进程的数据库连接和文件系统权限

## 根因分析

Linus 视角：**crash blast radius 是进程边界的第一目的**。把 browser 跑在 main 进程 = 把不稳定的组件和稳定的组件绑一起了。Electron 提供 utility process 正是为此——crash 就让它 crash，主进程重启它即可。

当前架构把"永远不 crash 的组件（main）"和"经常 crash 的组件（browser automation）"放在同一个进程里——这是 colocation 反模式。

Karpathy 视角：agent 跑 browser automation 是典型的 stochastic task——成功率不是 100%。需要**独立的失败域 + 重试机制 + resource cap**。跑在 main 进程无法给 browser 设单独的 memory limit / CPU quota。

## 设计方案

### 架构

```
Main process
├── Orchestration / DB / IPC to renderer
│
├──[fork]──> Worker utility process (agent run loop)
│
├──[fork]──> Browser utility process (browser automation)
│               ├── Electron BrowserWindow / Puppeteer
│               ├── 独立内存 / CPU quota
│               └── 通过 bus dispatch "browserAction.dispatch" 消费
│
└──[fork]──> Automation utility process (rule engine)
                ├── Rule evaluation loop
                ├── Scheduled triggers
                └── 通过 bus dispatch 发送到 browser / agent
```

### 对 C2 bus 的依赖

本 proposal 依赖 C2 的 RuntimeBus——拆进程后跨进程 dispatch 最自然的实现是：
- Main 的 bus 是 hub
- utility process 和 main 之间通过 `process.parentPort.postMessage` 传递 command/event
- Bus 在 main 侧做 multiplexing：根据 command kind 路由到对应 utility process

这让 C2 的抽象同时覆盖 in-process 和 cross-process 两种 dispatch，**代码层面完全一致**。

### Browser utility process 实现

新建 `src/main/browser-process/entry.ts`：

```ts
import { parentPort } from "node:worker_threads";  // 或 utilityProcess API

const browser = new BrowserAutomationService(...);

parentPort.on("message", async (msg) => {
  if (msg.kind === "browserAction.dispatch") {
    try {
      const result = await browser.execute(msg.payload);
      parentPort.postMessage({ kind: "browserAction.result", runId: msg.runId, result });
    } catch (e) {
      parentPort.postMessage({ kind: "browserAction.error", runId: msg.runId, error: serializeError(e) });
    }
  }
});
```

### Automation utility process

rule engine 比 browser 轻量，但同样的道理——独立进程 = 独立故障域。新建 `src/main/automation-process/entry.ts`：

```ts
const engine = new AutomationRuleEngine(db);

engine.on("fire", (payload) => {
  parentPort.postMessage({ kind: "automation.fired", ...payload });
});

// tick loop
setInterval(() => engine.evaluate(), 1000);
```

### DB 访问

utility process **不直接访问 DB**——所有 DB 操作通过 bus 让 main 进程的 writer actor 处理（与 B4 的 single-writer actor 配合）。

这避免 SQLite 跨进程连接的复杂度（SQLite 支持跨进程但要处理 WAL 同步）。

### Resource cap

- Electron utility process 可设 `memoryLimit`（v27+）
- 配置 `maxOldSpaceSize` 控制 V8 heap
- Main 进程定期 ping utility process，超时自动 kill + restart

### Crash recovery

Browser utility process crash 时：
1. Main 收到 `process.exit` 事件
2. 发"browser 不可用"告警
3. 根据 restart policy 重启进程
4. 重启后已在运行的 browser action 状态从 DB 恢复

Automation utility process 同理。

## Migration 计划

1. **Phase 0（前置）**：C2 RuntimeBus 完成
2. **Phase 1（1 周）**：设计 cross-process bus 协议（message envelope / error serialization / backpressure）
3. **Phase 2（1 周）**：browser 拆进程——browser automation 代码搬到 `browser-process/`，main 侧改为通过 bus dispatch
4. **Phase 3（3 天）**：automation 拆进程——同样方式
5. **Phase 4（3 天）**：monitoring & restart policy—— main 侧加 utility process health check + telemetry
6. **Phase 5（1 周观察期）**：生产压力测试 / crash 注入测试，确认 blast radius 隔离

## 风险与回滚

| 风险 | 触发条件 | 回滚方法 |
|------|---------|---------|
| IPC latency 升高 | browserAction 从本地函数调用变成跨进程 | 每次 action 多 1-2ms 可忽略；如果某 action 需要高频通信则重新评估 |
| State 丢失 | utility process crash 时正在执行的 action 状态 | 所有 action 状态进 DB 持久化，crash 后恢复 |
| 开发体验差 | 调试需要 attach 多个进程 | VS Code 多 process debug configuration |
| macOS entitlements | utility process 需要特殊 entitlement 才能跑某些 Electron API | 研究 Apple 文档，提前在 entitlements.plist 加 |

**回滚路径**：拆进程过程保留旧 in-process 代码路径作为 feature flag（`BROWSER_USE_UTILITY_PROCESS=true/false`），回滚时切 flag。

## 验证标准

1. **Blast radius 验证**：故意在 browser utility process 内 `process.exit(1)`，main 进程应不受影响，UI 仍可用
2. **Memory isolation**：browser automation 跑长时间任务，main 进程 memory 稳定不增长
3. **Restart 自动化**：kill -9 browser process，main 检测到后自动重启，丢失 ≤1 个 in-flight action
4. **Latency baseline**：browserAction.dispatch 的 P99 latency 在可接受区间（< 50ms 额外开销）
5. **Crash rate telemetry**：生产观察一周，browser process crash 数据可见且独立于 main 进程崩溃

## 不在范围

- **不把 worker 也一起重构**：worker 已经是 utility process（见 worker-entry.ts），本 proposal 只补 browser / automation
- **不实现跨机器 dispatch**：bus 仍是单机进程间，不做分布式
- **不重构 rule engine 的规则 DSL**：只是搬进程
- **不做 browser farm**：单个 browser utility process 就够，不是并发 N 个实例
- **不改 renderer**：renderer 层对 browser / automation 的交互仍走 main → utility process 中转

## 参考文件清单

- `src/main/browser/`（当前 browser automation 代码）
- `src/main/automation/`（当前 automation rule engine 代码）
- `src/main/automation-service.ts`（当前 rule engine 入口）
- `src/main/browser/browser-action-service.ts`（action 执行）
- `src/main/browser/browser-action-executor.ts`（具体 action）
- `src/main/service-graph.ts:110-113`（browserActionRef / automationRef 的 LateBinding，C2 会改）
- Electron utilityProcess 文档：https://www.electronjs.org/docs/latest/api/utility-process

## 附：为什么现在修

单个 browser page 的崩溃已经是生产痛点——任何 agent 的网页操作触发 chromium crash 都拖垮用户整个 desktop app。随着 agent 被用于更多 web automation 场景（社交登录、paid subscription 填表、CAPTCHA 对抗），crash 频率只会升。

C2 做完后，跨进程 bus 成本极低——本 proposal 是把 C2 的 bus 抽象延伸到进程边界，很自然。

Jobs 视角：**"app 不能崩"是 desktop 软件的基础承诺**。当前架构把 desktop 稳定性和 agent browser 稳定性绑定了，这违反了承诺。

## 附：gating matrix

| Gate | 条件 | 放行判断人 |
|------|------|----------|
| G1 | C2 RuntimeBus 完成 + 跨进程 dispatch 协议定稿 | Linus |
| G2 | browser utility process 跑 long-running automation 1 小时无 main 进程回压 | Owner |
| G3 | Kill utility process 后 main 进程自动重启，in-flight action 损失 ≤ 1 | Owner |
| G4 | Browser process 内存隔离验证：独立 heap，不与 main 共享 | Linus |
| G5 | macOS entitlements 配置完整，通过 notarization | Owner |

## 附：跨进程 message envelope

```ts
interface CrossProcessMessage {
  id: string;                // correlation id
  kind: CommandKind | EventKind;
  payload: unknown;          // 由 kind 决定 shape
  source: "main" | "browser-process" | "automation-process" | "worker";
  timestamp: number;
  // Error case
  error?: { name: string; message: string; stack?: string };
}
```

序列化走 JSON（Electron utilityProcess 默认）；大 payload 用 MessagePort + structured clone。

## 附：跨进程 DB 访问禁令

Utility process 内禁止直接 `new DatabaseSync(...)` ——所有 DB 操作走 bus dispatch 到 main 的 writer actor（B4）。原因：
1. SQLite WAL 跨进程同步复杂
2. Main 的 writer actor 保持单 writer 不变式
3. Utility process crash 不会导致 DB 文件锁残留

## 附：反模式对比

**Before**：
- Main 进程 import browser automation service
- 浏览器 crash → main 进程 crash → desktop app 关闭
- 用户 log off，30+ 秒后重新登录才能恢复

**After**：
- Main 进程通过 bus dispatch 到 browser utility process
- 浏览器 crash → utility process 独立退出 → main 进程 2 秒内重启它
- 用户看到 "browser automation recovering"，UI 其他部分无感

## 附：为什么不选其他方案

**方案 A（当前 proposal）**：Electron utilityProcess 隔离。

**方案 B（完全拆出 desktop app 外，跑独立 daemon）**：过度工程——用户不希望后台跑多个进程。

**方案 C（保留 main 进程但加 try-catch）**：JS 层的 try-catch 无法 catch native crash（chromium renderer crash）。

方案 A 是 Electron 官方推荐的隔离路径。

## 附：restart policy 细节

| 情况 | 行为 |
|-----|------|
| Browser utility process 正常退出（exit 0） | 不重启（可能是主动 stop） |
| 异常退出（exit ≠ 0） | 立即重启，最多 3 次/分钟 |
| 超过 3 次/分钟 | 进入 backoff（冷却 5 分钟） |
| 冷却期间 browserAction.dispatch | 直接返回 `BROWSER_UNAVAILABLE` 错误 |
| 冷却结束 | 自动重启；成功则清 backoff 计数 |
| 连续 3 次 backoff 失败 | 告警 + 停止重启，等用户手动恢复 |

## 附：resource cap 配置

```ts
const browserProcess = utilityProcess.fork(entryPath, args, {
  serviceName: "agent-company-browser",
  stdio: "pipe",
  execArgv: ["--max-old-space-size=2048"],  // 2GB heap 上限
});
```

macOS 的 resource monitor 可以看到 `agent-company-browser` 的 CPU/memory 独立使用，用户也能直接感知 automation 占用。

## 附：与 C2 的跨进程扩展

C2 的 InProcessRuntimeBus 扩展为支持 cross-process：

```ts
class CrossProcessRuntimeBus implements RuntimeBus {
  constructor(private child: UtilityProcess, private local: InProcessRuntimeBus) {}

  async dispatch(kind, payload) {
    if (this.isLocalKind(kind)) {
      return this.local.dispatch(kind, payload);
    }
    return this.sendToChild(kind, payload);
  }
}
```

消费者代码不变——bus 抽象隐藏了进程边界。
