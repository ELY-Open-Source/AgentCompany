import type { SQLInputValue } from "node:sqlite";
import { AppDatabaseBase } from "./database-base";

export { STALE_LOCK_TIMEOUT_MS } from "./database-base";

/**
 * AppDatabase — concrete persistence surface wired to the twenty-six
 * domain modules declared on AppDatabaseBase. New code must call the
 * owning module directly (e.g. `db.tasks.saveTask(...)`, not
 * `db.saveTask(...)`); the ESLint rule in .eslintrc enforces this.
 *
 * The only members living here are cross-cutting composites whose
 * single-module home does not exist yet (createHireRequest,
 * rollbackConfigRevision) and the raw-SQL escape hatch, and backups
 * which need the open/close lifecycle plumbing owned by this class.
 */
export class AppDatabase extends AppDatabaseBase {
  /**
   * Create a hire request by persisting the provisional agent row and
   * its approval atomically. The composition spans `agents` and
   * `approvalsMod`, so it lives here until a dedicated hiring module
   * owns both sides.
   */
  createHireRequest(input: Parameters<AppDatabaseBase["entityCrud"]["createHireRequest"]>[0]) {
    return this.entityCrud.createHireRequest(input, {
      saveAgent: (agentInput) => this.agents.saveAgent(agentInput),
      requestApproval: (approvalInput) => this.approvalsMod.requestApproval(approvalInput),
    });
  }

  /**
   * Roll back an agent configuration revision. Spans documents
   * (revision store), entityCrud (agent lookup), and a recorded
   * rollback entry — again a multi-module composite the subclass
   * carries until a dedicated agent-config module owns the flow.
   */
  rollbackConfigRevision(agentId: string, revisionId: string, companyId: string) {
    return this.documentsMod.rollbackConfigRevision(agentId, revisionId, companyId, {
      getConfigRevision: (rid, cid) => this.documentsMod.getConfigRevision(rid, cid),
      getAgent: (id) => this.entityCrud.getAgent(id),
      recordConfigRevision: (input) => this.documentsMod.recordConfigRevision(input),
    });
  }

  /**
   * Raw-SQL escape hatch. Not part of the public API. New callers MUST
   * add a typed method on the appropriate `database/<module>.ts` and
   * route through there. Retained only for legacy automation
   * bookkeeping that predates the module split; see
   * `.planning/review2/02-persistence-ipc.md` DB-001 for the migration
   * list.
   *
   * @internal
   */
  queryAll<T>(sql: string, ...params: SQLInputValue[]): T[] { return this.readAll<T>(sql, ...params); }
}
