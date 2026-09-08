/**
 * The small subset of Markdown the digest uses (lib/pipeline/digest.ts): "#" and "##"
 * headings, bullets with two-space continuation lines, paragraphs, **bold**. Parsed into
 * blocks here (pure, tested) and rendered by components/admin/Markdown.tsx. Nothing is ever
 * treated as HTML, so model output cannot inject markup.
 */

export type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;

export function parseMarkdown(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (list && list.length > 0) blocks.push({ type: "list", items: list });
    list = null;
  };

  for (const rawLine of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2].trim() });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      flushParagraph();
      list = list ?? [];
      list.push(bullet[1].trim());
      continue;
    }
    if (list && list.length > 0) {
      // a wrapped bullet continues on the next line, indented or not
      list[list.length - 1] = `${list[list.length - 1]} ${line.trim()}`;
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks;
}

export type InlineSpan = { bold: boolean; text: string };

/** Splits "**bold** and plain" into spans; stray asterisks stay as text. */
export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) spans.push({ bold: false, text: text.slice(last, match.index) });
    spans.push({ bold: true, text: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) spans.push({ bold: false, text: text.slice(last) });
  return spans;
}

/** The digest as plain text for a WhatsApp message: headings as lines, bullets as "•". */
export function markdownToPlainText(source: string): string {
  const lines: string[] = [];
  for (const block of parseMarkdown(source)) {
    if (lines.length > 0) lines.push("");
    if (block.type === "heading") lines.push(stripBold(block.text));
    else if (block.type === "paragraph") lines.push(stripBold(block.text));
    else for (const item of block.items) lines.push(`• ${stripBold(item)}`);
  }
  return lines.join("\n");
}

function stripBold(text: string): string {
  return parseInline(text)
    .map((span) => span.text)
    .join("");
}
