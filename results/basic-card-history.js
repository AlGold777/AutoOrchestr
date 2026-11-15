// The actual card DOM, observed in batches: synchronous intermediate paints are not reconstructed.
(function initBasicCardHistory(root) {
    'use strict';

    const CARD = '.debate-model-card';
    // The text of the post-terminal revisions is copied in full at every change of the card. A model that searches for minutes
    // (GPT: «Идёт поиск…», sources, reasoning) grows it to hundreds of thousands of characters: 23 copies filled the 10 MB storage and
    // stopped a run (checkpoint_failed, 2026-11-15). A revision is kept as head and tail with the cut length marked.
    const REVISION_TEXT_LIMIT = 12000;
    const limitRevision = (value) => {
        const text = String(value || '');
        if (text.length <= REVISION_TEXT_LIMIT) return text;
        const half = REVISION_TEXT_LIMIT / 2;
        return `${text.slice(0, half)}\n…[усечено ${text.length - REVISION_TEXT_LIMIT} знаков]…\n${text.slice(-half)}`;
    };
    const sessions = new WeakMap();
    const textOf = (node) => String(node?.innerText ?? node?.textContent ?? '').trim();
    const relevantAttribute = (name) => /^(?:data-|class$|style$|hidden$|title$|aria-)/.test(name || '');

    function create({ container, record, onChange = () => {}, isActive = () => true, sessionId = '' }) {
        const history = record.cardHistory ||= { version: 1, coverage: 'dom_observer_batches', events: [] };
        history.version = 1;
        history.coverage = 'dom_observer_batches';
        history.events ||= [];
        const nullable = (value) => value === undefined || value === null || value === '' ? null : value;
        const numberOrText = (value) => value == null || value === '' ? null
            : (Number.isFinite(Number(value)) ? Number(value) : value);
        const snapshotOf = (card) => {
            const indicator = card.querySelector('.status-indicator');
            const revisions = [...card.querySelectorAll('.post-terminal-answer-revision')]
                .map((node) => String(node.textContent || '').trim()).join('\n\n');
            return {
                text: textOf(card.querySelector('.debate-model-card-output')),
                title: textOf(card.querySelector('.debate-model-card-header')),
                role: textOf(card.querySelector('.debate-model-card-role')),
                revisionText: revisions,
                model: nullable(card.dataset.llmName),
                participantId: nullable(card.dataset.participantId),
                stepRef: nullable(card.dataset.stepRef),
                visit: numberOrText(card.dataset.visit),
                requestId: nullable(card.dataset.requestId),
                pipelineRunId: nullable(card.dataset.pipelineRunId),
                roundId: nullable(card.dataset.pipelineRoundId),
                attempt: numberOrText(card.dataset.attempt),
                stageAttemptId: nullable(card.dataset.stageAttemptId),
                status: nullable(card.dataset.status),
                indicator: indicator ? {
                    text: textOf(indicator), title: indicator.getAttribute('title'),
                    status: nullable(indicator.dataset.status), className: indicator.className
                } : null,
                kind: nullable(card.dataset.kind || card.dataset.entryKind),
                classes: card.className,
                hidden: Boolean(card.hidden || card.style.display === 'none' || card.style.visibility === 'hidden'),
                stale: Boolean(card.querySelector('.basic-run-stale')),
                closed: card.dataset.turnClosed === 'true',
                approved: nullable(card.dataset.approved),
                live: card.dataset.live === 'true'
            };
        };
        let sequence = history.events.reduce((max, event) => Math.max(max, Number(event.seq) || 0), 0);
        let cardSequence = history.events.reduce((max, event) => Math.max(max,
            Number(String(event.cardId || '').match(/:card:(\d+)$/)?.[1]) || 0), 0);
        let state = sessions.get(container);
        // A resume can load a checkpoint older than the last observed DOM batch.
        // In that case cached refs are not guaranteed to exist in this record: rewind future snapshots.
        if (!state || state.runId !== record.runId) {
            state = { runId: record.runId, ids: new WeakMap(), snapshots: new Map(), lastSeq: 0 };
            sessions.set(container, state);
        } else if (state.lastSeq > sequence) {
            state.lastSeq = sequence;
            for (const [card, snap] of state.snapshots.entries()) {
                if (snap.eventSeq > sequence) {
                    const id = state.ids.get(card);
                    const lastEvent = id ? history.events.slice().reverse().find((e) => e.cardId === id && e.seq <= sequence) : null;
                    if (lastEvent) {
                        const reconstruct = (ev) => {
                            if (!ev?.snapshot) return '';
                            if (ev.snapshot.textRef) {
                                return (root.CustomRunRecord?.textOf?.(record, ev.snapshot.textRef)) || record.texts?.[ev.snapshot.textRef] || '';
                            }
                            if (ev.snapshot.textPatch) {
                                const base = history.events.find((e) => e.seq === ev.snapshot.textPatch.baseSeq);
                                return reconstruct(base).slice(0, ev.snapshot.textPatch.prefixLength) + ((root.CustomRunRecord?.textOf?.(record, ev.snapshot.textPatch.suffixRef)) || record.texts?.[ev.snapshot.textPatch.suffixRef] || '');
                            }
                            return '';
                        };
                        const fullText = reconstruct(lastEvent);
                        const semantic = { ...snapshotOf(card), text: fullText };
                        state.snapshots.set(card, { snapshot: lastEvent.snapshot, semantic, fullText, eventSeq: lastEvent.seq });
                    } else {
                        state.snapshots.delete(card);
                    }
                }
            }
        }
        const { ids, snapshots } = state;
        const initialCards = new WeakSet(container.querySelectorAll(CARD));
        const newCards = new WeakSet();
        let stopped = false;

        const cardsWithin = (node) => {
            if (node?.nodeType !== 1) return [];
            return [...(node.matches(CARD) ? [node] : []), ...node.querySelectorAll(CARD)];
        };
        const belongs = (card) => {
            if (sessionId && card.dataset.sessionId && card.dataset.sessionId !== String(sessionId)) return false;
            const explicitRun = card.dataset.pipelineRunId;
            if (explicitRun) return explicitRun === record.runId;
            return isActive() && (snapshots.has(card) || (newCards.has(card) && !initialCards.has(card)));
        };
        const append = (card, type, snapshot) => {
            let id = ids.get(card);
            if (!id) {
                id = `${record.runId}:card:${++cardSequence}`;
                ids.set(card, id);
            }
            history.events.push({ seq: ++sequence, observedAt: Date.now(), type, cardId: id, snapshot });
            state.lastSeq = sequence;
        };
        const capture = (card) => {
            if (!belongs(card)) return;
            const semantic = snapshotOf(card);
            const previous = snapshots.get(card);
            if (previous && JSON.stringify(previous.semantic) === JSON.stringify(semantic)) return;
            const { text, title, role, revisionText, ...fields } = semantic;
            const snapshot = {
                ...fields, titleRef: record.put(title), roleRef: record.put(role),
                revisionTextRef: record.put(limitRevision(revisionText)), revisionTextLength: revisionText.length, textLength: text.length
            };
            if (previous && previous.fullText === text) {
                snapshot.textRef = previous.snapshot.textRef;
                if (previous.snapshot.textPatch) snapshot.textPatch = { ...previous.snapshot.textPatch };
            } else {
                let prefixLength = 0;
                if (previous && text.length > 512) {
                    const limit = Math.min(previous.fullText.length, text.length);
                    while (prefixLength < limit && previous.fullText[prefixLength] === text[prefixLength]) prefixLength++;
                }
                if (prefixLength >= 256) {
                    snapshot.textRef = null;
                    snapshot.textPatch = { baseSeq: previous.eventSeq, prefixLength, suffixRef: record.put(text.slice(prefixLength)) };
                } else snapshot.textRef = record.put(text);
            }
            append(card, previous ? 'updated' : initialCards.has(card) ? 'observed' : 'created', snapshot);
            snapshots.set(card, { snapshot, semantic, fullText: text, eventSeq: sequence });
        };
        const process = (mutations = []) => {
            if (stopped) return;
            const before = sequence;
            const detached = new Set();
            for (const mutation of mutations) {
                if (mutation.type === 'attributes' && !relevantAttribute(mutation.attributeName)) continue;
                if (mutation.type === 'childList') {
                    for (const node of mutation.addedNodes) {
                        for (const card of cardsWithin(node)) newCards.add(card);
                    }
                    for (const node of mutation.removedNodes) {
                        for (const card of cardsWithin(node)) detached.add(card);
                    }
                }
            }
            // Scan also catches attributes on ancestors and explicit run identity assigned after insertion.
            for (const card of container.querySelectorAll(CARD)) capture(card);
            for (const card of detached) {
                if (container.contains(card)) continue; // A move within the feed is not a removal.
                capture(card); // Includes a card both added and removed in one observer batch.
                const previous = snapshots.get(card);
                if (!previous) continue;
                append(card, 'removed', previous.snapshot);
                snapshots.delete(card);
            }
            if (sequence !== before) {
                try {
                    Promise.resolve(onChange()).catch(() => {});
                } catch (_) { /* Diagnostics must not interrupt the panel. */ }
            }
        };
        const observer = new MutationObserver(process);
        observer.observe(container, { childList: true, characterData: true, attributes: true, subtree: true });
        process();
        return {
            flush() { process(observer.takeRecords()); },
            disconnect() {
                if (stopped) return;
                process(observer.takeRecords());
                observer.disconnect();
                stopped = true;
            }
        };
    }

    root.BasicCardHistory = { create };
})(typeof window !== 'undefined' ? window : globalThis);
