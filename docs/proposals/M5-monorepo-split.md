# Proposal M5: landing/ 与 desktop app 拆分（pnpm workspace 或独立仓）

> 来源：问题.md M5（行 248-252）、附录 F 第 8 条（行 541-542）
> 状态：proposed
> 提出：Roundtable 2026-04-20（Linus + Karpathy + Steve Jobs）
> Owner: TBD
> 估计工时：1 周（workspace 方案）或 2 周（独立仓方案）
> Blocking dependencies：无

## 问题陈述

`landing/` 目录是独立的 marketing site（Next.js + Cloudflare Functions），自带：
- 独立 `package.json`
- 独立 `node_modules`
- 独立 build 流程
- 独立 deploy（Cloudflare Pages）
- 独立的 SQL migration（`landing/migrations/`）

和 desktop app（Electron + React）混在同一个 git repo 里。`scripts/generate-landing-release-links.mjs` 做跨项目协调，暗示两个产品要**手动同步**某些 artifact。

问题表现：
1. **贡献者 onboarding 费劲**：clone 后不知道要在根目录还是 landing/ 跑 pnpm install；CI 要跑哪个
2. **release 耦合**：desktop app 发版和 landing 发版必须同时推到同一个 commit——其中一个有问题就拖另一个
3. **依赖污染**：根 `node_modules` 和 `landing/node_modules` 可能安装同一个包的不同版本
4. **CI 资源浪费**：改一个 landing 文件触发整个 desktop 的 typecheck/test
5. **安全面混淆**：landing 的 Cloudflare token、数据库 URL 和 desktop 的签名证书放在同一个仓库，权限边界模糊

## 根因分析

Linus 视角：**一个 repo 两个产品 = release 耦合**。

Monorepo 本身不是错——Google / Facebook 用 monorepo。但 monorepo 需要**工具层面的约束**：
- 统一 task runner（nx / turborepo / bazel）
- 明确的 workspace 划分
- 共享依赖 hoisting 策略
- CI 按 changed-files 触发

当前项目有 pnpm 但没 workspace 配置，landing 实际上就是"目录塞在这里的另一个项目"，没有 monorepo 的任何好处——**只有成本**。

Karpathy 视角补充：AI coding agent 在这种结构下很容易在 desktop 任务里改到 landing 文件，或反之。隔离不清楚的 repo 让 agent 的 blast radius 变大。

## 设计方案

### Option A：pnpm workspace（推荐，低成本）

**目标结构**：

```
AgentCompany/
├── package.json             # root (workspace root, 无 runtime 代码)
├── pnpm-workspace.yaml      # 新增
├── packages/
│   ├── desktop/             # 当前的根内容移到这里
│   │   ├── package.json
│   │   ├── src/
│   │   ├── tests/
│   │   └── ...
│   └── landing/             # 当前的 landing/ 移到这里
│       ├── package.json
│       ├── app/
│       └── ...
└── docs/
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - "packages/*"
```

**Root package.json**（变简）：

```json
{
  "name": "agentcompany-root",
  "private": true,
  "scripts": {
    "desktop:dev": "pnpm --filter desktop dev",
    "desktop:build": "pnpm --filter desktop build",
    "landing:dev": "pnpm --filter landing dev",
    "landing:build": "pnpm --filter landing build",
    "typecheck": "pnpm -r typecheck",
    "lint": "pnpm -r lint"
  }
}
```

**CI 按 package 分跑**：desktop PR 只跑 desktop typecheck/test，landing PR 只跑 landing。

**好处**：
- 两个项目独立 `package.json`、独立版本
- 根目录干净
- 共享开发工具（eslint / tsconfig base）可提到 root
- pnpm 自动 hoist 共享依赖，磁盘占用下降

**成本**：
- git history 移动（git mv 保留 blame）
- CI 脚本改写（`scripts/` 要调整路径引用）
- 发布流程（electron-builder / cloudflare deploy）适配新路径

### Option B：独立仓（彻底隔离）

把 landing/ 推到独立 repo（例如 `github.com/badlogic/agentcompany-landing`），现 repo 只保留 desktop。

**好处**：
- 完全隔离 CI / secrets / 权限
- landing 团队可独立迭代不看 desktop 代码
- desktop 的 code review 范围缩小

**成本**：
- 跨 repo 协调（release link 生成脚本要走 GitHub API）
- Onboarding 要 clone 两个 repo
- git history 完整迁移工作量

### 推荐 A

- 当前团队规模不需要完全隔离
- landing 改动相对少，一个 repo 能保持 cross-cutting 改动（例如品牌一致性）的原子性
- workspace 成本最低，收益立刻兑现

## Migration 计划（Option A）

1. **Phase 1（1 天）**：新建 `packages/desktop/` 空目录 + `packages/landing/`；`pnpm-workspace.yaml`
2. **Phase 2（1 天）**：`git mv` 把当前根代码移到 `packages/desktop/`，landing/ 移到 `packages/landing/`
   - 根 `package.json` 拆成 root + desktop
   - 根配置（`tsconfig.base.json` / `eslint.config.mjs`）保留 root
3. **Phase 3（1 天）**：修 `scripts/*` 里的硬编码路径（`scripts/release-*.mjs`、`scripts/build-*.mjs`）
4. **Phase 4（1 天）**：CI 配置分包跑
5. **Phase 5（1 天）**：文档同步——README 更新；`CLAUDE.md` / `AGENTS.md` 说明 workspace 结构
6. **Phase 6（持续）**：观察 2 周，处理零星问题

## 风险与回滚

| 风险 | 触发条件 | 回滚方法 |
|------|---------|---------|
| git history 丢失 | git mv 不规范 | 用 `git mv` 保留 rename detection；必要时 `git log --follow` 验证 |
| electron-builder 找不到 artifact | 打包路径变化 | Phase 3 脚本改完后跑一次完整 build 验证 |
| Cloudflare deploy 路径改 | landing build output 位置变 | wrangler.toml 更新；deploy 前本地 dry-run |
| renderer import path 断 | 代码中的硬路径 | codemod 扫 `require("../../landing")` 类的跨 package 引用（理论上没有） |

**回滚路径**：phase 2 是单个 commit（git mv），任何后续阶段出问题直接 revert。

## 验证标准

1. **独立 build 成功**：`pnpm --filter desktop build` 和 `pnpm --filter landing build` 分别跑通
2. **依赖完整**：`pnpm install` 根目录跑完 `pnpm -r typecheck` 全绿
3. **CI 提速**：改 landing 文件的 PR 不触发 desktop test
4. **Release 脚本**：`pnpm run release:local` / `pnpm release:boss` / `pnpm release:cloudflare:public` 都能跑
5. **Git blame 保留**：`git log --follow packages/desktop/src/main/service-graph.ts` 能追到原始 commit

## 不在范围

- **不引入 turborepo / nx**：pnpm workspace 已足够，加 task runner 是过度工程
- **不改代码模块边界**：desktop 内部代码结构本 proposal 不动
- **不做跨 package 共享代码**：landing 目前不需要 desktop 的类型；如果未来需要再加 `packages/shared/`
- **第三方 runtime reference snapshot 边界**：reference snapshot 已迁出本仓库，monorepo split 保持这个边界
- **不改 git branching strategy**：单仓单分支 vs 多分支不是本 proposal 问题

## 参考文件清单

- `landing/package.json`（独立 package 定义）
- `landing/migrations/`（独立 SQL migration）
- `scripts/generate-landing-release-links.mjs`（跨项目脚本）
- `scripts/release-public-cloudflare.mjs`（landing 发布）
- `scripts/release-boss.mjs`（desktop 发布）
- 根 `package.json:1-86`（会被拆分）
- 根 `pnpm-lock.yaml`（workspace 化后会更长但更清晰）

## 附：为什么现在修

**延迟成本**：landing 每加一个 dependency 就让根 `node_modules` 更大；desktop 的 CI 时间持续上升。现在拆 1 天，拖到 landing 翻倍大小就是 3 天+。

对 AI coding agent 来说，workspace 化后"这个改动属于哪个 package"一目了然——agent 不再会在 desktop 任务里 accidentally 修 landing 文件。这是隔离 blast radius 的最低成本方式。

次要触发：M5 和 M4（scripts 目录混乱）相关——scripts 里的 `release-public-cloudflare.mjs` / `release-boss.mjs` / `release-local.mjs` 混在一起部分就是因为 desktop/landing 不分。拆了 workspace，scripts 也可以按 package 分。

## 附：gating matrix

| Gate | 条件 | 放行判断人 |
|------|------|----------|
| G1 | `pnpm-workspace.yaml` 存在，`pnpm install` 在根目录一次跑通 | Owner |
| G2 | `pnpm --filter desktop build` 产出可签名的 `.app` bundle | Owner |
| G3 | `pnpm --filter landing build` 产出可部署的 Cloudflare Pages 资源 | Owner |
| G4 | CI 按 changed files 触发相应 package 测试 | Owner |
| G5 | git log --follow 在两个 package 内都能追到原始 commit | Linus |

## 附：迁移后的目录结构草图

```
AgentCompany/
├── package.json                      # workspace root
├── pnpm-workspace.yaml
├── pnpm-lock.yaml                    # hoisted
├── tsconfig.base.json                # shared
├── eslint.config.mjs                 # shared
├── .gitignore
├── CLAUDE.md / AGENTS.md
├── docs/
├── scripts/
│   ├── desktop/                      # electron-builder / signing / release
│   └── landing/                      # cloudflare deploy / release-links
└── packages/
    ├── desktop/
    │   ├── package.json
    │   ├── src/
    │   │   ├── main/
    │   │   ├── preload/
    │   │   ├── renderer/
    │   │   └── shared/
    │   ├── tests/
    │   ├── builtin-skills/
    │   ├── electron-vite.config.ts
    │   └── tsconfig.json             # extends ../../tsconfig.base.json
    └── landing/
        ├── package.json
        ├── app/
        ├── migrations/
        ├── next.config.js
        └── tsconfig.json
```

## 附：为什么不选其他方案

**方案 A（当前 proposal）**：pnpm workspace，一个仓两个 package。

**方案 B（独立仓）**：对当前团队规模不经济；跨仓协调成本高。

**方案 C（保持现状 + 更多 gitignore 隔离）**：治标不治本；CI 仍跑全量。

方案 A 成本 1 周，收益持续。

## 附：release 脚本改造示意

```json
// packages/desktop/package.json scripts 片段
{
  "scripts": {
    "build": "electron-vite build && node ../../scripts/desktop/build-desktop.mjs",
    "release:local": "node ../../scripts/desktop/release-local.mjs",
    "release:boss": "node ../../scripts/desktop/release-boss.mjs"
  }
}

// packages/landing/package.json scripts 片段
{
  "scripts": {
    "build": "next build",
    "release": "node ../../scripts/landing/release-cloudflare.mjs"
  }
}

// root package.json
{
  "scripts": {
    "release:all": "pnpm --filter desktop release:boss && pnpm --filter landing release"
  }
}
```

## 附：CI 按 changed files 触发（示意）

```yaml
# .github/workflows/desktop-ci.yml
on:
  pull_request:
    paths:
      - "packages/desktop/**"
      - "pnpm-lock.yaml"
      - "tsconfig.base.json"

# .github/workflows/landing-ci.yml
on:
  pull_request:
    paths:
      - "packages/landing/**"
```

desktop PR 不触发 landing CI，反之亦然。
