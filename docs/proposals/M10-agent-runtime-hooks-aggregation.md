# Proposal M10: agent-runtime 的 hook 聚合到 AgentHooks + 契约版本化

> 来源：问题.md M10（行 278-282）、问题.md C5（行 174-186）
> 状态：proposed（与 C5 契约测试互补）
> 提出：Roundtable 2026-04-20（Linus + Karpathy + Steve Jobs）
> Owner: TBD
> 估计工时：1.5 周
> Blocking dependencies：无，但与 C5（hook 契约测试）协同

## 问题陈述

`src/main/agent-runtime/` 当前散装 10 个文件：

| 文件 | 职责 |
|------|------|
| agent-event-projection.ts | run event 投影 |
| artifact-projector.ts | artifact 投影 |
| context-compactor.ts | context 压缩（B3 问题点） |
| cost-writer.ts | cost 记录写入 |
| hook-handlers.ts | hook 回调处理 |
| hook-rpc.ts | hook RPC 层 |
| inbox-projection.ts | inbox 投影 |
| runtime-bridge.ts | 主进程 ↔ pi 桥接 |
| runtime-message-injector.ts | 运行时消息注入 |
| sqlite-session-store.ts | pi session 持久化 |

其中 compactor / cost-writer / inbox-projection / artifact-projector 都是**注入到 pi agent 的 hook**，但分散在不同文件里，没有一个统一的 `AgentHooks` 聚合类。

额外痛点（对照 C5）：hook 的签名、调用时序、block-type 约定**深度耦合 pi 版本**——B1 指出的 62 patch 漂移场景下，哪些 hook 还安全完全靠作者记忆。

## 根因分析

Linus 视角：**散装的 hook 没有统一的契约面**。

当前问题：
1. **注册点分散**：`pi-agent-factory.ts` 里 `transformContext: compactor`、`preTurn: inboxProjection`、`postTurn: costWriter` ——每个 hook 各自 import，没有统一枚举
2. **调用顺序隐式**：哪个 hook 先跑、哪个后跑依赖 pi 内部约定，我们没有声明
3. **失败处理不一致**：一个 hook 抛错，其他 hook 是否还跑？—— 当前行为依赖 pi 语义
4. **版本签名无契约**：pi 升级如果改了 hook 参数 shape，本地代码 compile-time 可能通过但 runtime 失败

Karpathy 视角（对应 C5）：**agent loop 的控制权在上游**，本地只能通过 hook 介入。hook 是**本项目和 pi 的唯一契约面**——这个契约面没治理就是随机炸。

## 设计方案

### AgentHooks 聚合类

新建 `src/main/agent-runtime/agent-hooks.ts`：

```ts
import type { PiAgentHooks } from "@mariozechner/pi-agent-core";

export interface AgentHooksConfig {
  compactor: ContextCompactor;
  costWriter: CostWriter;
  inboxProjection: InboxProjection;
  artifactProjector: ArtifactProjector;
  eventProjection: AgentEventProjection;
  logger: Logger;
}

export class AgentHooks {
  constructor(private config: AgentHooksConfig) {}

  toPiHooks(): PiAgentHooks {
    return {
      transformContext: async (messages, ctx) => {
        try {
          return await this.config.compactor.maybeCompact(messages, ctx);
        } catch (e) {
          return this.handleHookError("transformContext", e, { passthrough: messages });
        }
      },
      preTurn: async (ctx) => {
        await this.config.inboxProjection.inject(ctx);
      },
      postTurn: async (ctx) => {
        await Promise.all([
          this.config.costWriter.write(ctx),
          this.config.artifactProjector.project(ctx),
          this.config.eventProjection.record(ctx),
        ]);
      },
      onError: async (err, ctx) => {
        this.config.logger.error("agent.hook.error", { err, ctx });
      },
    };
  }

  private handleHookError<T>(hookName: string, err: unknown, opts: { passthrough: T }): T {
    this.config.logger.error("agent.hook.error", { hookName, err });
    // Fail-safe policy: hook 内部错误不 crash agent loop，但记录 telemetry
    return opts.passthrough;
  }
}
```

### 契约版本标识

```ts
export const AGENT_HOOKS_PI_COMPAT = "0.67.x";

// 启动时校验
import { version as piAgentVersion } from "@mariozechner/pi-agent-core/package.json";
if (!satisfies(piAgentVersion, AGENT_HOOKS_PI_COMPAT)) {
  throw new Error(`Agent hooks not compatible with pi-agent-core ${piAgentVersion}`);
}
```

升级 pi 前必须更新 `AGENT_HOOKS_PI_COMPAT`，强制开发者确认 hook 签名兼容性。

### Fixture 驱动的契约测试（配合 C5）

```
src/main/agent-runtime/__fixtures__/
├── transform-context/
│   ├── input-30-messages.json
│   └── expected-output.json
├── pre-turn/
│   └── inbox-injection.json
└── post-turn/
    └── cost-write.json
```

契约测试：每个 fixture 的 hook 输入/输出 shape 必须稳定。升级 pi 必须跑这套测试——如果 shape 变了，测试 fail，必须显式处理 migration。

### hook-handlers.ts / hook-rpc.ts 归类

这两个文件是 pi runtime 和 main 进程之间的 RPC（hook 执行位置 ≠ 进程位置）。本 proposal 不合并它们到 `agent-hooks.ts`，保留独立文件，但 agent-hooks 成为**入口**——外部代码只 import `AgentHooks`，内部如何走 RPC 是实现细节。

## Migration 计划

1. **Phase 1（2 天）**：实现 `AgentHooks` 类，内部调用保留原有 4 个 hook 模块
2. **Phase 2（2 天）**：pi-agent-factory.ts 从散装 import 切到 `new AgentHooks(...).toPiHooks()`
3. **Phase 3（3 天）**：加版本兼容标识 + 启动校验
4. **Phase 4（1 周）**：补 fixture 和契约测试
5. **Phase 5（持续）**：下次 pi 升级走完整 flow——跑 fixture 测试 + review `AGENT_HOOKS_PI_COMPAT`

## 风险与回滚

| 风险 | 触发条件 | 回滚方法 |
|------|---------|---------|
| Hook 执行顺序变化 | 聚合后若 pi 顺序改变 | 聚合类维持和原来一致的执行顺序，加注释 |
| Fixture 维护成本 | 每次 pi 改 hook shape 都要更新 fixture | 接受——这正是契约测试的目的 |
| 兼容范围过严 | `^0.67.0` vs `0.67.68` | 升级时 explicit 更新 compat 字符串 |
| Hook 吞 error | `handleHookError` 掩盖真实 bug | 强制 telemetry 记录；同时让 critical 场景（例如 cost 写入失败）走 throw 而不是 passthrough |

## 验证标准

1. **Typecheck 通过**：hook 签名与 pi 类型严格一致
2. **启动校验**：pi 版本不 satisfies 时应用启动 fail fast
3. **契约测试覆盖**：4 个主要 hook 都有 fixture + 验证
4. **Telemetry 可观测**：hook 错误被记录到 telemetry，不是静默吞
5. **Refactor 零行为变化**：相同 agent run，新旧方案产出的 event stream / cost record 一致

## 不在范围

- **不重写 compactor 内部逻辑**（B3 / C3 是独立 proposal）
- **不改 pi 上游**：只能在 hook 层适配
- **不做 hook 的 hot-reload**：启动一次加载即可
- **不实现自动 pi 升级**：升级仍是人工决策 + 跑 fixture
- **不合并 hook-handlers 和 hook-rpc**：它们是不同抽象层（业务 vs 协议）

## 参考文件清单

- `src/main/agent-runtime/context-compactor.ts:52-73`（B3 问题代码）
- `src/main/agent-runtime/cost-writer.ts`
- `src/main/agent-runtime/inbox-projection.ts`
- `src/main/agent-runtime/artifact-projector.ts`
- `src/main/agent-runtime/agent-event-projection.ts`
- `src/main/agent-runtime/hook-handlers.ts`
- `src/main/agent-runtime/hook-rpc.ts`
- `src/main/agent-runtime/runtime-bridge.ts`
- `src/main/agent-runtime/runtime-message-injector.ts`
- `src/main/agent-runtime/sqlite-session-store.ts`
- `src/main/worker/pi-agent-factory.ts:131`（hook 注册点）
- `pi-mono-reference/packages/agent/`（上游 hook 接口定义）

## 附：为什么现在修

pi 升级（B1 已完成的 0.67.68 pin）之前团队每次升级 pi 都是赌博——hook 是否还兼容没人能验证。M10 + C5 的契约测试是把"我猜还能跑"变成"测试证明能跑"的唯一办法。

M10 单独的收益：代码可读性——新工程师打开 `pi-agent-factory.ts` 不用猜哪几个 hook 在做什么，看 `AgentHooks` 的 `toPiHooks()` 一目了然。

注意与 B3（compactor tool_use 切腰斩）的关系：B3 是 compactor 内部的正确性问题，M10 是 hook 接入层的组织问题。两个正交，B3 先做（BLOCKER），M10 后做。

## 附：gating matrix

| Gate | 条件 | 放行判断人 |
|------|------|----------|
| G1 | `AgentHooks` 类与现有 pi 版本 0.67.68 契约对齐 | Linus |
| G2 | 4 个主要 hook 每个有 fixture 和契约测试 | Karpathy |
| G3 | 启动时校验 pi 版本在兼容范围，不在则 fail fast | Owner |
| G4 | Telemetry 可观察 hook 错误率，7 天无新 silent drop | Owner |
| G5 | 下次 pi 升级走完整 flow 验证 | Owner |

## 附：与 C5 的关系

C5（hook 契约测试）是 M10 的验证手段——M10 做好聚合后，C5 提供契约测试 harness。两件事 logically 可以并行做，但实现上 M10 先于 C5 更自然（先有聚合类再给它加测试）。

## 附：反模式对比

**Before**（`src/main/worker/pi-agent-factory.ts:131` 附近）：
```ts
const agent = createPiAgent({
  transformContext: contextCompactor.maybeCompact.bind(contextCompactor),
  preTurn: inboxProjection.inject.bind(inboxProjection),
  postTurn: async (ctx) => {
    await costWriter.write(ctx);
    await artifactProjector.project(ctx);
  },
  // ...每次加 hook 都要改 factory
});
```

**After**：
```ts
const hooks = new AgentHooks({ compactor, costWriter, inboxProjection, artifactProjector, ... });
const agent = createPiAgent(hooks.toPiHooks());
// 加新 hook 只改 AgentHooks.toPiHooks()，factory 不动
```

## 附：为什么不选其他方案

**方案 A（当前 proposal）**：AgentHooks 聚合类 + 版本兼容标识。

**方案 B（完全重写 agent loop，不用 pi）**：成本远大于收益——pi 已经处理了 token 流、provider 切换、retry 等。

**方案 C（把 hook 留在独立文件，但加统一的 factory helper）**：没解决"hook 入口分散"问题，签名仍各自 drift。

方案 A 成本低、收益清晰。

## 附：fixture 目录结构示例

```
src/main/agent-runtime/__fixtures__/
├── README.md
├── transform-context/
│   ├── 30-messages-with-tool-pairs.json
│   ├── 30-messages-no-tool-calls.json
│   ├── cjk-heavy-content.json
│   └── empty-input.json
├── pre-turn/
│   ├── inbox-with-unread-messages.json
│   └── inbox-empty.json
├── post-turn/
│   ├── successful-tool-call.json
│   ├── assistant-text-only.json
│   └── error-turn.json
└── version-matrix/
    └── compat-0.67.68.json
```

每个 fixture 包含 input + expected output + 注释说明。升级 pi 时跑 `pnpm test:hook-contracts` 一键验证。

## 附：hook error handling 策略矩阵

| Hook | 错误策略 | 理由 |
|------|---------|------|
| transformContext (compactor) | passthrough（返回原 messages） | compactor 挂不应该阻塞 agent 前进 |
| preTurn (inbox projection) | throw（让 agent loop 挂） | inbox 注入失败意味着 agent 读不到新消息，前进下去会 base 错误 |
| postTurn (cost writer) | throw | cost 写入失败是数据完整性问题，必须 crash |
| postTurn (artifact projector) | passthrough + telemetry | artifact 缺失不阻塞后续 |
| postTurn (event projection) | throw | event 丢失无法事后补，必须 crash |
| onError | 记 log | terminal hook，不能 rethrow |
