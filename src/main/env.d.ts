/**
 * Build-time constants injected by electron.vite.config.ts (`define`).
 * Vitest runs without the bundler, so the identifier may not exist at
 * runtime — always read it through a `typeof` guard.
 */
declare const __COMPOSIO_API_KEY__: string | undefined;
