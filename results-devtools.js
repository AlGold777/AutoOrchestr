// DevTools: Telemetry (Embedded Pragmatist)
(function attachPragmatistDevtools() {
    if (window.__DEVTOOLS_TELEMETRY_READY__) return;
    window.__DEVTOOLS_TELEMETRY_READY__ = true;
    const telemetryPlatformSelect = document.getElementById('telemetry-platform-select');
    const telemetryRefreshBtn = document.getElementById('telemetry-refresh-btn');
    const telemetryCopyBtn = document.getElementById('telemetry-copy-btn');
    const telemetryExportJsonBtn = document.getElementById('telemetry-export-json-btn');
    const telemetryResetBtn = document.getElementById('telemetry-reset-btn');
    const telemetryClearAllBtn = document.getElementById('telemetry-clear-all-btn');
    const telemetryTimeline = document.getElementById('telemetry-timeline');
    const telemetryStatus = document.getElementById('telemetry-status');
    const telemetrySummary = document.getElementById('telemetry-summary');
    const telemetrySummaryStatus = document.getElementById('telemetry-summary-status');
    const telemetryRoundsList = document.getElementById('telemetry-rounds');
    const escapeHtml = (window.ResultsShared && window.ResultsShared.escapeHtml) || ((s = '') => String(s));
    const flashButtonFeedback = window.ResultsShared?.flashButtonFeedback || null;
    const fallbackCopyViaTextarea = window.ResultsShared?.fallbackCopyViaTextarea || null;
    const clearNode = (node) => {
        if (!node) return;
        node.replaceChildren();
    };
    const replaceChildrenFromHtml = (node, html) => {
        if (!node) return;
        const source = String(html || '');
        if (!source) {
            node.replaceChildren();
            return;
        }
        const range = document.createRange();
        range.selectNode(node);
        node.replaceChildren(range.createContextualFragment(source));
    };
    const normalizePlatformName = (value = '') => String(value || '').trim().toLowerCase();
    // Выпадающий список моделей — единственный источник истины для фильтра
    // телеметрии. Раньше окно дополнительно пересекало результат с кнопками LLM
    // в шапке страницы: «All platforms» означало не «все», а «выбранные в
    // шапке», список умел только сужаться внутри шапки и никогда не расширялся.
    // При прогоне одной модели все допустимые значения давали одинаковый
    // результат, а остальные — пустой, и фильтр выглядел неработающим.
    const TELEMETRY_PSEUDO_MODELS = new Set(['', 'system', 'unknown']);
    const telemetryEventModelName = (event) => normalizePlatformName(
        event?.modelId || event?.platform || event?.llmName
        || event?.meta?.llmName || event?.meta?.platform || ''
    );
    // keepSystem: канонический экспорт обязан сохранять run-level события
    // (SYSTEM), иначе отчёт остаётся без конфигурации запуска. Окно таймлайна
    // сужает строго по модели.
    const matchesTelemetryModel = (event, platformFilter, { keepSystem = false } = {}) => {
        if (!platformFilter || platformFilter === 'all') return true;
        const modelId = telemetryEventModelName(event);
        if (keepSystem && (!modelId || modelId === 'system')) return true;
        return modelId === platformFilter;
    };
    const selectedTelemetryModel = () => normalizePlatformName(telemetryPlatformSelect?.value || 'all') || 'all';
    const resolveTelemetryPlatformName = (event) => {
        const raw = event?.platform || event?.llmName || event?.meta?.llmName || event?.meta?.platform || 'unknown';
        const cleaned = String(raw || '').trim();
        return cleaned || 'unknown';
    };
    const parseRunSessionIdFromDispatchId = (dispatchId) => {
        const raw = String(dispatchId || '').trim();
        if (!raw) return null;
        const parts = raw.split(':');
        if (parts.length < 3) return null;
        const middle = Number(parts[1]);
        if (Number.isFinite(middle) && middle > 0) return middle;
        return null;
    };
    const resolveEventRunSessionId = (event) => {
        const direct = Number(
            event?.meta?.runSessionId
            || event?.meta?.sessionId
            || event?.runSessionId
            || event?.sessionId
        );
        if (Number.isFinite(direct) && direct > 0) return direct;
        const dispatchId = event?.meta?.dispatchId || event?.dispatchId || event?.meta?.requestId;
        return parseRunSessionIdFromDispatchId(dispatchId);
    };
    const resolveCurrentRunSessionId = (events = []) => {
        const sorted = [...(Array.isArray(events) ? events : [])]
            .filter(Boolean)
            .sort((a, b) => (b?.ts || 0) - (a?.ts || 0));
        for (const event of sorted) {
            const runSessionId = resolveEventRunSessionId(event);
            if (Number.isFinite(runSessionId) && runSessionId > 0) return runSessionId;
        }
        return null;
    };
    const resolveEventPipelineRunId = (event) => {
        const raw = event?.meta?.pipelineRunId || event?.pipelineRunId || event?.meta?.runId || '';
        return String(raw || '').trim() || null;
    };
    const resolveCurrentPipelineRunId = (events = []) => {
        const sorted = [...(Array.isArray(events) ? events : [])]
            .filter(Boolean)
            .sort((a, b) => (b?.ts || 0) - (a?.ts || 0));
        for (const event of sorted) {
            const pipelineRunId = resolveEventPipelineRunId(event);
            if (pipelineRunId) return pipelineRunId;
        }
        return null;
    };
    const resolveLatestRound0StartTs = (events = []) => {
        return (Array.isArray(events) ? events : [])
            .filter((event) => (
                resolveTelemetryPlatformName(event) === 'ROUNDS'
                && resolveRoundLabel(event) === 'ROUND0_START'
                && Number.isFinite(Number(event?.ts))
            ))
            .map((event) => Number(event.ts))
            .reduce((acc, ts) => (ts > acc ? ts : acc), 0);
    };
    const filterEventsToCurrentRun = (events = [], runSessionId = null) => {
        const source = Array.isArray(events) ? events.slice() : [];
        const requestedRunSessionId = Number(runSessionId);
        const hasRequestedRunSessionId = runSessionId !== null
            && typeof runSessionId !== 'undefined'
            && Number.isFinite(requestedRunSessionId)
            && requestedRunSessionId > 0;
        const activeRunSessionId = hasRequestedRunSessionId
            ? requestedRunSessionId
            : resolveCurrentRunSessionId(source);
        if (!Number.isFinite(activeRunSessionId) || activeRunSessionId <= 0) {
            const cycleStartTs = resolveLatestRound0StartTs(source);
            if (!(cycleStartTs > 0)) {
                return { events: [], runSessionId: null, scopeMode: 'none' };
            }
            return {
                events: source.filter((event) => Number(event?.ts || 0) >= cycleStartTs),
                runSessionId: null,
                scopeMode: 'cycle'
            };
        }
        // Прогон = все волны с одним pipelineRunId; события без pipelineRunId — по runSessionId.
        const activePipelineRunId = hasRequestedRunSessionId ? null : resolveCurrentPipelineRunId(source);
        const scoped = source.filter((event) => {
            const pipelineRunId = resolveEventPipelineRunId(event);
            if (activePipelineRunId && pipelineRunId) return pipelineRunId === activePipelineRunId;
            return resolveEventRunSessionId(event) === activeRunSessionId;
        });
        if (!scoped.length) {
            return { events: [], runSessionId: activeRunSessionId, scopeMode: 'run' };
        }
        const cycleStartTs = resolveLatestRound0StartTs(scoped);
        const cycleScoped = cycleStartTs > 0
            ? scoped.filter((event) => Number(event?.ts || 0) >= cycleStartTs)
            : scoped;
        return { events: cycleScoped, runSessionId: activeRunSessionId, scopeMode: 'run' };
    };
    const formatTelemetryTimestamp = (value) => {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleTimeString();
    };
    const ROUND_COLUMNS = [
        { key: 0, label: 'R0 (open)' },
        { key: 1, label: 'R1 (dispatch)' },
        { key: 2, label: 'R2 (verify)' },
        { key: 3, label: 'R3 (collect)' },
        { key: 4, label: 'R4 (results)' }
    ];
    const TELEMETRY_CACHE_LIMIT = 400;
    const TELEMETRY_PINNED_LABELS = new Set([
        'MODEL_FINAL',
        'FINAL_STATUS',
        'FOCUS_STUCK',
        'BUDGET_EXHAUSTED',
        'PROMPT_SUBMITTED_ACCEPTED',
        'PROMPT_SUBMITTED_TIMEOUT'
    ]);
    const formatDurationShort = (ms) => {
        if (!Number.isFinite(ms)) return '';
        const seconds = ms / 1000;
        const formatted = seconds >= 10 ? `${Math.round(seconds)}s` : `${seconds.toFixed(1).replace(/\\.0$/, '')}s`;
        return formatted;
    };
    const resolveRoundLabel = (event) => {
        const raw = event?.label || event?.meta?.event || event?.event || '';
        return String(raw || '').trim().toUpperCase();
    };
    const normalizeRoundLabel = (label = '') => {
        return String(label || '')
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    };
    const resolveRoundDescriptor = (event) => {
        const rawLabel = resolveRoundLabel(event);
        const normalizedLabel = normalizeRoundLabel(rawLabel);
        const metaRound = Number(event?.meta?.round);
        let roundIndex = Number.isFinite(metaRound) ? metaRound : null;
        let phase = null;
        if (normalizedLabel === 'ROUND0_TAB_OPENED') {
            return { roundIndex: 0, phase: 'END' };
        }
        const match = normalizedLabel.match(/^ROUND(\\d+)_([A-Z0-9]+)$/);
        if (match) {
            if (!Number.isFinite(roundIndex)) {
                roundIndex = Number(match[1]);
            }
            const rawPhase = match[2] || null;
            if (rawPhase === 'COMPLETE') {
                phase = 'END';
            } else if (rawPhase === 'VERIFY') {
                phase = 'START';
            } else {
                phase = rawPhase;
            }
        } else if (Number.isFinite(roundIndex)) {
            if (normalizedLabel.includes('START')) phase = 'START';
            else if (normalizedLabel.includes('END')) phase = 'END';
            else if (normalizedLabel.includes('VERIFY')) phase = 'VERIFY';
            else if (normalizedLabel.includes('COMPLETE')) phase = 'END';
        }
        if (!Number.isFinite(roundIndex) || roundIndex < 0) return null;
        if (!phase) return null;
        return { roundIndex, phase };
    };
    const buildRoundMatrix = (events = []) => {
        const matrix = new Map();
        const globalRounds = new Map();
        (Array.isArray(events) ? events : []).forEach((event) => {
            const platform = resolveTelemetryPlatformName(event);
            if (!platform) return;
            const normalizedLabel = resolveRoundLabel(event);
            if (platform === 'ROUNDS') {
                const resolved = resolveRoundDescriptor(event);
                if (!resolved) return;
                const { roundIndex, phase } = resolved;
                const roundInfo = globalRounds.get(roundIndex) || { start: null, end: null, warnings: [] };
                if (phase === 'START' && !roundInfo.start) {
                    roundInfo.start = event;
                }
                if (phase === 'END' && !roundInfo.end) {
                    roundInfo.end = event;
                }
                if (event.level === 'warning' || phase.includes('VERIFY')) {
                    roundInfo.warnings = roundInfo.warnings || [];
                    roundInfo.warnings.push(event);
                }
                roundInfo.events = roundInfo.events || [];
                roundInfo.events.push(event);
                globalRounds.set(roundIndex, roundInfo);
                return;
            }
            const entry = matrix.get(platform) || { rounds: new Map(), tabVisits: [] };
            if (normalizedLabel === 'FOCUS_STUCK') {
                entry.focusStucks = entry.focusStucks || [];
                entry.focusStucks.push(event);
                matrix.set(platform, entry);
                return;
            }
            if (normalizedLabel === 'TAB_VISIT') {
                entry.tabVisits = entry.tabVisits || [];
                entry.tabVisits.unshift(event);
                entry.tabVisits = entry.tabVisits.slice(0, 4);
                matrix.set(platform, entry);
                return;
            }
            const resolved = resolveRoundDescriptor(event);
            if (!resolved) return;
            const { roundIndex, phase } = resolved;
            const rounds = entry.rounds;
            const roundInfo = rounds.get(roundIndex) || { start: null, end: null, warnings: [] };
            if (phase === 'START' && !roundInfo.start) {
                roundInfo.start = event;
            }
            if (phase === 'END' && !roundInfo.end) {
                roundInfo.end = event;
            }
            if (event.level === 'warning' || phase.includes('VERIFY')) {
                roundInfo.warnings = roundInfo.warnings || [];
                roundInfo.warnings.push(event);
            }
            roundInfo.events = roundInfo.events || [];
            roundInfo.events.push(event);
            rounds.set(roundIndex, roundInfo);
            entry.rounds = rounds;
            matrix.set(platform, entry);
        });
        return { matrix, globalRounds };
    };
    const determineRoundTimestamp = (entry) => {
        let latest = 0;
        entry.rounds?.forEach((info) => {
            if (info.end?.ts) {
                latest = Math.max(latest, info.end.ts);
            } else if (info.start?.ts) {
                latest = Math.max(latest, info.start.ts);
            }
        });
        return latest;
    };
    const resolveRoundIndexForTimestamp = (entry, ts) => {
        if (!entry?.rounds || !Number.isFinite(ts)) return null;
        let candidate = null;
        entry.rounds.forEach((info, roundIndex) => {
            const startTs = info.start?.ts;
            const endTs = info.end?.ts;
            if (!Number.isFinite(startTs)) return;
            const inWindow = (Number.isFinite(endTs) && ts >= startTs && ts <= endTs)
                || (!Number.isFinite(endTs) && ts >= startTs);
            if (inWindow) {
                if (!candidate || startTs > (candidate.startTs || 0)) {
                    candidate = { roundIndex, startTs };
                }
            }
        });
        if (candidate) return candidate.roundIndex;
        let latest = null;
        entry.rounds.forEach((info, roundIndex) => {
            const startTs = info.start?.ts;
            if (!Number.isFinite(startTs)) return;
            if (!latest || startTs > latest.startTs) {
                latest = { roundIndex, startTs };
            }
        });
        return latest ? latest.roundIndex : null;
    };
    const formatFocusStuckTooltip = (event) => {
        if (!event) return '';
        const ts = event?.ts ? new Date(event.ts).toLocaleTimeString() : '';
        const windowId = event?.meta?.windowId ?? event?.meta?.snapshot?.windowId ?? 'n/a';
        const tabId = event?.meta?.tabId ?? event?.meta?.snapshot?.tabId ?? 'n/a';
        const label = resolveRoundLabel(event) || 'FOCUS_STUCK';
        return `TIMEOUT @ ${ts} — ${label} (tabId=${tabId}, windowId=${windowId})`;
    };
    const formatRoundCell = (entry, roundIndex) => {
        const roundInfo = entry?.rounds?.get(roundIndex);
        if (!roundInfo || (!roundInfo.start && !roundInfo.end)) {
            return { text: '○ —', className: 'round-cell-pending' };
        }
        const timestamp = roundInfo.end?.ts || roundInfo.start?.ts || null;
        const timeLabel = timestamp ? formatTelemetryTimestamp(timestamp) : '—';
        const isComplete = Boolean(roundInfo.end);
        const outcome = String(roundInfo.end?.meta?.outcome || '').toLowerCase();
        const isDeferred = isComplete && outcome === 'deferred';
        const parts = [];
        if (isDeferred) {
            parts.push(`${timeLabel} (deferred)`);
        } else if (isComplete) {
            parts.push(`${timeLabel} (done)`);
        } else {
            parts.push(`${timeLabel} (running)`);
        }
        if (roundInfo.inferredEnd) {
            parts.push('inferred');
        }
        if (roundInfo.focusStuck?.ts) {
            const stuckTime = formatTelemetryTimestamp(roundInfo.focusStuck.ts);
            if (stuckTime) parts.push(`stuck ${stuckTime}`);
        }
        if (isComplete && roundInfo.end?.meta?.durationMs) {
            const durationText = formatDurationShort(roundInfo.end.meta.durationMs);
            if (durationText) parts.push(durationText);
        }
        if (roundIndex === 1 && entry.tabVisits?.length) {
            const visit = entry.tabVisits[0];
            const visitText = formatDurationShort(visit?.meta?.durationMs);
            if (visitText) parts.push(`visit ${visitText}`);
        }
        if (roundInfo.warnings?.length) {
            const warning = roundInfo.warnings[roundInfo.warnings.length - 1];
            if (warning?.details) parts.push(warning.details);
        }
        const statusClass = isDeferred
            ? 'round-cell-progress'
            : isComplete
            ? (roundInfo.end.level === 'warning' ? 'round-cell-warning' : 'round-cell-success')
            : 'round-cell-progress';
        const className = roundInfo.focusStuck ? 'round-cell-warning' : statusClass;
        const title = roundInfo.focusStuck ? formatFocusStuckTooltip(roundInfo.focusStuck) : '';
        return { text: parts.join(' • '), className, title };
    };
    const renderTelemetryRounds = (events = []) => {
        if (!telemetryRoundsList) return;
        const { matrix, globalRounds } = buildRoundMatrix(events);
        if (!matrix.size) {
            replaceChildrenFromHtml(telemetryRoundsList, '<p class="diag-empty">Waiting for round telemetry…</p>');
            return;
        }
        if (globalRounds.size) {
            matrix.forEach((entry) => {
                globalRounds.forEach((info, roundIndex) => {
                    const roundInfo = entry.rounds.get(roundIndex) || { start: null, end: null, warnings: [] };
                    if (!roundInfo.start && info.start) roundInfo.start = info.start;
                    if (!roundInfo.end && info.end) roundInfo.end = info.end;
                    if (info.warnings?.length) {
                        roundInfo.warnings = (roundInfo.warnings || []).concat(info.warnings);
                    }
                    roundInfo.events = (roundInfo.events || []).concat(info.events || []);
                    entry.rounds.set(roundIndex, roundInfo);
                });
            });
        }
        matrix.forEach((entry) => {
            const stuckEvents = entry.focusStucks || [];
            stuckEvents.forEach((evt) => {
                const ts = evt?.ts;
                if (!Number.isFinite(ts)) return;
                const roundIndex = resolveRoundIndexForTimestamp(entry, ts);
                if (roundIndex == null) return;
                const roundInfo = entry.rounds.get(roundIndex) || { start: null, end: null, warnings: [] };
                roundInfo.focusStuck = evt;
                entry.rounds.set(roundIndex, roundInfo);
            });
            const round4 = entry.rounds.get(4);
            const round4EndTs = round4?.end?.ts;
            if (!Number.isFinite(round4EndTs)) return;
            [0, 1, 2, 3].forEach((roundIndex) => {
                const roundInfo = entry.rounds.get(roundIndex);
                if (!roundInfo?.start || roundInfo.end) return;
                const startTs = roundInfo.start?.ts;
                if (Number.isFinite(startTs) && startTs <= round4EndTs) {
                    roundInfo.end = round4.end;
                    roundInfo.inferredEnd = true;
                    entry.rounds.set(roundIndex, roundInfo);
                }
            });
        });
        const models = Array.from(matrix.entries()).sort((a, b) => determineRoundTimestamp(b[1]) - determineRoundTimestamp(a[1]));
        const headerCells = ['<th>Model</th>', ...ROUND_COLUMNS.map((col) => `<th>${escapeHtml(col.label)}</th>`)].join('');
        const rows = models.map(([model, entry]) => {
            const cells = ROUND_COLUMNS.map((col) => {
                const cell = formatRoundCell(entry, col.key);
                const titleAttr = cell.title ? ` title="${escapeHtml(cell.title)}"` : '';
                return `<td class="${cell.className}"${titleAttr}>${escapeHtml(cell.text)}</td>`;
            }).join('');
            return `<tr><td class="round-model">${escapeHtml(model)}</td>${cells}</tr>`;
        }).join('');
        const tableHtml = `<table class="telemetry-rounds-table"><thead><tr>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`;
        replaceChildrenFromHtml(telemetryRoundsList, tableHtml);
    };

    const getRoundTelemetryEvents = (events = []) => (events || []).filter((evt) => {
        const label = resolveRoundLabel(evt);
        return label.startsWith('ROUND') || label === 'TAB_VISIT';
    });

    const mergeRoundTelemetry = (events = [], roundEvents = []) => {
        if (!roundEvents.length) return events.slice();
        const merged = events.slice();
        const seen = new Set(merged.map((evt) => `${evt?.ts || ''}|${evt?.label || ''}|${evt?.platform || evt?.llmName || ''}`));
        roundEvents.forEach((evt) => {
            const key = `${evt?.ts || ''}|${evt?.label || ''}|${evt?.platform || evt?.llmName || ''}`;
            if (seen.has(key)) return;
            seen.add(key);
            merged.push(evt);
        });
        return merged;
    };
    const writeClipboardText = async (text = '', button = null) => {
        if (!text) return false;
        if (navigator?.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                if (flashButtonFeedback && button) flashButtonFeedback(button, 'success');
                return true;
            } catch (err) {
                console.warn('[devtools] clipboard writeText failed', err);
            }
        }
        if (typeof fallbackCopyViaTextarea === 'function') {
            try {
                fallbackCopyViaTextarea(text);
                if (flashButtonFeedback && button) flashButtonFeedback(button, 'success');
                return true;
            } catch (err) {
                console.warn('[devtools] clipboard fallback failed', err);
            }
        }
        if (flashButtonFeedback && button) flashButtonFeedback(button, 'error');
        return false;
    };
    let telemetryCache = [];
    let telemetryScopedCache = [];
    let telemetryFilteredCache = [];
    let telemetryEventKeys = new Set();
    const TELEMETRY_BRIDGE_KEY = 'DevtoolsTelemetryBridge';
    const resolveTelemetryBridge = () => {
        const win = window;
        if (!win) return null;
        if (!win[TELEMETRY_BRIDGE_KEY]) {
            win[TELEMETRY_BRIDGE_KEY] = {};
        }
        return win[TELEMETRY_BRIDGE_KEY];
    };
    const telemetryBridge = resolveTelemetryBridge();
    const refreshTelemetryBridge = () => {
        if (!telemetryBridge) return;
        telemetryBridge.getLatestEvents = () => telemetryCache.slice();
        telemetryBridge.getScopedEvents = () => telemetryScopedCache.slice();
        telemetryBridge.getFilteredEvents = () => telemetryFilteredCache.slice();
        telemetryBridge.getEffectiveEvents = () => {
            const base = telemetryScopedCache;
            const hasRestrictiveFilter = isTelemetryFilterActive();
            const effective = hasRestrictiveFilter
                ? telemetryFilteredCache
                : (telemetryFilteredCache.length ? telemetryFilteredCache : base);
            return effective.slice();
        };
        // Экспорты (JSON в окне + MD в results.js) применяют активный фильтр окна,
        // чтобы при выбранной одной модели выгружалась только она, а не все платформы.
        telemetryBridge.applyActiveFilter = (events = []) => applyActiveTelemetryFilter(events);
        telemetryBridge.applyOnlyProblemsFilter = (events = []) => (Array.isArray(events) ? events.slice() : []);
        telemetryBridge.isOnlyProblemsEnabled = () => false;
        telemetryBridge.getActivePlatformNames = () => getActiveTelemetryPlatformNames();
        telemetryBridge.isFilterActive = () => isTelemetryFilterActive();
    };
    refreshTelemetryBridge();

    const formatDuration = (ms) => {
        if (!Number.isFinite(ms) || ms < 0) return null;
        if (ms < 1000) return `${Math.round(ms)}ms`;
        const seconds = ms / 1000;
        const digits = seconds >= 10 ? 0 : 1;
        const rounded = seconds.toFixed(digits);
        return `${rounded.replace(/\.0$/, '')}s`;
    };

    const normalizeTelemetryLabel = (event) => {
        const raw = event?.label || event?.meta?.event || '';
        return String(raw).trim().toUpperCase();
    };

    const buildTelemetrySummary = (events = []) => {
        const phaseMap = {
            PREPARATION_START: ['preparation', 'start'],
            PREPARATION_DONE: ['preparation', 'end'],
            STREAMING_START: ['streaming', 'start'],
            STREAMING_DONE: ['streaming', 'end'],
            FINALIZATION_START: ['finalization', 'start'],
            FINALIZATION_DONE: ['finalization', 'end'],
            PIPELINE_START: ['pipeline', 'start'],
            PIPELINE_COMPLETE: ['pipeline', 'end']
        };
        const summaries = new Map();
        (Array.isArray(events) ? events : []).forEach((event) => {
            const dispatchId = event?.meta?.dispatchId || event?.meta?.requestId;
            if (!dispatchId) return;
            const ts = Number.isFinite(event?.ts) ? event.ts : Date.now();
            const existing = summaries.get(dispatchId) || {
                dispatchId,
                platform: '',
                llmName: '',
                startTs: ts,
                endTs: ts,
                phases: {
                    preparation: {},
                    streaming: {},
                    finalization: {},
                    pipeline: {}
                },
                errors: [],
                hasSuccess: false,
                stateChanges: []
            };
            existing.startTs = Math.min(existing.startTs, ts);
            existing.endTs = Math.max(existing.endTs, ts);
            if (!existing.llmName) {
                existing.llmName = event?.meta?.llmName || event?.platform || event?.meta?.platform || '';
            }
            if (!existing.platform) {
                existing.platform = event?.meta?.platform || event?.platform || '';
            }
            const label = normalizeTelemetryLabel(event);
            if (label && phaseMap[label]) {
                const [phaseName, phaseKey] = phaseMap[label];
                existing.phases[phaseName] = existing.phases[phaseName] || {};
                existing.phases[phaseName][phaseKey] = ts;
            }
            if (label === 'PIPELINE_STEP') {
                const step = String(event?.meta?.step || '').trim().toLowerCase();
                const stepMap = {
                    pipeline_start: ['pipeline', 'start'],
                    preparation_start: ['preparation', 'start'],
                    preparation_done: ['preparation', 'end'],
                    streaming_start: ['streaming', 'start'],
                    streaming_done: ['streaming', 'end'],
                    finalization_start: ['finalization', 'start'],
                    finalization_done: ['finalization', 'end']
                };
                if (stepMap[step]) {
                    const [phaseName, phaseKey] = stepMap[step];
                    existing.phases[phaseName] = existing.phases[phaseName] || {};
                    existing.phases[phaseName][phaseKey] = ts;
                }
            }
            if (label === 'STATE_CHANGE') {
                const from = String(event?.meta?.from || '').trim();
                const to = String(event?.meta?.to || '').trim();
                if (from || to) {
                    existing.stateChanges.push({ from, to, ts });
                }
            }
            if (label === 'PIPELINE_COMPLETE' || label === 'FINALIZATION_DONE' || label === 'STREAMING_DONE') {
                existing.hasSuccess = true;
            }
            const level = String(event?.level || '').toLowerCase();
            const degraded = Boolean(event?.meta?.degraded) || String(event?.meta?.degradedReason || '').toLowerCase() === 'hard_timeout';
            const isError = !degraded && (level === 'error' || label === 'PIPELINE_ERROR' || label.endsWith('_ERROR') || event?.type === 'ERROR');
            if (isError) {
                const reason = event?.meta?.message || event?.details || event?.label || 'error';
                existing.errors.push({ reason, ts });
            }
            summaries.set(dispatchId, existing);
        });
        const summarizeStateTrail = (summary) => {
            const changes = (summary.stateChanges || []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
            if (!changes.length) return '';
            const segments = [];
            for (let i = 0; i < changes.length; i += 1) {
                const current = changes[i];
                const next = changes[i + 1];
                const duration = next ? formatDuration((next.ts || 0) - (current.ts || 0)) : formatDuration(summary.endTs - (current.ts || summary.endTs));
                const from = current.from || '?';
                const to = current.to || '?';
                const part = duration ? `${from}→${to} ${duration}` : `${from}→${to}`;
                segments.push(part);
            }
            return segments.join(' • ');
        };
        return Array.from(summaries.values())
            .map((summary) => ({ ...summary, stateTrail: summarizeStateTrail(summary) }))
            .sort((a, b) => b.startTs - a.startTs);
    };

    const renderTelemetrySummary = (events = []) => {
        if (!telemetrySummary) return;
        const summaries = buildTelemetrySummary(events);
        const visible = summaries.slice(0, 12);
        if (telemetrySummaryStatus) {
            telemetrySummaryStatus.textContent = summaries.length ? `${visible.length}/${summaries.length} runs` : 'No runs';
        }
        if (!visible.length) {
            replaceChildrenFromHtml(telemetrySummary, '<p class="diag-empty">No telemetry runs</p>');
            return;
        }
        const summaryHtml = visible.map((summary) => {
            const platform = escapeHtml(String(summary.llmName || summary.platform || 'unknown'));
            const time = summary.startTs ? new Date(summary.startTs).toLocaleTimeString() : '';
            const prepMs = formatDuration(summary.phases.preparation?.end - summary.phases.preparation?.start);
            const streamMs = formatDuration(summary.phases.streaming?.end - summary.phases.streaming?.start);
            const finalMs = formatDuration(summary.phases.finalization?.end - summary.phases.finalization?.start);
            const totalMs = formatDuration(summary.endTs - summary.startTs);
            const phaseParts = [];
            if (prepMs) phaseParts.push(`prep ${prepMs}`);
            if (streamMs) phaseParts.push(`stream ${streamMs}`);
            if (finalMs) phaseParts.push(`final ${finalMs}`);
            const phaseText = phaseParts.length ? phaseParts.join(' • ') : (totalMs ? `total ${totalMs}` : '-');
            const lastError = summary.errors.slice().sort((a, b) => b.ts - a.ts)[0];
            let status = 'running';
            if (summary.errors.length && summary.hasSuccess) {
                status = 'partial';
            } else if (summary.errors.length) {
                status = 'error';
            } else if (summary.hasSuccess) {
                status = 'success';
            }
            const statusClass = status === 'error'
                ? 'is-error'
                : (status === 'partial' ? 'is-warning' : (status === 'success' ? 'is-success' : ''));
            const reason = summary.errors.length ? String(lastError?.reason || '').trim() : 'ok';
            const reasonText = escapeHtml(reason || 'ok');
            const trail = summary.stateTrail ? escapeHtml(summary.stateTrail) : '';
            return `<div class="telemetry-summary-row ${statusClass}" title="dispatchId: ${escapeHtml(summary.dispatchId)}">
                <span class="telemetry-summary-platform">${platform}</span>
                <span class="telemetry-summary-time">${escapeHtml(time)}</span>
                <span class="telemetry-summary-status">${escapeHtml(status)}</span>
                <span class="telemetry-summary-phase">${escapeHtml(phaseText)}</span>
                <span class="telemetry-summary-reason">${reasonText}</span>
                ${trail ? `<span class="telemetry-summary-trail">${trail}</span>` : ''}
            </div>`;
        }).join('');
        replaceChildrenFromHtml(telemetrySummary, summaryHtml);
    };

    // Список строится только из моделей, которые реально есть в леджере. Раньше
    // сюда подмешивался захардкоженный каталог из десяти платформ, и окно
    // предлагало выбрать модели, по которым событий нет в принципе: любой такой
    // выбор давал пустой таймлайн.
    const buildTelemetryPlatformOptions = (events = []) => {
        const options = [];
        const seen = new Set();
        const pushOption = (name) => {
            const label = String(name || '').trim();
            if (!label) return;
            const value = normalizePlatformName(label);
            if (!value || seen.has(value) || TELEMETRY_PSEUDO_MODELS.has(value)) return;
            seen.add(value);
            options.push({ value, label });
        };
        (Array.isArray(events) ? events : []).forEach((event) => {
            pushOption(event?.modelId || event?.platform || event?.llmName);
        });
        return options;
    };

    const getTelemetryFilteredEvents = (events = []) => {
        const platformFilter = selectedTelemetryModel();
        let filtered = Array.isArray(events) ? events.slice() : [];
        if (platformFilter !== 'all') {
            filtered = filtered.filter((event) => matchesTelemetryModel(event, platformFilter));
        }
        return { filtered: filtered.slice(-250) };
    };

    const isTelemetryProblem = (event) => {
        if (window.ProblemContextFilter?.isProblem) {
            return window.ProblemContextFilter.isProblem(event);
        }
        const label = normalizeTelemetryLabel(event);
        const level = String(event?.level || event?.severity || '').toLowerCase();
        const details = String(event?.details || event?.message || event?.meta?.reason || '').toLowerCase();
        return level === 'error' || level === 'warning' || level === 'critical'
            || event?.type === 'ERROR'
            || /(ERROR|FAILED|FAILURE|TIMEOUT|REJECTED|EXCEPTION|UNSAFE|BLOCKED|MISMATCH|DIVERGENCE)/.test(label)
            || /(error|failed|failure|timeout|rejected|exception|unsafe|blocked|mismatch|divergence)/.test(details);
    };
    const telemetryContextKey = (event) => {
        const meta = event?.meta || {};
        return String(meta.dispatchId || event?.dispatchId || meta.runSessionId || event?.runSessionId
            || `${event?.platform || event?.llmName || 'unknown'}:${meta.tabId || ''}`);
    };
    function filterTelemetryProblemsWithContext(events = [], contextBefore = 10) {
        if (window.ProblemContextFilter?.filterWithContext) {
            return window.ProblemContextFilter.filterWithContext(events, {
                contextBefore,
                isProblem: isTelemetryProblem,
                getContextKey: telemetryContextKey
            });
        }
        const source = Array.isArray(events) ? events.slice() : [];
        const keep = new Set();
        source.forEach((event, index) => {
            if (!isTelemetryProblem(event)) return;
            keep.add(index);
            const key = telemetryContextKey(event);
            for (let cursor = index - 1, added = 0; cursor >= 0 && added < contextBefore; cursor -= 1) {
                if (telemetryContextKey(source[cursor]) !== key) continue;
                keep.add(cursor);
                added += 1;
            }
        });
        return source.filter((_, index) => keep.has(index));
    }

    // Активный фильтр модели для экспортов (JSON/MD), чтобы выгрузка уважала
    // выбранное в окне. Тот же предикат, что и у таймлайна, отличие одно —
    // без UI-капа в 250 событий.
    const isTelemetryFilterActive = () => selectedTelemetryModel() !== 'all';
    const applyActiveTelemetryFilter = (events = []) => {
        const list = Array.isArray(events) ? events.slice() : [];
        if (!isTelemetryFilterActive()) return list;
        const platformFilter = selectedTelemetryModel();
        return list.filter((event) => matchesTelemetryModel(event, platformFilter));
    };
    // Набор нормализованных имён платформ, к которым сейчас сведён экспорт.
    // Пустой массив = «все». Нужен для фильтрации секций диагностических логов
    // в MD-экспорте.
    const getActiveTelemetryPlatformNames = () => {
        const platformFilter = selectedTelemetryModel();
        return platformFilter !== 'all' ? [platformFilter] : [];
    };

    // Совпадают ли уже существующие <option> у select'а с желаемым набором value.
    // Авто-рефреш телеметрии (setInterval 2.5s) дёргает sync-функции на каждый
    // приход новых событий. Если каждый раз делать clearNode()+rebuild, это
    // сбрасывает выбранный фильтр и закрывает раскрытый список прямо во время
    // того, как пользователь пытается выбрать пункт — фильтры «не работают».
    // Поэтому перестраиваем options только когда сам набор реально изменился.
    const selectOptionValuesMatch = (selectEl, values) => {
        const existing = Array.from(selectEl.options).map((opt) => opt.value);
        return existing.length === values.length && existing.every((v, i) => v === values[i]);
    };

    const syncTelemetryPlatformOptions = (events = []) => {
        if (!telemetryPlatformSelect) return;
        const current = telemetryPlatformSelect.value;
        const platformOptions = buildTelemetryPlatformOptions(events);
        const optionValues = ['all', ...platformOptions.map((opt) => opt.value)];
        if (selectOptionValuesMatch(telemetryPlatformSelect, optionValues)) {
            if (!optionValues.includes(current)) telemetryPlatformSelect.value = 'all';
            return;
        }
        clearNode(telemetryPlatformSelect);
        const allOption = document.createElement('option');
        allOption.value = 'all';
        allOption.textContent = 'All platforms';
        telemetryPlatformSelect.appendChild(allOption);
        platformOptions.forEach((opt) => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            telemetryPlatformSelect.appendChild(option);
        });
        telemetryPlatformSelect.value = optionValues.includes(current) ? current : 'all';
    };

    const renderTelemetry = (events = []) => {
        if (!telemetryTimeline) return;
        const scoped = filterEventsToCurrentRun(events);
        const scopedEvents = scoped.events;
        telemetryScopedCache = scopedEvents.slice();
        const { filtered } = getTelemetryFilteredEvents(scopedEvents);
        const visibleEvents = filtered;
        telemetryFilteredCache = visibleEvents;
        refreshTelemetryBridge();
        renderTelemetryRounds(scopedEvents);
        renderTelemetrySummary(visibleEvents);
        if (telemetryStatus) {
            const runSuffix = scoped.runSessionId ? ` • run ${scoped.runSessionId}` : '';
            telemetryStatus.textContent = visibleEvents.length ? `${visibleEvents.length} events${runSuffix}` : 'No telemetry events';
        }
        if (!visibleEvents.length) {
            replaceChildrenFromHtml(telemetryTimeline, '<p class="diag-empty">No telemetry events</p>');
            return;
        }
        const sortedEvents = [...visibleEvents].sort((a, b) => (b?.ts || 0) - (a?.ts || 0));
        const timelineHtml = sortedEvents.map((e) => {
            const ts = e.ts ? new Date(e.ts).toLocaleTimeString() : '';
            const platform = escapeHtml(String(e.platform || e.llmName || 'unknown'));
            const type = escapeHtml(String(e.type || 'EVENT'));
            const dispatchId = escapeHtml(String(e?.meta?.dispatchId || ''));
            const label = escapeHtml(String(e.label || '').trim());
            const details = escapeHtml(String(e.details || '').trim());
            const detailText = [label, details].filter(Boolean).join(' — ');
            const level = String(e.level || '').toLowerCase();
            const levelClass = level === 'error'
                ? 'is-error'
                : (level === 'warning' ? 'is-warning' : (level === 'success' ? 'is-success' : ''));
            const rowClass = levelClass;
            return `<div class="telemetry-row ${rowClass}">
                <span class="telemetry-time">${ts}</span>
                <span class="telemetry-platform">${platform}</span>
                <span class="telemetry-type">${type}</span>
                <span class="telemetry-dispatch">${dispatchId || '-'}</span>
                <span class="telemetry-details">${detailText || '-'}</span>
            </div>`;
        }).join('');
        replaceChildrenFromHtml(telemetryTimeline, timelineHtml);
    };

    const buildTelemetryEventKey = (evt) => {
        if (!evt) return '';
        const label = resolveRoundLabel(evt);
        const platform = resolveTelemetryPlatformName(evt);
        const ts = evt?.ts || '';
        const details = evt?.details || '';
        return `${ts}|${label}|${platform}|${details}`;
    };
    const isPinnedTelemetryEvent = (evt) => {
        const label = resolveRoundLabel(evt);
        if (!label) return false;
        if (label.startsWith('ROUND')) return true;
        return TELEMETRY_PINNED_LABELS.has(label);
    };
    const trimTelemetryCache = (events = [], maxItems = TELEMETRY_CACHE_LIMIT) => {
        const next = Array.isArray(events) ? events.slice() : [];
        if (next.length <= maxItems) return next;
        const pinned = next.filter((evt) => isPinnedTelemetryEvent(evt));
        const unpinned = next.filter((evt) => !isPinnedTelemetryEvent(evt));
        const capacity = Math.max(0, maxItems - pinned.length);
        const trimmed = capacity ? unpinned.slice(-capacity) : [];
        return trimmed.concat(pinned).sort((a, b) => (a?.ts || 0) - (b?.ts || 0));
    };
    const resetTelemetryEventKeys = () => {
        telemetryEventKeys = new Set(telemetryCache.map(buildTelemetryEventKey).filter(Boolean));
    };
    const isTelemetrySurfaceVisible = () => {
        const modal = document.getElementById('api-keys-modal');
        return document.visibilityState !== 'hidden'
            && Boolean(modal?.classList?.contains('is-visible'))
            && modal?.style?.display !== 'none'
            && Boolean(telemetryTab?.classList?.contains('is-active'));
    };
    const renderTelemetryIfVisible = () => {
        if (!isTelemetrySurfaceVisible()) return false;
        syncTelemetryPlatformOptions(telemetryCache);
        renderTelemetry(telemetryCache);
        return true;
    };
    const ingestTelemetryEvents = (events = []) => {
        const incoming = Array.isArray(events) ? events : [];
        if (!incoming.length) return;
        let changed = false;
        incoming.forEach((evt) => {
            if (!evt) return;
            const key = buildTelemetryEventKey(evt);
            if (!key || telemetryEventKeys.has(key)) return;
            telemetryEventKeys.add(key);
            telemetryCache.push(evt);
            changed = true;
        });
        if (!changed) return;
        if (telemetryCache.length > TELEMETRY_CACHE_LIMIT) {
            telemetryCache = trimTelemetryCache(telemetryCache, TELEMETRY_CACHE_LIMIT);
            resetTelemetryEventKeys();
        }
        refreshTelemetryBridge();
        // The cache is the source of truth. DOM projection is demand-driven:
        // rendering a closed/background DevTools surface for every lifecycle
        // event exhausted the results-page renderer during nine-model runs.
        renderTelemetryIfVisible();
    };
    const replaceTelemetryEvents = (events = []) => {
        telemetryCache = [];
        telemetryEventKeys = new Set();
        ingestTelemetryEvents(events);
        if (!Array.isArray(events) || !events.length) {
            telemetryScopedCache = [];
            telemetryFilteredCache = [];
            refreshTelemetryBridge();
            syncTelemetryPlatformOptions([]);
            renderTelemetry([]);
        }
    };
    const getDiagnosticsRoundEvents = () => {
        const getter = window.__getDiagnosticLogs;
        if (typeof getter !== 'function') return [];
        const logsByModel = getter();
        if (!logsByModel || typeof logsByModel !== 'object') return [];
        const events = [];
        Object.entries(logsByModel).forEach(([model, logs]) => {
            if (!Array.isArray(logs)) return;
            logs.forEach((entry) => {
                if (!entry) return;
                const label = resolveRoundLabel(entry);
                if (!label) return;
                if (!label.startsWith('ROUND') && label !== 'TAB_VISIT') return;
                const meta = { ...(entry.meta || {}) };
                if (!meta.llmName) meta.llmName = model;
                const match = label.match(/^ROUND(\d+)/);
                if (match) meta.round = Number(match[1]);
                meta.event = label;
                events.push({
                    ts: entry.ts || Date.now(),
                    type: 'TELEMETRY',
                    label,
                    details: entry.details || '',
                    level: entry.level || 'info',
                    platform: meta.llmName || model,
                    meta
                });
            });
        });
        return events;
    };
    const setStatus = (text, tone = '') => {
        if (telemetryStatus) {
            telemetryStatus.textContent = text || '';
            telemetryStatus.dataset.tone = tone;
        }
    };

    const refreshTelemetry = () => {
        try {
            chrome.runtime.sendMessage({ type: 'GET_DIAG_EVENTS', limit: 400 }, (resp) => {
                if (chrome.runtime.lastError) {
                    console.warn('[devtools] telemetry refresh runtime error', chrome.runtime.lastError);
                    setStatus('Refresh failed (runtime error)', 'error');
                    return;
                }
                if (resp?.success) {
                    const incoming = resp.events || [];
                    const diagRounds = getDiagnosticsRoundEvents();
                    // GET_DIAG_EVENTS returns the authoritative persisted
                    // snapshot. Replacing the page cache is required after an
                    // extension reload/clear; ingest-only logic kept the old
                    // events visible when the new snapshot was empty.
                    replaceTelemetryEvents([...incoming, ...diagRounds]);
                    const activeRunId = resolveCurrentRunSessionId(telemetryScopedCache);
                    const runSuffix = activeRunId ? ` • run ${activeRunId}` : '';
                    setStatus(`${telemetryScopedCache.length} events${runSuffix}`, 'info');
                } else {
                    setStatus('No telemetry events (refresh failed)', 'error');
                }
            });
        } catch (err) {
            console.warn('[devtools] telemetry refresh error', err);
            setStatus('Refresh failed (exception)', 'error');
        }
    };

    telemetryPlatformSelect && telemetryPlatformSelect.addEventListener('change', () => {
        renderTelemetry(telemetryCache);
    });
    // Hard clear: wipe the backend diag/telemetry store AND every telemetry window
    // (Rounds, Timeline, Summary) plus the diagnostics Logs view, so the next export
    // starts from a clean slate. (Previously only a filter-reset existed; the real
    // clear button was removed by mistake.)
    const clearAllTelemetry = () => {
        const runtime = (typeof chrome !== 'undefined' && chrome?.runtime) ? chrome.runtime : null;
        if (runtime?.sendMessage) {
            try {
                runtime.sendMessage({ type: 'CLEAR_DIAG_EVENTS', reason: 'manual_clear_all' }, () => {
                    if (runtime.lastError) {
                        console.warn('[devtools] telemetry clear-all backend error', runtime.lastError);
                    }
                });
            } catch (err) {
                console.warn('[devtools] telemetry clear-all backend failed', err);
            }
        }
        telemetryCache = [];
        telemetryScopedCache = [];
        telemetryFilteredCache = [];
        telemetryEventKeys = new Set();
        if (telemetryPlatformSelect) telemetryPlatformSelect.value = 'all';
        refreshTelemetryBridge();
        renderTelemetry([]);
        if (telemetryStatus) telemetryStatus.textContent = 'No telemetry events';
        // Let results.js clear the diagnostics Logs view (llmLogs) it owns.
        try {
            document.dispatchEvent(new CustomEvent('diagnostics-clear-request', { detail: { source: 'telemetry_clear_all' } }));
        } catch (err) {
            console.warn('[devtools] diagnostics-clear-request dispatch failed', err);
        }
        if (telemetryClearAllBtn && flashButtonFeedback) {
            flashButtonFeedback(telemetryClearAllBtn, 'success');
        }
    };
    telemetryClearAllBtn && telemetryClearAllBtn.addEventListener('click', clearAllTelemetry);
    document.addEventListener('extension-runtime-reset', () => {
        telemetryCache = [];
        telemetryScopedCache = [];
        telemetryFilteredCache = [];
        telemetryEventKeys = new Set();
        syncTelemetryPlatformOptions([]);
        renderTelemetry([]);
        renderTelemetrySummary([]);
        renderTelemetryRounds([]);
        if (telemetryStatus) telemetryStatus.textContent = 'No telemetry events';
    });
    document.addEventListener('diagnostics-clear-request', () => {
        replaceTelemetryEvents([]);
        if (telemetryStatus) telemetryStatus.textContent = 'No telemetry events';
    });
    // Export/copy are invoked ONLY through the delegated action listener below
    // (which calls these functions directly). They must NOT also get their own
    // addEventListener: the toolbar buttons are already handled by the delegated
    // listener, so a second direct binding made one user click run the export
    // twice → two downloaded JSON files. (refresh/reset/clear-all keep both
    // bindings because their double-invocation is idempotent; export writes a
    // file, so it must fire exactly once.)
    const slugifyModelName = (value) => String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'unknown';
    // Модель в имени файла. Раньше её получали только одиночные incident-отчёты,
    // а полный экспорт всегда назывался одинаково, и по имени было нельзя понять,
    // чей это прогон. Берём выбранное в фильтре значение, а при `All platforms`
    // выводим модель из самих событий: одна модель в леджере — её имя,
    // несколько — `all-models`.
    const exportModelSlug = (events = []) => {
        const explicit = selectedTelemetryModel();
        if (explicit !== 'all') return slugifyModelName(explicit);
        const names = Array.from(new Set(
            (Array.isArray(events) ? events : [])
                .map(telemetryEventModelName)
                .filter((name) => name && !TELEMETRY_PSEUDO_MODELS.has(name))
        ));
        if (names.length === 1) return slugifyModelName(names[0]);
        return names.length ? 'all-models' : 'unknown';
    };
    // Экспорт телеметрии: сырые события текущего прогона без производных
    // отчётов. Разбор делает модель по запросу под конкретную проблему
    // (docs/Telemetry/queries.md); поэтому в файле только факты + короткая
    // памятка читателю.
    const TELEMETRY_EXPORT_FORMAT = 'telemetry-raw/1';
    const TELEMETRY_VIEW_FORMAT = 'telemetry-view/1';
    const TELEMETRY_VIEW_FIELDS_GUIDE = 't — мс от startTs; p — модель; l — метка; v — уровень (нет у info); '
        + 'y — тип события (нет у TELEMETRY); d — details; m — meta (сжатая; dispatchId указан в первой строке цепочки и при смене); '
        + 'n — сколько раз подряд повторилось, t2 — время последнего повтора. '
        + 'В файле только события, относящиеся к задаче, и все error/warning; остальное отброшено (sourceEventCount — сколько было).';
    const EXPORT_PROFILE_KEY = 'telemetryExportProfile';
    const exportProfileSelect = document.getElementById('telemetry-export-profile-select');
    if (exportProfileSelect) {
        try {
            chrome.storage?.local?.get?.([EXPORT_PROFILE_KEY], (stored) => {
                if (chrome.runtime?.lastError) return;
                const saved = stored?.[EXPORT_PROFILE_KEY];
                if (saved && Array.from(exportProfileSelect.options).some((option) => option.value === saved)) exportProfileSelect.value = saved;
            });
        } catch (_) {}
        exportProfileSelect.addEventListener('change', () => {
            try { chrome.storage?.local?.set?.({ [EXPORT_PROFILE_KEY]: exportProfileSelect.value }); } catch (_) {}
        });
    }
    const telemetryExportProfile = () => exportProfileSelect?.value || 'raw';
    const TELEMETRY_READER_GUIDE = 'Сырые события телеметрии расширения, по возрастанию времени. '
        + 'ts — миллисекунды; platform — модель; label — что произошло; level — важность; '
        + 'meta.dispatchId — один запрос к модели, meta.runSessionId — один прогон. '
        + 'Опирайся только на события из файла: чего в нём нет, того «не зафиксировано», а не «не было». '
        + 'Лог ограничен по размеру и может начинаться с середины прогона.';
    const requestTelemetryEventsForExport = () => new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage({ type: 'GET_DIAG_EVENTS', limit: 5000 }, (resp) => {
                if (chrome.runtime.lastError || !resp?.success) {
                    resolve(null);
                    return;
                }
                resolve(Array.isArray(resp.events) ? resp.events : []);
            });
        } catch (_) {
            resolve(null);
        }
    });
    const downloadTelemetryJson = (payload, filename) => {
        const json = window.SecretRedaction?.stringifySafe
            ? window.SecretRedaction.stringifySafe(payload)
            : JSON.stringify(payload);
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return json.length;
    };
    const exportTelemetryJson = async () => {
        const exportButton = telemetryExportJsonBtn;
        if (exportButton) {
            exportButton.disabled = true;
            exportButton.setAttribute('aria-busy', 'true');
        }
        if (telemetryStatus) telemetryStatus.textContent = 'Preparing telemetry JSON…';
        try {
            const stored = await requestTelemetryEventsForExport();
            if (!stored) {
                if (telemetryStatus) telemetryStatus.textContent = 'Telemetry export failed: background did not answer';
                return;
            }
            const events = applyActiveTelemetryFilter(stored);
            if (!events.length) {
                if (telemetryStatus) telemetryStatus.textContent = 'No telemetry events to export';
                return;
            }
            const runSessionId = resolveCurrentRunSessionId(events) || null;
            const exportedAt = Date.now();
            const profileId = telemetryExportProfile();
            const view = window.TelemetryViews
                ? window.TelemetryViews.buildTelemetryView(events, profileId)
                : { profile: 'raw', compact: false, events, sourceCount: events.length };
            const profileTask = view.compact ? window.TelemetryViews.getProfile(view.profile).task : null;
            const exportFormat = view.compact ? TELEMETRY_VIEW_FORMAT : TELEMETRY_EXPORT_FORMAT;
            const payload = {
                format: exportFormat,
                profile: view.profile,
                extensionVersion: chrome?.runtime?.getManifest?.().version || 'unknown',
                exportedAt: new Date(exportedAt).toISOString(),
                runSessionId,
                model: selectedTelemetryModel(),
                generationWaitProfile: window.ResultsShared?.getGenerationWaitProfile?.(),
                eventCount: view.events.length,
                sourceEventCount: events.length,
                firstTs: events[0]?.ts || null,
                lastTs: events[events.length - 1]?.ts || null,
                ...(view.compact ? { startTs: view.startTs, fieldsGuide: TELEMETRY_VIEW_FIELDS_GUIDE } : {}),
                readerGuide: profileTask ? `${TELEMETRY_READER_GUIDE} Задача: ${profileTask}` : TELEMETRY_READER_GUIDE,
                events: view.events
            };
            const filenameParts = ['telemetry'];
            if (view.compact) filenameParts.push(view.profile);
            filenameParts.push(exportModelSlug(events), exportedAt);
            const bytes = downloadTelemetryJson(payload, `${filenameParts.join('-')}.json`);
            if (telemetryStatus) telemetryStatus.textContent = `Telemetry exported: ${view.events.length} of ${events.length} events, ${Math.round(bytes / 1024)} KB`;
        } catch (err) {
            console.warn('[devtools] telemetry export json error', err);
            if (telemetryStatus) telemetryStatus.textContent = `JSON export failed: ${err?.message || 'unknown error'}`;
        } finally {
            if (exportButton) {
                exportButton.disabled = false;
                exportButton.removeAttribute('aria-busy');
            }
        }
    };
    const TELEMETRY_ACTION_SELECTOR = '#telemetry-export-json-btn, #telemetry-clear-all-btn';
    // Walk up the click target so text nodes or re-rendered buttons still trigger the telemetry handlers.
    const findTelemetryActionTarget = (event) => {
        let node = event?.target;
        while (node && node !== document && node !== window) {
            if (
                node.nodeType === Node.ELEMENT_NODE &&
                typeof node.matches === 'function' &&
                node.matches(TELEMETRY_ACTION_SELECTOR)
            ) {
                return node;
            }
            node = node.parentNode;
        }
        return null;
    };

    document.addEventListener('click', (event) => {
        const target = findTelemetryActionTarget(event);
        if (!target) return;
        if (target.id === 'telemetry-export-json-btn') {
            exportTelemetryJson();
            return;
        }
        if (target.id === 'telemetry-clear-all-btn') {
            clearAllTelemetry();
        }
    }, true);
    document.addEventListener('llm-selection-change', () => {
        renderTelemetryIfVisible();
    });

    const telemetryTab = document.getElementById('telemetry-tab');
    telemetryTab && telemetryTab.addEventListener('click', refreshTelemetry);
    let telemetryAutoRefreshTimer = null;
    const startTelemetryAutoRefresh = () => {
        if (!telemetryTimeline) return;
        if (telemetryAutoRefreshTimer) return;
        if (!isTelemetrySurfaceVisible()) return;
        refreshTelemetry();
        telemetryAutoRefreshTimer = setInterval(() => {
            refreshTelemetry();
        }, 2500);
    };
    const stopTelemetryAutoRefresh = () => {
        if (telemetryAutoRefreshTimer) {
            clearInterval(telemetryAutoRefreshTimer);
            telemetryAutoRefreshTimer = null;
        }
    };

    const isTelemetryTabActive = () => telemetryTab?.classList.contains('is-active');
    if (telemetryTimeline && isTelemetryTabActive()) {
        startTelemetryAutoRefresh();
    }

    document.addEventListener('devtools-tab-change', (event) => {
        if (!telemetryTab || !telemetryTimeline) return;
        const targetId = event?.detail?.targetId;
        if (targetId === 'telemetry-tabpanel') {
            startTelemetryAutoRefresh();
        } else if (!isTelemetryTabActive()) {
            stopTelemetryAutoRefresh();
        }
    });

    document.addEventListener('devtools-visibility-change', (event) => {
        if (event?.detail?.visible === true && isTelemetryTabActive()) {
            renderTelemetryIfVisible();
            startTelemetryAutoRefresh();
        } else {
            stopTelemetryAutoRefresh();
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            renderTelemetryIfVisible();
            if (isTelemetrySurfaceVisible()) startTelemetryAutoRefresh();
        } else {
            stopTelemetryAutoRefresh();
        }
    });

    document.addEventListener('telemetry-event', (event) => {
        const incoming = event?.detail?.events;
        ingestTelemetryEvents(incoming);
    });

    // Expose hooks for global callers (safety when script loaded late).
    window.__telemetryRefreshHook = refreshTelemetry;
    window.__telemetryResetHook = () => {
        if (telemetryPlatformSelect) telemetryPlatformSelect.value = 'all';
        renderTelemetry(telemetryCache);
    };

    const devtoolsTabs = Array.from(document.querySelectorAll('.devtools-tab'));
    devtoolsTabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            if (telemetryTab && telemetryTimeline) {
                if (tab === telemetryTab) {
                    startTelemetryAutoRefresh();
                } else if (!isTelemetryTabActive()) {
                    stopTelemetryAutoRefresh();
                }
            }
        });
    });
    const updateTelemetryCardAccessibility = (card, header, collapsed) => {
        if (!card) return;
        card.classList.toggle('is-collapsed', collapsed);
        const expanded = !collapsed;
        if (!header) return;
        header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        header.setAttribute('title', expanded ? 'Click to collapse' : 'Click to expand');
    };

    const telemetryCardToggle = (card, header) => {
        if (!card) return;
        const collapsed = card.classList.contains('is-collapsed');
        updateTelemetryCardAccessibility(card, header, !collapsed);
    };

    const setupTelemetryCollapsibles = () => {
        const collapsibleCards = Array.from(document.querySelectorAll(
            '#telemetry-tabpanel .devtools-card[data-collapsible], #disput-tabpanel .devtools-card[data-collapsible]'
        ));
        collapsibleCards.forEach((card) => {
            const header = card.querySelector('.devtools-card-header');
            if (!header) return;
            header.setAttribute('role', 'button');
            header.setAttribute('tabindex', '0');
            const isCollapsed = card.classList.contains('is-collapsed');
            updateTelemetryCardAccessibility(card, header, isCollapsed);
            header.addEventListener('dblclick', () => telemetryCardToggle(card, header));
            header.addEventListener('click', () => telemetryCardToggle(card, header));
            header.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    telemetryCardToggle(card, header);
                }
            });
        });
    };

    setupTelemetryCollapsibles();
})();
