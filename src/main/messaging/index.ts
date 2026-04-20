/**
 * Barrel for the messaging layer. `dispatch` handles wire-in between
 * the API server, thread runtime, and the DB; `normalize` sanitises
 * comment bodies before they are projected into a prompt. Storage
 * itself lives in `database/messages.ts` and stays there — the
 * messaging/ directory covers runtime behaviour around that store, not
 * the SQL.
 */

export * from "./dispatch";
export * from "./normalize";
