import type { PromptContext } from "./index";

/** Builds the social media accounts section (conditionally included) */
export function buildSocialSection(ctx: PromptContext): string {
  if (ctx.socialAccounts.length === 0) return "";

  const accountLines = ctx.socialAccounts.map(a =>
    `- ${a.platform}/@${a.accountName} (status: ${a.status}${a.requireApproval ? ", requires approval" : ""}) — ID: ${a.id}`
  );

  return `
# Social Media Accounts
The company has the following social media accounts connected:
${accountLines.join("\n")}

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
`;
}
