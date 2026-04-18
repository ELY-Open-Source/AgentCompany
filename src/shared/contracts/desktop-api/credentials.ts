import type { deleteEntitySchema } from "../schemas-badges";
import type { z } from "zod";
import type {
  CredentialSummary,
  SaveCredentialInput,
} from "../schemas-credentials";
import type {
  OAuthStartInput,
  OAuthPromptResponseInput,
  OAuthManualCodeResponseInput,
} from "../schemas-oauth";
import type { DesktopResult } from "./common";

export type CredentialsApi = {
  deleteSecret: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  // pi-mono credentials
  listCredentials: () => Promise<DesktopResult<CredentialSummary[]>>;
  saveCredential: (input: SaveCredentialInput) => Promise<DesktopResult<CredentialSummary>>;
  removeCredential: (input: { connectorId: string }) => Promise<DesktopResult<boolean>>;
  testCredential: (input: { connectorId: string }) => Promise<DesktopResult<{ ok: boolean; message: string }>>;
  // pi-mono OAuth
  startOAuth: (input: OAuthStartInput) => Promise<DesktopResult<boolean>>;
  cancelOAuth: (input: { connectorId: string }) => Promise<DesktopResult<boolean>>;
  submitOAuthPrompt: (input: OAuthPromptResponseInput) => Promise<DesktopResult<boolean>>;
  submitOAuthManualCode: (input: OAuthManualCodeResponseInput) => Promise<DesktopResult<boolean>>;
};
