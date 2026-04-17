import type { AppDatabase } from "../database";
import { createBudgetEnforcementService } from "../budget-enforcement-service";
import { createSessionManagementService } from "../session-management-service";
import { createSkillService } from "../skill-service";
import type { NotificationOptions } from "../notification-service";

export interface LeafServicesDeps {
  db: AppDatabase;
  logger: {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  notify: (options: NotificationOptions) => void;
  publishDomainChanged: () => void;
}

export interface LeafServices {
  skillService: ReturnType<typeof createSkillService>;
  budgetEnforcementService: ReturnType<typeof createBudgetEnforcementService>;
  sessionManagementService: ReturnType<typeof createSessionManagementService>;
}

/**
 * Build leaf services that no other service depends on except through this
 * bundle. Constructed first so downstream factories can receive concrete
 * references without null-checks.
 */
export function createLeafServices({
  db,
  logger,
  notify,
  publishDomainChanged,
}: LeafServicesDeps): LeafServices {
  const skillService = createSkillService({ db, profileDir: db.profileDir, logger });
  const budgetEnforcementService = createBudgetEnforcementService({
    db,
    logger,
    notify,
    publishDomainChanged,
  });
  const sessionManagementService = createSessionManagementService({ db, logger });

  return { skillService, budgetEnforcementService, sessionManagementService };
}
