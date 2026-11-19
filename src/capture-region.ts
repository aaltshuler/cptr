import { captureRegion } from "./lib/engines";
import { runCapture } from "./lib/run";

export default async function Command() {
  await runCapture(captureRegion, { closeFirst: true });
}
