// Холст прототипа Basic. Разметка и классы — как в pipeline_panel.html, pipeline/pipeline-runtime.js
// (buildModelBlocksHtml) и results.js (addRound); синтез — раунд из одной модели с ролью, отдельной колонки нет;
// линии — перенос drawInputSplitConnector / drawMergeSplitConnector / updatePipelineLayout из results.js.
// Всё рисуется из window.ProtoState; render() перерисовывает холст целиком.
(function initProtoCanvas() {
    'use strict';

    const S = () => window.ProtoState;
    const cards = () => window.ProtoCards || {};
    // Список ролей блока: None + judgeSystemPrompts из prompts.json (по order) + Custom (только Basic).
    const ROLE_OPTIONS = [['None', 'None'], ['interaction_meta_synthesis', 'Synthes'], ['interaction_critical_audit', 'Critique'], ['interaction_select_ideas', 'Select ideas'], ['interaction_pattern_clustering', 'Clustering'], ['custom', 'Custom']];

    const esc = (value = '') => String(value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const $ = (id) => document.getElementById(id);
    const panel = () => $('pipeline-panel');
    const flow = () => $('pipelineFlow');

    // ---------- Разметка ----------

    const modelBlockHtml = (model, index) => {
        const isActive = model.enabled !== false;
        const options = ROLE_OPTIONS
            .map(([value, label]) => `<option value="${esc(value)}"${(model.role || 'None') === value ? ' selected' : ''}>${esc(label)}</option>`)
            .join('');
        return `
            <div class="model-block ${isActive ? 'active' : 'inactive'} with-role" data-index="${index}" data-model="${esc(model.name)}">
                <div class="model-header">
                    <span class="status-indicator" data-llm-name="${esc(model.name)}"></span>
                    <input type="checkbox" class="model-checkbox model-input-checkbox"${isActive ? ' checked' : ''} aria-label="Input" title="Input">
                    <span class="model-name">${esc(model.name)}</span>
                </div>
                <select class="role-selector judge-prompt-selector"${isActive ? '' : ' disabled'}>${options}</select>
            </div>`;
    };

    const artifactsHtml = (artifacts = []) => {
        const items = artifacts.length
            ? artifacts.map((a) => `<span class="proto-artifact" title="${esc(a.title)} v${esc(a.version)}"><span class="proto-artifact-title">${esc(a.title)}</span><span class="proto-artifact-version">v${esc(a.version)}</span></span>`).join('')
            : '<span class="proto-artifacts-empty">—</span>';
        return `<div class="proto-artifacts" aria-disabled="true"><div class="proto-artifacts-label">Артефакты</div><div class="proto-artifacts-row">${items}</div></div>`;
    };

    const roundHtml = (round, i, total) => {
        const n = i + 1;
        const isLast = n === total;
        const deleteHidden = !(isLast && total > 1);
        let html = `
            <div class="stage-column" id="round${n}" data-round="${n}" data-round-index="${i}" data-planned-stage-id="canvas-r${n}">
                <div class="stage-header-row"><div class="stage-label"><span class="round-badge">R${n}</span> <button type="button" class="pipeline-round-delete-btn" title="Delete round" aria-label="Delete round"${deleteHidden ? ' hidden disabled' : ''}>×</button></div></div>
                <div class="model-stack" id="r${n}-models">${(round.models || []).map(modelBlockHtml).join('')}</div>
                ${artifactsHtml(round.artifacts)}
            </div>`;
        if (isLast) return html;
        html += `<div class="connector-group" data-round="${n + 1}"><svg class="connector-svg" id="svg-r${n}-r${n + 1}"></svg></div>`;
        return html;
    };

    // ---------- Линии (перенос из results.js) ----------

    const blockCenterY = (stack, index, container) => {
        const item = stack?.children[index];
        if (!item || !container) return 0;
        const a = item.getBoundingClientRect();
        const c = container.getBoundingClientRect();
        return (a.top + a.height / 2) - c.top;
    };
    const checkedIndices = (stackId, selector) => {
        const stack = $(stackId);
        if (!stack) return [];
        const out = [];
        Array.from(stack.children).forEach((item, i) => {
            const cb = item.querySelector(selector);
            if (cb && cb.checked && !cb.disabled) out.push(i);
        });
        return out;
    };
    const modeLookup = (stackId, mode) => {
        if (mode === 'input') return checkedIndices(stackId, '.model-input-checkbox');
        if (mode === 'send') return checkedIndices(stackId, '.model-input-checkbox');
        const stack = $(stackId);
        if (!stack) return [];
        if (mode === 'all') return Array.from(stack.children).map((_, i) => i);
        return [];
    };
    const inactiveIndices = (stack, active) => {
        if (!stack) return [];
        const set = new Set(active);
        return Array.from(stack.querySelectorAll('.model-block'))
            .map((b) => Array.from(stack.children).indexOf(b))
            .filter((i) => i >= 0 && !set.has(i));
    };
    const arrow = (y, cls) => `<polygon points="44,${y - 4} 50,${y} 44,${y + 4}" class="arrow-head ${cls}"/>`;

    const drawInputSplitConnector = (svgId, targetStackId, colorClass, targetMode = 'input') => {
        const svg = $(svgId);
        const entryPoint = $('entryPoint');
        const entryWrapper = $('entryWrapper');
        if (!svg) return;
        const targetStack = $(targetStackId);
        const active = modeLookup(targetStackId, targetMode);
        const inactive = inactiveIndices(targetStack, active);
        const all = [...active, ...inactive];
        if (!all.length) { svg.innerHTML = ''; if (entryPoint) entryPoint.style.marginTop = '26px'; return; }
        const W = 50; const splitX = W - 15;
        const ys = all.map((i) => blockCenterY(targetStack, i, svg));
        const minY = Math.min(...ys); const maxY = Math.max(...ys); const midY = (minY + maxY) / 2;
        if (entryPoint && entryWrapper) {
            const eys = all.map((i) => blockCenterY(targetStack, i, entryWrapper));
            entryPoint.style.marginTop = `${(Math.min(...eys) + Math.max(...eys)) / 2 - 9}px`;
        }
        const activePath = active.length > 0;
        const cls = activePath ? colorClass : 'inactive';
        let html = `<line x1="0" y1="${midY}" x2="${splitX}" y2="${midY}" class="connector-line ${cls}${activePath ? ' flow-anim' : ''}"/>`;
        if (ys.length > 1) html += `<line x1="${splitX}" y1="${minY}" x2="${splitX}" y2="${maxY}" class="merge-line ${cls}"/>`;
        active.forEach((i) => { const y = blockCenterY(targetStack, i, svg); html += `<line x1="${splitX}" y1="${y}" x2="${W - 6}" y2="${y}" class="connector-line ${colorClass} flow-anim"/>${arrow(y, colorClass)}`; });
        inactive.forEach((i) => { const y = blockCenterY(targetStack, i, svg); html += `<line x1="${splitX}" y1="${y}" x2="${W - 6}" y2="${y}" class="connector-line inactive"/>${arrow(y, 'inactive')}`; });
        svg.innerHTML = html;
    };

    const drawMergeSplitConnector = (svgId, sourceStackId, targetStackId, colorClass, { sourceMode = 'input', targetMode = 'input' } = {}) => {
        const svg = $(svgId);
        if (!svg) return;
        const sourceStack = $(sourceStackId);
        const targetStack = $(targetStackId);
        const src = modeLookup(sourceStackId, sourceMode);
        const tgt = modeLookup(targetStackId, targetMode);
        const srcInactive = ['send', 'input'].includes(sourceMode) ? inactiveIndices(sourceStack, src) : [];
        const tgtInactive = targetMode === 'input' ? inactiveIndices(targetStack, tgt) : [];
        if (!sourceStack || !targetStack || !(src.length + srcInactive.length) || !(tgt.length + tgtInactive.length)) { svg.innerHTML = ''; return; }
        const W = 50; const mergeX = 15; const splitX = W - 15;
        const aS = src.map((i) => blockCenterY(sourceStack, i, svg));
        const iS = srcInactive.map((i) => blockCenterY(sourceStack, i, svg));
        const aT = tgt.map((i) => blockCenterY(targetStack, i, svg));
        const iT = tgtInactive.map((i) => blockCenterY(targetStack, i, svg));
        const sYs = [...aS, ...iS]; const tYs = [...aT, ...iT];
        const activePath = aS.length > 0 && aT.length > 0;
        const cls = activePath ? colorClass : 'inactive';
        const anim = activePath ? ' flow-anim' : '';
        const sMin = Math.min(...sYs); const sMax = Math.max(...sYs);
        const tMin = Math.min(...tYs); const tMax = Math.max(...tYs);
        let html = '';
        aS.forEach((y) => { html += `<line x1="0" y1="${y}" x2="${mergeX}" y2="${y}" class="connector-line ${colorClass}${anim}"/>`; });
        iS.forEach((y) => { html += `<line x1="0" y1="${y}" x2="${mergeX}" y2="${y}" class="connector-line inactive"/>`; });
        if (sYs.length > 1) html += `<line x1="${mergeX}" y1="${sMin}" x2="${mergeX}" y2="${sMax}" class="merge-line ${cls}"/>`;
        html += `<line x1="${mergeX}" y1="${(sMin + sMax) / 2}" x2="${splitX}" y2="${(tMin + tMax) / 2}" class="connector-line ${cls}${anim}"/>`;
        if (tYs.length > 1) html += `<line x1="${splitX}" y1="${tMin}" x2="${splitX}" y2="${tMax}" class="merge-line ${cls}"/>`;
        aT.forEach((y) => { html += `<line x1="${splitX}" y1="${y}" x2="${W - 6}" y2="${y}" class="connector-line ${cls}${anim}"/>${arrow(y, cls)}`; });
        iT.forEach((y) => { html += `<line x1="${splitX}" y1="${y}" x2="${W - 6}" y2="${y}" class="connector-line inactive"/>${arrow(y, 'inactive')}`; });
        svg.innerHTML = html;
    };

    // Высота линий = высота самого высокого стека.
    const updateLayout = () => {
        const root = panel();
        const styles = getComputedStyle(document.documentElement);
        const blockH = parseFloat(styles.getPropertyValue('--pipeline-block-height')) || 64;
        const stacks = Array.from(root.querySelectorAll('.model-stack'));
        let maxHeight = 0;
        stacks.forEach((stack) => {
            const last = stack.lastElementChild;
            if (!last) return;
            const h = last.getBoundingClientRect().bottom - stack.getBoundingClientRect().top;
            if (h > maxHeight) maxHeight = h;
        });
        const height = Math.max(blockH, maxHeight || blockH);
        root.querySelectorAll('.connector-svg').forEach((svg) => { svg.style.height = `${height}px`; svg.setAttribute('height', `${height}`); });
        const entryWrapper = $('entryWrapper');
        if (entryWrapper) entryWrapper.style.height = `${height}px`;
    };

    const drawAll = () => {
        if (window.ProtoStand?.active) { window.ProtoStand.draw(); return; }
        const rounds = S().rounds;
        const total = rounds.length;
        updateLayout();
        drawInputSplitConnector('svg-in-models', 'r1-models', 'active');
        for (let n = 1; n < total; n++) {
            drawMergeSplitConnector(`svg-r${n}-r${n + 1}`, `r${n}-models`, `r${n + 1}-models`, 'brain-flow', { sourceMode: 'input', targetMode: 'input' });
        }
    };

    // ---------- render ----------

    const syncChrome = () => {
        const state = S();
        const total = state.rounds.length;
        const value = $('debate-round-value');
        if (value) value.value = String(total);
        const unit = $('debate-round-unit');
        if (unit) unit.textContent = total === 1 ? 'round' : 'rounds';
        const minus = $('debate-round-minus-btn');
        if (minus) minus.disabled = total <= 1;
        const plus = $('pipeline-add-round-btn');
        if (plus) plus.disabled = total >= 50;
        const length = $('debate-length-select');
        if (length) length.value = String(state.run?.maxWords || 300);
        const auto = $('debate-auto-toggle-btn');
        const isAuto = state.run?.policy === 'auto';
        if (auto) { auto.checked = isAuto; auto.setAttribute('aria-pressed', String(isAuto)); auto.closest('.debate-auto-toggle')?.classList.toggle('is-active', isAuto); }
        document.querySelectorAll('#protoModelButtons .llm-button').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.model === state.selectedModel);
            btn.setAttribute('aria-pressed', String(btn.dataset.model === state.selectedModel));
        });
    };

    let frame = 0;
    const render = () => {
        const state = S();
        const root = flow();
        if (!state || !root) return;
        // Стенд схем (stand.js) рисует холст сам, пока применена схема.
        if (window.ProtoStand?.active) { window.ProtoStand.render(); return; }
        if (!state.rounds.length) state.rounds.push(newRound(1));
        const total = state.rounds.length;
        root.innerHTML = `
            <div class="stage-column entry-column">
                <div class="stage-label"><span class="entry-badge">In</span></div>
                <div class="entry-wrapper" id="entryWrapper"><div class="entry-point" id="entryPoint" title="Общие значения" style="cursor:pointer">▶</div></div>
            </div>
            <div class="connector-group"><svg class="connector-svg" id="svg-in-models"></svg></div>
            ${state.rounds.map((round, i) => roundHtml(round, i, total)).join('')}
            <div id="insertionPoint"></div>`;
        syncChrome();
        drawAll();
        if (frame) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => { frame = 0; drawAll(); });
    };

    // ---------- Действия над состоянием ----------

    const newRound = (n) => ({
        ref: `r${n}`, input: '', task: '', role: 'None',
        models: S().models.map((name) => S().protoModel(name)),
        artifacts: []
    });
    const nextRef = () => 1 + Math.max(0, ...S().rounds.map((r) => Number(/^r(\d+)$/.exec(r.ref || '')?.[1]) || 0));
    const addRound = () => { if (S().rounds.length < 50) { S().rounds.push(newRound(nextRef())); render(); } };
    const removeLastRound = () => {
        const rounds = S().rounds;
        if (rounds.length <= 1) return;
        rounds.pop();
        render();
    };
    const modelOf = (block) => {
        const i = Number(block.closest('.stage-column')?.dataset.roundIndex);
        const round = S().rounds[i];
        return { i, round, model: round?.models?.[Number(block.dataset.index)] };
    };

    // ---------- События ----------

    const BLOCK_CONTROLS = 'input, select, button, .status-indicator, option';

    const bindPanel = () => {
        const root = panel();
        root.addEventListener('click', (event) => {
            const t = event.target;
            const badge = t.closest('.round-badge');
            if (badge) {
                event.preventDefault();
                const i = Number(badge.closest('.stage-column')?.dataset.roundIndex);
                cards().openRound?.(i);
                return;
            }
            if (t.closest('#entryPoint')) { cards().openEntry?.(); return; }
            if (t.closest('.pipeline-round-delete-btn')) { event.preventDefault(); removeLastRound(); return; }
            if (t.closest('#pipeline-add-round-btn')) { addRound(); return; }
            if (t.closest('#debate-round-minus-btn')) { removeLastRound(); return; }
            const item = t.closest('.pipeline-item');
            if (item) { const radio = item.querySelector('.pipeline-radio'); if (radio) radio.checked = true; const name = $('currentPipelineName'); if (name) name.textContent = item.dataset.name; }
        });

        root.addEventListener('dblclick', (event) => {
            const t = event.target;
            if (t.closest('select')) return;
            const block = t.closest('.model-block');
            if (block && !t.closest(BLOCK_CONTROLS)) {
                event.preventDefault();
                const { i, model } = modelOf(block);
                if (model) cards().openModel?.(i, model.name);
            }
        });

        root.addEventListener('change', (event) => {
            const t = event.target;
            const block = t.closest('.model-block');
            if (block) {
                const { model } = modelOf(block);
                if (!model) return;
                if (t.classList.contains('model-input-checkbox')) {
                    model.enabled = t.checked;
                } else if (t.classList.contains('role-selector')) {
                    model.role = t.value;
                }
                render();
                return;
            }
            if (t.id === 'debate-length-select') { S().run.maxWords = Number(t.value); return; }
            if (t.id === 'proto-import-input') importFile(t);
        });

        $('pipeline-add-btn')?.addEventListener('click', () => {
            const state = S();
            state.rounds = [newRound(1)];
            render();
        });
        $('pipeline-export-btn')?.addEventListener('click', exportState);
        $('pipeline-import-btn')?.addEventListener('click', () => $('proto-import-input')?.click());
    };

    const DATA_KEYS = ['models', 'defaults', 'run', 'rounds', 'selectedModel'];
    const exportState = () => {
        const data = {};
        DATA_KEYS.forEach((key) => { data[key] = S()[key]; });
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const a = Object.assign(document.createElement('a'), { href: url, download: 'proto-state.json' });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const importFile = (input) => {
        const file = input.files?.[0];
        if (!file) return;
        file.text().then((text) => {
            const data = JSON.parse(text);
            DATA_KEYS.forEach((key) => { if (data[key] !== undefined) S()[key] = data[key]; });
            render();
        }).catch((error) => console.warn('[proto] import failed', error)).finally(() => { input.value = ''; });
    };

    const bindTopBar = () => {
        $('protoModelButtons')?.addEventListener('click', (event) => {
            const btn = event.target.closest('.llm-button');
            if (!btn) return;
            S().selectedModel = btn.dataset.model;
            render();
        });
        $('debate-auto-toggle-btn')?.addEventListener('change', (event) => {
            S().run.policy = event.target.checked ? 'auto' : 'manual';
            syncChrome();
        });
    };

    window.ProtoCanvas = { render, syncChrome, drawInputSplitConnector, drawMergeSplitConnector };

    const start = () => {
        if (!S()) { console.warn('[proto] ProtoState is missing'); return; }
        if (!S().selectedModel) S().selectedModel = S().models[0];
        S().onChange = render;
        bindPanel();
        bindTopBar();
        window.addEventListener('resize', () => drawAll());
        render();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
