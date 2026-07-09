// Rows written before the compiled-prompt cap carried the entire skill
// catalogue (~1.1MB each; 144MB observed in a real profile). Nothing reads a
// finished run's compiled prompt back, and an interrupted run simply
// recompiles under the cap on recovery, so the table drains cleanly.
export const purgeRuntimeSnapshotBloatSchema = `
  delete from skill_runtime_snapshots;

  insert into schema_migrations(version, name, applied_at)
  values (51, 'purge_runtime_snapshot_bloat', datetime('now'));
`;
