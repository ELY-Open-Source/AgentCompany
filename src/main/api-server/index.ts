import { AgentApiServer, type ApiServerEventCallbacks } from "./server-core";
import { registerAgentRoutes } from "./routes-agents";
import { registerAgentControlRoutes } from "./routes-agent-control";
import { registerAgentStandupRoute } from "./routes-agents-standup";
import { registerTaskRoutes } from "./routes-tasks";
import { registerWorkGraphRoutes } from "./routes-work-graph";
import { registerMessageRoutes } from "./routes-messages";
import { registerApprovalRoutes } from "./routes-approvals";
import { registerFileRoutes } from "./routes-files";
import { registerMiscRoutes } from "./routes-misc";
import { registerMeetingRoutes } from "./routes-meetings";
import { registerRunRoutes } from "./routes-runs";
import type { AppDatabase } from "../database";

export type { ApiServerEventCallbacks };
export { AgentApiServer };

/**
 * Factory that creates and returns a fully-wired AgentApiServer with all
 * domain route modules registered.
 */
export function createApiServer(
  db: AppDatabase,
  callbacks: ApiServerEventCallbacks,
  allowedOrigins?: Iterable<string>,
): AgentApiServer {
  const server = new AgentApiServer(db, callbacks, allowedOrigins);
  registerAgentRoutes(server);
  registerAgentControlRoutes(server);
  registerAgentStandupRoute(server);
  registerTaskRoutes(server);
  registerWorkGraphRoutes(server);
  registerMessageRoutes(server);
  registerApprovalRoutes(server);
  registerFileRoutes(server);
  registerMiscRoutes(server);
  registerMeetingRoutes(server);
  registerRunRoutes(server);
  return server;
}
