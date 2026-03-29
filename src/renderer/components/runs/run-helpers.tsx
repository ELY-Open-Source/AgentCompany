import type { RunRecord } from "@shared/types";

export const LOG_CHUNK_BYTES = 65_536;

export interface RunLogState {
  content: string;
  offset: number;
  nextOffset: number;
  totalBytes: number;
  eof: boolean;
  loading: boolean;
  error: string | null;
}

export const initialLogState: RunLogState = {
  content: "",
  offset: 0,
  nextOffset: 0,
  totalBytes: 0,
  eof: true,
  loading: false,
  error: null,
};

export function isActiveStatus(status: RunRecord["status"]) {
  return status === "queued" || status === "running";
}

