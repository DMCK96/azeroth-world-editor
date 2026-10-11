/** A run of text in a note line */
export interface NoteSpan {
  text: string;
  bold: boolean;
}

/** One line of a release's notes */
export type NoteBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; spans: NoteSpan[] }
  | { kind: 'bullet'; spans: NoteSpan[] }
  | { kind: 'paragraph'; spans: NoteSpan[] };

// A link's address may hold one level of parentheses, so `javascript:alert(1)` is consumed whole.
const ADDRESS = String.raw`(?:[^()]|\([^()]*\))*`;
const IMAGE = new RegExp(String.raw`!\[[^\]]*\]\(${ADDRESS}\)`, 'g');
const LINK = new RegExp(String.raw`\[([^\]]*)\]\(${ADDRESS}\)`, 'g');
const BOLD = /\*\*(.+?)\*\*/g;

/** The line's spans: images gone, links reduced to their text, `**bold**` marked. Nothing else is interpreted. */
function spansOf(line: string): NoteSpan[] {
  const text = line.replace(IMAGE, '').replace(LINK, '$1');
  const spans: NoteSpan[] = [];
  const push = (part: string, bold: boolean): void => {
    if (part === '') return;
    const last = spans.at(-1);
    if (last && last.bold === bold) last.text += part;
    else spans.push({ text: part, bold });
  };
  let at = 0;
  for (const m of text.matchAll(BOLD)) {
    push(text.slice(at, m.index), false);
    push(m[1]!, true);
    at = m.index + m[0].length;
  }
  push(text.slice(at), false);
  return spans.some((s) => s.text.trim() !== '') ? spans : [];
}

/**
 * Release notes (GitHub markdown) as plain data: a heading, bullet or paragraph per line. The caller
 * prints every `text` as text, so markup in a note can never become markup on screen, and a link
 * keeps only its words (a commit hash stays visible, but nothing is clickable).
 */
export function parseNotes(markdown: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const spans = spansOf(heading ? heading[2]! : bullet ? bullet[1]! : line);
    if (spans.length === 0) continue;
    if (heading) blocks.push({ kind: 'heading', level: Math.min(heading[1]!.length, 3) as 1 | 2 | 3, spans });
    else if (bullet) blocks.push({ kind: 'bullet', spans });
    else blocks.push({ kind: 'paragraph', spans });
  }
  return blocks;
}
