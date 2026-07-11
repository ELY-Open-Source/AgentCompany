# Provider logos

Official brand marks for the model-provider catalog, bundled at build time so
the app never fetches them at runtime. Source: img.logo.dev (same source and
publishable token as the connectors page), downloaded once per brand.

Refresh a logo (token lives in `src/main/services/composio/connector-brands.ts`):

```
curl -o <provider-key>.png "https://img.logo.dev/<domain>?token=<publishable-token>&size=128&format=png&fallback=404"
```

Domain per file: openai.com, anthropic.com, claude.ai (claude-pro), grok.com
(xai), groq.com, mistral.ai, cerebras.ai, openrouter.ai, moonshot.ai (kimi;
also used for kimi-code — kimi.com is not in logo.dev's index), moonshot.cn
(kimi-cn), github.com (github-copilot), antigravity.google
(google-antigravity), chatgpt.com (gpt-account), azure.microsoft.com
(azure-openai), aws.amazon.com (aws-bedrock), cloud.google.com (vertex-ai).
The custom-openai / custom-anthropic endpoints carry no official brand and
render as letter tiles.
