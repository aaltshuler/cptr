import { LaunchProps, showHUD, showToast, Toast } from "@raycast/api";
import { reprocessAck, reprocessBundles } from "./lib/reprocess";
import { prefs, store } from "./lib/support";

export default async function Command(
  props: LaunchProps<{ arguments: { scope?: string } }>,
) {
  // A pass over a large archive takes a while and must never be silent.
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: "Reprocessing captures…",
  });
  try {
    const report = await reprocessBundles(store(), {
      scope: props.arguments.scope === "all" ? "all" : "missing",
      ocr: prefs().recognizeText !== false,
      onProgress: (done, total) => {
        toast.title = `Reprocessing captures… ${done} of ${total}`;
      },
    });
    await toast.hide();
    await showHUD(reprocessAck(report));
  } catch (err) {
    toast.style = Toast.Style.Failure;
    toast.title = "Reprocessing failed";
    toast.message = err instanceof Error ? err.message : String(err);
  }
}
