import { CaptureStore } from "../store";

const [root, timestamp] = process.argv.slice(2);
if (!root || !timestamp) throw new Error("Expected store root and timestamp");

const committed = new CaptureStore(root).commit(
  {
    kind: "clipboard",
    primary: { name: "content.txt", data: Buffer.from("concurrent") },
    text: { status: "done", method: "pasteboard" },
  },
  new Date(timestamp),
);
process.stdout.write(committed.id);
