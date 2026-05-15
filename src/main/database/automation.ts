import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { WorkflowPipelineRecord } from "@shared/types";
import type { ReadAll, SqliteRow } from "./helpers";
import { ensureId, nowIso } from "./helpers";

export function buildAutomationMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  deps: {
    addActivity: (input: { companyId: string; actor: string; action: string; entityType: string; entityId: string; detail: string }) => void;
  },
) {
  return {
    saveAutomationRule(input: {
      id?: string | null; companyId: string; name: string; description?: string;
      trigger: string; conditionsJson?: string; action: string; actionConfigJson?: string;
      sourceDepartment?: string | null; targetDepartment?: string | null;
      priority?: number; status?: string;
    }) {
      const id = ensureId(input.id ?? null);
      const ts = nowIso();
      const existing = getDb().prepare(
        "select company_id as companyId from automation_rules where id = ?",
      ).get(id) as { companyId: string } | undefined;
      if (existing && existing.companyId !== input.companyId) {
        throw new Error(`Automation rule ${id} does not belong to company ${input.companyId}`);
      }
      if (existing) {
        getDb().prepare(
          "update automation_rules set name = ?, description = ?, trigger = ?, conditions_json = ?, action = ?, action_config_json = ?, source_department = ?, target_department = ?, priority = ?, status = ?, updated_at = ? where id = ? and company_id = ?",
        ).run(input.name, input.description ?? "", input.trigger, input.conditionsJson ?? "{}", input.action, input.actionConfigJson ?? "{}", input.sourceDepartment ?? null, input.targetDepartment ?? null, input.priority ?? 50, input.status ?? "active", ts, id, input.companyId);
      } else {
        getDb().prepare(
          "insert into automation_rules (id, company_id, name, description, trigger, conditions_json, action, action_config_json, source_department, target_department, priority, status, execution_count, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
        ).run(id, input.companyId, input.name, input.description ?? "", input.trigger, input.conditionsJson ?? "{}", input.action, input.actionConfigJson ?? "{}", input.sourceDepartment ?? null, input.targetDepartment ?? null, input.priority ?? 50, input.status ?? "active", ts, ts);
      }
      deps.addActivity({ companyId: input.companyId, actor: "system", action: existing ? "updated" : "created", entityType: "automation_rule", entityId: id, detail: `${existing ? "Updated" : "Created"} automation rule: ${input.name}` });
      return id;
    },

    deleteAutomationRule(id: string, companyId: string) {
      getDb().prepare("delete from automation_rules where id = ? and company_id = ?").run(id, companyId);
    },

    listAutomationRuleNames(companyId: string): Set<string> {
      return new Set(
        readAll<{ name: string }>(
          "select name from automation_rules where company_id = ?",
          companyId,
        ).map((row) => row.name),
      );
    },

    toggleAutomationRule(id: string, companyId: string, status: "active" | "paused") {
      getDb().prepare("update automation_rules set status = ?, updated_at = ? where id = ? and company_id = ?").run(status, nowIso(), id, companyId);
    },

    recordAutomationExecution(ruleId: string, companyId: string, ruleName: string, trigger: string, action: string, detail: string) {
      const id = randomUUID();
      const ts = nowIso();
      getDb().prepare("insert into automation_log (id, company_id, rule_id, rule_name, trigger, action, detail, executed_at) values (?, ?, ?, ?, ?, ?, ?, ?)").run(id, companyId, ruleId, ruleName, trigger, action, detail, ts);
      getDb().prepare("update automation_rules set execution_count = execution_count + 1, last_executed_at = ? where id = ? and company_id = ?").run(ts, ruleId, companyId);
    },

    getAutomationLog(companyId: string) {
      return readAll<{ ruleId: string; ruleName: string; trigger: string; action: string; executedAt: string }>(
        "select rule_id as ruleId, rule_name as ruleName, trigger, action, executed_at as executedAt from automation_log where company_id = ? order by executed_at desc limit 100",
        companyId,
      );
    },

    listActiveAutomationRules(companyId: string, trigger: string): Array<{
      id: string; name: string; trigger: string; conditionsJson: string;
      action: string; actionConfigJson: string; sourceDepartment: string | null;
      targetDepartment: string | null; priority: number;
    }> {
      return readAll(
        "select id, name, trigger, conditions_json as conditionsJson, action, action_config_json as actionConfigJson, source_department as sourceDepartment, target_department as targetDepartment, priority from automation_rules where company_id = ? and trigger = ? and status = 'active' order by priority desc",
        companyId, trigger,
      );
    },

    saveWorkflow(input: {
      id?: string | null; companyId: string; name: string; description?: string;
      stepsJson?: string; triggerType: string; triggerConfigJson?: string; status?: string;
    }) {
      const id = ensureId(input.id ?? null);
      const ts = nowIso();
      const existing = getDb().prepare(
        "select company_id as companyId from workflow_pipelines where id = ?",
      ).get(id) as { companyId: string } | undefined;
      if (existing && existing.companyId !== input.companyId) {
        throw new Error(`Workflow ${id} does not belong to company ${input.companyId}`);
      }
      if (existing) {
        getDb().prepare(
          "update workflow_pipelines set name = ?, description = ?, steps_json = ?, trigger_type = ?, trigger_config_json = ?, status = ?, updated_at = ? where id = ? and company_id = ?",
        ).run(input.name, input.description ?? "", input.stepsJson ?? "[]", input.triggerType, input.triggerConfigJson ?? "{}", input.status ?? "draft", ts, id, input.companyId);
      } else {
        getDb().prepare(
          "insert into workflow_pipelines (id, company_id, name, description, steps_json, trigger_type, trigger_config_json, status, current_step_index, run_count, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)",
        ).run(id, input.companyId, input.name, input.description ?? "", input.stepsJson ?? "[]", input.triggerType, input.triggerConfigJson ?? "{}", input.status ?? "draft", ts, ts);
      }
      deps.addActivity({ companyId: input.companyId, actor: "system", action: existing ? "updated" : "created", entityType: "workflow", entityId: id, detail: `${existing ? "Updated" : "Created"} workflow: ${input.name}` });
      return id;
    },

    getWorkflowRecord(id: string, companyId: string): WorkflowPipelineRecord | null {
      const row = getDb().prepare(
        "select id, company_id as companyId, name, description, steps_json as stepsJson, trigger_type as triggerType, trigger_config_json as triggerConfigJson, status, current_step_index as currentStepIndex, run_count as runCount, last_run_at as lastRunAt, created_at as createdAt, updated_at as updatedAt from workflow_pipelines where id = ? and company_id = ?",
      ).get(id, companyId) as WorkflowPipelineRecord | undefined;
      return row ?? null;
    },

    updateWorkflowExecution(input: {
      id: string; companyId: string; status: string;
      currentStepIndex: number; stepsJson: string;
      incrementRunCount?: boolean; lastRunAt?: string | null;
    }) {
      const ts = nowIso();
      const runCountClause = input.incrementRunCount ? ", run_count = run_count + 1" : "";
      const lastRunAt = input.lastRunAt ?? null;
      getDb().prepare(
        `update workflow_pipelines
           set status = ?, current_step_index = ?, steps_json = ?, last_run_at = ?, updated_at = ?${runCountClause}
         where id = ? and company_id = ?`,
      ).run(input.status, input.currentStepIndex, input.stepsJson, lastRunAt, ts, input.id, input.companyId);
    },

    deleteWorkflow(id: string, companyId: string) {
      getDb().prepare("delete from workflow_pipelines where id = ? and company_id = ?").run(id, companyId);
    },

    listTriggerableWorkflows(companyId: string, triggerType: string): WorkflowPipelineRecord[] {
      return readAll<SqliteRow>(
        "select id, company_id as companyId, name, description, steps_json as stepsJson, trigger_type as triggerType, trigger_config_json as triggerConfigJson, status, current_step_index as currentStepIndex, run_count as runCount, last_run_at as lastRunAt, created_at as createdAt, updated_at as updatedAt from workflow_pipelines where company_id = ? and trigger_type = ? and status = 'active' order by created_at asc",
        companyId, triggerType,
      ) as WorkflowPipelineRecord[];
    },
  };
}
