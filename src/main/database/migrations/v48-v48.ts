import log from "electron-log/main.js";
import type { Migration, MigrationDeps } from "./types";

export function createMigrationsV48V48(deps: MigrationDeps): Migration[] {
  const { db } = deps;
  return [
    {
      // Persist @mention fan-out so inbox visibility stops depending on
      // a runtime-only regex against every message body.
      //
      // Before v48 `dispatchAgentMessage` woke mentioned agents via
      // `findMentionedAgentIds`, but `listAgentInboxUnread` filtered
      // purely on `channel`, `to_agent_id`, and department/project
      // membership. A mid-chat `@ceo update please` targeted at
      // 张工程师 therefore woke CEO with an empty inbox — CEO's
      // heartbeat fired, saw nothing new, and stayed silent while the
      // DM recipient replied and the operator assumed CEO had ignored
      // them. The join table makes "mentioned in a message" a first-
      // class visibility path: persisted once at dispatch, joined on
      // read, so every consumer (inbox projection, read-receipts,
      // search) sees a single source of truth.
      version: 48,
      name: "agent_message_mentions",
      fn: () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS agent_message_mentions (
            message_id TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            company_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (message_id, agent_id)
          )
        `);
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_agent_message_mentions_agent
          ON agent_message_mentions(company_id, agent_id, created_at)
        `);
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_agent_message_mentions_message
          ON agent_message_mentions(message_id)
        `);
        log.info("[migration v48] agent_message_mentions join table installed");
      },
    },
  ];
}
