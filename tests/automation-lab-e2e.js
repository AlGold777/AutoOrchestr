// E2E: automation_lab.html in Chromium with the unpacked extension, simulator mode.
//   node tests/automation-lab-e2e.js      SHOTS_DIR=dir to save screenshots
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const EXT = path.resolve(__dirname, '..');
const SHOTS = process.env.SHOTS_DIR || null;
const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'automation-'));
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, executablePath, viewport: { width: 1600, height: 1000 }, acceptDownloads: true, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  const fails = [];
  const check = (ok, msg) => { if (!ok) fails.push(msg); console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };
  const errors = [];
  try {
    const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    const id = /chrome-extension:\/\/([^/]+)\//.exec(worker.url())[1];
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    const shot = (name, p = page) => SHOTS && p.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    await page.goto(`chrome-extension://${id}/automation_lab.html`);
    await page.evaluate(() => new Promise((r) => chrome.storage.local.set({ tos_acknowledged_v1: true }, r)));
    await page.evaluate(() => { localStorage.setItem('automationLab.simulator', 'true'); localStorage.setItem('automationLab.models', '["Claude","GPT","Gemini"]'); });
    await page.reload();
    await page.waitForSelector('.model-nav-button.is-active');
    const roles = await page.$$eval('.model-nav-button.is-active', (n) => n.map((b) => `${b.title}:${b.querySelector('.model-nav-role').textContent}`));
    check(roles.includes('Claude:модератор') && roles.filter((r) => r.endsWith('модератор')).length === 1, 'first selected model is the moderator');
    await shot('0-empty');

    await page.fill('#ideaInput', 'Сервис онлайн-записи к врачу для небольших клиник.');
    await page.click('#sendBtn');
    await page.waitForSelector('.ask input[value=APPROVE]', { timeout: 30000 });
    check((await page.textContent('.ask legend')).startsWith('Утвердить правила решений?'), 'stage 1 asks to approve the decision rules');
    await page.check('.ask input[value=APPROVE]');
    await page.click('.ask button');
    await page.waitForFunction(() => document.querySelector('.ask input[type=radio]') && !document.querySelector('.ask input[value=APPROVE]'), null, { timeout: 60000 });
    await shot('1-ask');
    for (const name of await page.$$eval('.ask fieldset', (s) => s.map((f) => f.querySelector('input').name))) await page.check(`.ask input[name="${name}"] >> nth=0`);
    await page.click('.ask button');
    await page.waitForFunction(() => document.getElementById('centerStatus').textContent === 'готово', null, { timeout: 60000 });

    const bubbles = await page.$$eval('#centerChat .bubble, #leftChat .msg:not(.user) .bubble, #rightChat .msg:not(.user) .bubble', (n) => n.map((b) => b.textContent));
    check(bubbles.length > 10 && bubbles.every((t) => !/PAF_RESPONSE|```/.test(t)), 'answers are clean (no frames, no JSON fences)');
    check((await page.$$eval('#leftTabs .col-tab', (n) => n.map((t) => t.textContent))).join() === 'Claude,Gemini', 'three models split across the side columns');
    await shot('2-done');

    await page.click('#resultsBtn');
    check((await page.textContent('#modalBody')).includes('## Концепция'), 'Results shows the concept');
    await page.click('#closeModalBtn');
    const [md] = await Promise.all([page.waitForEvent('download'), page.click('#saveBtn')]);
    check(fs.readFileSync(await md.path(), 'utf8').includes('## Замечания ревью'), 'Save downloads the markdown');
    await page.click('#diagBtn');
    check((await page.textContent('#modalBody')).includes('Проблемы и что делать'), 'diagnostics opens from the gear');
    const [rep] = await Promise.all([page.waitForEvent('download'), page.click('#reportBtn')]);
    check(JSON.parse(fs.readFileSync(await rep.path(), 'utf8')).journal.length > 20, 'report for Claude downloads');
    await page.click('#closeModalBtn');

    const pipeline = await ctx.newPage();
    pipeline.on('pageerror', (e) => errors.push(`pipeline: ${e.message}`));
    await pipeline.goto(`chrome-extension://${id}/pipeline_panel.html`);
    await pipeline.waitForTimeout(1500);
    await pipeline.click('#telemetry-toggle-btn');
    await pipeline.click('#automation-tab');
    await pipeline.waitForFunction(() => /Проблемы и что делать/.test(document.getElementById('automation-diagnostics').textContent), null, { timeout: 10000 });
    check(true, 'telemetry window → Automation tab shows the live run');
    await shot('3-telemetry', pipeline);

    await page.reload();
    await page.waitForSelector('.model-nav-button.is-active');
    check((await page.$$('#centerChat .round')).length === 0 && !(await page.isDisabled('#sendBtn')), 'reload starts clean');
    await pipeline.waitForFunction(() => /не запущен/.test(document.getElementById('automation-diagnostics').textContent), null, { timeout: 10000 });
    check(true, 'reload clears the telemetry mirror');
    check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
  } catch (error) {
    fails.push(error.message);
    console.error(error);
  } finally {
    await ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (fails.length) { console.error(`\n${fails.length} failed`); process.exit(1); }
  console.log('\nautomation e2e: all checks passed');
})();
