import type { ProfileSnapshot } from "@shared/types";

export interface ProfileMetadataSection {
  currentCompanyId: ProfileSnapshot["currentCompanyId"];
  profilePath: ProfileSnapshot["profilePath"];
  updatesEnabled: ProfileSnapshot["updatesEnabled"];
  theme: ProfileSnapshot["theme"];
  locale: ProfileSnapshot["locale"];
  backend: ProfileSnapshot["backend"];
}

export interface ProfileCatalogSection {
  companies: ProfileSnapshot["companies"];
  connectors: ProfileSnapshot["connectors"];
}

export interface CompanyCollectionsSection {
  workspaces: ProfileSnapshot["workspaces"];
  agents: ProfileSnapshot["agents"];
  goals: ProfileSnapshot["goals"];
  projects: ProfileSnapshot["projects"];
  tasks: ProfileSnapshot["tasks"];
  approvals: ProfileSnapshot["approvals"];
  runs: ProfileSnapshot["runs"];
  costs: ProfileSnapshot["costs"];
  activity: ProfileSnapshot["activity"];
  secrets: ProfileSnapshot["secrets"];
  comments: ProfileSnapshot["comments"];
  socialAccounts: ProfileSnapshot["socialAccounts"];
  meetings: ProfileSnapshot["meetings"];
  documents: ProfileSnapshot["documents"];
  workProducts: ProfileSnapshot["workProducts"];
  knowledgeBase: ProfileSnapshot["knowledgeBase"];
  sprints: ProfileSnapshot["sprints"];
  automationRules: ProfileSnapshot["automationRules"];
  agentMessages: ProfileSnapshot["agentMessages"];
  workflows: ProfileSnapshot["workflows"];
}

export interface ProfileSnapshotSections {
  metadata: ProfileMetadataSection;
  catalog: ProfileCatalogSection;
  company: CompanyCollectionsSection;
}

export function splitProfileSnapshot(snapshot: ProfileSnapshot): ProfileSnapshotSections {
  return {
    metadata: {
      currentCompanyId: snapshot.currentCompanyId,
      profilePath: snapshot.profilePath,
      updatesEnabled: snapshot.updatesEnabled,
      theme: snapshot.theme,
      locale: snapshot.locale,
      backend: snapshot.backend,
    },
    catalog: {
      companies: snapshot.companies,
      connectors: snapshot.connectors,
    },
    company: {
      workspaces: snapshot.workspaces,
      agents: snapshot.agents,
      goals: snapshot.goals,
      projects: snapshot.projects,
      tasks: snapshot.tasks,
      approvals: snapshot.approvals,
      runs: snapshot.runs,
      costs: snapshot.costs,
      activity: snapshot.activity,
      secrets: snapshot.secrets,
      comments: snapshot.comments,
      socialAccounts: snapshot.socialAccounts,
      meetings: snapshot.meetings,
      documents: snapshot.documents,
      workProducts: snapshot.workProducts,
      knowledgeBase: snapshot.knowledgeBase,
      sprints: snapshot.sprints,
      automationRules: snapshot.automationRules,
      agentMessages: snapshot.agentMessages,
      workflows: snapshot.workflows,
    },
  };
}

export function assembleProfileSnapshot(sections: ProfileSnapshotSections): ProfileSnapshot {
  return {
    currentCompanyId: sections.metadata.currentCompanyId,
    profilePath: sections.metadata.profilePath,
    updatesEnabled: sections.metadata.updatesEnabled,
    theme: sections.metadata.theme,
    locale: sections.metadata.locale,
    backend: sections.metadata.backend,
    companies: sections.catalog.companies,
    connectors: sections.catalog.connectors,
    workspaces: sections.company.workspaces,
    agents: sections.company.agents,
    goals: sections.company.goals,
    projects: sections.company.projects,
    tasks: sections.company.tasks,
    approvals: sections.company.approvals,
    runs: sections.company.runs,
    costs: sections.company.costs,
    activity: sections.company.activity,
    secrets: sections.company.secrets,
    comments: sections.company.comments,
    socialAccounts: sections.company.socialAccounts,
    meetings: sections.company.meetings,
    documents: sections.company.documents,
    workProducts: sections.company.workProducts,
    knowledgeBase: sections.company.knowledgeBase,
    sprints: sections.company.sprints,
    automationRules: sections.company.automationRules,
    agentMessages: sections.company.agentMessages,
    workflows: sections.company.workflows,
  };
}
