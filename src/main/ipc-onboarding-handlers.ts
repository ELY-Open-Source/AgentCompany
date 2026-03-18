import {
  IPC_CHANNELS,
  bootstrapOnboardingSchema,
} from "@shared/contracts";
import { fail, ok, type RegisterDomainHandlersDependencies } from "./ipc-domain-common";

export function registerOnboardingHandlers({
  registerHandle,
  bootstrapOnboarding,
}: Pick<
  RegisterDomainHandlersDependencies,
  "registerHandle" | "bootstrapOnboarding"
>) {
  registerHandle(IPC_CHANNELS.bootstrapOnboarding, (_event, payload) => {
    const input = bootstrapOnboardingSchema.parse(payload);
    try {
      return ok(bootstrapOnboarding(input));
    } catch (error) {
      return fail("ONBOARDING_BOOTSTRAP_FAILED", error instanceof Error ? error.message : "Unable to bootstrap onboarding.");
    }
  });
}
