// Floating tooltip controller for results pages.
(function installResultsTooltips(root) {
    'use strict';

    if (!root || root.ResultsTooltips) return;

    function create(options = {}) {
        const doc = options.document || root.document;
        const floatingTooltip = doc.createElement('div');
        floatingTooltip.className = 'floating-tooltip';
        doc.body.appendChild(floatingTooltip);

        let activeTooltipTarget = null;
        const tooltipTargets = new Set();

        const positionFloatingTooltip = (target) => {
            if (!target || !target.dataset || !target.dataset.tooltip) return;
            const message = target.dataset.tooltip.trim();
            if (!message) return;
            const description = (target.dataset.tooltipDesc || '').trim();
            if (description) {
                const name = doc.createElement('b');
                name.className = 'floating-tooltip-name';
                name.textContent = message;
                const desc = doc.createElement('span');
                desc.className = 'floating-tooltip-desc';
                desc.textContent = description;
                floatingTooltip.replaceChildren(name, desc);
            } else {
                floatingTooltip.textContent = message;
            }
            activeTooltipTarget = target;
            floatingTooltip.classList.add('is-visible');
            requestAnimationFrame(() => {
                const rect = target.getBoundingClientRect();
                const tooltipRect = floatingTooltip.getBoundingClientRect();
                const spacing = 12;
                let top = rect.top - tooltipRect.height - spacing;
                if (top < 8) top = rect.bottom + spacing;
                let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
                const viewportWidth = root.innerWidth;
                const maxLeft = viewportWidth - tooltipRect.width - 8;
                left = Math.min(Math.max(left, 8), Math.max(maxLeft, 8));
                floatingTooltip.style.top = `${top + root.scrollY}px`;
                floatingTooltip.style.left = `${left + root.scrollX}px`;
            });
        };

        const hideFloatingTooltip = (target) => {
            if (target && target !== activeTooltipTarget) return;
            activeTooltipTarget = null;
            floatingTooltip.classList.remove('is-visible');
        };

        const registerTooltipTarget = (el) => {
            if (!el || !el.dataset || !el.dataset.tooltip || !el.dataset.tooltip.trim()) return;
            if (tooltipTargets.has(el)) return;
            tooltipTargets.add(el);
            el.addEventListener('mouseenter', () => positionFloatingTooltip(el));
            el.addEventListener('focus', () => positionFloatingTooltip(el));
            el.addEventListener('mouseleave', () => hideFloatingTooltip(el));
            el.addEventListener('blur', () => hideFloatingTooltip(el));
        };

        const registerInitialTargets = () => {
            [
                ...doc.querySelectorAll('.select-tooltip[data-tooltip]'),
                ...doc.querySelectorAll('.mode-pill[data-tooltip]'),
                ...doc.querySelectorAll('.top-new-pages-toggle[data-tooltip]'),
                ...doc.querySelectorAll('.sidebar-toggle-btn[data-tooltip]')
            ].forEach(registerTooltipTarget);
        };

        const repositionActive = () => {
            if (activeTooltipTarget) positionFloatingTooltip(activeTooltipTarget);
        };

        registerInitialTargets();

        return {
            registerTooltipTarget,
            positionFloatingTooltip,
            hideFloatingTooltip,
            repositionActive,
            registerInitialTargets
        };
    }

    root.ResultsTooltips = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
