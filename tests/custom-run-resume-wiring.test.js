const fs = require('fs');
const path = require('path');

// The page (results.js) passes the record's callbacks and the saved state to the engine. These checks read the wiring:
// the page path itself (windows, transport) is verified on the page, not here.
const results = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

describe('Basic page binds the engine to the run record (8.2, 8.3)', () => {
  test('the texts go to the record: putText is record.put, getText reads record.texts', () => {
    expect(results).toContain('putText: (value) => record.put(value),');
    expect(results).toContain('getText: (ref) => (ref && record.texts[ref] !== undefined ? record.texts[ref] : undefined)');
  });

  test('the checkpoint writes the registry and the snapshot, and waits for the write (a failed write stops the run)', () => {
    expect(results).toContain('...(record && customRunStore ? { checkpoint: checkpointRecord } : {}),');
    expect(results).toMatch(/const checkpointRecord = \(state\) => \{[\s\S]*?setArtifacts\(record, state\.artifacts\);[\s\S]*?setSnapshot\(record[\s\S]*?return writeRecord\(\);\s*\};/);
  });

  test('writes of the record go one after another, debounced ones too', () => {
    expect(results).toMatch(/const writeRecord = \(\) => \{\s*const next = recordWrites\.then\(\(\) => (?:\{\s*runCardHistory\?\.flush\(\);\s*return\s+)?customRunStore\.save\(record\)/);
    expect(results).toContain("const write = () => writeRecord().catch((error) => console.warn('[RESULTS] Custom run record not saved', error));");
  });

  test('«Продолжить прогон» takes the latest record only when it has a saved state, and goes on with its own schema and state', () => {
    expect(results).toContain('if (!window.CustomRunRecord.canResume(latest)) {');
    expect(results).toContain('const builtFromRecord = (record) => {');
    // The steps the run started with come from the snapshot; an older record has only its schema (plan 4.6).
    expect(results).toContain('const steps = Array.isArray(record.snapshot?.steps) ? record.snapshot.steps : window.BasicSchema.assemble(schema, { roleText: customRoleText });');
    expect(results).toContain('...(resumeRecord ? { resume: { ...resumeRecord.snapshot, artifacts: resumeRecord.artifacts } } : {}),');
    expect(results).toContain('pipelineRunId: resumeRecord ? resumeRecord.runId : makePipelineRunId(),');
    expect(results).toContain('resumeCustomFromPage,');
  });

  test('the end notice of a run names the detail of the stop (the address of a missing input) after the reason', () => {
    expect(results).toContain('showNotification(basicRunNotice(stopText, result.answers.length, result.stopDetail), result.stopReason');
    expect(results).toMatch(/const basicRunNotice = \(stopText, acceptedCount, stopDetail = ''\) => `Basic: \$\{stopText\}\$\{stopDetail \? ` \(\$\{stopDetail\}\)` : ''\}\./);
  });

  test('«Продолжить» is offered as a line of the feed after a run that did not finish, not as a button of the panel', () => {
    const panel = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
    expect(panel).not.toContain('pipeline-resume-btn');
    expect(results).toContain("if (result.stopReason !== 'steps_done') offerResumeLine(record);");
    // A stop a continuation would only repeat offers none; the button goes on with its own run (plan 4.2).
    expect(results).toMatch(/const offerResumeLine = \(record\) => \{\s*if \(!record \|\| !window\.CustomRunRecord\?\.canResume\?\.\(record\) \|\| DEAD_END_STOPS\.includes\(record\.stopReason\)\) return;/);
    expect(results).toContain("const DEAD_END_STOPS = Object.freeze(['context_full', 'missing_input', 'unsupported_input']);");
    expect(results).toContain("buttonLabel: 'Продолжить',");
    expect(results).toContain('void resumeCustomFromPage(record.runId); }');
  });

  test('V01: the page writes the chats into the record while the batch is in flight, and marks a lost chat of a resumed participant strict', () => {
    expect(results).toContain('const bindingsWatch = record ? setInterval(() => { void syncParticipantChats(runContext.pipelineRunId, wave); }, 1000) : null;');
    expect(results).toContain('} finally { if (bindingsWatch) clearInterval(bindingsWatch); }');
    expect(results).toContain('window.CustomRunRecord.setChatBindings(record, chatBindings)');
    expect(results).toMatch(/const strict = Boolean\(resumeRecord\) && !isNewChat\(request\) && !binding\s*&& \(record\.attempts \|\| \[\]\)\.some\(\(item\) => item\.participant === request\.participantId\);/);
    const orchestrator = fs.readFileSync(path.join(__dirname, '..', 'background', 'job-orchestrator.js'), 'utf8');
    expect(orchestrator).toContain('strict: participant.strict === true,');
  });

  test('R07: the windows of a run get the signal of the run, so a Stop closes them', () => {
    expect(results).toContain('return window.ChoiceDialog.ask({ signal: customAbortController?.signal, ...options });');
  });

  test('V08: a new run keeps its files in the record, and a resume without the stored files is refused', () => {
    expect(results).toContain('window.CustomRunRecord.setAttachments(record, attachments) === false');
    expect(results).toContain('if (latest.attachmentsStored === false) {');
  });

  test('the run takes the limit of the schema, and the decision window offers «Продолжить» only where the engine allows it', () => {
    expect(results).toContain('runMaxWords: built.run.maxWords,');
    expect(results).toMatch(/const canContinue = choices\.includes\('continue'\);[\s\S]*?confirmText: canContinue \? 'Продолжить' : 'Пропустить участника'/);
  });

  test('B-8: без модулей приёма ответов страница не принимает всё молча (нет заглушки { ok: true })', () => {
    expect(results).not.toContain('|| { ok: true }');
    expect(results).toContain('не загружены модули приёма ответов');
    expect(results).not.toContain('DebateResponseAcceptance?.evaluate?.(');
  });

  test('the owner answer and the unknown request are asked in windows (A06), no guessed answer is passed; there is no route choice', () => {
    expect(results).toContain('provideOwnerResult: async (request) => {');
    expect(results).toContain('const { stepRef, task, goal, input, output, document, reason, detail } = request;');
    expect(results).toContain('window.StageCard.ownerAskMessage({ task, goal, input, output, reason, detail,');
    expect(results).not.toContain('chooseRoute');
    expect(results).toContain("resolveUnknown: ({ stepRef, items, choices = ['resend', 'skip'] }) => askChoiceDialog({");
    expect(results).toContain("const askChoiceDialog = (options) => {");
  });
});

describe('Этап 1: документ для User в запуске', () => {
  test('этап 1: карточка шага передаёт источники документа, окно User принимает документ и не требует текст при документе', () => {
    expect(results).toContain('documentSources: documentSourcesFor(step.ref)');
    expect(results).toContain("textInput: document ? null : { label: 'Ответ User', required: true }");
    expect(results).toContain("answerFormat: output?.format === 'json' ? 'json' : 'text'");
  });
});

describe('Этап 2: документы в запуске', () => {
  test('страница не хранит документы отдельно: рамки и окно строятся из записи прогона', () => {
    expect(results).not.toContain('BasicDocuments');
    expect(results).not.toContain('llmComparatorDocuments');
  });
});

describe('T08: повтор схемы на странице', () => {
  test('the start hands a schema with run.repeat to runBasicRepeat, the others go on as before', () => {
    expect(results).toContain('if (repeat) return runBasicRepeat({ task, repeat });');
    expect(results).toMatch(/const \{ repeat \} = buildBasicRun\(draftPlanForCanvas\(getActiveDraftPlan\(\)\)\)\.run;/);
  });

  test('the repeat lock is taken before the first await and released in finally (F2)', () => {
    expect(results).toMatch(/const runBasicRepeat = async \(\{ task, repeat \}\) => \{[\s\S]*?pipelineRunActive = true;\s*basicRepeatActive = true;[\s\S]*?const \{ repeat \}/);
    expect(results).toMatch(/finally \{\s*customAbortController = null;\s*basicRepeatActive = false;\s*pipelineRunActive = false;/);
  });

  test('Stop marks the repeat as stopped first, before it aborts the pass or a window', () => {
    expect(results).toMatch(/const cancelPipelineRun = async \(\) => \{\s*basicRepeatStop = true;/);
  });

  test('every pass is an ordinary run with new chats (forceNewTabs), and the run takes its own record', () => {
    expect(results).toContain('await runCustomFromPage({ task: passTask(pass, carried, passesLeft(requestsUsed)), forceNewTabs: true });');
    expect(results).toContain('forceNewTabs: forceNewTabs || (newPagesCheckbox ? newPagesCheckbox.checked : true),');
  });

  test('the request count of a pass comes from the autosave report, the upper bound is the fallback', () => {
    expect(results).toContain('const sent = lastBasicAutosave?.usage?.requestsUpperBound;');
    expect(results).toContain('requestsUsed += typeof sent === \'number\' ? sent : requestsPerPass;');
    expect(results).toContain('return { ...result, usage: report?.usage ?? null };');
  });

  test('the repeat is cleared in finally, so an exception leaves the page free', () => {
    expect(results).toMatch(/\} catch \(error\) \{\s*stopNotice\(`повтор остановлен из-за ошибки: [^`]*`, 'error'\);\s*return finished > 0;\s*\} finally \{\s*customAbortController = null;\s*basicRepeatActive = false;\s*pipelineRunActive = false;\s*setPipelineRunUi\(false\);\s*updateDebateButtonsUi\(\);/);
  });
});

describe('T03: запись прогона на диск и строка цепочки', () => {
  const panel = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');

  test('the export button and the autosave build the report with the same function', () => {
    expect(results).toContain('const buildBasicReportNow = async ({ record = null, executionActive = null } = {}) => {');
    expect(results).toContain('const report = await buildBasicReportNow();');
    expect(results).toContain('buildBasicReportNow({ record, executionActive: false })');
  });

  test('the report of the export and of the autosave carries the sections of the task', () => {
    expect(results).toContain('report.taskSections = await window.BasicRunChain.taskSections(report.customRun.task);');
  });

  test('the autosave runs after the final save of the record and after the end notice (a failed save stays visible), and keeps its result', () => {
    expect(results).toContain('const autosaveRun = async () => {');
    expect(results).toMatch(/showNotification\(basicRunNotice\(stopText[^\n]*\n\s*\/\/[^\n]*\n\s*lastBasicAutosave = await autosaveRun\(\);/);
    expect(results).toMatch(/if \(record\) \{ window\.CustomRunRecord\.finishRun\(record, \{ stopReason: 'error' \}\); await saveRecord\(true\); \}\s*lastBasicAutosave = await autosaveRun\(\);/);
    expect(results).toContain('let lastBasicAutosave = null;');
  });

  test('the autosave writes through the chain module with the documents folder and the run folders', () => {
    expect(results).toContain('window.BasicRunChain.saveRun({ folder, dirs: window.DocumentsFolder.runDirs({ pipeline: customPipelineName(), startedAt: runContext.startedAt }), report, at: new Date().toISOString() })');
  });

  test('a failed autosave without a folder is silent; a denied or failed one gives one notice', () => {
    expect(results).toContain('Запись прогона не сохранена в папку: ');
    expect(results).toMatch(/result\.reason === 'denied' \|\| result\.reason === 'error'/);
  });

  test('the chain module loads before the page script', () => {
    expect(panel.indexOf('disput/basic-run-chain.js')).toBeGreaterThan(-1);
    expect(panel.indexOf('disput/basic-run-chain.js')).toBeLessThan(panel.indexOf('src="results.js"'));
  });
});
