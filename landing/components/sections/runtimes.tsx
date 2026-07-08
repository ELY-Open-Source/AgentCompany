import { Container } from "../ui/container";
import { Reveal } from "../ui/reveal";

const runtimes = [
  { name: "Claude Code", provider: "Anthropic" },
  { name: "Codex CLI", provider: "OpenAI" },
  { name: "Gemini CLI", provider: "Google" },
  { name: "Kimi", provider: "Moonshot AI" },
  { name: "GLM", provider: "Zhipu AI" },
  { name: "MiniMax", provider: "MiniMax" },
  { name: "Ollama", provider: "Local" },
  { name: "Anthropic-compatible API", provider: "Any provider" },
];

export function Runtimes() {
  return (
    <section className="border-y border-[var(--border)]">
      <Container className="py-12 md:py-16">
        <Reveal>
          <p className="eyebrow text-center text-sm text-[var(--muted)]">Supported runtimes</p>
          <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-4 md:gap-x-10 lg:gap-x-12">
            {runtimes.map((runtime) => (
              <li key={runtime.name} className="flex items-baseline gap-2">
                <span className="text-base font-medium tracking-tight text-[var(--text)]">{runtime.name}</span>
                <span className="hidden text-sm text-[var(--muted)] sm:inline">{runtime.provider}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </Container>
    </section>
  );
}
