# Proposal C3-followup: 用真实 tokenizer 替换字符估算

> 来源：Roundtable 2026-04-20 surgical compactor 修复；C3 首轮决定先用保守常量 (2 chars/token) 落地
> 状态：proposed（中间态已落地，真正解决方案待依赖就绪）
> 提出：Karpathy (T2)
> Owner: TBD
> 估计工时：1 天（换依赖）+ 半天（灰度验证）
> Blocking dependencies：无硬阻塞；等 pi-ai 暴露 tokenizer 或接入 tiktoken/anthropic-tokenizer

## 问题陈述

`src/main/agent-runtime/context-compactor.ts` 的 `estimateTokens` 现在用 `Math.ceil(chars / 2)` 做 token 估算，作为 120k 阈值的守门人。

问题：
1. **中文 BPE 实际约 1.5-2 tokens/char**：2 chars/token 的常量对 CJK 大致可用，但 mixed 中英 / emoji / code block 的实际比例会漂移。
2. **对拉丁文过度保守**：英文 BPE 约 4 chars/token，用 2 chars/token 会让英文 agent 的阈值提前 50% 触发——这是安全的方向（宁可早触发不要晚触发），但浪费了压缩空间。
3. **无法感知 tool 定义 / system prompt 开销**：`estimateTokens` 只数 messages 里的文本，tool schema JSON 和 system prompt 的 token 都没计。真实 input tokens 比估算大。
4. **Anthropic prompt caching 的 breakpoint 计算需要精确 token 数**：字符估算拿不到 cache hit / miss 的决策依据，未来接 cache 优化时必须换。

## 根因

pi-ai 0.67.68 没 export tokenizer。Compactor 作为 `transformContext` hook 在 renderer / main 都可能跑，依赖必须能在 Node 和 Electron main process 里用。

备选方案：
- **tiktoken** (OpenAI BPE)：快，tree-shakable，但对 Anthropic 模型的真实 token 数只是近似（Anthropic 用私有 BPE，两者差异 5-10%）。
- **@anthropic-ai/tokenizer**：精确，但包体积较大（~2MB），且 Anthropic 自己建议用 `count_tokens` API 而不是本地估算（原因：模型更新会换 tokenizer）。
- **pi-ai 升级暴露 tokenizer**：理论上最干净，但要等上游；pi-mono 仓 `packages/ai/src/utils/` 目前只有 `overflow.ts` 做错误匹配，没 tokenizer utility。
- **Anthropic `count_tokens` API**：精确，但每次 compactor 估算都要额外 HTTP round-trip，违反 "compactor 必须是纯函数" 的现有契约。

## 建议路径

1. 先等 pi-ai 是否在后续 patch 里暴露 `countTokens(messages, model)`——如果暴露，零成本切过去。
2. 若 6 周内上游没动作，引入 `tiktoken` + 模型 → encoding 映射表（Anthropic 用 `cl100k_base` 近似；Gemini / GPT 各自对应）。
3. 保留 `estimateTokens(text: string): number` 的对外签名不变，只换内部实现——B3 配对修复和 hook 调用都无需动。

## 不做的事

- 不引入 `count_tokens` API 调用：compactor 必须是纯同步函数，不能发网络。
- 不做"运行时采样真实 tokenizer 校准常量"的启发式：引入额外系统状态，违反 let it crash。

## 验证标准

- 英文 + 中文 + code block 三种典型 transcript，估算值与 Anthropic 真实 input tokens 误差 ≤ 10%。
- 120k 阈值触发时机提前/延后不超过真实阈值的 5%。
- typecheck 全绿；现有 `compactMessagesIfNeeded` 调用点不动。
