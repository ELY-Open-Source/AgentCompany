import { createStandardSessionCodec } from "@agentcompany/adapter-utils/session-codec";

export const sessionCodec = createStandardSessionCodec({ extraSessionIdKeys: ["sessionID"] });

export { execute } from "./execute.js";
export { testEnvironment } from "./test.js";
export {
  listOpenCodeModels,
  discoverOpenCodeModels,
  ensureOpenCodeModelConfiguredAndAvailable,
  resetOpenCodeModelsCacheForTests,
} from "./models.js";
export { parseOpenCodeJsonl, isOpenCodeUnknownSessionError } from "./parse.js";
