(function initPipelineRuntime(global) {
    'use strict';

    const MODELS = [
        { name: 'Claude', defaultActive: true },
        { name: 'GPT', defaultActive: true },
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

    const buildJudgePromptOptionsHtml = ({ index = 0, orderedPrompts = [], escapeHtml = escapeFallback } = {}) => {
        const prompts = Array.isArray(orderedPrompts) ? orderedPrompts.filter((prompt) => prompt?.id) : [];
        if (!prompts.length) return '';
        const metaPrompt = prompts.find((prompt) => {
            const id = String(prompt.id || '').toLowerCase();
            return id.includes('meta_synthesis');
        }) || prompts.find((prompt) => String(prompt.label || '').toLowerCase().includes('meta'));
        const primaryPrompt = index > 0 ? (metaPrompt || prompts[0]) : prompts[0];
        const ordered = [primaryPrompt, ...prompts.filter((prompt) => prompt !== primaryPrompt)];
        // "None" is first: no mini prompt is attached to the block's round. A new block keeps the
        // former default (the first prompt); Universal and Test start with None (their saved stacks).
        const options = ordered
            .map((prompt, position) => `<option value="${escapeHtml(prompt.id)}"${position === 0 ? ' selected' : ''}>${escapeHtml(prompt.label || prompt.id)}</option>`)
            .join('');
        return `<option value="">None</option>${options}`;
    };

    const buildModelBlocksHtml = ({
        activeIndices = DEFAULT_MODEL_INDICES,
        withRole = false,
        onlyActive = false,
        orderedPrompts = [],
        escapeHtml = escapeFallback
    } = {}) => {
        const activeSet = new Set(activeIndices);
        return MODELS
            .map((model, index) => ({ model, index }))
            .filter(({ index }) => !onlyActive || activeSet.has(index))
            .map(({ model, index }) => {
            const isActive = activeSet.has(index);
            const roleHtml = withRole
                ? `<select class="role-selector judge-prompt-selector"${isActive ? '' : ' disabled'}>${buildJudgePromptOptionsHtml({ index, orderedPrompts, escapeHtml })}</select>`
                : '';
            const inputAttrs = `${isActive ? ' checked' : ''} aria-label="Input" title="Input"`;
            const sendAttrs = `${isActive ? ' checked' : ''}${isActive ? '' : ' disabled'} aria-label="Send" title="Send"`;
            return `
                <div class="model-block ${isActive ? 'active' : 'inactive'}${withRole ? ' with-role' : ''}" data-index="${index}">
                    <div class="model-header">
                        <span class="status-indicator" data-llm-name="${escapeHtml(model.name)}"></span>
                        <input type="checkbox" class="model-checkbox model-input-checkbox"${inputAttrs}>
                        <span class="model-name">${escapeHtml(model.name)}</span>
                        <button type="button" class="model-block-inspect-btn" title="Inspect block prompts" aria-label="Inspect ${escapeHtml(model.name)} pipeline block">📝</button>
                        <input type="checkbox" class="model-checkbox model-send-checkbox"${sendAttrs}>
                    </div>
                    ${roleHtml}
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
        renderModelStack(r1Stack, { activeIndices: [], withRole: false, onlyActive: true, orderedPrompts, escapeHtml });
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
            const sendCb = block.querySelector('.model-send-checkbox');
            const role = block.querySelector('.role-selector');
            return {
                name: block.querySelector('.model-name')?.textContent?.trim() || '',
                input: !!inputCb?.checked,
                send: !!sendCb?.checked,
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
                const name = block.querySelector('.model-name')?.textContent?.trim();
                if (!name) return null;
                const input = !!block.querySelector('.model-input-checkbox')?.checked;
                const send = !!block.querySelector('.model-send-checkbox')?.checked;
                const promptId = block.querySelector('.role-selector')?.value || null;
                return { name, input, send, promptId };
            })
            .filter(Boolean);
        const inputModels = models.filter((model) => model.input).map((model) => model.name);
        const sendModels = models.filter((model) => model.send).map((model) => model.name);
        return { models, inputModels, sendModels };
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
        buildJudgePromptOptionsHtml,
        buildModelBlocksHtml,
        renderModelStack,
        hydratePipelineStacks,
        captureModelStackState,
        getRoundModelsState,
        buildPipelineRuntimeSnapshot
    };
})(typeof window !== 'undefined' ? window : globalThis);
