import { describe, expect, it } from 'vitest';
import { parseNotes } from '../../src/core/updates/notes';

const plain = (text: string) => ({ text, bold: false });

describe('parseNotes', () => {
  it('reads headings, bullets and paragraphs, one block per line, skipping blank lines', () => {
    expect(parseNotes('## What changed\n\n- Fixed the export (abc1234)\n* Added a thing\nSee below')).toEqual([
      { kind: 'heading', level: 2, spans: [plain('What changed')] },
      { kind: 'bullet', spans: [plain('Fixed the export (abc1234)')] },
      { kind: 'bullet', spans: [plain('Added a thing')] },
      { kind: 'paragraph', spans: [plain('See below')] },
    ]);
  });
  it('caps heading depth at 3', () => {
    expect(parseNotes('###### Deep')[0]).toMatchObject({ kind: 'heading', level: 3 });
    expect(parseNotes('# Top')[0]).toMatchObject({ kind: 'heading', level: 1 });
  });
  it('marks bold runs', () => {
    expect(parseNotes('- a **bold** word')[0]).toEqual({ kind: 'bullet', spans: [plain('a '), { text: 'bold', bold: true }, plain(' word')] });
  });
  it('turns a link into its text, so the commit hash stays visible and no link remains', () => {
    expect(parseNotes('- Fix export ([abc1234](https://github.com/DMCK96/azeroth-world-editor/commit/abc1234))')[0]).toEqual({
      kind: 'bullet',
      spans: [plain('Fix export (abc1234)')],
    });
  });
  it('drops images and keeps javascript: links as inert text only', () => {
    expect(parseNotes('![shot](https://x/y.png) after')[0]).toEqual({ kind: 'paragraph', spans: [plain(' after')] });
    expect(parseNotes('[click](javascript:alert(1))')[0]).toEqual({ kind: 'paragraph', spans: [plain('click')] });
  });
  it('leaves raw HTML as literal text', () => {
    expect(parseNotes('<script>alert(1)</script>')[0]).toEqual({ kind: 'paragraph', spans: [plain('<script>alert(1)</script>')] });
  });
  it('handles Windows line endings and empty input', () => {
    expect(parseNotes('- a\r\n- b')).toHaveLength(2);
    expect(parseNotes('')).toEqual([]);
    expect(parseNotes('   \n \n')).toEqual([]);
  });
  it('leaves an unclosed ** alone', () => {
    expect(parseNotes('2 ** 3')[0]).toEqual({ kind: 'paragraph', spans: [plain('2 ** 3')] });
  });
});
