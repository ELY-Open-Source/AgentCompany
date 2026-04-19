/**
 * Registers the concrete lifecycle hook handlers against the processor.
 * Handler side is kept thin — read the payload, call into the service
 * graph, translate throws into a `retryable` outcome so the processor's
 * attempt cap decides when a transient failure becomes permanent.
 */

import type { AutomationEventContext } from "./automation/types";
import type {
  DocumentLifecycleProcessor,
  LifecycleHookContext,
  LifecycleHookOutcome,
} from "./document-lifecycle-processor";

export interface LifecycleHandlerDeps {
  dispatchAutomation: (trigger: string, ctx: AutomationEventContext) => void;
  wakeAgentIfPossible: (
    agentId: string | null | undefined,
    companyId: string,
    trigger: string,
  ) => string | null;
}

export function registerLifecycleHandlers(
  processor: DocumentLifecycleProcessor,
  deps: LifecycleHandlerDeps,
): void {
  processor.register("automation_dispatch", automationDispatchHandler(deps));
  processor.register("reviewer_wake", reviewerWakeHandler(deps));
}

function automationDispatchHandler(deps: LifecycleHandlerDeps) {
  return (payload: Record<string, unknown>, context: LifecycleHookContext): LifecycleHookOutcome => {
    const trigger = typeof payload.trigger === "string" ? payload.trigger : "document_created";
    const automationContext: AutomationEventContext = {
      companyId: context.companyId,
      agentId: stringOrUndefined(payload.agentId),
      projectId: stringOrUndefined(payload.projectId),
    };
    try {
      deps.dispatchAutomation(trigger, automationContext);
      return { kind: "succeeded" };
    } catch (error) {
      return { kind: "retryable", reason: describeError(error) };
    }
  };
}

function reviewerWakeHandler(deps: LifecycleHandlerDeps) {
  return (payload: Record<string, unknown>, context: LifecycleHookContext): LifecycleHookOutcome => {
    const reviewerAgentId = stringOrNull(payload.reviewerAgentId);
    if (!reviewerAgentId) {
      return { kind: "failed", reason: "payload missing reviewerAgentId" };
    }
    try {
      deps.wakeAgentIfPossible(reviewerAgentId, context.companyId, "assignment");
      return { kind: "succeeded" };
    } catch (error) {
      return { kind: "retryable", reason: describeError(error) };
    }
  };
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
