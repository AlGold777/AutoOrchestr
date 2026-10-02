#!/usr/bin/env node
// Deterministic digest of an extension report — every number is computed here, not by a model.
//
//   node scripts/summarize-report.js "<report>.json" [more.json ...]
//
// Understands both exports:
//   * message-delivery report   ({ report: 'message-delivery', diagnosis, journal })
//   * Disput Flow export        ({ metadata.debateRunId, stageExecutions, events, delivery?, ... })
//
// Output rules (docs/report-analysis-prompt.md):
//   * a value read from the file carries its path (`events[12]`, `delivery.journal[40]`);
//   * a computed value is marked `calc:` with its formula;
//   * "no field", null, "", [] and "0 records" are different answers and are printed as such;
//   * events are joined to a transport request by explicit identifiers (requestId, dispatchId);
//     a join by stageId + model only is labelled, never presented as proof;
//   * facts only: no causes, no advice.
'use strict';
const fs = require('fs');

const digest = require('../shared/report-digest');
const { summarizeDisputFlow, summarizeDelivery } = digest;

function summarize(file) {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (d.report === 'message-delivery') return summarizeDelivery(d);
  if (d.metadata?.debateRunId || Array.isArray(d.stageExecutions)) return summarizeDisputFlow(d);
  throw new Error(`${file}: unknown report type (top-level keys: ${Object.keys(d).slice(0, 8).join(', ')})`);
}

if (require.main === module) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('usage: node scripts/summarize-report.js <report.json> [more.json ...]');
    process.exit(1);
  }
  files.forEach((file) => {
    try {
      console.log(`# ${file.split('/').pop()}\n${summarize(file)}\n`);
    } catch (error) {
      console.error(String(error.message || error));
      process.exitCode = 1;
    }
  });
}

module.exports = { summarize, ...digest };
