(function initResponseCardCover() {
  'use strict';
  if (window.ResultsResponseCardCover) return;

  const HOLD = 0.30;
  const FINISH = 0.84;
  const EXIT = 34;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const pull = (raw) => raw < 0.55
    ? raw * 0.72
    : 0.396 + 0.604 * (1 - Math.pow(1 - (raw - 0.55) / 0.45, 2.4));

  function create(root) {
    if (!root) return null;
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let state = null;
    let raf = 0;
    let destroyed = false;
    const cardsInRoot = () => Array.from(root.querySelectorAll('.llm-panel'))
      .filter((card) => (card.parentElement === root || state?.groups.includes(card.parentElement))
        && !card.matches('.favorite-panel, #comparison-panel'));
    const visibleCards = () => cardsInRoot().filter((card) => !card.hidden
      && card.style.display !== 'none' && !card.classList.contains('hidden'));
    const mode = () => root.classList.contains('view-grid') ? 'grid' : 'stack';
    const columns = () => mode() === 'grid'
      ? clamp(Math.floor(((root.clientWidth || root.getBoundingClientRect().width || window.innerWidth) + 10) / 310), 1, 3)
      : 1;
    const enabled = () => (root.classList.contains('view-stack') || root.classList.contains('view-grid'))
      && !document.body.classList.contains('llm-stream-preview-open')
      && !root.querySelector('.llm-panel-expanded') && !motion?.matches;

    function geometry() {
      if (!state) return;
      const bar = document.querySelector('.top-control-bar');
      const barTop = bar ? Number.parseFloat(getComputedStyle(bar).top) || 0 : 0;
      state.top = Math.max(window.innerWidth <= 700 ? 66 : 76, (bar?.offsetHeight || 0) + barTop + 8);
      state.height = Math.max(1, Math.min(620, Math.max(470, window.innerHeight - 96), window.innerHeight - state.top - 20));
      state.step = Math.max(1, window.innerHeight * 0.92);
      root.style.setProperty('--response-cover-top', `${state.top}px`);
      root.style.setProperty('--response-cover-height', `${state.height}px`);
      root.style.setProperty('--response-cover-travel', `${(state.groups.length - 1) * state.step}px`);
      root.style.setProperty('--response-cover-columns', String(state.columns));
    }

    function progress() {
      return state ? clamp((state.top - root.getBoundingClientRect().top) / state.step, 0, state.groups.length - 1) : 0;
    }

    function render() {
      if (!state || !root.isConnected) return;
      const absolute = progress();
      const base = Math.floor(absolute);
      const t = pull(clamp((absolute - base - HOLD) / (FINISH - HOLD), 0, 1));
      // Moving blocks do not accept clicks through covered controls.
      const active = t >= 1 ? base + 1 : t === 0 ? base : -1;
      state.groups.forEach((group, index) => {
        const current = index === base;
        const incoming = index === base + 1;
        const visible = (current && t < 1) || (incoming && t > 0);
        const y = current ? -EXIT * t : incoming ? 100 * (1 - t) : index < base ? -EXIT : 100;
        group.style.transform = `translate3d(0, ${y}%, 0)`;
        group.style.zIndex = String(index + 1);
        group.style.visibility = visible ? 'visible' : 'hidden';
      });
      state.cards.forEach((card, index) => {
        const interactive = Math.floor(index / state.columns) === active;
        card.toggleAttribute('inert', !interactive);
        card.setAttribute('aria-hidden', String(!interactive));
      });
    }

    function schedule() {
      if (raf || destroyed) return;
      raf = requestAnimationFrame(() => { raf = 0; render(); });
    }

    function restore() {
      if (!state) return;
      const old = state;
      state = null;
      old.entries.forEach(({ card, marker, group, inert, ariaHidden }) => {
        if (card.parentNode === group && marker.parentNode === root) root.insertBefore(card, marker);
        marker.remove();
        card.classList.remove('response-cover-card');
        card.toggleAttribute('inert', inert);
        if (ariaHidden === null) card.removeAttribute('aria-hidden');
        else card.setAttribute('aria-hidden', ariaHidden);
      });
      old.sticky.remove();
      root.classList.remove('response-cover-host');
      ['top', 'height', 'travel', 'columns'].forEach((key) => root.style.removeProperty(`--response-cover-${key}`));
    }

    function refresh() {
      if (destroyed) return;
      const candidates = visibleCards();
      const columnCount = columns();
      const shouldMount = enabled() && Math.ceil(candidates.length / columnCount) >= 2;
      if (state && shouldMount && state.columns === columnCount && state.mode === mode() && candidates.length === state.cards.length
        && candidates.every((card, index) => card === state.cards[index])) return;
      if (!state && !shouldMount) return;

      const absolute = progress();
      const previousColumns = state?.columns;
      const readingIndex = Math.floor(absolute) + (absolute % 1 >= FINISH ? 1 : 0);
      const previousCards = state?.cards.slice(readingIndex * previousColumns, (readingIndex + 1) * previousColumns) || [];
      const previousNextCards = state?.cards.slice((readingIndex + 1) * previousColumns, (readingIndex + 2) * previousColumns) || [];
      const reading = state && root.getBoundingClientRect().top <= state.top
        && root.getBoundingClientRect().bottom >= state.top + state.height;
      restore();
      if (!shouldMount) return;
      const cards = visibleCards();
      const sticky = document.createElement('div');
      sticky.className = 'response-cover-sticky';
      const deck = document.createElement('div');
      deck.className = 'response-cover-deck';
      const groups = [];
      const entries = cards.map((card, index) => {
        if (index % columnCount === 0) {
          const group = document.createElement('div');
          group.className = 'response-cover-group';
          deck.appendChild(group);
          groups.push(group);
        }
        const group = groups[groups.length - 1];
        const marker = document.createComment('response card position');
        root.insertBefore(marker, card);
        const entry = { card, marker, group, inert: card.hasAttribute('inert'), ariaHidden: card.getAttribute('aria-hidden') };
        card.classList.add('response-cover-card');
        group.appendChild(card);
        return entry;
      });
      sticky.appendChild(deck);
      root.appendChild(sticky);
      root.classList.add('response-cover-host');
      state = { sticky, deck, cards, groups, entries, columns: columnCount, mode: mode() };
      geometry();
      observe();
      if (reading) {
        const previous = previousCards.find((card) => cards.includes(card));
        const index = previous ? Math.floor(cards.indexOf(previous) / columnCount) : Math.min(readingIndex, groups.length - 1);
        const sameGroup = (oldCards, newCards) => oldCards.length === newCards.length && oldCards.every((card, i) => card === newCards[i]);
        const sameBlocks = previousColumns === columnCount
          && sameGroup(previousCards, cards.slice(index * columnCount, (index + 1) * columnCount))
          && sameGroup(previousNextCards, cards.slice((index + 1) * columnCount, (index + 2) * columnCount));
        const position = index + (sameBlocks ? Math.max(0, absolute - readingIndex) : 0);
        const top = root.getBoundingClientRect().top + window.scrollY - state.top + position * state.step;
        window.scrollTo({ top, behavior: 'instant' });
      }
      render();
    }

    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.type === 'attributes'
        || record.target === root || record.target === state?.deck || state?.groups.includes(record.target))) {
        refresh();
        observe();
      }
    });
    function observe() {
      observer.disconnect();
      observer.observe(root, { attributes: true, attributeFilter: ['class', 'hidden'], childList: true });
      observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      if (state) {
        observer.observe(state.deck, { childList: true });
        state.groups.forEach((group) => observer.observe(group, { childList: true }));
      }
      cardsInRoot().forEach((card) => observer.observe(card, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] }));
    }
    const onResize = () => {
      if ((state && state.columns !== columns()) || (!state && enabled())) {
        refresh();
        return;
      }
      const absolute = progress();
      const reading = state && root.getBoundingClientRect().top <= state.top
        && root.getBoundingClientRect().bottom >= state.top + state.height;
      geometry();
      if (reading) {
        const top = root.getBoundingClientRect().top + window.scrollY - state.top + absolute * state.step;
        window.scrollTo({ top, behavior: 'instant' });
      }
      schedule();
    };
    const barObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
    const bar = document.querySelector('.top-control-bar');
    if (bar) barObserver?.observe(bar);
    barObserver?.observe(root);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', onResize);
    motion?.addEventListener?.('change', refresh);
    observe();
    refresh();

    return {
      refresh,
      destroy() {
        destroyed = true;
        cancelAnimationFrame(raf);
        observer.disconnect();
        barObserver?.disconnect();
        window.removeEventListener('scroll', schedule);
        window.removeEventListener('resize', onResize);
        motion?.removeEventListener?.('change', refresh);
        restore();
      }
    };
  }

  window.ResultsResponseCardCover = Object.freeze({ create });
})();
