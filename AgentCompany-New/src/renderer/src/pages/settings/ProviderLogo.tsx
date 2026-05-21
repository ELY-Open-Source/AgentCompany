const PROVIDER_BRAND: Record<string, [string, string]> = {
  "Anthropic": ["#cb9a5b", "A"],
  "OpenAI": ["#0a0a0b", "O"],
  "xAI Grok": ["#0a0a0b", "X"],
  "GitHub Copilot": ["#2da44e", "⌬"],
  "Google Antigravity": ["#3a7bd5", "G"],
  "GPT account": ["#10a37f", "◔"],
  "Azure OpenAI": ["#0078d4", "Az"],
  "AWS Bedrock": ["#e87722", "Bd"],
  "Vertex AI": ["#4285f4", "V"],
  "Groq": ["#f55036", "Q"],
};

export function ProviderLogo({ label, size = 30 }: { label: string; size?: number }) {
  const entry = PROVIDER_BRAND[label] ?? ["#a1a1aa", label.slice(0, 1).toUpperCase()];
  const [background, glyph] = entry;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 7,
        background,
        color: "#fff",
        display: "grid",
        placeItems: "center",
        fontSize: Math.round(size * 0.42),
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {glyph}
    </div>
  );
}
