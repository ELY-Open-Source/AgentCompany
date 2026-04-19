import type { z } from "zod";
import type { CompanyMetrics, OnboardingBootstrapResult, ProfileSnapshot, StandupReport } from "../../types";
import type { bootstrapOnboardingSchema, companyInputSchema, connectorDisabledModelsSchema, connectorInputSchema, settingsSchema } from "../schemas-company";
import type { metricsQuerySchema } from "../schemas-badges";
import type { DesktopResult } from "./common";

export type CompaniesApi = {
  loadSnapshot: () => Promise<DesktopResult<ProfileSnapshot>>;
  pickDirectory: () => Promise<DesktopResult<string | null>>;
  openPath: (targetPath: string) => Promise<DesktopResult<boolean>>;
  saveCompany: (input: z.infer<typeof companyInputSchema>) => Promise<DesktopResult<string>>;
  setCurrentCompany: (companyId: string) => Promise<DesktopResult<boolean>>;
  saveConnector: (input: z.infer<typeof connectorInputSchema>) => Promise<DesktopResult<boolean>>;
  testConnector: (id: z.infer<typeof connectorInputSchema.shape.id>) => Promise<DesktopResult<boolean>>;
  updateSettings: (input: z.infer<typeof settingsSchema>) => Promise<DesktopResult<boolean>>;
  checkForUpdates: () => Promise<DesktopResult<boolean>>;
  deleteCompany: (companyId: string) => Promise<DesktopResult<boolean>>;
  listConnectorModels: (connectorId: string) => Promise<DesktopResult<Array<{ id: string; label: string }>>>;
  getConnectorDisabledModels: (connectorId: string) => Promise<DesktopResult<Array<{ id: string; label: string }>>>;
  setConnectorDisabledModels: (input: z.infer<typeof connectorDisabledModelsSchema>) => Promise<DesktopResult<boolean>>;
  getCompanyMetrics: (input: z.infer<typeof metricsQuerySchema>) => Promise<DesktopResult<CompanyMetrics>>;
  getStandupReport: (companyId: string) => Promise<DesktopResult<StandupReport>>;
  bootstrapOnboarding: (input: z.infer<typeof bootstrapOnboardingSchema>) => Promise<DesktopResult<OnboardingBootstrapResult>>;
  checkNodeInstalled: () => Promise<DesktopResult<{ installed: boolean; version: string | null }>>;
  backupProfile: () => Promise<DesktopResult<string | null>>;
  restoreProfile: () => Promise<DesktopResult<boolean>>;
};
