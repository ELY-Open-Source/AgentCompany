# Proposal C4: initial-user-turn 退回语义 cue + hire 升级为显式 tool

> 来源：问题.md C4（行 158-172）、附录 F 样本 4（行 479-491）
> 状态：proposed（待 B5 eval harness 就绪后实施）
> 提出：Roundtable 2026-04-20（Linus + Karpathy + Steve Jobs）
> Owner: TBD
> 估计工时：2 周（其中 1 周做 hire_agent tool，1 周改 prompt + eval 验证）
> Blocking dependencies：**B5（LLM 行为 eval harness）必须先就绪**，否则改 prompt 无法验证行为回归
>
> 圆桌投票记录：Linus 不改，Karpathy 不改，Jobs 改（2-1 决定今晚不动代码，写 proposal 等 eval）

## 问题陈述

`src/main/orchestration/initial-user-turn.ts:62-83` 的 CEO 初始 user turn 把 tool 选择、实现细节、API 路径、业务数字、语气**全写死**：

```ts
return [
  "You are the CEO of this company. Your team is empty (zero active direct reports).",
  "This wake has ONE job: call the `bash` tool to execute `node -e '...'` fetch POSTs that file 3–5 hire_agent requests against /api/companies/{companyId}/agents, then one approve_ceo_strategy POST against /api/companies/{companyId}/approvals.",
  "The exact body shape and connectorId rules are in your Team Building Phase operating instructions above. Use a connectorId and model from the Available Connectors section (only ready connectors).",
  "Start the first POST NOW. Do not write a plan document. Do not describe what you will do — execute the tool call.",
].join("\n\n");
```

五个耦合：
1. **Tool 名**：`bash`
2. **实现细节**：`node -e '...'` + `fetch` POST
3. **API 路径**：`/api/companies/{companyId}/agents`、`/api/companies/{companyId}/approvals`
4. **业务数字**：3-5 个 hire + 1 个 approve_ceo_strategy
5. **语气**：NOW / Do not

这段 prompt 没有任何机制让它和 `src/main/prompt-builder/ceo-modes/team-building.en.md` 保持一致——两处都在告诉 CEO "现在该做什么"，容易 drift。

## 根因分析

Karpathy 视角（prompt 工程原则）：**把实现细节泄漏到 LLM 层是最脆的设计**。

当前 prompt 假设：
- `bash` tool 永远存在（pi-agent-core 未来可能改名或增加 sandbox 模式）
- `node -e` 执行环境永远可用（container 化后可能没 node）
- `/api/companies/...` 路径永远稳定（REST → GraphQL 迁移时全部失效）
- CEO "理解" fetch POST 的 body shape（依赖 prompt 里其他部分说清楚）

每个假设破一次，CEO 就静默做错事。更糟的是——**CEO 一旦学会这个 pattern，其他 agent 会照抄**：所有业务逻辑都 `bash + node -e + fetch`，项目滑向 "everything is bash" 的反模式。

Linus 视角（第一性原理）：hire 这件事**本来就应该是一个 tool**。当前让 CEO 通过 HTTP POST 自己的 API server 来 hire——这意味着：
1. main 进程要跑 HTTP server（`api-server.ts`）
2. CEO 要拼 body / 处理 auth / 处理 error
3. 出错只能通过 HTTP status code 感知

直接把 `hire_agent` 做成 pi tool，CEO 调用 tool → main 进程直接 DB 写 → 返回 ack。省掉整个 HTTP 层。

Jobs 视角（为什么他投改）：这段 prompt 就是 Jobs 厌恶的"让工程问题泄漏给用户"——CEO 是用户视角的 agent，不该知道 HTTP endpoint。

**为什么今晚不改**（2-1 决定）：Linus + Karpathy 认为无 eval 下改 prompt = 盲飞。CEO 的实际行为不能凭"prompt 读起来更干净"来验证，必须有 golden trace 对比。今晚没有 eval 框架（B5 blocked by user constraint "无 tests/fixture"）就硬改，可能让 CEO 完全不 hire 而团队当场发现不了。

## 设计方案

分两步：

### Step 1：把 `hire_agent` 升级为显式 pi tool

新建 `src/main/agent-runtime/tools/hire-agent.ts`：

```ts
export const hireAgentTool: AgentTool = {
  name: "hire_agent",
  description: "Create a new direct report agent for this company. Use this when the CEO needs to fill a role.",
  input: {
    type: "object",
    required: ["name", "role", "description", "connectorId", "model"],
    properties: {
      name: { type: "string", description: "Short display name for the agent, e.g. 'CTO'" },
      role: { type: "string", description: "Business role, e.g. 'Chief Technology Officer'" },
      description: { type: "string", description: "1-2 sentences describing responsibilities" },
      connectorId: { type: "string", description: "Must be a ready connectorId from the Available Connectors list" },
      model: { type: "string", description: "Must be allowed by the connector's enabledModels" }
    }
  },
  handler: async (input, ctx) => {
    // 校验 connectorId / model
    // 直接调 db.agents.saveAgent(...)
    // 返回 agentId
  }
};
```

同时引入 `file_approval` tool，替代 `/api/companies/{companyId}/approvals` POST。

### Step 2：把 initial-user-turn 降级为语义 cue

After：

```ts
return [
  "You are the CEO. Your team is currently empty.",
  "Review your Team Building Phase operating instructions in the system prompt, then take action.",
].join("\n\n");
```

**没有** `bash`、没有 `node -e`、没有 API 路径、没有数字、没有"NOW"。系统 prompt 里的 `ceo-modes/team-building.en.md` 自己说做什么、做多少。

### SOP 层更新

`src/main/prompt-builder/ceo-modes/team-building.en.md` 需要明确：
- 描述任务（组建初始团队）
- 描述可用 tool（`hire_agent`、`file_approval`）
- 描述合理数量（3-5 个角色）
- 不描述具体实现（bash / fetch / HTTP）

这样 CEO 行为 = system prompt 决定，initial-user-turn 只是**触发信号**。

## Migration 计划

1. **Phase 0（前置）**：B5 eval harness 就绪——能 record 当前 CEO 在 team-building trigger 下的 tool call 序列（作为 baseline）
2. **Phase 1（1 周）**：实现 `hire_agent` / `file_approval` tool，注册到 pi-agent-factory。
   - CEO 在某些场景开始用新 tool，但保留旧 HTTP API（dual-path）
3. **Phase 2（3 天）**：跑 eval 对比——CEO 在新 tool 可用时的行为 vs baseline
   - 必须验证：新 tool 可用时 CEO 优先用 tool，且产出的 hire 记录 schema 与 HTTP 路径一致
4. **Phase 3（3 天）**：修改 `initial-user-turn.ts` 和 `ceo-modes/team-building.en.md`，删除实现细节
5. **Phase 4（1 周）**：eval 验证行为没有回退，下掉 HTTP `/api/companies/{id}/agents` POST 路径（保留 GET / DELETE 用于 UI）

## 风险与回滚

| 风险 | 触发条件 | 回滚方法 |
|------|---------|---------|
| CEO 不 hire（改 prompt 后） | 语义 cue 太弱 | eval 直接发现，revert prompt |
| CEO hire 错角色 | 新 tool 接收参数导致发散 | tool schema validation 层拒绝 |
| 旧 call site 依赖 HTTP | UI 或脚本直接调 `/api/companies/{id}/agents` | 保留 HTTP 路径直到 UI 迁移完 |
| eval fixture 未覆盖边缘 | 某些 trigger（例如"空公司 + 单 connector"）没 baseline | phase 2 要求覆盖 10+ 初始状态组合 |

**回滚路径**：每个 phase 可独立 revert。tool 可先加不强推；prompt 改动可直接回到硬编码版本。

## 验证标准

**前置：B5 必须就绪**。具体验证：

1. **行为 eval**：在 10+ 种初始 company 状态下，CEO 产出的 hire 数量 / 角色 / 参数，新方案应与旧方案一致（允许 ±1 个 hire 的方差）
2. **Tool 覆盖**：新 `hire_agent` tool 被 CEO 调用的比例 ≥95%（剩余 <5% 走兼容 HTTP 路径）
3. **Prompt 长度**：initial user turn 从 ~400 token 降到 ~80 token
4. **Regression test**：旧 `curl -X POST /api/companies/{id}/agents` 仍能工作（兼容期）
5. **Cache friendliness**：initial user turn 变短后，system prompt 的 cache hit 率提升

## 不在范围

- **不改 system prompt 整体结构**：262 行的系统 prompt 走 C7 proposal 独立重构
- **不改 CEO 模式 state machine**：5 个 ceo-modes 文件结构保留，走 M7 proposal
- **不做 prompt A/B harness**：那是 C7 的事
- **不动 renderer**：hire 在 UI 层的表现不变（创建新 agent 卡片）
- **不改 approval 审批流**：`file_approval` tool 只是路径替换，approval 逻辑本身不动

## 参考文件清单

- `src/main/orchestration/initial-user-turn.ts:62-83`（硬编码段落）
- `src/main/orchestration/initial-user-turn.ts:78-82`（CEO lookup fail-open catch，关联 C6）
- `src/main/prompt-builder/ceo-modes/team-building.en.md`（对应的 operating instructions）
- `src/main/api-server.ts` + `src/main/api-endpoints.ts`（当前承载 hire POST 的 HTTP 层）
- `src/main/worker/pi-agent-factory.ts:131`（tool 注册点）
- `src/main/database/agents.ts`（CEO hire 最终写入的 DB 层）

## 附：为什么这件事不能省略也不能现在 rush

**不能省略**：每次 pi-agent-core 升级（B1 问题指出 62 patch 漂移），`bash` tool 的 schema / 沙盒行为可能悄悄变。prompt 硬编码 `bash + node -e + fetch` 时，升级 pi 就是一场赌博。

**不能现在 rush**（Linus + Karpathy 今晚投反对）：prompt 行为是 agent 公司最敏感的地方，无 eval 改 = 赌 CEO 还按原样 hire。圆桌共识：**等 B5，然后一次性做完**。

Karpathy 原则："没有 eval 的 prompt 改动是对随机函数做微调"——我们今晚同意把它写进 proposal 而不动代码。

## 附：gating matrix

| Gate | 条件 | 放行判断人 |
|------|------|----------|
| G1 | B5 eval harness 就绪 + baseline recorded | Karpathy |
| G2 | `hire_agent` tool 实现 + schema 固化 | Owner |
| G3 | Tool 可用期间 eval 通过：CEO 在 10+ 种初始状态下用 tool 而非 HTTP POST | Karpathy |
| G4 | Prompt 精简后 eval：hire 数量 / 角色 / 参数与 baseline 一致 | Karpathy |
| G5 | 旧 HTTP 路径灰度下线 2 周无回退 | Owner |

## 附：新 hire_agent tool 的 schema 草案

```json
{
  "name": "hire_agent",
  "description": "Create a new direct report agent for this company. Use when a role needs filling.",
  "input_schema": {
    "type": "object",
    "required": ["name", "role", "description", "connectorId", "model"],
    "properties": {
      "name": {
        "type": "string",
        "description": "Short display name, e.g. 'CTO', 'Head of Marketing'",
        "maxLength": 50
      },
      "role": {
        "type": "string",
        "description": "Business role title",
        "maxLength": 100
      },
      "description": {
        "type": "string",
        "description": "1-2 sentences describing responsibilities and how this person contributes",
        "maxLength": 500
      },
      "connectorId": {
        "type": "string",
        "description": "Connector ID from the Available Connectors section; must be ready"
      },
      "model": {
        "type": "string",
        "description": "Model name allowed by connector.enabledModels"
      },
      "department": {
        "type": "string",
        "enum": ["engineering", "product", "design", "marketing", "sales", "operations", "legal", "finance"]
      }
    }
  }
}
```

Tool handler（main 进程内）：
1. 校验 connectorId / model 组合合法性
2. 生成 agentId
3. 调 `db.agents.saveAgent(...)` 写入
4. 发 telemetry `agent.hired`
5. 返回 `{ agentId, name, role }`

## 附：反模式对比

**Before**（`src/main/orchestration/initial-user-turn.ts:62-83`）：五层耦合混在 prompt 字符串里——agent 必须"解析"提示词才知道要做什么。

**After**：agent 读到"your team is empty → 看 system prompt 的 team-building 段 → 用 hire_agent tool"这条清晰链路。每一步都是 agent 正常 reasoning 能处理的粒度。

## 附：与 M7 的协同

M7（CEO mode state machine）和 C4 共享 `resolveCeoMode` 函数——同一个函数决定：
- initial-user-turn 发什么 cue（C4）
- prompt-builder 加载哪个 ceo-modes markdown（M7）

两件事一次做完，避免 mode 判断在两处漂移。

## 附：为什么不选其他方案

**方案 A（当前 proposal）**：退回语义 cue + 显式 tool。

**方案 B（继续硬编码但写成 typed template）**：把字符串换成 template literal + 参数注入。治标不治本——实现细节仍泄漏，只是语法糖。

**方案 C（删掉 initial-user-turn，全靠 system prompt）**：失去"trigger 特定 cue"的能力——当用户 explicit 点击 "start team building" 时没有强信号区分于普通 wake。

方案 A 平衡了清晰度和表达力。
