# Phase 5 — Design System & Desktop Flows

> Visual + interaction system for the rebuild. Anchors: desktop-native, two-mode (AI CEO / AI Co-Founder), thread-runtime first, knowledge-backed. No web-dashboard-in-a-shell affordances.

---

## 1. Design intent

A control-plane for an autonomous company. Calm. Information-dense. Keyboard-first. Pause moments are intentional — when AI Co-Founder mode pauses for review, the UI **feels** like a checkpoint, not a delay.

The aesthetic baseline already lives in `landing/` and `screenshots/Dashboard.jpeg`: dusty navy (`#4a5d7a`), graphite text, off-white surfaces, restrained accent. We keep that palette and tighten the IA.

## 2. Information architecture

### 2.1 Top-level navigation (left rail)

```
┌─────────────────────────────────────┐
│ ⌂  Dashboard                        │
│ 📥 Inbox      ⓘ <wait-on-you count>│
│ 🧵 Threads                          │
│ ✓  Tasks & Approvals                │
│ 💼 Workspaces                       │
│ 📚 Knowledge                        │
│ ──                                  │
│ ⚙  Settings                          │
│ 📊 Diagnostics                      │
└─────────────────────────────────────┘
```

Sidebar collapses to icons at < 1100 px. Active item shows a subtle vertical accent bar.

### 2.2 Top bar

Per company: company picker · execution-mode pill (AI CEO / AI Co-Founder) · provider chip with active connector + cost-this-month · search · profile.

The mode pill is interactive: clicking opens a small panel explaining the difference, with a switch.

### 2.3 Onboarding (first run)

Welcome opens the flow. The setup panel then runs 7 sections:

1. **Requirements** — checks Node.js because CLI runtimes call the local API through `node -e`.
2. **Providers** — connects at least one runtime.
3. **Company** — captures company name, description, and workspace.
4. **Team Models** — enables the models available to the CEO and workers.
5. **Mode** — defaults to `ai_ceo`; `ai_cofounder` keeps key decisions human-reviewed.
6. **Mission** — captures the first goal and acceptance description.
7. **Launch** — creates the company, CEO agent, workspace, kickoff task, and initial run handoff.

The user lands in Control Center after launch.

### 2.4 Dashboard

Top: 4 KPI tiles (Active agents, Tasks in review, Spend month-to-date, Waiting-on-you).
Below: 3 columns —
- "What's happening now" (live runs with brief status)
- "Decisions waiting for you" (approval queue mirrors Inbox)
- "Recent deliverables" (documents/work-products with reviewer)

Empty states explain what each panel will hold once activity begins.

### 2.5 Inbox

A single ordered feed of `inbox_items`:

| Type | Source | Action |
|---|---|---|
| Wait-on-you (approval) | `thread_wait_states` `waiting_for='human'` + linked approval | Approve / Deny inline |
| @mention | `agent_messages.body` mention scan | Reply |
| Subscribed thread update | `thread_subscriptions` + `conversation_events` | Open |
| Deliverable for review | `tasks.requires_user_review` true | Open task |

Counts shown in sidebar mirror the unread/wait totals.

### 2.6 Threads

A two-pane view: left = thread list (filter: All / Subscribed / Wait / Recent); right = thread transcript with composer.

Transcript items: agent messages, tool executions (collapsible), tool results (collapsible), human posts, wait-state markers ("Waiting on @you to approve `bash` call …").

Composer: posts a `user` message into the active thread → triggers `wakeup_request` for the assigned agent.

### 2.7 Tasks & Approvals

Existing task/approval surfaces preserved; added:

- "Pending tool approvals" section grouped by run (each item shows tool, args summary, "Approve in thread" deep link).

### 2.8 Workspaces

Existing surface preserved. Adds workspace lock indicator and a "Reveal in Finder/Explorer/Files" button (uses `openPath`).

### 2.9 Knowledge

Existing surface preserved. Adds "Inject into agent" affordance — moves a knowledge entry into the prompt-builder context for the next run.

### 2.10 Settings

Sub-pages:

```
Settings
  • Profile
  • Providers          ← new (the key addition)
  • Execution defaults (mode default, thinking level, retry counts)
  • Budgets
  • Workspaces
  • Skills
  • Updates
  • Advanced (logs path, profile dir, vault info)
```

### 2.11 Diagnostics

Read-only:
- Recent runs with status colours
- Recent IPC errors
- Vault backend label (e.g. "macOS Keychain" or "encrypted file")
- Current pi-mono package versions
- Open log directory button

## 3. Settings → Providers panel (the central new surface)

### 3.1 Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ Providers                                                            │
│  Search [             ]      View: [Configured ▾]   [+ Add provider]│
│                                                                      │
│ ── Configured (4) ──────────────────────────────────────────────── │
│   ● Claude Pro/Max     OAuth · claude.pro@gmail.com   [Re-login][⋯] │
│   ● Anthropic API      Key  · sk-ant-…abcd            [Edit]   [⋯] │
│   ● AWS Bedrock        AWS  · profile=prod  region=us-east-1 [Edit] │
│   ! Gemini CLI         OAuth · refresh failed         [Re-login]    │
│                                                                      │
│ ── Available (21) ─────────────────────────────────────────────── │
│   ○ ChatGPT Plus/Pro (Codex)   OAuth      [Login]                   │
│   ○ GitHub Copilot              OAuth      [Login]                   │
│   ○ Antigravity                 OAuth      [Login]                   │
│   ○ OpenAI API                  Key        [Add]                     │
│   …                                                                  │
└──────────────────────────────────────────────────────────────────────┘
```

Status dot colours:
- `●` green — `active`
- `◐` amber — `expired` (refresh failed)
- `!` red — `error`
- `○` neutral — `not configured`

### 3.2 Forms

Five hand-written forms (no universal generator):

1. **OAuthRow** — "Login" button, optional GHE domain prompt for GitHub Copilot (renders `OAuthPromptDialog`), shows progress (`onProgress` messages) inline as a tiny status line.
2. **ApiKeyForm** — single password input (masked) + "Reveal" toggle + dropdown "Source: Inline value | Env var name". Save button.
3. **AzureForm** — fields: `baseUrl`, `resourceName`, `apiVersion`, `deploymentMap` (key/value editor), `apiKey`. Save button.
4. **AwsForm** — radio: "AWS profile" / "IAM keys" / "Bearer token", each revealing fields. Region (default `us-east-1`). Advanced toggles for `forceCache`, `endpointUrl`, `skipAuth`, `forceHttp1`.
5. **VertexForm** — fields: `project`, `location`, `credentialsPath` (file picker, optional), "Use ADC" checkbox.

Each form has a "Test connection" button that performs `streamSimple(... { maxTokens: 1 })` against the connector's default model with a 1-character prompt. Outcome: ✅ "OK — used $0.0001" / ❌ "<error message>".

### 3.3 OAuthPromptDialog

Modal triggered by `oauth:prompt-request` (e.g. GHE domain) and `oauth:manual-code-request` (fallback when callback server is blocked):

```
┌─────────────────────────────────────┐
│ GitHub Copilot                       │
│                                      │
│ Enter your GitHub Enterprise domain. │
│ Leave blank for github.com.          │
│                                      │
│ [github.com_______________________]  │
│                                      │
│        [Cancel]   [Submit →]         │
└─────────────────────────────────────┘
```

## 4. Mode UX

Mode pill in top bar:

- **AI CEO** — solid green pill. Tooltip: "Tools execute without review. Approvals only for explicit policy gates."
- **AI Co-Founder** — outlined navy pill. Tooltip: "Agents pause at write-side tools (bash, edit, write). You approve in Inbox."

Switching modes is per-company. The switch action writes `companies.execution_mode` and a confirmation toast.

### Pause state in a thread

When a run pauses at `beforeToolCall`, the thread shows:

```
┌───────────────────────────────────────────┐
│ ⟳ engineer-01 wants to run                │
│                                           │
│ [bash]  npm install                       │
│         in workspaces/web-frontend        │
│                                           │
│ [Approve]   [Deny]   [Approve & don't ask]│
└───────────────────────────────────────────┘
```

"Approve & don't ask" sets a per-task auto-approval for the same tool with the same arg shape (writes `agent_permissions.permissions_json`).

## 5. Visual system

### 5.1 Tokens (Tailwind config)

```
colors:
  navy.700  #2c3a4f
  navy.600  #4a5d7a   ← brand accent
  navy.500  #6f8198
  graphite  #1f1f23   ← primary text
  ash       #56575a   ← secondary text
  fog       #efeff1   ← surface alt
  paper     #f8f8f9   ← surface
  accent    #c98c5a   ← warm accent (warnings, awaiting human)
  ok        #4a8d6f
  warn      #c79a45
  err       #b75252

font:
  sans      Inter, ui-sans-serif
  mono      "JetBrains Mono", ui-monospace

radius:
  sm 4px / md 8px / lg 12px

shadow:
  card  0 1px 2px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)
```

Dark mode: invert paper/fog/graphite axis; navy.600 preserved as accent.

### 5.2 Spacing scale

`4 / 8 / 12 / 16 / 24 / 32 / 48 / 64` px. No off-grid spacing.

### 5.3 Components reused

`src/renderer/components/ui/` already exposes primitives, layout, feedback, hooks. We extend it (no rewrite) with:

- `<StatusDot status="active|expired|error|none" />`
- `<MaskedSecret value="sk-ant-…" />`
- `<KeyValueEditor />` (Azure deployment map, custom env)
- `<ModePill mode="ai_ceo" | "ai_co_founder" interactive />`
- `<WaitMarker reason="awaiting human" tool="bash" />`

### 5.4 Density + responsive

- Default density: comfortable. Toggle to compact in Settings → Profile.
- Window min size: `1024 × 720`. Sidebar collapses < 1100. Right panels collapse < 1280.
- Drag-and-drop affordances:
  - Knowledge entries → agent context (drag onto agent card).
  - Files into Workspaces (already supported by underlying tooling; UI affordance added).

### 5.5 Keyboard

| Shortcut | Action |
|---|---|
| `⌘/Ctrl + K` | Quick open (companies, threads, tasks) |
| `⌘/Ctrl + 1..9` | Switch sidebar item |
| `⌘/Ctrl + Enter` | Submit composer / Approve highlighted item |
| `Esc` | Close dialogs |
| `?` | Show shortcuts overlay |

## 6. Empty + loading + error states (mandatory per screen)

Every new screen ships:

- Empty illustration + 1-line explanation + 1-CTA.
- Loading: skeleton blocks (no spinners except > 2 s).
- Error: a `<FailureCard>` with an action button (retry / open logs).

No placeholder copy. No "Coming soon" text on any provider — every provider has either an active form or an inactive form with a clear "Configure" path.

## 7. Microcopy rules

- Lead with verbs ("Approve", "Deny", "Re-login").
- Status text uses past tense ("Refreshed 2 min ago").
- Cost expressed as `$0.012` (3 decimals when < $1, otherwise 2).
- Token counts use grouping `12,345`.
- Times use locale-aware format with absolute hover tooltip.

## 8. Thread runtime UX bindings

| Renderer concept | Binding |
|---|---|
| "Wait card" in thread | `thread_wait_states` row resolved == null |
| "Read receipt" | (not in this rebuild) |
| "Subscribed" badge | `thread_subscriptions` row exists |
| "Mention" highlight | `agent_messages.body` mentions parsed at render time (existing helper) |
| "Inject knowledge" | calls `agentCompany.addThreadEvent` with `event_type: 'knowledge_injection'`, then `wakeup_request` |

## 9. Onboarding mode-explainer copy

```
AI CEO
The CEO agent runs without pausing. Tools execute autonomously.
Best for: research sprints, content batches, long-running automation.

AI Co-Founder
The CEO agent pauses before any tool that writes to your filesystem,
modifies code, or runs a shell command. You approve in your Inbox.
Best for: code in your real workspaces, anything you'd want to review first.

You can switch any company between modes from the top bar.
```

## 10. Done criteria for Phase 5

- Every screen is named.
- Every form is a dedicated component.
- Every state (empty/loading/error) has a rule.
- Every status surface has a token.
- The Providers panel is fully specified per the contract.
- The mode UX is concrete, not aspirational.
