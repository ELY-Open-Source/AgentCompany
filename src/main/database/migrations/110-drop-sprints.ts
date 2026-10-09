// Sprints were saved but never tracked against tasks; the records are removed rather than kept as a promise.
export const dropSprintsSchema = `
  drop index if exists idx_sprints_org;
  drop table if exists sprints;
`;
