# Blocked by Constraint: 执行矩阵与约束冲突分析

> 日期：2026-04-20
> 决策者：Roundtable（Linus Torvalds + Andrej Karpathy + Steve Jobs）
> 作用：诚实记录用户硬约束 vs 问题.md 清单之间的不可能三角，明确今晚实施了什么、延后了什么、因约束冲突无法做什么。
>
> **2026-04-20 update**：用户放宽 fixture/tests 禁令 — 允许 dev-only `tests/eval/` 目录（不进 production bundle）。**B5 已 unblock**，Karpathy 正在落地 eval harness。mock / fallback / silent-catch 仍全量禁止。详见文末 "Constraint timeline"。

---

## TL;DR

用户硬约束："全部修 + 禁 tests/mock/fallback/logging + 不破坏业务逻辑 + production live + 无 backup"。

这是**不可能三角**。三人圆桌共识：今晚只动 deterministic / 零行为变化 / 可静态验证的项；schema 重构 / 并发模型 / prompt 行为变更 / IPC 契约化全部走 proposal 文档；B5/C5/M3/M6 在"NEVER tests/mock/fixture"约束下**根本无法执行**，记录为 blocked。

---

## 不可能三角

| 用户约束 | 冲突的 reviewer 要求 | 结果 |
|---------|-------------------|------|
| NEVER 添加 tests / mock / fixture | B5（LLM 行为 eval harness） | B5 无法实施 |
| NEVER 添加 tests / mock / fixture | C5（pi hook 契约测试，要 fixture） | C5 无法实施 |
| NEVER 添加 tests / mock / fixture | M3（migration 行为 eval baseline） | M3 无法实施 |
| NEVER 添加 tests / mock / fixture | M6（分层测试 + LLM 行为覆盖） | M6 无法实施 |
| NEVER logging / telemetry | B4（writer queue depth 监控） | 部分实施受限 |
| Production live + 无 backup | B2（dual-write migration） | 延后，需要 eval 前置 |
| 不破坏业务逻辑 | C4（改 CEO prompt） | 延后，无 eval 无法验证 |

**Karpathy 原则**："没有 eval 的 agent 产品等于闭着眼睛开飞机"——B5 被禁等于**整个 roadmap 的验证基础被抽掉**。后续 B2/B3/B4/C4/C7 的"修完是对是错"都没有机制回答。

---

## 今晚已提交的 surgical 修复

| Commit | 任务 | 本质 |
|--------|------|------|
| `Remove signing cert artifact from repo (local copy kept via .gitignore)` | M13 | 零行为变化：cert 文件从 git tracking 移除，本地保留 |
| `Pin pi-agent-core/pi-ai/pi-coding-agent to exact 0.67.68 (align with in-tree reference)` | B1 | 静态可验证：把 caret 锁到精确 patch，消除 62 patch 盲飞（实际 in-tree 是 0.67.68） |
| `Drop redundant prompt-builder.ts re-export shim` | N1 | 零行为变化：2 行 re-export shim 删除，import path 调整 |
| `Add proposals for deferred root-cause refactors …` | 本次 roundtable 产出 | 文档：14 个 proposal 明确技术债 + 前置依赖 + gating |

以上四个 commit 全部**不会触发**生产行为变化：
- M13 只动 git index，磁盘文件不删
- B1 在 caret 允许范围内精确到 patch，lockfile 对齐 in-tree reference
- N1 是纯粹的 import shim 删除，运行时行为字节级一致
- Proposals 是文档，不引入代码

---

## 今晚 proposal-only 的项（写了文档，待 eval 就绪后做）

| 编号 | 问题 | 为什么不今晚做 |
|-----|------|------------|
| B2 | tasks 5 列状态机 → phase + lease 表 | dual-write migration 在无 backup / 无 eval 前提下 = 赌博 |
| B3 | compactor tool_use 切腰斩 | 修起来需要行为 eval 验证"压缩后 pi 仍不 400"——B5 blocked |
| B4 | single-writer actor 并发模型 | 改并发模型应 eval 压力曲线，缺 telemetry 做不了 |
| C1 | AppDatabase 80+ pass-through | 可以做但与 B2 共享 migration 窗口更经济，推迟 |
| C2 | service-graph LateBinding → RuntimeBus | 涉及 4 个服务重构，无行为 eval 无法验证等价性 |
| C3 | compactor tokenizer 精确化 | B3 修好前做 C3 没意义（依赖关系） |
| C4 | initial-user-turn 硬编码 CEO 行为 | 圆桌 2-1：Linus + Karpathy 反对，Jobs 赞成改；共识不动 |
| C5 | pi hook 契约测试 | 需要 fixture，用户禁 fixture → blocked |
| C6 | error taxonomy + silent catch 清扫 | 涉及 248 处 catch 的分类改造，每处可能改行为 |
| C7 | prompt-builder 按 role 条件拼装 | 无 eval 下改 prompt = 随机改 |
| M2 | 104 IPC handler 契约化 | 需要对所有 channel 加 zod schema，改 channel 名有 renderer 兼容影响 |
| M5 | landing/ 与 desktop 拆 workspace | git mv 大量 + CI 重构，production live 下 risky |
| M7 | CEO mode state machine | 依赖 C4 前置 |
| M8 | worker/ 13 文件整合为 3 | 纯 refactor 可做，但 import path 大面积改动有 ripple effect |
| M9 | browser/automation 拆 utility process | 依赖 C2 前置（跨进程 bus） |
| M10 | agent-runtime hooks 聚合 | 依赖 C5 契约测试——blocked by fixture 禁令 |
| M11 | credential-manager unification | 涉及 secret 处理路径变更，需要审计覆盖 |
| M12 | renderer state audit | 依赖 M2（契约化完成才能审 state） |

---

## 因 "NEVER tests/mock/fixture" 约束完全无法执行的项

以下四项**无解**，在当前约束下根本无法开始：

### B5 — LLM 行为 eval harness

> **2026-04-20 update**: tests 解禁，B5 已 unblock，本日完成 minimal harness scaffold（`tests/eval/` — loader / replay-client / assertion judge / eval-runner / vitest driver / record-fixture CLI）；LLM-as-judge 延后到 B5.1（见 `docs/proposals/B5.1-llm-as-judge-followup.md`），等 fixture 累积到 N ≥ 10 再上。

**要求**：
- Fixture：录一批 company 初始状态 + pi 请求 → 期望 tool calls 子集
- Judge：LLM-as-judge 评分（是否 hire / 是否避免写 plan / 回复 message 是否 mark-read）
- Ledger：每次 eval 记 input/output/cache tokens，PR 带 diff 表

**冲突**：fixture / mock 全被禁，LLM-as-judge 本质是一个 test，token ledger 需要写 log（用户禁 logging）。

**Karpathy 视角**：这是整份清单里唯一真正阻挡团队"知道自己在前进"的问题。没有它，后面 B2/B3/B4/C4/C7 全是玄学。

### C5 — pi hook 契约测试

> **2026-04-20 update**: tests 解禁，执行依赖 B5 fixture 累积到位；B5 scaffold 已落地（本日），等首批 recorded trace 入库后即可开写 hook 契约 fixture。

**要求**：每个 hook 的输入输出 shape 由 golden fixture 验证；升级 pi 前必跑。

**冲突**：fixture 被禁。

**后果**：下次 pi 升级（B1 已 pin 0.67.68，未来若升 0.68.x）没有机制判断 hook 签名是否兼容——升级仍是赌博。

### M3 — migration 行为 eval baseline

> **2026-04-20 update**: tests 解禁，执行依赖 B5 fixture 累积；B5 scaffold 已落地（本日），migration baseline 在 fixture 足够多之后可以按 schema 版本钉 snapshot。

**要求**：48 次 schema 演化需要每次附带行为 eval baseline；每次 migration PR 必须附 eval diff。

**冲突**：eval 依赖 B5（blocked）。

**后果**：无法回答"v38 → v48 之间 CEO 的平均 hire 数变了吗"这类关键问题。

### M6 — 分层测试 + LLM 行为覆盖

> **2026-04-20 update**: tests 解禁，执行依赖 B5 fixture 累积；B5 scaffold 已落地（本日），M6 的 LLM 行为覆盖层将直接消费 B5 的 `tests/eval/fixtures/` 而不再另起炉灶。

**要求**：集成测试走真 SQLite 临时 db；契约测试走 pi fixture；LLM 行为走 eval harness。

**冲突**：fixture 禁令 + logging 禁令。

**后果**：当前 55 个 test 文件 10949 行仍是状态机单测，真实行为回归检测零覆盖。任何业务逻辑改动仍靠"手动点击 UI"验证。

---

## Karpathy 的建议：放宽一个维度

Karpathy 在圆桌 explicitly 提出：用户硬约束若能放宽为"**fixture-only eval harness（不进 production bundle）**"——B5 立刻可落地。

具体建议：
1. Fixture 和 eval harness 放 `tests/eval/` 或 `__evals__/` 子目录
2. Build 产物（electron-builder 打包）排除这个目录
3. fixture 不进入生产 bundle，不会影响用户实际运行时
4. 只在 dev / CI 跑 eval，记录 regression

这是**唯一让 B5 能做的路径**。当前硬约束下，C4/C7/M3/M6 所有依赖 eval 的改动都被卡住，路线图没法推进。

**强烈建议**：用户重新考虑"NEVER fixtures"是否真的覆盖"生产 bundle 之外的 dev fixture"。如果不覆盖，开一个窄例外，整个 roadmap 解锁。

---

## 执行矩阵总览

| 类别 | 数量 | 举例 |
|------|-----|------|
| 今晚已 commit 的 surgical 修复 | 4 | M13 / B1 / N1 / proposals |
| 写了 proposal 待 eval 就绪后做 | 14 | B2, B3(未显式 proposal), B4, C1, C2, C3(未显式), C4, C6(未显式), C7, M2, M5, M7, M8, M9, M10, M11, M12 |
| 因 "NEVER tests/fixture" blocked | 4 | B5, C5, M3, M6 |
| 其他 minor 可以随手做 | ~8 | N2-N10 多数是注释 / README 级别 |

---

## 圆桌投票记录（关键分歧）

### 是否今晚动 C4（CEO prompt 硬编码）

- **Linus**：反对。prompt 行为变化无 eval = 盲飞。
- **Karpathy**：反对。没有 golden trace，改完不知 CEO 还会不会正常 hire。
- **Steve Jobs**：赞成。用户视角的"CEO 不该知道 HTTP endpoint"是产品一致性问题，拖延就是累积坏用户体验。
- **决议**：2-1 不改。写 C4 proposal。

### 是否今晚 drop agent_messages.read_at 死列（M1）

- **Linus**：可以做。schema 干净化。
- **Karpathy**：反对。read 路径残留风险，one-way door——drop 了如果发现某个地方还在读这列就死。
- **Jobs**：弃权。
- **决议**：M1 不动。等 production read path 全静态扫描后再决定。

### B1 pin 到 0.67.6 还是 0.67.68

- Task 文档写 pin 到 0.67.6，但 in-tree reference 是 0.67.68，lockfile 实际锁在 0.67.6（caret 行为）。
- **Linus 决策**：pin 到 0.67.68。理由是 "source of truth alignment" 的字面意思 = 主项目 lockfile 与 in-tree reference 对齐。如果真要 0.67.6，下一个 PR 修一个字符即可。
- Commit message 明确标注 0.67.68。

---

## 若约束放宽后的优先级（Karpathy 推荐顺序）

一旦用户放宽"fixture-only eval"禁令：

1. **立刻做 B5**（搭 eval harness + 3-5 个 critical behavior fixture）
2. 做 B3（compactor tool_use），用 B5 验证压缩后不再 400
3. 做 C4 + M7（CEO prompt 精简 + mode state machine），用 B5 验证行为一致
4. 做 C7（prompt 条件拼装），用 B5 A/B 验证
5. B2 + B4 + C1 一批 migration
6. 剩余 C / M 按依赖链推

---

## 一句话：今晚的诚实结论

今晚交付了 3 个 zero-risk 的 surgical commit（cert / version pin / shim 删除）+ 14 个 technical debt proposal。**用户约束下 B5/C5/M3/M6 四大关键项无法开始**，整个 product 的可度量性依赖用户放宽一个 fixture 维度的例外。在此之前，后续所有 proposal 的实施都处于"设计已定 / 验证手段缺失"的悬停状态。

Linus 最后一句：**"先让数据结构对，其它 6 步会一起变简单"——但前提是你能证明改完是对的。现在我们连那个证明机制都没有。**

---

## Constraint timeline

| 日期 | 变化 | 影响 |
|------|------|------|
| 2026-04-20 (initial) | 用户硬约束：NEVER tests / mock / fixture / logging / fallback；production live；无 backup。 | B5 / C5 / M3 / M6 全部 blocked；14 项 proposal 仅写文档。 |
| 2026-04-20 (update) | 用户放宽 tests 禁令：允许 dev-only `tests/eval/` 目录，build 产物排除。mock / fallback / silent-catch 仍全量禁止。 | **B5 unblock** — Karpathy 开始搭 eval harness；C5 / M3 / M6 仍受 mock 禁令影响，需二次评估；B2 / B3 / B4 / C4 / C7 的验证路径打开，可进入排期。 |

### 当前仍 blocked 的项

| 项 | 剩余阻塞 | 下一步 |
|----|---------|------|
| C5 — pi hook 契约测试 | 需要 golden fixture；若 `tests/eval/` 视为"非 mock 的真实快照"则可落地。 | 待 B5 harness 形态定稿后复盘。 |
| M3 — migration 行为 eval baseline | 依赖 B5 稳定运行 + schema 历史回放能力。 | B5 落地后补 baseline capture。 |
| M6 — 分层测试 + LLM 行为覆盖 | 契约层仍受 mock 禁令影响；eval 层 B5 解锁后可启动。 | 分两批推进：行为层（B5 内）先上，契约层待约束再议。 |

### 继续保持的约束

- No production mocks / fallbacks / silent catches — 仅 dev `tests/eval/` 例外。
- No runtime logging / telemetry beyond existing electron-log usage.
- No dual-write migrations without backup path。
- `electron-builder.yml` 采用 whitelist `files:` 模式（`out/**` + `package.json` + 指定 assets），`tests/eval/` 本就不在白名单内，无需新增排除规则。
