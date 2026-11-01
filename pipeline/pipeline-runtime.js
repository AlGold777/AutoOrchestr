(function initPipelineRuntime(global) {
    'use strict';

    const MODELS = [
        { name: 'Claude', defaultActive: false },
        { name: 'GPT', defaultActive: false },
        { name: 'Gemini', defaultActive: false },
        { name: 'Grok', defaultActive: false },
        { name: 'Le Chat', defaultActive: false },
        { name: 'Qwen', defaultActive: false },
        { name: 'DeepSeek', defaultActive: false },
        { name: 'Perplexity', defaultActive: false },
        { name: 'Z.ai', defaultActive: false },
        { name: 'Kimi', defaultActive: false }
    ];

    const DEFAULT_MODEL_INDICES = MODELS.reduce((acc, model, index) => {
        if (model.defaultActive) acc.push(index);
        return acc;
    }, []);
    const DEFAULT_JUDGE_INDICES = MODELS.length > 1 ? [0, 1] : [0];
    const DEFAULT_LATE_JUDGE_INDICES = [0];
    const escapeFallback = (value = '') => String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const cloneConfig = (config) => {
        if (!config) return null;
        try {
            if (typeof structuredClone === 'function') return structuredClone(config);
        } catch (_) {}
        return JSON.parse(JSON.stringify(config));
    };

    const getRoundStage = (roundIndex) => roundIndex === 1 ? 'models' : 'judge';

    // Participant labels are stored in full; omit a repeated provider prefix only in the canvas caption.
    const getParticipantDisplayLabel = (providerName, participantLabel) => {
        const provider = String(providerName || '').trim();
        const label = String(participantLabel || '').trim();
        if (!label || label === provider) return provider;
        if (!provider) return label;
        const startsWithProvider = label.slice(0, provider.length).toLocaleLowerCase() === provider.toLocaleLowerCase();
        if (!startsWithProvider) return label;
        const rawSuffix = label.slice(provider.length);
        const suffix = rawSuffix.trimStart();
        const hasWhitespaceBoundary = rawSuffix.length > 0 && /^\s/.test(rawSuffix) && suffix.length > 0;
        if (!hasWhitespaceBoundary && !/^[·•:—-]/.test(suffix)) return label;
        const shortened = /^[·•:—-]/.test(suffix) ? suffix.slice(1).trim() : suffix;
        return shortened || label;
    };

    const buildJudgePromptOptionsHtml = ({ index = 0, orderedPrompts = [], escapeHtml = escapeFallback } = {}) => {
        const prompts = Array.isArray(orderedPrompts) ? orderedPrompts.filter((prompt) => prompt?.id) : [];
        if (!prompts.length) return '';
        const metaPrompt = prompts.find((prompt) => {
            const id = String(prompt.id || '').toLowerCase();
            return id.includes('meta_synthesis');
        }) || prompts.find((prompt) => String(prompt.label || '').toLowerCase().includes('meta'));
        const primaryPrompt = index > 0 ? (metaPrompt || prompts[0]) : prompts[0];
        const ordered = [primaryPrompt, ...prompts.filter((prompt) => prompt !== primaryPrompt)];
        // "None" is first and the default of every new block and round: no mini prompt is attached
        // unless the moderator picks one. Saved pipelines restore the prompt they stored.
        const options = ordered
            .map((prompt) => `<option value="${escapeHtml(prompt.id)}">${escapeHtml(prompt.label || prompt.id)}</option>`)
            .join('');
        return `<option value="" selected>None</option>${options}`;
    };

    const buildModelBlocksHtml = ({
        activeIndices = DEFAULT_MODEL_INDICES,
        withRole = false,
        onlyActive = false,
        items = null,
        participantControls = false,
        orderedPrompts = [],
        escapeHtml = escapeFallback
    } = {}) => {
        const activeSet = new Set(activeIndices);
        const source = Array.isArray(items)
            ? items.map((item, index) => ({ model: { name: String(item?.name || ''), id: String(item?.id || item?.participantId || item?.name || ''), label: String(item?.label || item?.name || '') }, index, item }))
                .filter(({ model }) => model.name)
            : MODELS.map((model, index) => ({ model: { ...model, id: model.name, label: model.name }, index, item: null }));
        return source
            .filter(({ index }) => Array.isArray(items) || !onlyActive || activeSet.has(index))
            .map(({ model, index, item }) => {
            const isActive = typeof item?.send === 'boolean' ? item.send : (typeof item?.input === 'boolean' ? item.input : activeSet.has(index));
            const roleHtml = withRole
                ? `<select class="role-selector judge-prompt-selector"${isActive || participantControls ? '' : ' disabled'}>${buildJudgePromptOptionsHtml({ index, orderedPrompts, escapeHtml })}</select>`
                : '';
            const inputAttrs = `${isActive ? ' checked' : ''} aria-label="Участие в раунде"`;
            const label = model.label || model.name;
            const displayLabel = getParticipantDisplayLabel(model.name, label);
            const removeButton = participantControls && model.id !== model.name
                ? `<button type="button" class="model-participant-remove" data-participant-remove title="Убрать участника из этого раунда" aria-label="Убрать ${escapeHtml(label)} из раунда">×</button>`
                : '';
            const participantTools = participantControls
                ? `<span class="model-participant-label-wrap"><button type="button" class="model-participant-label" data-participant-label title="Переименовать участника">${escapeHtml(label === model.name ? '✎' : displayLabel)}</button>${removeButton}<button type="button" class="model-participant-switch" data-participant-switch title="Сменить модель участника" aria-label="Сменить модель ${escapeHtml(label)}">⇄</button><button type="button" class="model-participant-add" data-participant-add title="Добавить участника ${escapeHtml(model.name)}" aria-label="Добавить участника ${escapeHtml(model.name)}">+</button></span>`
                : '';
            return `
                <div class="model-block ${isActive ? 'active' : 'inactive'}${withRole ? ' with-role' : ''}${model.id !== model.name ? ' is-participant-duplicate' : ''}" data-index="${index}" data-provider-name="${escapeHtml(model.name)}" data-participant-id="${escapeHtml(model.id)}" data-participant-label-value="${escapeHtml(label)}">
                    <div class="model-header">
                        <span class="model-status-slot"><span class="status-indicator" data-llm-name="${escapeHtml(model.name)}"></span></span>
                        <span class="model-name">${escapeHtml(model.name)}</span>
                        ${participantTools}
                    </div>
                    <div class="model-options">
                        <input type="checkbox" class="model-checkbox model-input-checkbox"${inputAttrs}>
                        ${roleHtml}
                    </div>
                </div>
            `;
        }).join('');
    };

    const renderModelStack = (stack, options = {}) => {
        if (!stack) return;
        stack.innerHTML = buildModelBlocksHtml(options);
    };

    const hydratePipelineStacks = ({ document, escapeHtml = escapeFallback, orderedPrompts = [] } = {}) => {
        const r1Stack = document?.getElementById?.('r1-models');
        renderModelStack(r1Stack, { activeIndices: [], withRole: true, onlyActive: true, orderedPrompts, escapeHtml });
        const r2Stack = document?.getElementById?.('r2-models');
        renderModelStack(r2Stack, { activeIndices: [], withRole: true, onlyActive: true, orderedPrompts, escapeHtml });
    };

    const captureModelStackState = (document, stackId) => {
        const stack = document?.getElementById?.(stackId);
        if (!stack) return null;
        const items = Array.from(stack.querySelectorAll('.model-block'))
            .filter((block) => !block.classList.contains('pipeline-empty-slot'))
            .map((block) => {
            const inputCb = block.querySelector('.model-input-checkbox');
            const role = block.querySelector('.role-selector');
            return {
                name: block.dataset.providerName || block.querySelector('.model-name')?.textContent?.trim() || '',
                id: block.dataset.participantId || block.dataset.providerName || block.querySelector('.model-name')?.textContent?.trim() || '',
                label: block.dataset.participantLabelValue || block.querySelector('.model-participant-label')?.textContent?.trim() || '',
                input: !!inputCb?.checked,
                send: !!inputCb?.checked,
                // None (empty value) is stored as no role.
                role: role ? (role.value || null) : null
            };
        }).filter((item) => item.name);
        return { items };
    };

    const getRoundModelsState = (document, roundIndex) => {
        const stack = document?.getElementById?.(`r${roundIndex}-models`);
        if (!stack) return null;
        const models = Array.from(stack.querySelectorAll('.model-block'))
            .map((block) => {
                const name = block.dataset.providerName || block.querySelector('.model-name')?.textContent?.trim();
                if (!name) return null;
                const input = !!block.querySelector('.model-input-checkbox')?.checked;
                const send = input;
                const promptId = block.querySelector('.role-selector')?.value || null;
                return { name, id: block.dataset.participantId || name, label: block.dataset.participantLabelValue || name, input, send, promptId };
            })
            .filter(Boolean);
        const inputModels = models.filter((model) => model.input).map((model) => model.name);
        const sendModels = models.filter((model) => model.send).map((model) => model.name);
        return { models, inputModels, sendModels, participantIds: models.filter((model) => model.send).map((model) => model.id) };
    };

    const buildPipelineRuntimeSnapshot = ({ config, roundCounter = 1, getRoundState } = {}) => {
        const snapshot = cloneConfig(config) || {};
        const rounds = [];
        const totalRounds = Math.max(1, Number(snapshot?.roundCounter) || roundCounter || 1);
        for (let r = 1; r <= totalRounds; r++) {
            const state = typeof getRoundState === 'function' ? getRoundState(r) : null;
            if (!state) {
                rounds.push(null);
                continue;
            }
            rounds.push({
                round: r,
                stage: getRoundStage(r),
                ...state
            });
        }
        return {
            config: snapshot,
            rounds
        };
    };

    global.PipelineRuntime = {
        MODELS,
        DEFAULT_MODEL_INDICES,
        DEFAULT_JUDGE_INDICES,
        DEFAULT_LATE_JUDGE_INDICES,
        cloneConfig,
        getRoundStage,
        getParticipantDisplayLabel,
        buildJudgePromptOptionsHtml,
        buildModelBlocksHtml,
        renderModelStack,
        hydratePipelineStacks,
        captureModelStackState,
        getRoundModelsState,
        buildPipelineRuntimeSnapshot
    };
})(typeof window !== 'undefined' ? window : globalThis);
