# Proposal M2: 104 IPC handler 契约化（集中 channel 定义 + 类型化 invoke）

> 来源：问题.md M2（行 227-234）、附录 D（行 403-408）
> 状态：proposed
> 提出：Roundtable 2026-04-20（Linus + Karpathy + Steve Jobs）
> Owner: TBD
> 估计工时：2 周
> Blocking dependencies：无（独立于其他 proposal）

## 问题陈述

主进程注册的 IPC handler 总数 **104**（`grep -c "ipcMain\.handle\|registerHandle("` 全 main 目录），分散在 22 个文件：

- `ipc-agent-coordination-handlers.ts`
- `ipc-automation-operations-handlers.ts`
- `ipc-browser-handlers.ts`
- `ipc-budget-handlers.ts`
- `ipc-content-operations-handlers.ts`
- `ipc-core-admin-handlers.ts`
- `ipc-core-agent-graph-handlers.ts`
- `ipc-core-common.ts`
- `ipc-core-handlers.ts`
- `ipc-core-operations-handlers.ts`
- `ipc-core-read-handlers.ts`
- `ipc-core-task-graph-handlers.ts`
- `ipc-core-work-graph-handlers.ts`
- `ipc-credentials-handlers.ts`
- `ipc-domain-common.ts`
- `ipc-domain-handlers.ts`
- `ipc-oauth-handlers.ts`
- `ipc-onboarding-handlers.ts`
- `ipc-recovery-handlers.ts`
- `ipc-skill-handlers.ts`
- `ipc-support.ts`
- `ipc-thread-handlers.ts`

所有 channel 名都是**字符串字面量**：`ipcMain.handle("agents/list", ...)`、`ipcRenderer.invoke("agents/list", ...)`。preload 和 main 之间无 schema 约束，renderer 里任何拼写错误都是 runtime 静默失败。

## 根因分析

Linus 视角：**无类型约束的大面积 RPC surface 是可观测性黑洞**。

当前问题：
1. **字符串拼写错误**：renderer 写 `"agents/lsit"`（typo），preload invoke 不报错，main 没有 handler → Promise 永不 resolve 或超时
2. **参数 shape 漂移**：main 改了 handler 接收的参数结构，renderer 还按旧 shape 发——JSON 反序列化成功但字段丢失，产出异常由业务层感知
3. **返回值类型假设**：renderer 期望 `{ ok: true, data: ... }`，main 返回 `data` 裸值或 `null`——typeof 判断错了又是静默 bug
4. **静态 grep 困难**：改 channel 名要 grep 字符串，漏一处就断一个功能
5. **新 channel 命名漂移**：`core-admin` / `core-agent-graph` / `core-common` 这种前缀暴露"core 是啥都不清楚"的命名漂移——审查时得打开文件才知道属于哪个域

Karpathy 视角补充：AI coding agent 写 renderer 代码时，没有 IDE 自动补全 channel 名，每次都 grep 猜一次——写错概率很高。即使写对了 channel，payload shape 也是 tribal knowledge。

## 设计方案

### 核心：单一 contract 源

新建 `src/shared/ipc-contracts.ts`（renderer 和 main 都能 import）：

```ts
// 所有 channel 集中定义
export const IpcChannels = {
  "agents/list": {
    input: z.object({ companyId: z.string() }),
    output: z.object({ agents: z.array(AgentRecordSchema) }),
  },
  "tasks/save": {
    input: TaskRecordSchema,
    output: z.object({ taskId: z.string() }),
  },
  "approvals/resubmit": {
    input: z.object({ approvalId: z.string() }),
    output: z.object({ ok: z.literal(true) }),
  },
  // ... 104 条
} as const;

export type IpcChannelName = keyof typeof IpcChannels;
export type IpcInput<K extends IpcChannelName> = z.infer<typeof IpcChannels[K]["input"]>;
export type IpcOutput<K extends IpcChannelName> = z.infer<typeof IpcChannels[K]["output"]>;
```

### main 侧：强制契约注册

```ts
// src/main/ipc-core-common.ts（改造）
export function registerIpcHandler<K extends IpcChannelName>(
  channel: K,
  handler: (input: IpcInput<K>) => Promise<IpcOutput<K>> | IpcOutput<K>
): void {
  const contract = IpcChannels[channel];
  ipcMain.handle(channel, async (_evt, rawInput) => {
    const input = contract.input.parse(rawInput);  // validation
    const output = await handler(input);
    return contract.output.parse(output);  // validation
  });
}
```

`registerIpcHandler` 不接受 raw string——channel 名必须是 `IpcChannels` 的 key。TypeScript 会在编译期拒绝 typo。

### preload 侧：强制类型化 invoke

```ts
// src/preload/index.ts（改造）
async function invokeIpc<K extends IpcChannelName>(
  channel: K,
  input: IpcInput<K>
): Promise<IpcOutput<K>> {
  return await ipcRenderer.invoke(channel, input);
}

contextBridge.exposeInMainWorld("api", {
  invoke: invokeIpc,
});
```

### renderer 侧使用

```ts
// Before
const result: any = await window.api.invoke("agents/list", { companyId });

// After
const result = await window.api.invoke("agents/list", { companyId });
// result 被推导为 { agents: AgentRecord[] }
```

IDE 自动补全 channel 名；input 写错类型直接红线；output 不需要断言。

### 命名规范化

现有 channel 名混乱（`core-admin` / `core-agent-graph` / `agents/list` / `tasks.save` 等），一次性规整：

- Format: `<domain>/<verb>`（小写 / slash 分割）
- Domain 列表固定：`agents / tasks / runs / approvals / messages / documents / skills / automations / browser / credentials / oauth / onboarding / recovery / threads / companies / connectors / budgets`
- 不再有 `core-*` 前缀——哪个域就叫哪个域

迁移时保持旧 channel 名作为 alias 几个版本，telemetry 观察老名字消失再删。

## Migration 计划

1. **Phase 1（3 天）**：建 `src/shared/ipc-contracts.ts`，先把 10-20 个最核心的 handler 迁移
2. **Phase 2（1 周）**：剩余 80+ handler 分批迁移，每批一个 PR（按 handler 文件分）
3. **Phase 3（2 天）**：命名规范化——renderer 代码统一改新 channel 名
4. **Phase 4（2 天）**：main 侧老 channel 名走 alias 层，telemetry 观察
5. **Phase 5（2 周后）**：删掉 alias，彻底移除旧名

## 风险与回滚

| 风险 | 触发条件 | 回滚方法 |
|------|---------|---------|
| zod 开销 | 每次 IPC 都跑 parse | 大 payload 场景 benchmark；必要时用更轻的 validator 或 conditional parse |
| renderer 类型推导失败 | 某个 schema 递归 / 复杂 | 拆 schema 或用 type assertion 临时绕过 |
| 契约漂移 | 有人改 schema 没改 call site | typecheck 会直接报 —— 这是目标 |
| 遗漏的 channel | grep 漏了某个 registerHandle | Phase 1-2 分批时每批跑完 grep，剩余 channel 列表归零 |

## 验证标准

1. **Typecheck**：全项目 `pnpm typecheck` 通过
2. **Grep 归零**：`grep -rn 'ipcMain\.handle\s*(\s*"' src/main/` 应归零（全部走 `registerIpcHandler`）
3. **Renderer 零 any**：renderer 层 IPC 调用处无 `as any` / `// @ts-ignore`
4. **Runtime validation**：故意给 handler 发错 payload，应被 zod parse 拒绝（不是进入业务逻辑再 crash）
5. **Telemetry**：迁移期间监控 unknown-channel 事件，迁完应归零

## 不在范围

- **不改 IPC 传输机制**：仍用 Electron 原生 `ipcMain.handle` / `ipcRenderer.invoke`
- **不做跨进程 pub-sub**：channel 还是 request-response；事件推送走独立 `webContents.send` 通道
- **不做 versioning**：本次一次性切换，不做 v1/v2 并存（成本 > 收益）
- **不引入 gRPC / protobuf**：zod schema + TypeScript 足够
- **不做权限控制**：所有 channel 对 renderer 开放，权限层面走独立 proposal

## 参考文件清单

- `src/main/ipc-*.ts`（22 个 handler 文件）
- `src/preload/index.ts`（contextBridge expose）
- `src/renderer/**/*.ts`（消费者，数百处 invoke 调用）
- `src/shared/types.ts`（已有部分 schema，可复用）

## 附：为什么现在修

**AI coding agent 最大的错误来源之一**就是 IPC 调用——字符串 channel + any payload，一旦没查到正确的字符串就瞎猜，猜错就是静默失败，反复几次才能找对。把契约集中化以后，AI 写代码时 IDE 直接告诉它 channel 名和 payload shape，一次对。

另一个触发因素：M12（renderer state audit）要做前提必须先有 M2。当前 renderer 的状态一致性问题一部分就来自 IPC 契约不明——消息传错、payload 错、renderer 把错数据当对数据渲染。先修 M2 再做 M12。

## 附：gating matrix

| Gate | 条件 | 放行判断人 |
|------|------|----------|
| G1 | `src/shared/ipc-contracts.ts` 覆盖 104 个 channel | Linus |
| G2 | 所有 main 侧 handler 通过 `registerIpcHandler` 注册 | Linus |
| G3 | Preload `invokeIpc` 类型化后，renderer 层 `as any` 归零 | Linus |
| G4 | 命名规范化后 alias 保留 2 周观察，无旧名残留 | Owner |
| G5 | Runtime zod parse 错误率监控 7 天 | Karpathy |

## 附：channel 命名规范化 before/after 示例

| Before | After |
|--------|-------|
| "core-admin:list-profiles" | "profiles/list" |
| "core-agent-graph:save" | "agents/save" |
| "core-task-graph:delete" | "tasks/delete" |
| "core-work-graph:list-runs" | "runs/list" |
| "domain:approvals/resubmit" | "approvals/resubmit" |
| "oauth:start" | "oauth/start" |
| "browser:take-action" | "browser/action" |

"core-*" 前缀彻底消失——哪个 domain 就叫哪个 domain。

## 附：为什么不选其他方案

**方案 A（当前 proposal）**：集中 contract + zod runtime validation + codemod 迁移。

**方案 B（仅加 TypeScript 类型不做 runtime validation）**：main / renderer 进程间 payload 反序列化后类型已失效——runtime 仍可能错 shape。zod 必须。

**方案 C（gRPC / protobuf）**：Electron IPC 不需要这种重量级框架；zod 足够。

**方案 D（只规范命名不做契约化）**：核心问题是缺契约，改名只是治标。

方案 A 一次性解决类型、命名、runtime validation 三件事。

## 附：zod vs 其他 validator

| 选项 | 优点 | 缺点 |
|------|------|------|
| zod | 类型推导原生 + 广泛使用 | runtime 开销 ~5μs/parse |
| io-ts | fp-ts 生态 | 学习曲线 |
| yup | 成熟 | TS 推导不如 zod |
| typebox | 速度最快 + JSON Schema | API 偏底层 |

选 zod：项目已有 `zod@4.3.6` 依赖，无需新增；推导质量好。

## 附：Event push 通道（非 invoke）

Electron 还有 `webContents.send` → `ipcRenderer.on` 的单向事件推送。本 proposal 同样契约化：

```ts
export const IpcEvents = {
  "runs/updated": z.object({ runId: z.string(), status: RunStatusEnum }),
  "approvals/updated": z.object({ approvalId: z.string() }),
  "tasks/updated": z.object({ taskId: z.string() }),
  // ...
};

// main 侧
emitEvent<K extends IpcEventName>(channel: K, payload: IpcEventPayload<K>) {
  const validated = IpcEvents[channel].parse(payload);
  webContents.send(channel, validated);
}

// renderer 侧
subscribeEvent<K extends IpcEventName>(channel: K, handler: (payload: IpcEventPayload<K>) => void): () => void {
  const wrapped = (_evt, raw) => handler(IpcEvents[channel].parse(raw));
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.off(channel, wrapped);
}
```

Event 和 invoke 走同一套契约风格，减少认知负担。
