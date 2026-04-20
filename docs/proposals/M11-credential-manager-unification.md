# Proposal M11: 统一 CredentialManager（OAuth + API key + vault 三合一）

> 来源：问题.md M11（行 284-288）、附录 I 第 1 条（行 587）
> 状态：proposed
> 提出：Roundtable 2026-04-20（Linus + Karpathy + Steve Jobs）
> Owner: TBD
> 估计工时：2 周
> Blocking dependencies：无

## 问题陈述

`src/main/credentials/` 模块当前有 4 个文件：
- `credential-resolver.ts`
- `credential-store.ts`
- `oauth-login-service.ts`
- `types.ts`

同时还有独立的：
- `src/main/vault.ts`（secret 加密存储）
- `src/main/connector-definitions-data-apikey.ts`（API key 类 connector 定义）
- `src/main/connector-definitions-data-oauth.ts`（OAuth 类 connector 定义）
- `src/main/connector-definitions-data-cloud.ts`（Cloud 类 connector 定义）

**四个不同的"我是谁"来源**散落，secret 生命周期（如何过期 / 如何轮换 / 如何跨 connector 共享）不明确。

具体问题：
1. **Resolve 路径不统一**：有的走 `credentialResolver.resolve(id)`，有的直接 `vault.decrypt(key)`，有的走 `credentialStore.lookup(connectorId)` —— call site 多样，每种 resolve 路径的失败模式也不同
2. **Secret 生命周期**：OAuth token 有 `expires_at`，API key 通常没有，cloud-hosted 凭证可能有 API-specific expiry —— 当前没有统一的 "refresh / rotate" 流程
3. **Vault 被直接 expose**：某些 service 直接调 `vault.decrypt(...)`，绕开 credentialResolver 的缓存/审计
4. **Connector 定义分三份**：相同的 connector "XX" 可能同时在 apikey / oauth 两份定义里存在，用户 UI 看到的 connector 状态由谁算真源不确定
5. **权限边界不明**：哪些 service 能读什么凭证？当前没有 ACL，任何 service 都能 import credentialResolver 和 vault

## 根因分析

Linus 视角（安全边界是数据结构的第一公民）：**"凭证"是一个抽象概念，当前项目没有把它建模成一等公民**，而是按类型（OAuth vs API key）分别处理，导致每种类型各成体系。

真正的抽象应该是：

```
Credential (abstract)
├── metadata: { id, scope, expiresAt, ... }
├── provider: OAuthProvider | ApiKeyProvider | CloudProvider
└── resolve(): Promise<{ secret: string, metadata: Metadata }>
```

provider 负责具体的获取和刷新逻辑，上层只关心"给我 X 连接器的凭证"——类型差异被封装。

Karpathy 视角：agent 调用 connector 时只想"用 X 连接器"，不关心这个连接器是 OAuth / API key / Cloud。当前分三份 connector 定义意味着 UI 和 agent 都需要做类型判断——属于把实现细节泄漏到 consumer。

## 设计方案

### 统一的 CredentialManager

新建 `src/main/credentials/credential-manager.ts`：

```ts
export interface Credential {
  id: string;
  connectorId: string;
  kind: "api_key" | "oauth" | "cloud_hosted";
  expiresAt: number | null;
}

export interface ResolvedCredential {
  secret: string;
  metadata: Credential;
}

export class CredentialManager {
  constructor(
    private vault: Vault,
    private store: CredentialStore,
    private oauth: OAuthLoginService,
  ) {}

  async resolve(connectorId: string, opts?: { skipRefresh?: boolean }): Promise<ResolvedCredential> {
    const credential = this.store.lookup(connectorId);
    if (!credential) throw new CredentialNotFound(connectorId);

    switch (credential.kind) {
      case "api_key":
        return this.resolveApiKey(credential);
      case "oauth":
        return this.resolveOAuth(credential, opts);
      case "cloud_hosted":
        return this.resolveCloud(credential);
    }
  }

  async rotate(connectorId: string): Promise<void> {
    // 统一的轮换入口
  }

  async revoke(connectorId: string): Promise<void> {
    // 统一的吊销入口
  }

  private async resolveOAuth(cred: Credential, opts?: { skipRefresh?: boolean }): Promise<ResolvedCredential> {
    if (cred.expiresAt && cred.expiresAt - Date.now() < REFRESH_BEFORE_MS && !opts?.skipRefresh) {
      await this.oauth.refresh(cred.id);
    }
    const secret = await this.vault.decrypt(cred.id);
    return { secret, metadata: cred };
  }

  private async resolveApiKey(cred: Credential): Promise<ResolvedCredential> {
    const secret = await this.vault.decrypt(cred.id);
    return { secret, metadata: cred };
  }

  private async resolveCloud(cred: Credential): Promise<ResolvedCredential> {
    // Cloud 场景走 provider API 拿 ephemeral token
    ...
  }
}
```

### Vault 只做存储，不暴露 API

Vault 变成 `CredentialManager` 的内部实现——其他模块不再直接 import `vault.ts`。

```ts
// vault.ts 只 export 内部使用的类
export class Vault {
  // internal methods
}
```

ESLint rule：禁止 `credentials/` 目录之外的代码直接 import `vault.ts`。

### Connector 定义合并

三份 connector 定义文件合并为统一结构：

```ts
// src/main/connectors/definitions/index.ts
export interface ConnectorDefinition {
  id: string;
  label: string;
  authKind: "api_key" | "oauth" | "cloud_hosted";
  enabledModels?: string[];
  // 根据 authKind 分支
  apiKey?: ApiKeyConfig;
  oauth?: OAuthConfig;
  cloud?: CloudConfig;
}
```

所有 connector 在一个地方注册，UI / agent 不再需要判断类型——CredentialManager 和 ConnectorRegistry 各自消费 `authKind`。

### 审计和权限

- 所有 `resolve` 调用记 telemetry：`credential.resolved`（connectorId, caller, timestamp）
- 敏感操作（`rotate` / `revoke`）需要显式 caller 标识
- Log 中**永不**打印 secret（redactor 检查）

## Migration 计划

1. **Phase 1（3 天）**：建 `CredentialManager` 类，内部调用现有 `credentialResolver` / `credentialStore` / `oauthLoginService`（组合层）
2. **Phase 2（1 周）**：所有 call site 改用 `credentialManager.resolve(connectorId)`——grep `credentialResolver` / `vault.decrypt` 的使用处
3. **Phase 3（3 天）**：合并 connector 定义文件到统一结构
4. **Phase 4（2 天）**：加 ESLint rule 禁止直接 import `vault.ts`
5. **Phase 5（持续）**：下次 OAuth refresh token 过期 bug 修复时，在 CredentialManager 层统一处理，不再散修

## 风险与回滚

| 风险 | 触发条件 | 回滚方法 |
|------|---------|---------|
| Secret 解密路径变 | 合并后某些 edge case 路径丢失 | Phase 1-2 保留旧路径，逐步迁移 |
| OAuth refresh 时序 | `resolveOAuth` 的 `REFRESH_BEFORE_MS` 判断不当 | 可配置；保守值开始 |
| Connector 定义合并冲突 | 同一个 connector 在两份定义里有 | 合并时 explicit choose，由 Owner 确认 |
| 审计 log 过大 | 每次 resolve 都记一条 | 加 sample rate 或只记重要 connector |

## 验证标准

1. **静态 scan**：`grep -rn "vault\.decrypt\|vault\.encrypt" src/main/` 除 `credentials/` 内之外应无命中
2. **Typecheck**：全项目通过
3. **Connector UI 一致**：UI 显示的 connector 状态与 `credentialManager.listAvailable()` 一致
4. **OAuth refresh 正确**：模拟 token 过期场景，resolve 自动 refresh
5. **Telemetry**：每次 resolve 可见于 telemetry，无 secret 泄漏到 log

## 不在范围

- **不重写 OAuth flow**：OAuth 登录 UI 和流程保留，只是 resolve 路径改
- **不改 vault 加密算法**：现有 AES-GCM / OS keychain 集成不动
- **不做 multi-user 隔离**：单用户 desktop app，不需要
- **不做凭证同步**（跨设备）：独立 feature
- **不引入密钥管理服务**（HashiCorp Vault / AWS Secrets Manager）

## 参考文件清单

- `src/main/credentials/credential-resolver.ts`
- `src/main/credentials/credential-store.ts`
- `src/main/credentials/oauth-login-service.ts`
- `src/main/credentials/types.ts`
- `src/main/vault.ts`（改为 credentials/ 内部）
- `src/main/connector-definitions-data-apikey.ts`
- `src/main/connector-definitions-data-oauth.ts`
- `src/main/connector-definitions-data-cloud.ts`
- 所有 call site（grep `credentialResolver` / `vault.decrypt` 找到）

## 附：为什么现在修

每多加一个 connector 类型（例如未来支持 JWT / mTLS / device cert），现在的分层结构都要再拆一个文件、再加一条分支逻辑。统一到 CredentialManager 后，新 authKind 只是加一个 case 分支。

**安全角度的刚性需求**：审计和权限一旦变成合规要求（例如要求记录"哪个 agent 用了哪个凭证"），当前散装结构根本没法快速加上。现在改还是 refactor，等到合规逼迫再改就是紧急项目。

## 附：gating matrix

| Gate | 条件 | 放行判断人 |
|------|------|----------|
| G1 | `CredentialManager` 可同时 serve OAuth / API key / Cloud 三类 | Owner |
| G2 | 所有 call site 迁移完，grep `vault\.decrypt` 仅限 `credentials/` 内 | Linus |
| G3 | 三份 connector definition 合并为单一结构 | Owner |
| G4 | 审计 log 记录 7 天无 secret 泄漏 | Security |
| G5 | OAuth refresh 单元测试通过：token 过期 < REFRESH_BEFORE 时自动刷新 | Owner |

## 附：secret 生命周期治理

| 凭证类型 | 创建 | 刷新 | 轮换 | 吊销 | 审计事件 |
|---------|------|------|------|------|---------|
| OAuth | OAuth flow | 自动 (refresh token) | 手动触发 | OAuth revoke endpoint | created/refreshed/revoked |
| API key | 用户粘贴 + vault 加密 | 不适用 | 用户替换 | 用户删除 | created/rotated/revoked |
| Cloud hosted | 登录 | Provider API 换短期 token | Provider 端管理 | Provider 端删除 | created/exchanged/revoked |

CredentialManager 对外 API 不区分这三类——内部根据 `kind` 走对应 provider。

## 附：反模式对比

**Before**：
```ts
// 随便某个 service 里
const secret = await vault.decrypt(connectorId);  // 任何人能调
const token = await oauth.getCurrentToken(connectorId);  // 绕过 vault
```

**After**：
```ts
const { secret, metadata } = await credentialManager.resolve(connectorId);
// 唯一入口；自动 refresh；自动审计；不暴露 vault API
```

## 附：为什么不选其他方案

**方案 A（当前 proposal）**：统一 CredentialManager。

**方案 B（给每种 authKind 独立的 Manager，再加一个 Dispatcher）**：多一层，没增加清晰度。

**方案 C（保留现状，只加 wrapper）**：wrapper 不能阻止旧 call site 继续绕路。

方案 A 是唯一真正统一的方案。
