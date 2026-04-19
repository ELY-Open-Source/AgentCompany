# Native UI Parity Audit

Status: fine-grained current-directory visual pass completed
Scope: only files inside the current Rust workspace directory were modified during this remediation phase.
Rule: preserve business logic and runtime/data wiring while restoring original Electron page grammar and desktop skin as closely as possible from current-directory UI code only.

## Structural parity status

### Settings
Status: remediated
- Top-row tabs with active underline restored.
- Single active content panel below restored.
- Off-source left sidebar shell removed.

### Onboarding
Status: remediated
- Dedicated welcome screen restored.
- Left hero + fixed right step panel topology restored.
- Step tabs and back/continue flow restored to source-like wizard grammar.

### Dashboard / Overview
Status: remediated
- Recovery banner, budget banner, metrics, performance, budget utilization, needs attention, active work, and recent activity now follow source-like section ordering.
- Metric cards and attention rows route into real target sections.

### Runs
Status: remediated
- Dedicated Run Queue on the left and Run Detail on the right restored.
- Runtime events, artifacts, and operator controls remain available as secondary panels below the primary detail hierarchy.

### Approvals
Status: remediated
- Upper review area now uses grouped review-list grammar closer to PendingReviewList.
- Lower pending approval list/detail inspector remains wired to real decision actions.

### Documents
Status: remediated
- Source-like shell restored: section header, prose list, work-product list, dedicated editor/inspector column.

### Inbox / Messages
Status: remediated
- Inbox now uses a tighter source-like attention-list shell.
- Messages retain channel rail, thread header, stream, composer, and inspector while removing off-source chrome.

## Fine-grained visual skin status

### Shared surface tokens
Status: remediated
- Window/sidebar backgrounds shifted warmer to align better with screenshots.
- Panel borders softened toward warmer desktop-gray values.
- Selection fills and accent tints were reduced to calmer desktop tones.

### Communication chrome
Status: remediated
- Messages panes use tighter spacing and calmer radii.
- Sidebar now reads more like a desktop rail than a generic white card.
- Message avatar chrome, inspector chrome, and inbox row density were tightened toward screenshot rhythm.

## Remaining known limits

These are current-directory-only limits, not parent-repo edits:
- GPUI primitives are still not a literal copy of the Electron React/Tailwind component library, so parity is strongest at layout, interaction order, and tone rather than byte-for-byte component rendering.
- Some screenshot-level micro-details such as exact iconography, font rasterization, and component internals remain bounded by the native GPUI implementation.
- Parent-directory source repos and tests were intentionally not modified in this phase.

## Verification
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` passes
- `cargo test --workspace` passes
- Current-directory git state was kept clean at each story boundary before the next story started
