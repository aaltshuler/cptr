import { capturePDFs } from "./lib/engines";
import { runCapture } from "./lib/run";

export default async function Command() {
  await runCapture(capturePDFs);
}
