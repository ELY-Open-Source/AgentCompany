type ValueOf<T> = T[keyof T];

export const PROVIDER_DATA_POLICY = {
  STANDARD: "standard",
  ZERO_DATA_RETENTION: "zero_data_retention",
} as const;

export const PROVIDER_EXECUTION_MODE = {
  FOREGROUND: "foreground",
  BACKGROUND: "background",
} as const;

export type ProviderDataPolicy = ValueOf<typeof PROVIDER_DATA_POLICY>;
export type ProviderExecutionMode = ValueOf<typeof PROVIDER_EXECUTION_MODE>;
