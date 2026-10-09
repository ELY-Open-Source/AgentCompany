import { z } from "zod";
import type { DesktopApi } from "../../../shared/desktop-api";
import { collaborationContracts } from "./collaboration";
import { organizationContracts } from "./organization";
import { platformContracts } from "./platform";

/** Every desktop API method the renderer invokes (not the event subscription or the constants). */
export type InvokedMethod = { [K in keyof DesktopApi]: DesktopApi[K] extends (...args: never[]) => Promise<unknown> ? K : never }[keyof DesktopApi];
export type InputOf<K extends InvokedMethod> = Parameters<DesktopApi[K]> extends [infer I] ? I : undefined;

const noInput = z.undefined();

/** The runtime contract of each IPC call; a method without a schema, or a schema that disagrees with its type, fails the typecheck. */
export const IPC_CONTRACTS: { [K in InvokedMethod]: z.ZodType<InputOf<K>> } = {
  loadSnapshot: noInput,
  relaunchApp: noInput,
  reportUnsaved: z.strictObject({ unsaved: z.boolean() }),
  runningSessionCount: noInput,
  pickDirectory: noInput,
  listConnectorCatalog: noInput,
  windowMinimize: noInput,
  windowMaximize: noInput,
  windowClose: noInput,
  ...organizationContracts,
  ...collaborationContracts,
  ...platformContracts,
};
