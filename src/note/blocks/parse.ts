export type Block =
  | { kind: "todo"; checked: boolean; text: string }
  | { kind: "callout"; calloutType: string; title: string; body: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "text"; lines: string[] };

const TODO_RE = /^- \[([ xX])\](?: (.*))?$/;
const CALLOUT_RE = /^>\s*\[!(\w+)\]\s?(.*)$/;

/** Strip one leading `>` and an optional following space: "> a" → "a", ">" → "". */
function stripQuote(line: string): string {
  return line.replace(/^>\s?/, "");
}

export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }

    const todo = TODO_RE.exec(line);
    if (todo) {
      blocks.push({ kind: "todo", checked: todo[1] !== " ", text: todo[2] ?? "" });
      i++;
      continue;
    }

    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i]);
        i++;
      }
      const head = CALLOUT_RE.exec(quoteLines[0]);
      if (head) {
        blocks.push({
          kind: "callout",
          calloutType: head[1],
          title: head[2],
          body: quoteLines.slice(1).map(stripQuote),
        });
      } else {
        blocks.push({ kind: "quote", lines: quoteLines.map(stripQuote) });
      }
      continue;
    }

    const textLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith(">") &&
      !TODO_RE.test(lines[i])
    ) {
      textLines.push(lines[i]);
      i++;
    }
    blocks.push({ kind: "text", lines: textLines });
  }

  return blocks;
}

/** Re-add the `>` prefix for a callout/quote body line. */
function reQuote(line: string): string {
  return line === "" ? ">" : `> ${line}`;
}

function blockToMarkdown(block: Block): string {
  switch (block.kind) {
    case "todo":
      return `- [${block.checked ? "x" : " "}]${block.text ? ` ${block.text}` : ""}`;
    case "callout": {
      const head = `> [!${block.calloutType}]${block.title ? ` ${block.title}` : ""}`;
      return [head, ...block.body.map(reQuote)].join("\n");
    }
    case "quote":
      return block.lines.map(reQuote).join("\n");
    case "text":
      return block.lines.join("\n");
  }
}

export function serializeBlocks(blocks: Block[]): string {
  let out = "";
  for (let i = 0; i < blocks.length; i++) {
    if (i === 0) {
      out += blockToMarkdown(blocks[i]);
      continue;
    }
    const adjacentTodos = blocks[i - 1].kind === "todo" && blocks[i].kind === "todo";
    out += (adjacentTodos ? "\n" : "\n\n") + blockToMarkdown(blocks[i]);
  }
  return out;
}
