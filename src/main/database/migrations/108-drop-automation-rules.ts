// Automation rules were saved but never ran; the records are removed rather than kept as a promise.
export const dropAutomationRulesSchema = `
  drop index if exists idx_automation_org;
  drop table if exists automation_rules;
`;
