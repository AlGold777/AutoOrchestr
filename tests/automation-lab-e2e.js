// End-to-end check of automation_lab.html inside a real Chromium with the unpacked extension loaded.
// Runs the five-stage pilot in simulator mode (no provider accounts needed), reloads the page in the
// middle to prove IndexedDB persistence, answers the owner questionnaires through the center feed,
// verifies that model answers are shown cleaned (no transport frames), and that the Automation tab
// of the Pipeline telemetry window shows the diagnosis.
//   node tests/automation-lab-e2e.js                       (headless)
//   SHOTS_DIR=/some/dir node tests/automation-lab-e2e.js   (save screenshots)
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const EXT_PATH = path.resolve(__dirname, '..');
const SHOTS_DIR = process.env.SHOTS_DIR || null;
// Use the preinstalled full Chromium when present (headless shell cannot load extensions).
const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

async function main() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automation-lab-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: process.env.HEADED !== '1',
    executablePath,
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`, '--no-first-run', '--no-default-browser-check'],
    viewport: { width: 1600, height: 1000 },
    acceptDownloads: true
  });
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); console.log(`${condition ? 'ok  ' : 'FAIL'} ${message}`); };
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 30000 });
    const extensionId = /chrome-extension:\/\/([^/]+)\//.exec(worker.url())[1];
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    const shot = async (name, target = page) => { if (SHOTS_DIR) await target.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`) }); };
    await page.goto(`chrome-extension://${extensionId}/automation_lab.html`);
    await page.evaluate(() => new Promise((resolve) => chrome.storage.local.set({ tos_acknowledged_v1: true }, resolve)));
    await page.evaluate(() => { localStorage.setItem('automationLab.simulator', 'true'); localStorage.setItem('automationLab.models', JSON.stringify(['Claude', 'GPT', 'Gemini'])); });
    await page.reload();
    await page.waitForSelector('.model-nav-button.is-active');
    check(await page.locator('#lintBanner').isHidden(), 'spec loads and manifest_lint passes in the extension page');
    check((await page.$$eval('.model-nav-button.is-active', (nodes) => nodes.map((n) => n.textContent))).join('|').includes('основная'), 'model bar marks the primary model');
    await shot('0-empty');

    await page.fill('#ideaInput', 'Сервис онлайн-записи к врачу для небольших клиник: пациенты записываются сами, администратор видит расписание.');
    await page.click('#sendBtn');
    await page.waitForSelector('.owner-form input[value=APPROVE]', { timeout: 30000 });
    const center1 = await page.textContent('#centerChat');
    check(center1.includes('Ожидается: 1 вкладка — основная модель Claude'), 'center feed states the stage 1 expectation (1 tab, primary model)');
    check(center1.includes('Decision Policy'), 'DPL approval question appears in the center feed');
    const leftText = await page.textContent('#leftChat');
    check(leftText.includes('принят') && leftText.includes('Snapshot') && leftText.includes('Changes'), 'Claude column shows the accepted answer with its structure');
    await shot('1-dpl-approval');

    await page.reload();
    await page.waitForSelector('.owner-form input[value=APPROVE]', { timeout: 30000 });
    check(true, 'state survives a page reload (IndexedDB)');

    await page.check('.owner-form input[value=APPROVE]');
    await page.click('.owner-form button[type=submit]');
    await page.waitForFunction(() => {
      const form = document.querySelector('.owner-form');
      return form && !form.querySelector('input[value=APPROVE]') && form.querySelector('input[type=radio]');
    }, null, { timeout: 60000 });
    const center2 = await page.textContent('#centerChat');
    check(/Ожидается: 3 вкладки параллельно \(Claude, GPT, Gemini\)/.test(center2), 'center feed states the stage 2 expectation (3 tabs in parallel)');
    check(/Отправлено в новые чаты: Claude, GPT, Gemini \(3 вкладки\)/.test(center2), 'center feed shows the fan-out dispatch to three models');
    const leftTabs = await page.$$eval('#leftTabs .col-tab', (nodes) => nodes.map((n) => n.textContent.replace(' •', '')));
    const rightTabs = await page.$$eval('#rightTabs .col-tab', (nodes) => nodes.map((n) => n.textContent.replace(' •', '')));
    check(leftTabs.join(',') === 'Claude,Gemini' && rightTabs.join(',') === 'GPT', `model columns host all selected models (${leftTabs} | ${rightTabs})`);
    await shot('2-owner-decisions');

    for (const name of await page.$$eval('.owner-form fieldset', (sets) => sets.map((set) => set.querySelector('input').name))) {
      await page.check(`.owner-form input[name="${name}"] >> nth=0`);
    }
    await page.click('.owner-form button[type=submit]');
    await page.waitForFunction(() => /Стадии 1–5 завершены/.test(document.getElementById('stateChip').textContent), null, { timeout: 60000 });
    check(await page.isVisible('.summary-card'), 'final summary card with concept and findings');

    const answers = await page.$$eval('.msg.ok .bubble', (nodes) => nodes.map((n) => n.textContent));
    check(answers.length >= 8, `accepted answers are listed (${answers.length})`);
    check(answers.every((text) => !/PAF_RESPONSE|```/.test(text)), 'answers are shown cleaned: no PAF_RESPONSE markers or JSON fences');
    await page.click('#rightTabs .col-tab >> nth=0').catch(() => {});
    await page.click('#leftTabs .col-tab:has-text("Gemini")');
    check((await page.textContent('#leftChat')).includes('Стадия 5'), 'Gemini tab shows its stage 5 review');
    await shot('3-complete');

    await page.click('#resultsBtn');
    await page.waitForSelector('#resultsModal:not([hidden])');
    check((await page.textContent('#tabResults')).includes('Концепция продукта (PCON)'), 'results modal shows the product concept');
    await page.click('.tabs button[data-tab=diagnostics]');
    await page.waitForSelector('#tabDiagnostics .ald-section');
    const diagText = await page.textContent('#tabDiagnostics');
    check(diagText.includes('критичных проблем нет') && diagText.includes('Транспорт: каждая отправка по моделям'), 'diagnostics tab: no critical problems, transport table present');
    await shot('4-diagnostics');
    await page.click('.tabs button[data-tab=telemetry]');
    check((await page.$$eval('#tabTelemetry tbody tr', (nodes) => nodes.length)) === 3, 'telemetry has one row per provider');
    const [mdDownload] = await Promise.all([page.waitForEvent('download'), page.click('#exportMdBtn')]);
    const markdown = fs.readFileSync(await mdDownload.path(), 'utf8');
    check(markdown.includes('## Концепция продукта') && markdown.includes('## Находки независимого ревью'), 'Markdown export contains concept and findings');
    await page.click('#closeResultsBtn');

    const [reportDownload] = await Promise.all([page.waitForEvent('download'), page.click('#reportBtn')]);
    const report = JSON.parse(fs.readFileSync(await reportDownload.path(), 'utf8'));
    check(report.report === 'automation-lab-diagnostics' && report.journal.length > 20 && report.diagnosis.stages.length === 5, 'report for Claude contains diagnosis and journal');

    const pipeline = await context.newPage();
    pipeline.on('pageerror', (error) => consoleErrors.push(`pipeline: ${error.message}`));
    await pipeline.goto(`chrome-extension://${extensionId}/pipeline_panel.html`);
    await pipeline.waitForTimeout(1500);
    await pipeline.click('#telemetry-toggle-btn');
    await pipeline.waitForSelector('#automation-tab', { state: 'visible', timeout: 15000 });
    await pipeline.click('#automation-tab');
    await pipeline.waitForFunction(() => /Проблемы и что делать/.test(document.getElementById('automation-diagnostics')?.textContent || ''), null, { timeout: 15000 });
    check((await pipeline.textContent('#automation-diagnostics')).includes('Сервис онлайн-записи'), 'Pipeline telemetry window → Automation tab shows the project diagnosis');
    await shot('5-pipeline-automation-tab', pipeline);

    check(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `: ${consoleErrors.join(' | ')}` : ''}`);
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log('\nautomation_lab e2e: all checks passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
