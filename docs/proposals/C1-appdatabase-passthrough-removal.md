# Proposal C1: 用 codemod 一次性删除 AppDatabase 80+ legacy pass-through

> 来源：问题.md C1（行 114-127）、附录 F 样本 5（行 495-507）、附录 C（行 390-391）
> 状态：proposed（可与 B2 共享 migration 窗口）
> 提出：Roundtable 2026-04-20（Linus + Karpathy + Steve Jobs）
> Owner: TBD
> 估计工时：1 周（含 codemod 脚本 + 逐个 PR 验证）
> Blocking dependencies：无强依赖，但建议 B2 完成后再做（B2 会修改 tasks 模块 API）

## 问题陈述

数据库访问层有两层 pass-through：

**第一层**：`src/main/database-base.ts` 的 `AppDatabaseBase` 持有 26 个领域模块（`threads` / `company` / `agents` / `tasks` / `runs` / ...），在 226-336 行为这些模块的 80+ 方法手写薄委托。

**第二层**：`src/main/database.ts` 的 `AppDatabase`（`AppDatabaseBase` 的子类），在 13-192 行又手写一层更薄的委托，例如：

```ts
// src/main/database.ts:13-23
listComments(taskId: string) { return this.activityMod.listComments(taskId); }
sendAgentMessage(input: {...}) { return this.messages.sendAgentMessage(input); }
// 共计 192 行，几乎全是这种 one-liner
```

作者在 `database-base.ts:49-51` 自己承认：

> "Domain modules. New code should prefer `db.tasks.saveTask(...)` over the legacy pass-through methods on AppDatabase. Pass-through remains for back-compat until all call sites migrate."

没有迁移计划，没有 deadline，没有 ESLint rule 禁止新代码走 pass-through。

## 根因分析

Linus 视角（好品味原则第六条：代码是否可读）：**两层委托是认知税**。

读代码路径：`caller → AppDatabase.saveTask → AppDatabaseBase.saveTask → tasks.saveTask → SQL`。每一层都没有任何增值逻辑，纯粹的字符串转发。这是典型的"架构师幻觉"——觉得加一层抽象就是解耦，实际是把同一个事情说三遍。

**真正的解耦**是：call site 和 SQL 之间存在一层做 validation / caching / observability 的东西。当前架构里那一层是空的。

Karpathy 视角补充：AI coding agent 读这个 codebase 时，每次想保存 task 都看到三个等价的 API（`db.saveTask` / `db.saveTask` 继承 / `db.tasks.saveTask`），完全不知道该用哪个。这种 ambiguity 会让 agent 每次选得不一样，导致代码风格 drift——"我之前写过 db.saveTask，这次也写这个" vs "我之前写过 db.tasks.saveTask，这次也写这个"——最后仓库里三种风格并存，review 成本陡增。

根本问题：**"back-compat until all call sites migrate" 没有触发条件**。谁来触发？触发日期？指标？——都没有。所以它就是永远存在。

## 设计方案

### 目标最终形态

```ts
// src/main/database.ts（重写后 ~30 行）
export class AppDatabase extends AppDatabaseBase {
  // 保留只有 AppDatabase 才有的逻辑（如果有）
  // 没有任何 pass-through
}

// src/main/database-base.ts（删除 226-336 的 pass-through 段落）
export class AppDatabaseBase {
  public readonly threads: ThreadsModule;
  public readonly company: CompanyModule;
  public readonly agents: AgentsModule;
  // ... 26 个模块
  // 没有 pass-through 方法
}
```

### 所有 call site 强制走命名空间

```ts
// Before
db.saveTask(task)
db.listComments(taskId)
db.sendAgentMessage(input)

// After
db.tasks.saveTask(task)
db.activity.listComments(taskId)
db.messages.sendAgentMessage(input)
```

### Codemod 脚本

新建 `scripts/codemod/remove-appdatabase-passthrough.mjs`：

1. 构建方法名 → 模块名的映射表（从 `database-base.ts:226-336` 和 `database.ts:13-192` 逆向抽取）。例如：
   ```
   saveTask → tasks.saveTask
   listTasks → tasks.listTasks
   sendAgentMessage → messages.sendAgentMessage
   listComments → activity.listComments
   … (~80 条)
   ```
2. 用 ts-morph 或 jscodeshift 扫 `src/` 和 `tests/`，匹配 `db.<method>(...)`，替换为 `db.<module>.<method>(...)`。
3. 对每次替换做 typecheck 验证：`pnpm typecheck` 必须通过。
4. 产出 migration report（每个文件改了几处）。

### ESLint rule 锁死

新规则：`no-appdatabase-passthrough`——禁止在类型为 `AppDatabase` 的对象上调用领域方法（只允许访问 `db.tasks` / `db.agents` 等 getter）。

## Migration 计划

1. **Step 1（1 天）**：写 codemod 脚本 + dry-run 出 report，评估影响面（预计 500-800 处 call site）。
2. **Step 2（2 天）**：按模块分批跑 codemod，每个模块一个 PR：
   - `db.threads.*` 一个 PR
   - `db.tasks.*` 一个 PR
   - `db.messages.*` 一个 PR
   - ...
   每个 PR 跑 typecheck + 相关 unit/integration test。
3. **Step 3（1 天）**：所有 call site 迁移完后，删 `database-base.ts:226-336` 的 pass-through 段落 + 删 `database.ts:13-192`。
4. **Step 4（半天）**：合并 `AppDatabase` 到 `AppDatabaseBase`，改名为 `AppDatabase`。删除无用的继承层。
5. **Step 5（半天）**：打开 ESLint rule，新 PR 无法再走 pass-through。

不需要 schema migration——这是纯代码结构重构，二进制行为零变化。

## 风险与回滚

| 风险 | 触发条件 | 回滚方法 |
|------|---------|---------|
| Codemod 误改 | 动态 property access `db[name]` | codemod 检测到 computed access 时跳过并 warn |
| Typecheck 通过但 runtime 错 | 模块 getter 返回 undefined | `AppDatabaseBase` constructor 里逐个 assert 模块已 init |
| 测试 mock 失效 | 测试 stub 了 `db.saveTask` | 测试改为 stub `db.tasks.saveTask`——codemod 同时处理 |
| 第三方 plugin 依赖 | builtin-skills 或外部代码调 `db.saveTask` | 当前没有第三方 plugin 路径，如发现再加 deprecation proxy |

**回滚路径**：任何 step PR 可单独 revert。final cleanup（step 3-4）前代码层面保持 dual API，任何时候都可暂停。

## 验证标准

1. **Typecheck 通过**：每个 codemod PR + final cleanup PR
2. **所有测试绿**：typecheck / unit / integration / e2e
3. **静态扫描**：最终 `grep -rn "db\.saveTask\|db\.listTasks\|…" src/` 应无命中（除了 `db.tasks.saveTask` 这种合法 namespaced 调用）
4. **ESLint CI 门禁**：新 PR 引入 pass-through 风格被 CI 拒绝
5. **Line count**：`database.ts` 从 192 行 → ≤30 行；`database-base.ts` 从 472 行 → ≤200 行

## 不在范围

- **不重构领域模块内部 API**：只是把 pass-through 删掉，模块内部实现不动。
- **不改 IPC 接口**：renderer 看到的还是相同 shape。
- **不引入 ORM**：SQLite 直接 prepare + run 的风格保留。
- **不做 query builder**：领域模块内部写 SQL 的方式不变。
- **不拆分领域模块到独立文件**：已经在 `src/main/database/` 子目录了，不动。

## 参考文件清单

- `src/main/database.ts:13-192`（第二层 pass-through，待删除）
- `src/main/database-base.ts:40-472`（域模块装配 + 第一层 pass-through）
- `src/main/database-base.ts:49-51`（作者自白注释）
- `src/main/database-base.ts:226-336`（80+ pass-through 方法段）
- `src/main/database/*`（26 个域模块，API 不变）
- `src/renderer/**/*.ts`（主要 call site 消费方）
- `src/main/ipc-*.ts`（IPC handler call site）

## 附：为什么现在修

**broken-window 效应**：只要注释写着"pass-through remains for back-compat"且没有 deadline，新代码就会继续加新的 pass-through。当前 80+ 方法是一天的 codemod，拖到 150+ 就是一周，拖到 300+ 就没人敢动了。

Linus 原话精神：当你发现自己写注释"我知道这很糟但是…"的时候，你就已经在积累技术债。技术债不会自己消失，只会复利。

C1 和 B2 可以共享 migration 窗口——B2 要改 tasks 的状态机 API，codemod 正好顺带把 `db.saveTask → db.tasks.saveTask` 处理掉，两件事一起做比先后做省一半 PR review 工夫。

C1 改完后代码的可读性/可教性明显提升，这个直接影响 AI coding agent 的产出质量——agent 不再在"三个等价 API 选哪个"上浪费 token 和时间。

## 附：codemod 脚本草稿

```js
// scripts/codemod/remove-appdatabase-passthrough.mjs
import { Project, SyntaxKind } from "ts-morph";

const PASSTHROUGH_MAP = {
  // 从 database.ts:13-192 和 database-base.ts:226-336 抽取
  saveTask: "tasks",
  listTasks: "tasks",
  deleteTask: "tasks",
  saveAgent: "agents",
  listAgents: "agents",
  sendAgentMessage: "messages",
  listComments: "activity",
  // ... ~80 条
};

const project = new Project({ tsConfigFilePath: "tsconfig.json" });
const sourceFiles = project.getSourceFiles(["src/**/*.ts", "tests/**/*.ts"]);

for (const sf of sourceFiles) {
  const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const call of calls) {
    const expr = call.getExpression();
    if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const prop = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    const obj = prop.getExpression().getText();
    const method = prop.getName();

    // 只改 db.xxx(...) 形式
    if (obj === "db" && method in PASSTHROUGH_MAP) {
      const module = PASSTHROUGH_MAP[method];
      prop.setExpression(`${obj}.${module}`);
    }
  }
}

await project.save();
```

## 附：gating matrix

| Gate | 条件 | 放行判断人 |
|------|------|----------|
| G1 | Codemod dry-run report 显示预期影响面（500-800 call sites） | Linus |
| G2 | 每个模块的迁移 PR 单独跑 typecheck + unit test 绿 | Owner |
| G3 | 所有模块迁完后 `grep -rn 'db\.saveTask\|db\.listTasks' src/` 无命中 | Linus |
| G4 | `database.ts` 行数 < 30 | Linus |
| G5 | ESLint rule `no-appdatabase-passthrough` 启用，CI 捕获新违规 | Owner |

## 附：call site 分布（预估）

基于 grep：
- `src/main/ipc-*.ts`：~200 处
- `src/main/orchestration/`：~100 处
- `src/main/worker/`：~50 处
- `src/main/agent-runtime/`：~80 处
- `src/renderer/`：~0 处（renderer 通过 IPC，不直接访问 db）
- `tests/`：~100 处

总计 ~530 处。codemod 一次性全改，分批 PR 按文件提交。

## 附：与 B2 的协同

B2 的 phase/lease 重构需要改 `src/main/database/tasks-status.ts` 的 API。codemod 可同时处理两件事：
1. 把 `db.saveTask → db.tasks.saveTask`（C1）
2. 把 `db.tasks.saveTask → db.tasks.advanceTaskPhase`（B2 的新 API）

一个 PR 两件事。节约 review 一次成本。

## 附：为什么不选其他方案

**方案 A（当前 proposal）**：一次性 codemod 迁移。优点：彻底；缺点：一次大 PR。

**方案 B（渐进式，新代码用新 API，旧代码原样）**：broken-window 加剧，永远迁不完（过去两年证明了）。

**方案 C（只删 database.ts 的第二层，保留 database-base.ts 的第一层）**：治标不治本，仍有 pass-through 层。

方案 A 是**真的解决问题**的方案。

## 附：PR 拆分策略

按"同一领域的 call site 一批 PR"拆分：

| PR | 迁移范围 | 预计大小 | 评估 |
|----|---------|---------|-----|
| PR-1 | `db.tasks.*` 迁移 | ~150 处 | 跟 B2 合并最省力 |
| PR-2 | `db.agents.*` 迁移 | ~80 处 | 独立 |
| PR-3 | `db.messages.*` 迁移 | ~70 处 | 独立 |
| PR-4 | `db.approvals.*` 迁移 | ~60 处 | 独立 |
| PR-5 | `db.runs.*` 迁移 | ~50 处 | 独立 |
| PR-6 | 其他 21 个模块分 5 批 | ~170 处 | 独立 |
| PR-7 | Final cleanup（删 database.ts pass-through） | - | 所有前置完成后 |

每个 PR 单独跑 typecheck + 相关单测，review 一次 < 1 小时。

## 附：自动 import 优化

Codemod 跑完后，同 file 内如果 `db.tasks.*` 多处调用，可以抽成本地 alias：

```ts
const { tasks } = db;
tasks.saveTask(t);
tasks.listTasks();
```

但这是 optional 优化，由 reviewer 决定是否采纳。
