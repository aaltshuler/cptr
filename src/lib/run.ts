import { closeMainWindow, showHUD, showToast, Toast } from "@raycast/api";
import { CaptureOutcome, CaptureResult } from "./types";

export type { CaptureOutcome, CaptureResult } from "./types";

/** Shared no-view command runner: HUD on success, failure toast naming the
 * fix, empty ack = user-cancelled (their Esc is the ack). */
export async function runCapture(
  fn: () => Promise<CaptureResult>,
  options: { closeFirst?: boolean } = {},
): Promise<void> {
  try {
    if (options.closeFirst) {
      await closeMainWindow({ clearRootSearch: true });
      await new Promise((r) => setTimeout(r, 300)); // let the window leave the frame
    }
    const result = await fn();
    await settleOutcome(result);
  } catch (err) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Capture failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/** HUD the ack, then await follow-up work — surfacing its failure as a toast
 * instead of letting Raycast kill it silently. */
export async function settleOutcome(result: CaptureResult): Promise<void> {
  const outcome: CaptureOutcome =
    typeof result === "string" ? { ack: result } : result;
  if (outcome.ack) await showHUD(outcome.ack);
  if (outcome.followUp) {
    try {
      await outcome.followUp;
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: outcome.followUpFailureTitle ?? "Capture follow-up failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
