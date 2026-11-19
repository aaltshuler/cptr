import { LaunchProps, showToast, Toast } from "@raycast/api";
import { captureWeb } from "./lib/engines";
import { settleOutcome } from "./lib/run";

export default async function Command(
  props: LaunchProps<{ arguments: { url?: string } }>,
) {
  // Two-phase ack: the render takes seconds and must never be silent.
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: "Capturing page…",
  });
  try {
    const result = await captureWeb(props.arguments.url);
    await toast.hide();
    await settleOutcome(result);
  } catch (err) {
    toast.style = Toast.Style.Failure;
    toast.title = "Page capture failed";
    toast.message = err instanceof Error ? err.message : String(err);
  }
}
