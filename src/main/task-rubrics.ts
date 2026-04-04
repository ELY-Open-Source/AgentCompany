/**
 * Task-type-specific business rubrics for quality validation.
 *
 * Imported by task-quality-gates.ts to extend validateTaskCreation with
 * domain-aware checks for research, content, management, and other task types.
 */

import type { TaskType } from "@shared/types/enums";

export interface TaskRubric {
  /** Sections the task description should contain (case-insensitive substring match). */
  requiredSections: string[];
  /** Keywords that signal the brief is grounded in quality criteria. */
  qualityKeywords: string[];
  /** Minimum description length for this task type. */
  minDescriptionLength: number;
  /** Human-readable template hint shown in warnings when sections are missing. */
  briefTemplate: string;
}

const RUBRICS: Record<TaskType, TaskRubric> = {
  research: {
    requiredSections: ["research question", "methodology", "sources", "expected findings"],
    qualityKeywords: ["data", "evidence", "analysis", "comparison", "findings"],
    minDescriptionLength: 100,
    briefTemplate:
      "A research task brief should cover: Research Question, Methodology, Sources to consult, and Expected Findings.",
  },
  content: {
    requiredSections: ["target audience", "brand voice", "key messages", "format"],
    qualityKeywords: ["audience", "tone", "call to action", "engagement", "headline"],
    minDescriptionLength: 80,
    briefTemplate:
      "A content task brief should cover: Target Audience, Brand Voice, Key Messages, and Format (e.g., blog post, social copy, email).",
  },
  management: {
    requiredSections: ["objective", "stakeholders", "timeline", "success metrics"],
    qualityKeywords: ["milestone", "deliverable", "risk", "dependency", "alignment"],
    minDescriptionLength: 80,
    briefTemplate:
      "A management task brief should cover: Objective, Stakeholders, Timeline, and Success Metrics.",
  },
  general: {
    requiredSections: [],
    qualityKeywords: [],
    minDescriptionLength: 50,
    briefTemplate: "",
  },
  code: {
    requiredSections: [],
    qualityKeywords: [],
    minDescriptionLength: 50,
    briefTemplate: "",
  },
};

/** Returns the rubric for the given task type, defaulting to "general" for unknown values. */
function getTaskTypeRubric(taskType: string): TaskRubric {
  const key = taskType as TaskType;
  return RUBRICS[key] ?? RUBRICS.general;
}

/**
 * Validates a task input against the type-specific rubric.
 * Returns warnings (not errors) — missing sections are advisory,
 * not blockers, to avoid rejecting valid heterodox formats.
 */
export function validateTaskRubric(input: {
  title: string;
  description: string;
  type: string;
}): { warnings: string[] } {
  const rubric = getTaskTypeRubric(input.type);
  const warnings: string[] = [];

  // No extra checks needed for code/general types
  if (rubric.requiredSections.length === 0) {
    return { warnings };
  }

  const lower = input.description.toLowerCase();

  const missingSections = rubric.requiredSections.filter(
    (section) => !lower.includes(section.toLowerCase()),
  );

  if (missingSections.length > 0) {
    const listed = missingSections.map((s) => `"${s}"`).join(", ");
    warnings.push(
      `${capitalizeFirst(input.type)} task is missing recommended sections: ${listed}. ${rubric.briefTemplate}`,
    );
  }

  return { warnings };
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
