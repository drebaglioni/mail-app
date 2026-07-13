import type { SenderType } from "./types";

export type SenderBucket = "people" | "automated" | "uncategorized";

/**
 * Map only an explicit model/heuristic classification into People or Automated.
 * Missing analysis and missing sender_type are recoverable unknown states, not
 * evidence that the sender is a person.
 */
export function senderBucket(senderType?: SenderType): SenderBucket {
  if (senderType === "person") return "people";
  if (senderType === "automated") return "automated";
  return "uncategorized";
}
