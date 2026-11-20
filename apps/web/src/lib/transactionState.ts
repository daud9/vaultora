export type TransactionStage =
  | "idle"
  | "preparing"
  | "awaiting_authorization"
  | "submitted"
  | "confirmed"
  | "failed";

export interface TransactionState {
  stage: TransactionStage;
  hash?: string;
  message?: string;
}

export type TransactionAction =
  | { type: "START" }
  | { type: "REQUEST_AUTHORIZATION" }
  | { type: "SUBMITTED"; hash: string }
  | { type: "CONFIRMED" }
  | { type: "FAILED"; message: string; hash?: string }
  | { type: "RESET" };

export const initialTransactionState: TransactionState = { stage: "idle" };

const transitions: Record<TransactionStage, readonly TransactionStage[]> = {
  idle: ["preparing"],
  preparing: ["awaiting_authorization", "failed"],
  awaiting_authorization: ["submitted", "failed"],
  submitted: ["confirmed", "failed"],
  confirmed: ["preparing", "idle"],
  failed: ["preparing", "idle"],
};

export function transactionReducer(
  state: TransactionState,
  action: TransactionAction,
): TransactionState {
  if (action.type === "RESET") return initialTransactionState;

  const nextStages: Record<Exclude<TransactionAction["type"], "RESET">, TransactionStage> = {
    START: "preparing",
    REQUEST_AUTHORIZATION: "awaiting_authorization",
    SUBMITTED: "submitted",
    CONFIRMED: "confirmed",
    FAILED: "failed",
  };
  const nextStage = nextStages[action.type];

  if (!transitions[state.stage].includes(nextStage)) return state;

  switch (action.type) {
    case "START":
      return { stage: "preparing" };
    case "REQUEST_AUTHORIZATION":
      return { stage: "awaiting_authorization" };
    case "SUBMITTED":
      return action.hash.trim()
        ? { stage: "submitted", hash: action.hash }
        : { stage: "failed", message: "The network did not return a transaction hash." };
    case "CONFIRMED":
      return { ...state, stage: "confirmed" };
    case "FAILED":
      return state.hash || action.hash
        ? { stage: "failed", message: action.message, hash: state.hash || action.hash }
        : { stage: "failed", message: action.message };
  }
}
