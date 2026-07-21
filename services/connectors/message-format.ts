const TABLE_SEPARATOR_CELL = /^:?-{3,}:?$/;

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function tableCells(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isTableRow(line: string) {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && tableCells(line).length > 1;
}

function isTableSeparator(line: string) {
  return isTableRow(line) && tableCells(line).every((cell) => TABLE_SEPARATOR_CELL.test(cell));
}

function formatTelegramInline(value: string) {
  const tokens: string[] = [];
  const stash = (html: string) => {
    const token = `\u0000${tokens.length}\u0000`;
    tokens.push(html);
    return token;
  };

  let formatted = value
    .replace(/`([^`\n]+)`/g, (_match, code: string) => stash(`<code>${escapeHtml(code)}</code>`))
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label: string, url: string) => (
      stash(`<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`)
    ));

  formatted = escapeHtml(formatted)
    .replace(/\*\*(?=\S)(.+?\S)\*\*/g, "<b>$1</b>")
    .replace(/~~(?=\S)(.+?\S)~~/g, "<s>$1</s>")
    .replace(/(^|[^*])\*(?=\S)([^*]+?\S)\*(?!\*)/g, "$1<i>$2</i>");

  return formatted.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => tokens[Number(index)] || "");
}

function formatTable(lines: string[], start: number, inline: (value: string) => string, strong: (value: string) => string) {
  const header = tableCells(lines[start]);
  const hasHeader = start + 1 < lines.length && isTableSeparator(lines[start + 1]);
  let end = start + (hasHeader ? 2 : 1);
  while (end < lines.length && isTableRow(lines[end]) && !isTableSeparator(lines[end])) end += 1;
  const output: string[] = [];
  if (hasHeader) output.push(header.map((cell) => strong(inline(cell))).join(" · "));
  const firstDataRow = hasHeader ? start + 2 : start;
  for (let index = firstDataRow; index < end; index += 1) {
    output.push(`• ${tableCells(lines[index]).map(inline).join(" — ")}`);
  }
  return { output, end };
}

/** Converts common Markdown emitted by agents into Telegram's safe HTML subset. */
export function formatTelegramMessage(markdown: string) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      if (inCodeBlock) {
        output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
      }
      inCodeBlock = !inCodeBlock;
      index += 1;
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      index += 1;
      continue;
    }
    if (isTableRow(line) && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const table = formatTable(lines, index, formatTelegramInline, (value) => `<b>${value}</b>`);
      output.push(...table.output);
      index = table.end;
      continue;
    }

    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+)$/);
    const quote = line.match(/^\s*>\s?(.*)$/);
    const bullet = line.match(/^\s*[-+*]\s+(.+)$/);
    const ordered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    if (heading) output.push(`<b>${formatTelegramInline(heading[1])}</b>`);
    else if (/^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/.test(line)) output.push("──────────");
    else if (quote) output.push(`<blockquote>${formatTelegramInline(quote[1])}</blockquote>`);
    else if (bullet) output.push(`• ${formatTelegramInline(bullet[1])}`);
    else if (ordered) output.push(`${ordered[1]}. ${formatTelegramInline(ordered[2])}`);
    else output.push(formatTelegramInline(line));
    index += 1;
  }

  if (inCodeBlock) output.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  return output.join("\n");
}

/** Discord renders common Markdown itself, but not Markdown tables. */
export function formatDiscordMessage(markdown: string) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let inCodeBlock = false;
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      output.push(line);
      index += 1;
      continue;
    }
    if (!inCodeBlock && isTableRow(line) && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const table = formatTable(lines, index, (value) => value, (value) => `**${value}**`);
      output.push(...table.output);
      index = table.end;
      continue;
    }
    output.push(line);
    index += 1;
  }
  return output.join("\n");
}
