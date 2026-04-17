import type { z } from "zod";
import type { TaskRecord } from "../../types";
import type { autoAssignSchema, goalInputSchema, projectInputSchema, sprintInputSchema, taskInputSchema } from "../schemas-tasks";
import type { workspaceInputSchema } from "../schemas-company";
import type { deleteEntitySchema, entityGetterSchema } from "../schemas-badges";
import type { DesktopResult, SaveTaskResult } from "./common";

export type TasksApi = {
  saveWorkspace: (input: z.infer<typeof workspaceInputSchema>) => Promise<DesktopResult<string>>;
  saveGoal: (input: z.infer<typeof goalInputSchema>) => Promise<DesktopResult<string>>;
  saveProject: (input: z.infer<typeof projectInputSchema>) => Promise<DesktopResult<string>>;
  saveTask: (input: z.infer<typeof taskInputSchema>) => Promise<DesktopResult<SaveTaskResult>>;
  saveSprint: (input: z.infer<typeof sprintInputSchema>) => Promise<DesktopResult<string>>;
  deleteTask: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  deleteGoal: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  deleteProject: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  deleteWorkspace: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  deleteSprint: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  getTask: (input: z.infer<typeof entityGetterSchema>) => Promise<DesktopResult<TaskRecord>>;
  autoAssignTask: (input: z.infer<typeof autoAssignSchema>) => Promise<DesktopResult<string>>;
};
