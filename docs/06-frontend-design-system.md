# Frontend Design System

## Product Tone

- Audience: technical operators running multiple AI agents simultaneously
- Interaction style: dense, precise, keyboard-first
- Motion style: restrained, purposeful, confidence-building
- Visual identity: warm, approachable workspace — Linear meets Raycast, not a neon cyber UI

## Typography

- Body/UI family: system stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`)
- Monospace family: JetBrains Mono Variable (`font-family: "JetBrains Mono Variable", monospace`)
- Scale:
  - Page titles: 31px, -0.03em tracking
  - Section headings: 18px semibold, -0.01em
  - Body/labels: 14px
  - Compact UI (sidebar, pills, badges): 13px, 0.005em tracking
  - Captions/meta: 12px
  - Micro labels (status pills, section headers): 10-11px uppercase, 0.08-0.12em tracking
  - Monospace (logs, IDs, timestamps): JetBrains Mono, 11-12px

## Color Tokens

### Light mode (`:root` default)

| Token | Value | Purpose |
|---|---|---|
| `--bg` | `#fbfbfb` | App background |
| `--panel` | `#ffffff` | Card/sidebar surfaces |
| `--panel-soft` | `#f4f5f5` | Active/hover states |
| `--text` | `#1a202c` | Primary text |
| `--muted` | `#718096` | Secondary/caption text |
| `--muted-strong` | `#4a5568` | Emphasized secondary text |
| `--accent` | `#c06a3a` | Warm terracotta — primary action color (~4.6:1 on white) |
| `--accent-soft` | `#f7ece6` | Accent background tint |
| `--danger` | `#e5484d` | Errors, destructive actions |
| `--warn` | `#b7791f` | Warnings, budget alerts |
| `--success` | `#2f855a` | Positive states, healthy budgets |
| `--success-soft` | `#edf7f0` | Success background tint |
| `--line` | `rgba(15,23,42,0.08)` | Subtle borders |
| `--line-strong` | `rgba(15,23,42,0.14)` | Emphasized borders |

### Dark mode (`[data-theme="dark"]` and `prefers-color-scheme: dark` when `data-theme="system"`)

| Token | Value |
|---|---|
| `--bg` | `#111315` |
| `--panel` | `#1b1f23` |
| `--panel-soft` | `#232931` |
| `--text` | `#f4f7fb` |
| `--muted` | `#9aa7b5` |
| `--accent` | `#ee8a58` |
| `--accent-soft` | `rgba(238,138,88,0.14)` |

Dark mode is fully implemented via `data-theme` attribute on `:root`, with a `prefers-color-scheme` media query for the `"system"` setting.

## Accent Color

The warm terracotta accent (`#c06a3a` light / `#ee8a58` dark) is the signature color. Use it only for:
- Active navigation items (icon fill + label)
- Primary action buttons
- Focus rings

Everything else is greyscale. Overuse dilutes the signal.

## Focus Ring

```css
.focus-ring:focus-visible {
  box-shadow: 0 0 0 1px rgba(192,106,58,0.5), 0 0 0 4px rgba(192,106,58,0.12);
  border-color: rgba(192,106,58,0.35);
}
```

## Layout Model

- Left sidebar: 220px fixed, keyboard-navigable
- Main content: max-width 1040px centered, 40px horizontal / 32px vertical padding
- Section spacing: 56px between major sections

## Spacing & Radius

- Interactive controls: 6-8px border radius
- Cards/panels: 10px border radius
- Dividers: 1px `var(--line)` borders, no heavy card shadows

## Animation

All transitions use `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-expo feel).

| Context | Duration |
|---|---|
| Hover/focus | 150ms (`duration-150`) |
| Page transitions | 240ms, y-axis slide (12px in, -10px out) |
| Panel reveals | 220ms, height or y-axis |

Respect `prefers-reduced-motion` globally — durations collapse to `0.01ms` when set.

## Icon System

Phosphor Icons (`@phosphor-icons/react`), weight `regular` by default, `fill` for active/selected states. Standard size 16-18px. Active sidebar icons use `--accent` color.

## Design Principles

1. **Hierarchy before density** — Typography, spacing, and color create visual hierarchy; never rely on borders alone.
2. **Quiet until needed** — Default state is calm and minimal. Warnings and errors earn their visual weight through color and placement.
3. **One accent, used with intent** — Terracotta is reserved for active navigation, primary actions, and focus states.
4. **Native-feeling, not native-copying** — macOS-aware (drag regions, traffic lights) but not AppKit imitation.
5. **Content over chrome** — The user's agents, tasks, and runs are the content. Minimize decorative scaffolding.

## Required Screens

Overview · Connectors · Agents · Tasks · Task Detail · Approvals · Costs · Activity · Workspaces · Settings · Onboarding

## Desktop-Specific Behaviors

- `Cmd` (macOS) / `Ctrl` (Windows/Linux) for search, command palette, save, refresh
- Context menus on list rows and workspace rows
- Drag/drop for workspace import and artifact attachment
- Reveal in Finder/Explorer for logs and artifacts
