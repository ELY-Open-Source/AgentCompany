export const skillHardeningSchema = `
  create unique index if not exists idx_skill_runtime_snapshots_agent_run
    on skill_runtime_snapshots(agent_id, run_id);
`;
