import { fileURLToPath } from "node:url";

/** Clipboard file entries have arrived as both plain paths and file:// URIs
 * across Raycast versions — normalize either form (fileURLToPath also decodes
 * percent-encoding correctly, e.g. spaces). */
export function clipboardFilePath(file: string): string {
  return file.startsWith("file://") ? fileURLToPath(file) : file;
}
