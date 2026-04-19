#[derive(Clone, Copy, Debug)]
pub struct ConnectorSeed {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
}

pub const CONNECTOR_SEEDS: &[ConnectorSeed] = &[
    ConnectorSeed {
        id: "claude-pro",
        label: "Claude Pro",
        description: "Anthropic OAuth session for Claude Pro.",
    },
    ConnectorSeed {
        id: "openai-codex",
        label: "OpenAI Codex",
        description: "OpenAI OAuth session for Codex desktop flows.",
    },
    ConnectorSeed {
        id: "github-copilot",
        label: "GitHub Copilot",
        description: "GitHub Copilot OAuth session.",
    },
    ConnectorSeed {
        id: "gemini-cli",
        label: "Gemini CLI",
        description: "Google Gemini CLI OAuth session.",
    },
    ConnectorSeed {
        id: "antigravity",
        label: "Antigravity",
        description: "Google Antigravity OAuth session.",
    },
    ConnectorSeed {
        id: "anthropic",
        label: "Anthropic",
        description: "Anthropic API key connector.",
    },
    ConnectorSeed {
        id: "openai",
        label: "OpenAI",
        description: "OpenAI API key connector.",
    },
    ConnectorSeed {
        id: "google",
        label: "Google",
        description: "Google AI Studio API key connector.",
    },
    ConnectorSeed {
        id: "mistral",
        label: "Mistral",
        description: "Mistral API key connector.",
    },
    ConnectorSeed {
        id: "groq",
        label: "Groq",
        description: "Groq API key connector.",
    },
    ConnectorSeed {
        id: "cerebras",
        label: "Cerebras",
        description: "Cerebras API key connector.",
    },
    ConnectorSeed {
        id: "xai",
        label: "xAI",
        description: "xAI API key connector.",
    },
    ConnectorSeed {
        id: "openrouter",
        label: "OpenRouter",
        description: "OpenRouter API key connector.",
    },
    ConnectorSeed {
        id: "vercel-ai-gateway",
        label: "Vercel AI Gateway",
        description: "Vercel AI Gateway API key connector.",
    },
    ConnectorSeed {
        id: "zai",
        label: "Z AI",
        description: "Z AI API key connector.",
    },
    ConnectorSeed {
        id: "opencode",
        label: "OpenCode",
        description: "OpenCode API key connector.",
    },
    ConnectorSeed {
        id: "opencode-go",
        label: "OpenCode Go",
        description: "OpenCode Go API key connector.",
    },
    ConnectorSeed {
        id: "huggingface",
        label: "Hugging Face",
        description: "Hugging Face API key connector.",
    },
    ConnectorSeed {
        id: "kimi-coding",
        label: "Kimi Coding",
        description: "Kimi Coding API key connector.",
    },
    ConnectorSeed {
        id: "minimax",
        label: "MiniMax",
        description: "MiniMax global API connector.",
    },
    ConnectorSeed {
        id: "minimax-cn",
        label: "MiniMax CN",
        description: "MiniMax China API connector.",
    },
    ConnectorSeed {
        id: "fireworks",
        label: "Fireworks",
        description: "Fireworks API key connector.",
    },
    ConnectorSeed {
        id: "fireworks-firepass",
        label: "Fireworks Firepass",
        description: "Fireworks Firepass API key connector.",
    },
    ConnectorSeed {
        id: "amazon-bedrock",
        label: "Amazon Bedrock",
        description: "AWS Bedrock cloud connector.",
    },
    ConnectorSeed {
        id: "azure-openai",
        label: "Azure OpenAI",
        description: "Azure OpenAI cloud connector.",
    },
    ConnectorSeed {
        id: "google-vertex",
        label: "Google Vertex",
        description: "Google Vertex AI cloud connector.",
    },
];
