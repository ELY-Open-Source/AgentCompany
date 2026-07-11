import openaiLogo from "../assets/provider-logos/openai.png";
import anthropicLogo from "../assets/provider-logos/anthropic.png";
import claudeProLogo from "../assets/provider-logos/claude-pro.png";
import xaiLogo from "../assets/provider-logos/xai.png";
import groqLogo from "../assets/provider-logos/groq.png";
import mistralLogo from "../assets/provider-logos/mistral.png";
import cerebrasLogo from "../assets/provider-logos/cerebras.png";
import openrouterLogo from "../assets/provider-logos/openrouter.png";
import kimiLogo from "../assets/provider-logos/kimi.png";
import kimiCnLogo from "../assets/provider-logos/kimi-cn.png";
import githubCopilotLogo from "../assets/provider-logos/github-copilot.png";
import googleAntigravityLogo from "../assets/provider-logos/google-antigravity.png";
import gptAccountLogo from "../assets/provider-logos/gpt-account.png";
import azureOpenAiLogo from "../assets/provider-logos/azure-openai.png";
import awsBedrockLogo from "../assets/provider-logos/aws-bedrock.png";
import vertexAiLogo from "../assets/provider-logos/vertex-ai.png";

/**
 * Official provider marks bundled at build time (assets/provider-logos —
 * downloaded once from img.logo.dev, see the README there). Catalog keys
 * without an official brand (the custom endpoints) fall back to a letter
 * tile. The white tile behind the image keeps transparent marks legible on
 * the dark theme; full-bleed logos cover it entirely.
 */
const PROVIDER_LOGOS: Record<string, string> = {
  openai: openaiLogo,
  anthropic: anthropicLogo,
  "claude-pro": claudeProLogo,
  xai: xaiLogo,
  groq: groqLogo,
  mistral: mistralLogo,
  cerebras: cerebrasLogo,
  openrouter: openrouterLogo,
  kimi: kimiLogo,
  "kimi-cn": kimiCnLogo,
  "kimi-code": kimiLogo,
  "github-copilot": githubCopilotLogo,
  "google-antigravity": googleAntigravityLogo,
  "gpt-account": gptAccountLogo,
  "azure-openai": azureOpenAiLogo,
  "aws-bedrock": awsBedrockLogo,
  "vertex-ai": vertexAiLogo,
};

export function ProviderLogo({ providerKey, label, size = 30 }: { providerKey: string; label: string; size?: number }) {
  const logo = PROVIDER_LOGOS[providerKey];
  if (logo) {
    return (
      <img
        src={logo}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: 7, objectFit: "cover", background: "#fff", flexShrink: 0 }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 7,
        background: "#a1a1aa",
        color: "#fff",
        display: "grid",
        placeItems: "center",
        fontSize: Math.round(size * 0.42),
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {label.slice(0, 1).toUpperCase()}
    </div>
  );
}
