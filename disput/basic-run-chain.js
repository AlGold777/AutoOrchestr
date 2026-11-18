// Run chain: every saved run of a Basic pipeline is a file in the documents folder plus one line in chain.txt.
// A line is "<number> <time UTC> <file path> <SHA-256 of the file> <SHA-256 of the previous line>", fields separated by spaces.
// The SHA-256 of the previous line is taken from the line and its '\n', as `tail -n 1 chain.txt | shasum -a 256` does.
// The module only counts, compares and writes; it does not read the content of answers.
(function initBasicRunChain(root) {
  'use strict';

  const HEADING = /^=== (.+) ===\s*$/;

  const subtle = () => {
    if (root.crypto && root.crypto.subtle) return root.crypto.subtle;
    return require('crypto').webcrypto.subtle;
  };

  // SHA-256 of the UTF-8 bytes of a string as 64 lowercase hex digits.
  const sha256Hex = async (text) => {
    const bytes = new TextEncoder().encode(String(text == null ? '' : text));
    const digest = new Uint8Array(await subtle().digest('SHA-256', bytes));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  };

  // The task split by lines "=== TITLE ===". Each section is an exact piece of the text from its heading to the next heading.
  // The text before the first heading (if not empty) is a section with an empty title.
  const sectionsOf = (task) => {
    const text = String(task == null ? '' : task);
    const starts = [];
    let offset = 0;
    text.split('\n').forEach((line) => {
      const match = HEADING.exec(line.replace(/\r$/, ''));
      if (match) starts.push({ index: offset, title: match[1].trim() });
      offset += line.length + 1;
    });
    const sections = [];
    const first = starts.length ? starts[0].index : text.length;
    if (first > 0) sections.push({ title: '', text: text.slice(0, first) });
    starts.forEach((start, i) => {
      const end = i + 1 < starts.length ? starts[i + 1].index : text.length;
      sections.push({ title: start.title, text: text.slice(start.index, end) });
    });
    return sections;
  };

  // Title, length and SHA-256 of every section of the task.
  const taskSections = async (task) => Promise.all(sectionsOf(task).map(async (section) => ({
    title: section.title,
    chars: section.text.length,
    sha256: await sha256Hex(section.text)
  })));

  // One line of the chain; spaces in the path become %20 so that the line has exactly five fields.
  const chainLine = ({ number, at, file, fileSha256, prevSha256 }) => [
    number,
    at,
    String(file).replace(/ /g, '%20'),
    fileSha256,
    prevSha256
  ].join(' ');

  const nonEmptyLines = (chainText) => String(chainText == null ? '' : chainText)
    .split('\n')
    .filter((line) => line.trim() !== '');

  // The last line that is not empty, or null.
  const lastLine = (chainText) => {
    const lines = nonEmptyLines(chainText);
    return lines.length ? lines[lines.length - 1] : null;
  };

  // The next line of the chain for a file, and the whole chain text with that line.
  const append = async (chainText, { at, file, fileText }) => {
    const text = String(chainText == null ? '' : chainText);
    const last = lastLine(text);
    const line = chainLine({
      number: nonEmptyLines(text).length + 1,
      at,
      file,
      fileSha256: await sha256Hex(fileText),
      prevSha256: last === null ? '-' : await sha256Hex(`${last}\n`)
    });
    const base = text === '' || text.endsWith('\n') ? text : `${text}\n`;
    return { line, text: `${base}${line}\n` };
  };

  // Checks the fifth field of every line from the second one: it must be the SHA-256 of the line before.
  // brokenAt is the number (from 1) of the first line that does not match, or null.
  const verify = async (chainText) => {
    const lines = nonEmptyLines(chainText);
    for (let i = 1; i < lines.length; i += 1) {
      const expected = await sha256Hex(`${lines[i - 1]}\n`);
      if (lines[i].split(' ')[4] !== expected) return { ok: false, brokenAt: i + 1 };
    }
    return { ok: true, brokenAt: null };
  };

  const failure = (result) => ({ ok: false, reason: result.reason, message: result.message || '' });

  // Writes a run to dirs (the folders of the run) and adds its line to chain.txt in the root of the folder.
  // folder is what DocumentsFolder.create returns: ensureAccess, readAt, writeAt.
  const saveRun = async ({ folder, dirs, report, at }) => {
    try {
      const access = await folder.ensureAccess({ request: false });
      if (access !== 'granted') return { ok: false, reason: access === 'none' ? 'none' : 'denied', message: '' };

      const text = JSON.stringify(report, null, 2);
      const written = await folder.writeAt({ dirs, file: `run_${report.runId}.json`, text });
      if (!written.ok) return failure(written);

      const chain = await folder.readAt({ dirs: [], file: 'chain.txt' });
      if (!chain.ok && chain.reason !== 'missing') return failure(chain);

      const appended = await append(chain.ok ? chain.text : '', {
        at: at || new Date().toISOString(),
        file: written.path,
        fileText: text
      });
      const saved = await folder.writeAt({ dirs: [], file: 'chain.txt', text: appended.text });
      if (!saved.ok) return failure(saved);

      const fields = appended.line.split(' ');
      return {
        ok: true,
        path: written.path,
        line: appended.line,
        number: Number(fields[0]),
        fileSha256: fields[3]
      };
    } catch (error) {
      return { ok: false, reason: 'error', message: String(error?.message || error) };
    }
  };

  const api = Object.freeze({
    sha256Hex,
    sectionsOf,
    taskSections,
    chainLine,
    lastLine,
    append,
    verify,
    saveRun
  });
  root.BasicRunChain = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
