// The document marks ([[DOC: id]] … [[/DOC]]) are not part of a document: the extracted text, the answer text and
// the text of an owner's document carry none of them.
const Output = require('../disput/basic-output');

const RAW = [
  'Пояснение до документа.',
  '[[DOC: art-final]]',
  'Архитектура MVP',
  '',
  '1. Цели',
  '[[/DOC]]',
  'Пояснение после документа.',
  '[[AO-abc123]]'
].join('\n');

describe('Basic output: document marks never reach the document text', () => {
  test('extractDocument returns the text between the marks without any mark', () => {
    const doc = Output.extractDocument(RAW, 'art-final');
    expect(doc).toBe('Архитектура MVP\n\n1. Цели');
    expect(doc).not.toMatch(/\[\[\/?DOC/);
  });

  test('a stray mark inside the block is removed from the document', () => {
    const doc = Output.extractDocument('[[DOC: d]]Текст [[DOC: d]] еще[[/DOC]]', 'd');
    expect(doc).toBe('Текст  еще');
  });

  test('cleanAnswer and stripDocumentMarks drop the marks and the delivery mark', () => {
    expect(Output.cleanAnswer(RAW)).not.toMatch(/\[\[\/?DOC|\[\[AO-/);
    expect(Output.stripDocumentMarks('a [[DOC: x]] b [[/DOC]] c')).toBe('a  b  c');
  });

  test('checkAnswer hands the document without marks', () => {
    const output = { format: 'text', document: 'read', artifacts: [{ id: 'art-final', pointer: '' }] };
    const result = Output.checkAnswer(RAW, output, { limit: 1000 });
    expect(result.ok).toBe(true);
    expect(result.documents['art-final']).not.toMatch(/\[\[\/?DOC/);
  });
});
