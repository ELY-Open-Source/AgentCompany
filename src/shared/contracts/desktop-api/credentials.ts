import type { z } from "zod";
import type { secretInputSchema } from "../schemas-company";
import type { deleteEntitySchema } from "../schemas-badges";
import type { DesktopResult } from "./common";

export type CredentialsApi = {
  saveSecret: (input: z.infer<typeof secretInputSchema>) => Promise<DesktopResult<string>>;
  deleteSecret: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
};
