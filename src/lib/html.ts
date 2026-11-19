export function htmlToPlainText(html: string): string {
  return decodeHTMLEntities(
    html
      .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHTMLEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return text.replace(
    /&(#x[\da-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi,
    (entity, value: string) => {
      const lower = value.toLowerCase();
      if (!lower.startsWith("#")) return named[lower] ?? entity;

      const codePoint = Number.parseInt(
        lower.startsWith("#x") ? lower.slice(2) : lower.slice(1),
        lower.startsWith("#x") ? 16 : 10,
      );
      return Number.isInteger(codePoint) &&
        codePoint >= 0 &&
        codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    },
  );
}
