// Re-export from the split module for backward compatibility.
// All route logic now lives in src/main/api-server/
export { AgentApiServer, createApiServer } from "./api-server/index";
export type { ApiServerEventCallbacks } from "./api-server/index";
