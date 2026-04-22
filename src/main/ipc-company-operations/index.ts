import { registerDocumentHandlers } from "./document-handlers";
import { registerKnowledgeEntryHandlers } from "./knowledge-entry-handlers";
import { registerMeetingHandlers } from "./meeting-handlers";
import { registerSprintHandlers } from "./sprint-handlers";
import type { CompanyOperationHandlerDependencies } from "./types";

export function registerCompanyOperationsHandlers(dependencies: CompanyOperationHandlerDependencies) {
  registerMeetingHandlers(dependencies);
  registerDocumentHandlers(dependencies);
  registerKnowledgeEntryHandlers(dependencies);
  registerSprintHandlers(dependencies);
}
