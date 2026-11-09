// The card of a Basic participant shows the verdict of the engine on its attempt (L-20).
// A card is marked accepted, or it keeps the last answer with the reason of the rejection (never shown as accepted).
(function initBasicCardVerdict(root) {
    'use strict';

    const NOTICE_CLASS = 'basic-card-verdict';
    // Round id of the card, as results.js writes it: s<step+1>, plus v<visit> for a later visit.
    const roundIdOf = (entry) => `s${Number(entry.step) + 1}${Number(entry.visit) > 1 ? `v${entry.visit}` : ''}`;

    // The participant's card of this attempt. An empty model or participant id matches nothing: no card is taken by guess.
    function find(container, entry) {
        const model = String(entry?.model || '');
        const participant = String(entry?.participant || '');
        if (!container || !model || !participant) return null;
        const round = roundIdOf(entry);
        const cards = Array.from(container.querySelectorAll('.debate-model-card')).filter((card) => (
            card.dataset.llmName === model
            && card.dataset.participantId === participant
            && card.dataset.kind !== 'moderator' && card.dataset.kind !== 'fragment'
            && (!card.dataset.pipelineRoundId || card.dataset.pipelineRoundId === round)
        ));
        return cards[cards.length - 1] || null;
    }

    // Writes the verdict onto the card of the attempt. Returns the card, or null when the attempt has no card.
    function mark(container, entry, reasonText = '') {
        if (!entry || typeof entry.accepted !== 'boolean') return null;
        const card = find(container, entry);
        if (!card) return null;
        const accepted = entry.accepted === true;
        card.dataset.accepted = accepted ? 'true' : 'false';
        const notice = Array.from(card.children).find((node) => node.classList?.contains(NOTICE_CLASS)) || null;
        if (accepted) {
            notice?.remove();
            return card;
        }
        const line = notice || card.ownerDocument.createElement('div');
        line.className = NOTICE_CLASS;
        line.textContent = `Не принято: ${reasonText || 'причина не записана'}. Ниже последний ответ участника; он не принят.`;
        if (!notice) {
            const output = Array.from(card.children).find((node) => node.classList?.contains('debate-model-card-output'));
            if (output) output.after(line);
            else card.append(line);
        }
        return card;
    }

    // A write that has only the text must not replace the formatting the card already shows for this same answer.
    function keepsStructure(body, answer, sameAnswer) {
        if (!body?.querySelector('h1,h2,h3,h4,h5,h6,ul,ol,pre,table,blockquote')) return false;
        return Boolean(sameAnswer(body.textContent, answer));
    }

    root.BasicCardVerdict = Object.freeze({ find, mark, roundIdOf, keepsStructure });
})(typeof window !== 'undefined' ? window : globalThis);
