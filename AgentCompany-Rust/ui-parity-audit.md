# Native UI Parity Audit

Status: current-directory remediation pass completed
Scope: only files inside the current Rust workspace directory were modified during this remediation phase.
Rule: preserve business logic and runtime/data wiring while restoring original Electron page grammar as closely as possible from current-directory UI code only.

## Completed current-directory parity remediations

### Settings
Status: remediated
- Native settings now use top-row tabs with active underline.
- A single active content panel renders below the tab strip.
- The off-source left sidebar shell was removed.

### Onboarding
Status: remediated
- Native onboarding now has a dedicated welcome screen.
- Post-welcome flow uses left hero + fixed right step panel topology.
- Step tabs and back/continue flow were restored to source-like wizard grammar.

### Dashboard / Overview
Status: remediated
- Section order now matches the source flow more closely:
  1. Recovery banner
  2. Budget banner
  3. Metrics
  4. Performance
  5. Budget utilization
  6. Needs attention
  7. Active work
  8. Recent activity
- Metric cards and attention rows route into their target sections.
- Active work exposes an All runs affordance.

### Runs
Status: remediated
- Native runs now follow a dedicated Run Queue + Run Detail shell.
- Runtime events, artifacts, and operator actions remain available but are secondary panels below the primary detail hierarchy.
- Queue filtering/search/list selection remain real native interactions.

### Approvals
Status: remediated
- Top review area now uses grouped review-list grammar closer to PendingReviewList instead of custom parallel cards.
- Pending approval list/detail remain wired to real approve/reject state transitions.

### Documents
Status: remediated
- Document Center now uses a source-like shell with section header, prose list, work-product list, and dedicated editor/inspector column.
- Existing native save-draft path remains intact.

### Inbox / Messages
Status: remediated
- Inbox now uses a tighter source-like attention-list shell.
- Messages now remove off-source chrome and keep a direct communication shell: channel rail, thread header, stream, composer, inspector.

## Remaining known limits

These are current-directory-only limits, not parent-repo edits:
- Native GPUI widgets are not a literal copy of the Electron React component library, so some visual micro-details still differ at the component-skin level.
- Some source components depend on Electron/Tailwind-specific primitives not reproduced one-to-one in GPUI, so parity is structural and interactional first.
- Parent-directory source repos and tests were intentionally not modified in this phase.

## Verification
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` passes
- `cargo test --workspace` passes
- Current-directory git state was kept clean at each story boundary before the next story started
