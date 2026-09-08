import { parseInline, parseMarkdown } from "@/lib/markdown";

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((span, index) => (span.bold ? <strong key={index}>{span.text}</strong> : <span key={index}>{span.text}</span>))}
    </>
  );
}

/** The digest as rendered text with real headings, at most 70 characters a line (design-brief §5 A5). */
export function Markdown({ source }: { source: string }) {
  return (
    <div className="max-w-[70ch] text-body-lg leading-7">
      {parseMarkdown(source).map((block, index) => {
        if (block.type === "heading") {
          if (block.level === 1) {
            return (
              <h2 key={index} className="font-display text-heading font-bold">
                <Inline text={block.text} />
              </h2>
            );
          }
          return (
            <h3 key={index} className="mt-7 font-display text-body-lg font-bold">
              <Inline text={block.text} />
            </h3>
          );
        }
        if (block.type === "list") {
          return (
            <ul key={index} className="mt-2 list-disc space-y-1.5 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inline text={item} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index} className="mt-2">
            <Inline text={block.text} />
          </p>
        );
      })}
    </div>
  );
}
