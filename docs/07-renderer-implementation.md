# Phase 6: FrontendDeveloper Renderer Implementation

## Stack

- React `19`
- TypeScript
- Vite / electron-vite
- Framer Motion for shell transitions and utility drawer motion

## Renderer Responsibilities Implemented

- first-launch onboarding for company bootstrap and workspace selection
- persistent desktop shell with section navigation
- command palette toggle and keyboard-driven navigation hooks
- connector registry with status, version, auth posture, and configuration surfaces
- company, agent, goal, project, task, approval, cost, activity, workspace, and settings panels
- run console utility drawer with live status and log retrieval
- empty, loading, and error states for first-run and operational flows

## State Model

- snapshot-driven renderer state sourced from `window.agentCompany.loadSnapshot()`
- local UI state for section selection, command palette visibility, console visibility, dialog drafts, and selection state
- event subscription via `window.agentCompany.subscribe(...)` for domain changes and run updates

## Desktop-Native UX Decisions

- shell layout assumes resizable desktop windows, not mobile breakpoints
- keyboard shortcuts are routed from the application menu into renderer event handling
- workspace opening and log access are explicit desktop actions
- drawer, inspector, and list/detail panels remain visible at desktop densities

## Key Files

- [App.tsx](/Users/zacharyzhang/Documents/Github/paperclip/AgentCompany/src/renderer/App.tsx)
- [main.tsx](/Users/zacharyzhang/Documents/Github/paperclip/AgentCompany/src/renderer/main.tsx)
- [styles.css](/Users/zacharyzhang/Documents/Github/paperclip/AgentCompany/src/renderer/styles.css)
- [index.html](/Users/zacharyzhang/Documents/Github/paperclip/AgentCompany/src/renderer/index.html)
