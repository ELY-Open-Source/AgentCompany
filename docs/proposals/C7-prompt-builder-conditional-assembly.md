# Proposal C7: prompt-builder 按 role 条件拼装 + token 预算守门

> 来源：问题.md C7（行 202-215）、附录 C（行 395）、附录 H（行 574-577）
> 状态：proposed（待 B5 + C4 完成后实施）
> 提出：Roundtable 2026-04-20（Linus + Karpathy + Steve Jobs）
> Owner: TBD
> 估计工时：2 周
> Blocking dependencies：B5（eval harness）、C4（initial-user-turn 精简）

## 问题陈述

`src/main/prompt-builder/system-prompt.ts` 共 262 行，无条件拼装：
- 15 个 SOP（`prompt-builder/sops/*.md`）
- 11 个 API 文档（`prompt-builder/api-docs/*.md`）
- 5 个 CEO 模式片段（`prompt-builder/ceo-modes/*.md`）
- 7 个部门指南（`prompt-builder/department-guidelines/*.md`）
- Operating instructions (CEO / non-CEO 分支)
- Capability registry
- Skill injection

问题细节：
1. **无条件拼接**：一个 customer_support IC 也会收到全 15 个 SOP（包括 engineering / legal / finance 类）
2. **版本无治理**：每个 SOP/api-doc 的 git blame 是唯一变更记录，没有 `version` frontmatter
3. **无 token 预算守门**：prompt 本身可能吃掉 20-30k input tokens；compactor 还没开始就先把 budget 吃大半
4. **A/B 实验无法做**：改一个 SOP 的某句话无法 attribute 到具体行为变化
5. **Cache invalidation 代价高**：Anthropic prompt caching 对稳定前缀敏感——262 行拼装每改一次就 cache miss 一次

## 根因分析

Karpathy 视角：**prompt 越长越脆**。

长 prompt 的三个问题：
1. **Relevance dilution**：LLM 注意力机制对 prompt 中后段的 attention 权重递减（lost-in-the-middle 现象）。全塞 33 个 markdown 文件反而让关键信号被淹没。
2. **Cross-contamination**：legal SOP 的措辞会影响 engineering agent 的输出风格（比如加 disclaimers）；这不是我们想要的。
3. **Evaluation intractability**：33 个片段两两组合有 1000+ 种可能影响；改一个不知道动了哪。

Linus 视角补充：**当前架构假设"一个 prompt 适配所有 agent"**。这和 AppDatabase pass-through 是同构的问题——用一个巨大的 god object 替代多个专用对象。正确做法是按 role 产出不同 prompt。

另一个层面的问题：**没有 budget**。prompt-builder 的输出长度是"算出来多少就多少"，caller 无法预判。20k / 30k / 50k token 的 prompt 走 Anthropic 都能跑，但 cost 和 latency 完全不同，而且 compactor（B3 未修时）行为也会随 prompt 长度变化。

## 设计方案

### 核心原则

1. **按 role 条件拼装**：每个 agent 只看到自己需要的
2. **显式 budget**：prompt > threshold 直接 fail fast
3. **片段版本化**：每个 markdown 带 frontmatter `version: X`
4. **Cache-friendly layering**：稳定前缀（不变的 operating instructions）+ 动态后缀（per-turn context）显式分离

### 片段分类表

| 片段类型 | 何时包含 | 共享度 |
|---------|---------|--------|
| Core operating instructions | 总是 | 所有 agent |
| CEO operating instructions | `agent.role === "ceo"` | CEO only |
| CEO mode（team-building/awaiting-*/operating） | CEO + 当前 phase | CEO only |
| Department guidelines | 按 `agent.department` | 同部门 |
| SOPs | 按"与 agent 能力相关" | 有限子集 |
| API docs | 按 connector 可用性 | 动态 |
| Capability registry | 总是 | 所有 agent |
| Skill injection（pi 的 progressive disclosure） | 总是 | 所有 agent |

### 新 API 结构

```ts
// src/main/prompt-builder/index.ts（重写）
export function buildSystemPrompt(ctx: PromptContext): string {
  const sections = resolveSections(ctx);  // 新增
  const parts = sections.map((s) => renderSection(s, ctx));
  const prompt = parts.join("\n\n");
  enforceBudget(prompt, ctx);  // 新增
  return prompt;
}

interface SectionRef {
  id: string;        // "sop.task-delegation" | "department.engineering" | ...
  version: string;   // 从 markdown frontmatter
  required: boolean; // 不满足 required 则 fail
}

function resolveSections(ctx: PromptContext): SectionRef[] {
  const sections: SectionRef[] = [
    { id: "core.operating-instructions", version: "1.0", required: true },
    { id: "core.capability-registry", version: "1.0", required: true },
  ];

  if (ctx.agent.role === "ceo") {
    sections.push({ id: "ceo.operating-instructions", version: "1.0", required: true });
    sections.push({ id: `ceo.mode.${ctx.ceoMode}`, version: "1.0", required: true });
  }

  if (ctx.agent.department) {
    sections.push({ id: `department.${ctx.agent.department}`, version: "1.0", required: true });
  }

  for (const sop of resolveRelevantSops(ctx)) {
    sections.push({ id: `sop.${sop.slug}`, version: sop.version, required: false });
  }

  // API docs 仅当对应 connector ready 时
  for (const connector of ctx.allConnectors ?? []) {
    if (connector.status === "ready") {
      sections.push({ id: `api-docs.${connector.id}`, version: "1.0", required: false });
    }
  }

  return sections;
}
```

### SOP 相关性规则

替代"全塞"的朴素规则：

1. **SOP 有 `tags` frontmatter**：`tags: [task, delegation, messaging]`
2. **Agent role / department 决定关注 tag 集合**：
   - CEO → 全 tag
   - Engineering dept → `[task, code, review]`
   - Customer support → `[task, messaging, escalation]`
3. **Loader 根据 tag 交集筛选**

Markdown 示例：

```md
---
id: sop.task-delegation
version: 1.2
tags: [task, delegation]
---
# Task delegation SOP
...
```

### Token 预算守门

```ts
// src/main/prompt-builder/budget.ts
const BUDGET_THRESHOLDS = {
  warn: 8_000,    // 超过 warn 打 telemetry
  error: 16_000,  // 超过 error 直接抛
};

function enforceBudget(prompt: string, ctx: PromptContext): void {
  const tokens = estimateTokensPrecise(prompt, ctx.locale);  // 用 tiktoken 精确计算（C3 的 scope）
  recordMetric("prompt.tokens", tokens, { role: ctx.agent.role, companyId: ctx.companyId });
  if (tokens > BUDGET_THRESHOLDS.error) {
    throw new PromptBudgetError(`System prompt ${tokens} tokens exceeds ${BUDGET_THRESHOLDS.error}`);
  }
  if (tokens > BUDGET_THRESHOLDS.warn) {
    logger.warn("prompt.budget.warn", { tokens, threshold: BUDGET_THRESHOLDS.warn });
  }
}
```

**Let it crash 原则**：超预算直接 throw，不做"自动裁剪"——因为自动裁剪会悄悄改行为。

### Cache-friendly layering

当前 `buildTaskPrompt`（`prompt-builder/index.ts:48-`）已经把 system prompt（cacheable）和 per-turn context（non-cacheable）分开，这是对的。C7 保留这个分层，进一步：

- system prompt 内部按 stability 排序：`[core → role → department → SOPs → skills]`（稳定度递减）
- Anthropic cache_control breakpoint 标在 `core + role + department` 之后

### A/B harness（可选阶段）

SOP 片段支持 variant：

```md
---
id: sop.task-delegation
version: 1.2
variants:
  - id: default
    weight: 50
  - id: concise
    weight: 50
    path: ./task-delegation.concise.md
---
```

Loader 按 companyId hash 稳定分配到一个 variant，eval harness（B5）可以对比两个 variant 的行为差异。

## Migration 计划

1. **Phase 0（前置）**：B5 eval harness 就绪 + C4 initial-user-turn 精简完成
2. **Phase 1（3 天）**：给所有 markdown 片段加 frontmatter（`id` / `version` / `tags`），loader 支持读取
3. **Phase 2（1 周）**：实现 `resolveSections` + `renderSection`，行为上保持与当前一致（所有 section 都包含），新旧切换走 feature flag
4. **Phase 3（3 天）**：按 role 开始差异化加载——CEO 仍看全量，非 CEO 开始按 tag 过滤
5. **Phase 4（3 天）**：加 budget enforcement，先 warn-only 跑一周观测分布
6. **Phase 5（持续）**：A/B harness + per-company variant 分配

## 风险与回滚

| 风险 | 触发条件 | 回滚方法 |
|------|---------|---------|
| 漏包含 SOP 导致 agent 行为退化 | tag 过滤规则太严 | eval 发现 → 回到"全量包含" flag → 修 tag 规则 |
| Budget error 触发生产崩 | 某 company 的 connector 数量极端 | 阶段 4 warn-only 期间监测 p99；超限前调高或加裁剪 |
| Markdown frontmatter 格式错 | 作者漏写 version | Loader 启动时校验所有片段，任何格式错直接 fail |
| Cache invalidation 增多 | 稳定前缀拆得太细 | 监控 cache hit 率，必要时合并片段 |

## 验证标准

**前置：B5 必须就绪**。

1. **行为 eval**：对比 5 种 agent role × 3 种 trigger 下的 tool call 序列，新旧方案一致
2. **Prompt 长度**：非 CEO agent 的 system prompt 长度降低 40%+
3. **Cache hit rate**：观察 Anthropic cache hit rate，降低 <5%（cache 友好）
4. **Budget 分布**：99% 的 prompt 在 warn 阈值内
5. **A/B pilot**：至少一个 SOP 有 variant，eval 可观测两个 variant 的行为差异

## 不在范围

- **不改 SOP 内容**：只是让加载条件化 + 版本化，具体文字不动（那是 Owner 业务的事）
- **不做 AI-driven prompt optimization**：prompt 片段仍是人写的 markdown
- **不改 pi 的 prompt 结构**：本项目只控制自己注入到 pi 的 systemPrompt，pi 内部行为不动
- **不做 per-agent fine-grained prompt**：按 role / department 分组即可，不做 per-agent 定制
- **不动 token 精确化**（C3 的 scope）：本 proposal 可先用近似估算，C3 完成后自动精确

## 参考文件清单

- `src/main/prompt-builder/system-prompt.ts:1-262`（主拼装函数）
- `src/main/prompt-builder/sops/*.md`（15 个 SOP）
- `src/main/prompt-builder/api-docs/*.md`（11 个 API 文档）
- `src/main/prompt-builder/ceo-modes/*.md`（5 个 CEO 模式）
- `src/main/prompt-builder/department-guidelines/*.md`（7 个部门指南）
- `src/main/prompt-builder/operating-instructions.ts` + `operating-instructions-ceo.ts`
- `src/main/prompt-builder/capability-registry.ts`
- `src/main/prompt-builder/skill-injection.ts`
- `src/main/prompt-builder/index.ts`（入口 + per-turn 拼装）

## 附：为什么现在做

prompt caching 的经济账：Anthropic cache 5 分钟 TTL，稳定前缀每 miss 一次多付 ~30% cost。262 行拼装每天被改几次就是每天多付 30% × N 次。这是隐性 recurring cost，估算 company 规模一大、agent 数量一多，年度多付上万美元（有具体数值可做 cost model，不在本 proposal 范围）。

更重要的是：**有了条件拼装 + version frontmatter，AI coding agent 改 prompt 时可以 diff 到具体片段**——而不是在 262 行大 blob 里大海捞针。这直接降低 team 改 prompt 的心理门槛，促进迭代。

## 附：gating matrix

| Gate | 条件 | 放行判断人 |
|------|------|----------|
| G1 | B5 eval harness + C4 完成 | Karpathy |
| G2 | 所有 markdown 片段加了 frontmatter | Owner |
| G3 | resolveSections 函数覆盖 CEO / 非 CEO / 所有 department | Owner |
| G4 | Budget enforcement warn 阈值下 95% prompt 不触发 | Karpathy |
| G5 | A/B variant 第一个实验跑出 eval 差异数据 | Karpathy |

## 附：markdown frontmatter schema

```ts
export const SopFrontmatterSchema = z.object({
  id: z.string().regex(/^sop\.[a-z-]+$/),
  version: z.string().regex(/^\d+\.\d+$/),
  tags: z.array(z.string()).min(1),
  locale: z.enum(["en", "zh"]).default("en"),
  variants: z.array(z.object({
    id: z.string(),
    weight: z.number().min(0).max(100),
    path: z.string().optional(),
  })).optional(),
});
```

Build 时校验所有 markdown 符合 schema；不符合直接 fail。

## 附：SOP tag 分类体系（初版草案）

| Tag | 含义 | 关联 role |
|-----|------|---------|
| task | 任务管理相关 | 所有 |
| delegation | 分派相关 | CEO, 管理层 |
| code | 代码相关 | engineering |
| review | 审查相关 | 所有 reviewer |
| messaging | 消息沟通 | 所有 |
| escalation | 升级相关 | 所有 |
| finance | 财务相关 | finance, CEO |
| legal | 法务相关 | legal, CEO |
| marketing | 营销相关 | marketing |
| customer | 客户交互 | support, sales |

规则：SOP 至少有 1 个 tag，agent 根据 role 计算 relevant tag 集合。
