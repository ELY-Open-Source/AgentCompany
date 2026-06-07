export const taskSubtasksDeleteSchema = `
  alter table tasks add column parent_task_id text references tasks(id) on delete set null;
`;
