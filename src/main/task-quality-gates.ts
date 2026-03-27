/**
 * Task Quality Gates — pure validation functions for task creation.
 *
 * Called by IPC handlers, API server, and automation service to enforce
 * minimum description quality, acceptance criteria, and capability matching.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface CapabilityMatchResult {
  matched: boolean;
  warning?: string;
}

/** Minimal DB interface for capability matching — keeps the function testable with mocks.
 *  Skill methods are optional since the skill system may not be implemented yet (graceful degradation per D-07). */
export interface CapabilityMatchDb {
  getAgent(id: string): { name: string; capabilities: string };
  listAgentSkillAssignments?(id: string): string[];
  getCompanySkill?(companyId: string, skillId: string): { name: string; description: string | null; slug: string } | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_DESCRIPTION_LENGTH = 50;

export const ACCEPTANCE_CRITERIA_KEYWORDS: readonly string[] = [
  "acceptance criteria",
  "done when",
  "success criteria",
  "definition of done",
  "requirements:",
  "must:",
  "should:",
  "- [ ]",
  "- [x]",
  "deliverable:",
  "expected outcome",
  "exit criteria",
];

// ---------------------------------------------------------------------------
// checkAcceptanceCriteria
// ---------------------------------------------------------------------------

export function checkAcceptanceCriteria(description: string): { hasCriteria: boolean; suggestion: string } {
  const lower = description.toLowerCase();
  const found = ACCEPTANCE_CRITERIA_KEYWORDS.some((kw) => lower.includes(kw));

  if (found) {
    return { hasCriteria: true, suggestion: "" };
  }

  return {
    hasCriteria: false,
    suggestion:
      'Task description should include acceptance criteria. Add a "Done when:" or "Acceptance criteria:" section, or use checkbox items (- [ ]) to define success conditions.',
  };
}

// ---------------------------------------------------------------------------
// validateTaskCreation
// ---------------------------------------------------------------------------

export function validateTaskCreation(
  input: { title: string; description: string },
  isHeartbeat: boolean,
): TaskValidationResult {
  // Heartbeat tasks bypass all validation
  if (isHeartbeat) {
    return { valid: true, errors: [], warnings: [] };
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  // TASK-01: Minimum description length
  if (input.description.length < MIN_DESCRIPTION_LENGTH) {
    errors.push(
      `Task description must be at least ${MIN_DESCRIPTION_LENGTH} characters (currently ${input.description.length}). Add details about what needs to be done, expected behavior, and any constraints.`,
    );
  }

  // TASK-02: Acceptance criteria detection (only check if length passes)
  if (input.description.length >= MIN_DESCRIPTION_LENGTH) {
    const criteria = checkAcceptanceCriteria(input.description);
    if (!criteria.hasCriteria) {
      errors.push(criteria.suggestion);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// checkCapabilityMatch
// ---------------------------------------------------------------------------

/** Tokenize text into words >3 chars, same pattern as database.ts autoAssignTask */
function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
}

export function checkCapabilityMatch(
  db: CapabilityMatchDb,
  agentId: string,
  taskDescription: string,
  companyId: string,
): CapabilityMatchResult {
  const taskWords = tokenize(taskDescription);

  // Nothing to match against — task description too short/vague
  if (taskWords.length === 0) {
    return { matched: true };
  }

  const agent = db.getAgent(agentId);
  const capWords = tokenize(agent.capabilities);
  const capabilityOverlap = taskWords.filter((w) => capWords.includes(w)).length;

  // Check skill assignments for additional matching (graceful degradation)
  let skillOverlap = 0;
  try {
    if (db.listAgentSkillAssignments && db.getCompanySkill) {
      const skillIds = db.listAgentSkillAssignments(agentId);
      for (const skillId of skillIds) {
        const skill = db.getCompanySkill(companyId, skillId);
        if (skill) {
          const skillWords = tokenize(`${skill.name} ${skill.description ?? ""} ${skill.slug}`);
          skillOverlap += taskWords.filter((w) => skillWords.includes(w)).length;
        }
      }
    }
  } catch {
    // Skill system may not be available — graceful degradation per D-07
  }

  // Direct capability or skill overlap found
  if (capabilityOverlap > 0 || skillOverlap > 0) {
    return { matched: true };
  }

  // No capabilities defined at all — graceful degradation (Pitfall 4)
  if (capWords.length === 0 && skillOverlap === 0) {
    return { matched: true };
  }

  // Agent has capabilities but no overlap — warn
  return {
    matched: false,
    warning: `Agent "${agent.name}" may lack skills for this task. Their capabilities (${agent.capabilities.slice(0, 80)}...) have no overlap with the task description. Consider reassigning.`,
  };
}
