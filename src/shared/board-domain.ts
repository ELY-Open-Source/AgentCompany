export const CHAT_THREAD_BOARD_STATE = {
  OPEN: "open",
  FROZEN: "frozen",
  TAKEOVER: "takeover",
} as const;

export const BOARD_INTERVENTION_MODE = {
  OBSERVE: "observe",
  INTERVENE: "intervene",
  TAKEOVER: "takeover",
} as const;

export const BOARD_INTERVENTION_ACTION = {
  DECISION: "decision",
  FREEZE: "freeze",
  TAKEOVER: "takeover",
  ROLLBACK: "rollback",
  FORCE_APPROVAL: "force_approval",
} as const;

type ValueOf<T> = T[keyof T];

export type ChatThreadBoardState = ValueOf<typeof CHAT_THREAD_BOARD_STATE>;
export type BoardInterventionMode = ValueOf<typeof BOARD_INTERVENTION_MODE>;
export type BoardInterventionAction = ValueOf<typeof BOARD_INTERVENTION_ACTION>;

