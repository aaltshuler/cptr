/** What an engine returns: a plain HUD ack line, or an ack plus follow-up
 * work that must keep the command alive after the HUD (Raycast unloads
 * no-view commands when their promise resolves). */
export interface CaptureOutcome {
  ack: string;
  followUp?: Promise<void>;
  followUpFailureTitle?: string;
}

export type CaptureResult = string | CaptureOutcome;
