// End-to-end check of automation_lab.html inside a real Chromium with the unpacked extension loaded.
// Runs the five-stage pilot in simulator mode (no provider accounts needed), reloads the page in the
// middle to prove IndexedDB persistence, answers the owner questionnaires through the UI and
// verifies results, registry, telemetry and the Markdown export.
//   node tests/automation-lab-e2e.js            (headless)
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
    viewport: { width: 1440, height: 1000 },
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
    const url = `chrome-extension://${extensionId}/automation_lab.html`;
    await page.goto(url);
    await page.evaluate(() => new Promise((resolve) => chrome.storage.local.set({ tos_acknowledged_v1: true }, resolve)));
    await page.evaluate(() => localStorage.setItem('automationLab.simulator', 'true'));
    await page.reload();
    await page.waitForFunction(() => /spec v2\.2\.4/.test(document.getElementById('specBadge').textContent));
    check(await page.locator('#lintBanner').isHidden(), 'spec loads and manifest_lint passes in the extension page');
    const shot = async (name) => { if (SHOTS_DIR) await page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`), fullPage: true }); };

    await page.fill('#ideaInput', 'Сервис онлайн-записи к врачу для небольших клиник: пациенты записываются сами, администратор видит расписание.');
    await page.click('#newProjectForm button[type=submit]');
    await page.waitForSelector('#ownerPanel:not([hidden])', { timeout: 30000 });
    check((await page.textContent('#ownerForm')).includes('Decision Policy'), 'stage 1 committed and DPL approval questionnaire shown');
    await shot('1-dpl-approval');

    await page.reload();
    await page.waitForSelector('#ownerPanel:not([hidden])', { timeout: 30000 });
    check(true, 'state survives a page reload (IndexedDB)');

    await page.check('#ownerForm input[value=APPROVE]');
    await page.click('#ownerForm button[type=submit]');
    await page.waitForFunction(() => {
      const form = document.getElementById('ownerForm');
      return !document.getElementById('ownerPanel').hidden && !form.querySelector('input[value=APPROVE]') && form.querySelector('input[type=radio]');
    }, null, { timeout: 60000 });
    check(true, 'stages 2 (fan-out) and 3 committed; owner decision questions shown');
    await shot('2-owner-decisions');
    for (const name of await page.$$eval('#ownerForm fieldset', (sets) => sets.map((set) => set.querySelector('input').name))) {
      await page.check(`#ownerForm input[name="${name}"] >> nth=0`);
    }
    await page.click('#ownerForm button[type=submit]');
    await page.waitForFunction(() => /Стадии 1–5 завершены/.test(document.getElementById('stateBadge').textContent), null, { timeout: 60000 });
    check(true, 'stages 4 and 5 committed; project reached PILOT_COMPLETE');

    const results = await page.textContent('#tabResults');
    check(results.includes('Концепция продукта (PCON)'), 'results show the product concept');
    check(/Находки ревью \(6\)/.test(results), 'results show 6 independent review findings (2 per model × 3 models)');
    const stageBadges = await page.$$eval('.stage-card .badge', (nodes) => nodes.map((node) => node.textContent));
    check(stageBadges.filter((text) => text === 'Зафиксирована').length === 5, 'all five stage cards show "Зафиксирована"');
    await shot('3-results');

    const openTab = async (name, selector) => {
      await page.click(`.tabs button[data-tab=${name}]`);
      await page.waitForFunction((sel) => document.querySelectorAll(sel).length > 0, selector, { timeout: 10000 }).catch(() => {});
    };
    await openTab('registry', '#tabRegistry tbody tr');
    const rows = await page.$$eval('#tabRegistry tbody tr', (nodes) => nodes.length);
    check(rows >= 25, `registry lists canonical objects (${rows})`);
    await openTab('calls', '#tabCalls section');
    check((await page.$$eval('#tabCalls section', (nodes) => nodes.length)) === 5, 'calls tab shows five stage executions');
    await page.click('#tabCalls button:has-text("Промпт") >> nth=0');
    check((await page.textContent('#textDialogBody')).includes('## ACTIVE'), 'prompt viewer shows the compiled layered prompt');
    await page.keyboard.press('Escape');
    await shot('4-calls');
    await openTab('telemetry', '#tabTelemetry tbody tr');
    check((await page.$$eval('#tabTelemetry tbody tr', (nodes) => nodes.length)) === 3, 'telemetry has one row per provider');
    await shot('5-telemetry');

    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportMdBtn')]);
    const markdown = fs.readFileSync(await download.path(), 'utf8');
    check(markdown.includes('## Концепция продукта') && markdown.includes('## Находки независимого ревью'), 'Markdown export contains concept and findings');

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
