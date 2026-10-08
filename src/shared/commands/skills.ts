export interface ImportSkillDirectoryInput {
  orgId: string;
  directoryPath: string;
  versionSemver: string;
}

export interface SyncSkillsFromDiskInput {
  orgId: string;
}

export interface BindSkillInput {
  orgId: string;
  agentId: string;
  skillId: string;
  revisionId: string;
}

export interface ResolveAgentSkillsInput {
  orgId: string;
  agentId: string;
  runId: string;
  /** Token budget for the compiled skills. */
  maxTokens: number;
}

export interface RunSkillTestsInput {
  orgId: string;
  revisionId: string;
}
