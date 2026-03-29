export { execute } from "./execute.js";
export { testEnvironment } from "./test.js";
export {
  parseGeminiJsonl,
  isGeminiUnknownSessionError,
  describeGeminiFailure,
  detectGeminiAuthRequired,
  isGeminiTurnLimitResult,
} from "./parse.js";
export { listGeminiSkills, syncGeminiSkills } from "./skills.js";
import { createStandardSessionCodec } from "@agentcompany/adapter-utils/session-codec";

export const sessionCodec = createStandardSessionCodec({ extraSessionIdKeys: ["sessionID"] });
