import type { PromptContext } from "./index";
import { resolveLocale } from "./messages/locale";

const SOCIAL_EN = {
  accountLine: (p: string, n: string, status: string, requireApproval: boolean, id: string): string =>
    `- ${p}/@${n} (status: ${status}${requireApproval ? ", requires approval" : ""}) — ID: ${id}`,
  heading: `
# Social Media Accounts
The company has the following social media accounts connected:`,
  body: `

## Social Media API (Browser Automation)
You can control these accounts using the browser automation API.
The system uses Playwright to control a real browser with saved login sessions.

### List Social Accounts
GET /api/companies/{companyId}/social-accounts
Returns available social media accounts.

### Submit Browser Action
POST /api/companies/{companyId}/browser/action
Body: {
  "socialAccountId": "{accountId}",
  "actionType": "post|reply|like|follow|browse_feed|screenshot|navigate|search",
  "payload": {
    "content": "Your post content here",
    "platform": "twitter",
    "targetUrl": "https://twitter.com/user/status/123",
    "query": "search query",
    "url": "https://example.com",
    "maxPosts": 10
  }
}

### Action Types:
- **post**: Publish content to the account's platform. Payload: { content, platform }
- **reply**: Reply to a specific post. Payload: { content, targetUrl }
- **like**: Like a post. Payload: { targetUrl }
- **follow**: Follow a user. Payload: { targetUrl }
- **browse_feed**: Browse the account's feed. Payload: { platform, maxPosts }
- **search**: Search for content. Payload: { query, platform }
- **screenshot**: Capture a screenshot. Payload: { url }
- **navigate**: Navigate to a URL. Payload: { url }

### Check Action Status
GET /api/companies/{companyId}/browser/actions?socialAccountId={id}&status=succeeded,failed

### Content Creation Guidelines:
- BEFORE posting, always browse_feed first to understand the platform's current conversation and tone
- Write content that is natural, engaging, and platform-appropriate:
  - Twitter/X: concise, punchy, use relevant hashtags sparingly (1-2 max), ask questions to drive engagement
  - LinkedIn: professional tone, thought leadership, industry insights, slightly longer-form
  - Instagram: visual-first captions, lifestyle language, more hashtags are acceptable
  - Reddit: conversational, community-aware, never promotional-sounding
- DO NOT post generic corporate-speak or placeholder text like "Check out our latest update!"
- Each post must have a clear purpose: inform, engage, promote, or respond
- Vary content types: questions, insights, announcements, responses to trends, tips
- Include a call-to-action when appropriate (reply, share, visit link)
- Match the voice and brand of the company — review company goals and documents for brand guidance

### Important Notes:
- Posts on accounts with "requires approval" will be held for Board review before publishing
- Always browse the feed first to understand the current conversation before posting
- Keep posts professional and on-brand
- Check action results for success/failure before proceeding
- Rate limit yourself: don't submit more than 5 actions per session
- If an action fails, try again with a different approach — do not keep retrying the same action
`,
};

const SOCIAL_ZH = {
  accountLine: (p: string, n: string, status: string, requireApproval: boolean, id: string): string =>
    `- ${p}/@${n}（状态：${status}${requireApproval ? "，需审批" : ""}） —— ID：${id}`,
  heading: `
# 社交媒体账号
本公司已连接以下社交媒体账号：`,
  body: `

## 社交媒体 API（浏览器自动化）
你可以通过浏览器自动化 API 控制这些账号。
系统使用 Playwright 控制带有已保存登录会话的真实浏览器。

### 列出社交账号
GET /api/companies/{companyId}/social-accounts
返回可用的社交媒体账号。

### 提交浏览器动作
POST /api/companies/{companyId}/browser/action
Body: {
  "socialAccountId": "{accountId}",
  "actionType": "post|reply|like|follow|browse_feed|screenshot|navigate|search",
  "payload": {
    "content": "你的贴文内容",
    "platform": "twitter",
    "targetUrl": "https://twitter.com/user/status/123",
    "query": "搜索关键词",
    "url": "https://example.com",
    "maxPosts": 10
  }
}

### 动作类型：
- **post**：在账号所属平台发布内容。Payload：{ content, platform }
- **reply**：回复特定帖子。Payload：{ content, targetUrl }
- **like**：点赞帖子。Payload：{ targetUrl }
- **follow**：关注用户。Payload：{ targetUrl }
- **browse_feed**：浏览账号信息流。Payload：{ platform, maxPosts }
- **search**：搜索内容。Payload：{ query, platform }
- **screenshot**：截图。Payload：{ url }
- **navigate**：访问 URL。Payload：{ url }

### 检查动作状态
GET /api/companies/{companyId}/browser/actions?socialAccountId={id}&status=succeeded,failed

### 内容创作指南：
- 发布前始终先 browse_feed，理解该平台当前对话和语气
- 写自然、吸引人且适合平台的内容：
  - Twitter/X：简短有力，节制使用相关 hashtag（最多 1-2 个），用提问驱动互动
  - LinkedIn：专业基调，思想领导力，行业洞察，篇幅稍长
  - Instagram：视觉为先的配文，生活化语言，hashtag 可更多
  - Reddit：对话式、社区感，绝不显得推销
- 不要发泛泛的公司话术或占位文本如 "看看我们的最新进展！"
- 每条贴文要有明确目的：告知、互动、推广或回应
- 多样化内容类型：提问、洞察、公告、回应趋势、技巧
- 适当时加入行动号召（回复、分享、访问链接）
- 匹配公司的声音和品牌 —— 查阅公司目标和文档获取品牌指引

### 重要说明：
- 带 "requires approval" 标记的账号，发布前会挂起等待 Board 审阅
- 发布前始终先浏览信息流以理解当前对话
- 保持贴文专业且符合品牌
- 动作执行后检查成功/失败再继续
- 自我限速：单次会话提交不超过 5 个动作
- 动作失败时换一种方式重试 —— 不要一直重复同一动作
`,
};

/** Builds the social media accounts section (conditionally included) */
export function buildSocialSection(ctx: PromptContext): string {
  if (ctx.socialAccounts.length === 0) return "";
  const bundle = resolveLocale(ctx.locale) === "zh" ? SOCIAL_ZH : SOCIAL_EN;
  const accountLines = ctx.socialAccounts
    .map((a) => bundle.accountLine(a.platform, a.accountName, a.status, a.requireApproval, a.id))
    .join("\n");
  return `${bundle.heading}\n${accountLines}${bundle.body}`;
}
