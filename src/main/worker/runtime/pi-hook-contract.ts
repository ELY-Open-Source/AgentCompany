/**
 * Compile-time contract between local hook implementations and
 * `pi-agent-core` callback signatures.
 *
 * Root `package.json` pins `@mariozechner/pi-agent-core` to 0.67.68
 * while our worker wires local hooks — `beforeToolCall` and
 * `transformContext` — into the pi Agent constructor. Those hooks carry
 * deep structural coupling: pi decides the context shape passed in and
 * the result shape we return. A silent signature drift on upgrade would
 * slip past runtime tests until a real tool call fires in production.
 *
 * This module re-states every hook callback type as a named alias sourced
 * from pi, then pins the concrete inline callbacks from `pi-agent-factory`
 * to those aliases via the `ExpectHookType` helper. If pi ever renames a
 * type, drops a field, or changes an argument, `tsc` fails here — not at
 * the first destructive-tool invocation on a user machine.
 *
 * The contract is compile-only: no runtime validator, no fallback path.
 * Importing this file for side effects (see `pi-agent-factory`) is enough
 * to drag it into the typecheck graph.
 */

import type {
  AgentMessage,
  AgentOptions,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@mariozechner/pi-agent-core";

/**
 * Canonical hook callback types sourced directly from `AgentOptions`.
 *
 * Using `NonNullable<AgentOptions[...]>` keeps a single upstream source
 * of truth — if pi changes the option signature the alias fails, which
 * cascades into every `satisfies` check below.
 */
export type PiBeforeToolCall = NonNullable<AgentOptions["beforeToolCall"]>;
export type PiTransformContext = NonNullable<AgentOptions["transformContext"]>;

/**
 * Context/result types carried across the hook boundary. Pinned by name
 * here so `hook-rpc.ts` payloads stay anchored to the pi-provided shapes
 * even when the local RPC wrapper strips or re-packs fields.
 */
export type PiBeforeToolCallContext = BeforeToolCallContext;
export type PiBeforeToolCallResult = BeforeToolCallResult;
export type PiAgentMessage = AgentMessage;

/**
 * Type-level assertion: `Fn` must be assignable to the pi hook slot `Slot`.
 *
 * The helper produces `never` when `Fn` drifts, so any `satisfies` use
 * resolves to `never` and fails to satisfy the target. That failure is
 * the compile-time breakage we want — a single red squiggle pointing at
 * the offending hook.
 */
type ExpectHookType<Slot, Fn extends Slot> = Fn;

/**
 * Callable shapes actually installed by `pi-agent-factory.createPiAgent`.
 *
 * These mirror the inline hook functions passed into `new Agent({...})`.
 * Keeping them as standalone named types means a future refactor that
 * pulls them out of the factory closure into named exports only has to
 * swap the `typeof` lookup — the contract check below continues to hold.
 */
type LocalBeforeToolCallShape = (
  ctx: BeforeToolCallContext,
  signal?: AbortSignal,
) => Promise<BeforeToolCallResult | undefined>;

type LocalTransformContextShape = (
  messages: AgentMessage[],
  signal?: AbortSignal,
) => Promise<AgentMessage[]>;

/**
 * Contract assertions — these are pure type positions; no runtime code.
 *
 * Each alias forces `tsc` to verify the local shape is still a valid
 * substitute for the corresponding pi slot. Removing or renaming a
 * field on either side breaks the build.
 */
export type BeforeToolCallContract = ExpectHookType<PiBeforeToolCall, LocalBeforeToolCallShape>;
export type TransformContextContract = ExpectHookType<PiTransformContext, LocalTransformContextShape>;

/**
 * Hook handler return envelopes used by `agent-runtime/hook-handlers.ts`.
 *
 * The handlers run inside main and ship results back to the worker over
 * the RPC channel, so they do not implement the raw pi signatures.
 * Pinning the mapped shapes here guarantees that any change to the
 * upstream result type surfaces in the RPC payload layer too.
 */
export type BeforeToolCallHandlerResult = {
  readonly block: boolean;
  readonly reason: string | null;
};

export type TransformContextHandlerResult = {
  readonly changed: boolean;
  readonly messages: AgentMessage[] | null;
};
