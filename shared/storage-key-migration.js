(function installStorageKeyMigration(root) {
    'use strict';

    if (!root || root.StorageKeyMigration) return;

    // Old llmCodex*/llmCortex* storage keys -> neutral names. `copy` keys hold
    // user settings or run records and are carried over; the rest are
    // transient (cleared on reload) or legacy and are just dropped.
    const MAP = Object.freeze({
        'llmCodexDebateRun.v1': { to: 'aoRunTransport.v1', copy: true },
        'llmCodexDebateScheme.v1': { to: 'aoSchemeMode.v1', copy: true },
        'llmDisputAutoMode.v1': { to: 'aoAutoMode.v1', copy: true },
        'llmCodexDebateFullAnswers.v1': { to: 'aoFullAnswers.v1', copy: true },
        'llmCodexDebateSelectors.v1': { to: 'aoSelectors.v1', copy: false },
        'llmCortexDebateEngineState.v1': { to: 'aoEngineState.v1', copy: false },
        'llmCodexDebateTrace.v1': { to: 'aoTrace.v1', copy: false }
    });
    const LEGACY_ONLY = ['llmCodexDebateTrace', 'llmCortexDebateBackgroundExecutor.v1'];

    const run = (storage) => new Promise((resolve) => {
        try {
            if (!storage?.get || !storage?.set || !storage?.remove) { resolve(false); return; }
            const oldKeys = Object.keys(MAP);
            const newKeys = oldKeys.map((k) => MAP[k].to);
            storage.get([...oldKeys, ...newKeys, ...LEGACY_ONLY], (data) => {
                try {
                    const have = data || {};
                    const payload = {};
                    const drop = [...LEGACY_ONLY];
                    oldKeys.forEach((key) => {
                        if (!(key in have)) return;
                        const { to, copy } = MAP[key];
                        if (copy && !(to in have)) payload[to] = have[key];
                        drop.push(key);
                    });
                    const finish = () => storage.remove(drop.filter((k) => k in have), () => resolve(true));
                    if (Object.keys(payload).length) storage.set(payload, finish);
                    else finish();
                } catch (_) { resolve(false); }
            });
        } catch (_) { resolve(false); }
    });

    root.StorageKeyMigration = Object.freeze({ MAP, run });
    if (root.chrome?.storage?.local && root.document) {
        root.StorageKeyMigration.ready = run(root.chrome.storage.local);
    }
})(typeof self !== 'undefined' ? self : this);
