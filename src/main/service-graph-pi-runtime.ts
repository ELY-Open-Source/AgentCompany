/**
 * Pi-mono runtime + credential service factory.
 *
 * Composes `CredentialStore`, `CredentialResolver`, `OAuthLoginService`, and
 * `RuntimeBridge` for `service-graph.ts`. Extracted to keep `service-graph.ts`
 * under the 400-line cap.
 */

import type { AppDatabase } from "./database";
import type { DesktopEvent } from "@shared/types";
import { CredentialResolver, CredentialStore, OAuthLoginService } from "./credentials";
import { RuntimeBridge } from "./agent-runtime";

export interface PiRuntimeServicesDeps {
  db: AppDatabase;
  emitEvent: (event: DesktopEvent) => void;
  refreshConnectorHealth: (connectorId: string) => Promise<void>;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

export interface PiRuntimeServices {
  credentialStore: CredentialStore;
  credentialResolver: CredentialResolver;
  oauthLoginService: OAuthLoginService;
  runtimeBridge: RuntimeBridge;
  release: () => void;
}

export function createPiRuntimeServices(deps: PiRuntimeServicesDeps): PiRuntimeServices {
  const credentialStore = new CredentialStore({ db: deps.db });
  const credentialResolver = new CredentialResolver(credentialStore);
  const oauthLoginService = new OAuthLoginService({
    store: credentialStore,
    emitEvent: deps.emitEvent,
    refreshConnectorHealth: deps.refreshConnectorHealth,
    logger: deps.logger,
  });
  const runtimeBridge = new RuntimeBridge({
    db: deps.db,
    emitEvent: deps.emitEvent,
    logger: deps.logger,
    credentialResolver,
  });

  return {
    credentialStore,
    credentialResolver,
    oauthLoginService,
    runtimeBridge,
    release: () => {},
  };
}
