/* Internal-scroll cover deck. Cards remain direct feed children for session/export code. */
(() => {
    const create = (root) => {
        if (!root) return null;
        let enabled = true;
        let cards = [];
        let height = 0;
        let step = 1;
        let frame = 0;
        let readingCard = null;
        const savedInert = new Map();
        const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        const clean = (card) => {
            card.classList.remove('pipeline-cover-card');
            card.removeAttribute('data-cover-state');
            card.style.removeProperty('--pipeline-cover-y');
            card.style.removeProperty('--pipeline-cover-z');
            if (savedInert.has(card)) card.inert = savedInert.get(card);
            savedInert.delete(card);
        };
        const paint = () => {
            if (!height || !cards.length) return;
            const position = Math.min(cards.length - 1, Math.max(0, root.scrollTop / step));
            const index = Math.floor(position);
            const progress = Math.min(1, Math.max(0, (position - index - 0.30) / 0.54));
            readingCard = cards[progress >= 1 ? Math.min(index + 1, cards.length - 1) : index];
            cards.forEach((card, i) => {
                const active = i === index || (i === index + 1 && progress > 0);
                const seated = (i === index && progress === 0) || (i === index + 1 && progress === 1);
                const y = i === index ? -0.34 * progress * height : (1 - progress) * height;
                const state = !active ? 'hidden' : seated ? 'seated' : 'moving';
                if (card.dataset.coverState !== state) card.dataset.coverState = state;
                const value = `${y.toFixed(2)}px`;
                if (card.style.getPropertyValue('--pipeline-cover-y') !== value) card.style.setProperty('--pipeline-cover-y', value);
                card.inert = state !== 'seated' || savedInert.get(card);
            });
        };
        const refresh = () => {
            frame = 0;
            const next = Array.from(root.children).filter((card) => card.classList.contains('debate-model-card')
                && !card.hidden && card.style.display !== 'none');
            const usable = enabled && !motion?.matches && root.clientHeight > 20
                && !next.some((card) => card.classList.contains('is-wide-expanded'));
            if (!usable || !next.length) {
                cards.forEach(clean);
                cards = [];
                height = 0;
                root.classList.remove('pipeline-cover-host');
                root.style.removeProperty('--pipeline-cover-height');
                root.style.removeProperty('--pipeline-cover-travel');
                return;
            }
            const changed = next.length !== cards.length || next.some((card, index) => card !== cards[index]);
            const oldPosition = height ? root.scrollTop / step : 0;
            const oldCard = readingCard;
            cards.filter((card) => !next.includes(card)).forEach(clean);
            cards = next;
            const style = getComputedStyle(root);
            height = root.clientHeight - parseFloat(style.paddingTop || 0) - parseFloat(style.paddingBottom || 0);
            step = height * 0.92;
            root.style.setProperty('--pipeline-cover-height', `${height}px`);
            root.style.setProperty('--pipeline-cover-travel', `${(cards.length - 1) * step}px`);
            root.classList.add('pipeline-cover-host');
            cards.forEach((card, index) => {
                if (!savedInert.has(card)) savedInert.set(card, !!card.inert);
                card.classList.add('pipeline-cover-card');
                card.style.setProperty('--pipeline-cover-z', String(index + 1));
            });
            const retainedIndex = cards.indexOf(oldCard);
            root.scrollTop = (changed && retainedIndex >= 0 ? retainedIndex : oldPosition) * step;
            paint();
        };
        const schedule = () => { if (!frame) frame = requestAnimationFrame(refresh); };
        const observer = new MutationObserver(schedule);
        // Presentation attributes written by paint are deliberately excluded.
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
        const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
        resize?.observe(root);
        root.addEventListener('scroll', paint, { passive: true });
        motion?.addEventListener('change', schedule);
        return {
            refresh,
            setEnabled(value) { enabled = !!value; refresh(); },
            destroy() {
                observer.disconnect(); resize?.disconnect();
                root.removeEventListener('scroll', paint);
                motion?.removeEventListener('change', schedule);
                cancelAnimationFrame(frame);
                enabled = false; refresh();
            }
        };
    };
    const cleanSnapshot = (card) => {
        card.classList.remove('pipeline-cover-card');
        card.removeAttribute('data-cover-state');
        card.removeAttribute('inert');
        card.style.removeProperty('--pipeline-cover-y');
        card.style.removeProperty('--pipeline-cover-z');
    };
    window.PipelineCardCover = { create, cleanSnapshot };
})();
