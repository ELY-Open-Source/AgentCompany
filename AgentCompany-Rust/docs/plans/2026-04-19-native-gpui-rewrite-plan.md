# AgentCompany-Rust Native GPUI Rewrite Plan

Goal: rebuild AgentCompany as a native Rust + GPUI desktop app that preserves the current Electron product surface, UI/UX structure, and core execution semantics while replacing the entire application stack with Rust crates and a typed Pi Mono sidecar boundary.

Architecture: keep the PRD four-layer split intact. UI lives in `crates/app_ui`, page/application state in `crates/app_models`, business entities and rules in `crates/domain`, persistence and sidecar orchestration in `crates/storage`, `crates/runtime`, and `crates/pi_bridge`. Preserve Electron parity by reading the Electron renderer, screenshots, and e2e flows as the truth source for layout and workflow behavior.

Tech Stack: Rust 2024, GPUI, rusqlite, anyhow/thiserror, Pi Mono sidecar over typed JSON RPC, cargo fmt/clippy/test.

---

## Phase 0: Ground truth and guardrails

### Task 0.1: Lock the rewrite truth sources into the repo
Objective: make the migration inputs explicit so implementation never guesses.

Files:
- Create: `docs/reference/electron-parity.md`
- Reference: `PRD.md`, `../README.md`, `../问题.md`, `../screenshots/*`, `../src/renderer/**/*`, `../tests/e2e/desktop.smoke.spec.ts`

Verification:
- Document section-to-section mapping for onboarding, dashboard, communication, approvals, documents, and settings.
- Confirm every item in PRD section 5 and 14 has a Rust destination.

### Task 0.2: Stabilize the Rust baseline
Objective: restore and verify the existing Rust workspace before structural changes.

Files:
- Existing workspace only

Verification commands:
- `cargo fmt --check`
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`
- `cargo test --workspace`

Status at plan creation: complete.

---

## Phase 1: UI shell parity foundation

### Task 1.1: Split the monolithic `app_root.rs`
Objective: move each page renderer into a dedicated module so the UI can grow toward parity without a god file.

Files:
- Modify: `crates/app_ui/src/app_root.rs`
- Create: `crates/app_ui/src/app_root/sidebar.rs`
- Create: `crates/app_ui/src/app_root/overview.rs`
- Create: `crates/app_ui/src/app_root/runs.rs`
- Create: `crates/app_ui/src/app_root/inbox.rs`
- Create: `crates/app_ui/src/app_root/messages.rs`
- Create: `crates/app_ui/src/app_root/approvals.rs`
- Create: `crates/app_ui/src/app_root/documents.rs`
- Create: `crates/app_ui/src/app_root/workspaces.rs`
- Create: `crates/app_ui/src/app_root/settings.rs`
- Create: `crates/app_ui/src/app_root/onboarding.rs`

Verification:
- `cargo fmt --check`
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`
- `cargo test --workspace`

### Task 1.2: Introduce explicit shell/theme tokens
Objective: replace ad-hoc colors and spacing with a tokenized shell that matches the Electron visual hierarchy.

Files:
- Create: `crates/app_ui/src/theme.rs`
- Create: `crates/app_ui/src/shell.rs`
- Modify: `crates/app_ui/src/lib.rs`
- Modify: `crates/app_ui/src/app_root.rs`

Verification:
- main shell matches screenshot structure: left sidebar, top title bar, content canvas, onboarding split screen.
- `cargo fmt --check`
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`
- `cargo test --workspace`

### Task 1.3: Add parity notes per major screen
Objective: each Rust screen states which Electron screen and screenshot it is matching.

Files:
- Create: `docs/reference/dashboard-parity.md`
- Create: `docs/reference/onboarding-parity.md`
- Create: `docs/reference/communication-parity.md`
- Create: `docs/reference/approvals-parity.md`

Verification:
- Each note names source files and screenshots.

---

## Phase 2: Data model and storage completion

### Task 2.1: Extend domain IDs and typed entities
Objective: replace stringly-typed cross-domain references with PRD-aligned newtypes and explicit enums.

Files:
- Modify: `crates/domain/src/lib.rs`
- Modify: `crates/domain/src/models.rs`
- Modify: `crates/domain/src/enums.rs`
- Create as needed under `crates/domain/src/`

Verification:
- repository and runtime APIs accept semantic IDs instead of free-form strings where feasible.
- `cargo test --workspace`

### Task 2.2: Expand SQLite schema toward PRD entities
Objective: support thread state, artifacts, workspace lease state, audit events, and richer approvals.

Files:
- Modify: `crates/storage/src/schema.rs`
- Modify: `crates/storage/src/store.rs`
- Create: `migrations/*` when schema versioning is introduced
- Create tests under `crates/storage/tests/`

Verification:
- migration tests cover schema bootstrap and round-trip persistence for company, run, approval, message, document, workspace, and artifact slices.

---

## Phase 3: Runtime contract completion

### Task 3.1: Expand Pi bridge protocol to PRD contract
Objective: cover handshake, run lifecycle, tool lifecycle, approvals, steer, follow-up, and compaction events.

Files:
- Modify: `crates/pi_bridge/src/protocol.rs`
- Modify: `crates/pi_bridge/src/client.rs`
- Modify: `crates/runtime/src/service.rs`
- Modify: `crates/runtime/tests/sidecar_contract.rs`

Verification:
- sidecar contract tests assert handshake, start run, tool approval, steer, follow-up, and run finished flow.

### Task 3.2: Add runtime projection into storage/app state
Objective: runtime events must land in durable state and visible UI state.

Files:
- Modify: `crates/runtime/src/lib.rs`
- Modify: `crates/storage/src/store.rs`
- Modify: `crates/app_models/src/state.rs`
- Add tests where needed

Verification:
- a synthetic runtime event sequence updates run status, approvals, messages, and artifacts in one end-to-end test.

---

## Phase 4: Vertical workflow parity

### Task 4.1: Onboarding parity
Objective: reproduce the Electron onboarding flow, step structure, and persistence semantics.

### Task 4.2: Dashboard parity
Objective: reproduce metrics, active work, and recent activity layout.

### Task 4.3: Communication parity
Objective: reproduce three-column message layout, message detail, and composer flow.

### Task 4.4: Approval parity
Objective: reproduce approval queue/detail/actions and connect decisions to runtime.

### Task 4.5: Documents/workspaces parity
Objective: reproduce document center and workspace/artifact visibility.

Verification for each task:
- UI-visible proof in Rust layout
- persisted state proof in SQLite
- runtime behavior proof where applicable
- automated test proof

---

## Phase 5: End-to-end verification

### Task 5.1: Native smoke harness
Objective: add a Rust-native smoke path that boots the app against a temp profile and exercises the primary first-run flow.

Files:
- Create: `crates/app/tests/native_smoke.rs` or equivalent supported harness
- Add any test support modules needed under `crates/app/tests/`

Verification:
- first-run onboarding bootstrap is exercised against a temp profile
- smoke test is part of `cargo test --workspace`

### Task 5.2: Runtime + storage end-to-end flow
Objective: one test drives onboarding bootstrap, run creation, tool approval, message writeback, and artifact registration through Rust crates.

Files:
- Create: `crates/runtime/tests/runtime_storage_e2e.rs`
- Modify storage/runtime code as needed

Verification:
- `cargo test --workspace runtime_storage_e2e -- --nocapture`

---

## Phase 6: Hardening and release readiness

### Task 6.1: Cross-platform shell and path abstraction
### Task 6.2: crash recovery and session restore
### Task 6.3: packaging/release pipeline

Verification baseline:
- `cargo fmt --check`
- `cargo clippy --workspace --all-targets --all-features -- -D warnings`
- `cargo test --workspace`

---

Execution rule: every completed slice must leave the workspace green and in a committable state before the next slice starts.
