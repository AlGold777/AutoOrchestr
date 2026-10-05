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
      .filter((card) => (card.parentElement === root || card.parentElement === state?.deck)
        && !card.matches('.favorite-panel, #comparison-panel'));
    const visibleCards = () => cardsInRoot().filter((card) => !card.hidden
      && card.style.display !== 'none' && !card.classList.contains('hidden'));
    const enabled = () => root.classList.contains('view-stack')
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
      root.style.setProperty('--response-cover-travel', `${(state.cards.length - 1) * state.step}px`);
    }

    function progress() {
      return state ? clamp((state.top - root.getBoundingClientRect().top) / state.step, 0, state.cards.length - 1) : 0;
    }

    function render() {
      if (!state || !root.isConnected) return;
      const absolute = progress();
      const base = Math.floor(absolute);
      const t = pull(clamp((absolute - base - HOLD) / (FINISH - HOLD), 0, 1));
      // Neither moving card accepts clicks during overlap, so a press on the
      // incoming card cannot fall through to a covered control in the old card.
      const active = t >= 1 ? base + 1 : t === 0 ? base : -1;
      state.cards.forEach((card, index) => {
        const current = index === base;
        const incoming = index === base + 1;
        const visible = (current && t < 1) || (incoming && t > 0);
        const y = current ? -EXIT * t : incoming ? 100 * (1 - t) : index < base ? -EXIT : 100;
        card.style.transform = `translate3d(0, ${y}%, 0)`;
        card.style.zIndex = String(index + 1);
        card.style.visibility = visible ? 'visible' : 'hidden';
        card.toggleAttribute('inert', index !== active);
        card.setAttribute('aria-hidden', String(index !== active));
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
      old.entries.forEach(({ card, marker, style, inert, ariaHidden }) => {
        if (card.parentNode === old.deck && marker.parentNode === root) root.insertBefore(card, marker);
        marker.remove();
        card.classList.remove('response-cover-card');
        Object.entries(style).forEach(([property, saved]) => {
          if (saved.value) card.style.setProperty(property, saved.value, saved.priority);
          else card.style.removeProperty(property);
        });
        card.toggleAttribute('inert', inert);
        if (ariaHidden === null) card.removeAttribute('aria-hidden');
        else card.setAttribute('aria-hidden', ariaHidden);
      });
      old.sticky.remove();
      root.classList.remove('response-cover-host');
      ['top', 'height', 'travel'].forEach((key) => root.style.removeProperty(`--response-cover-${key}`));
    }

    function refresh() {
      if (destroyed) return;
      const candidates = visibleCards();
      const shouldMount = enabled() && candidates.length >= 2;
      if (state && shouldMount && candidates.length === state.cards.length
        && candidates.every((card, index) => card === state.cards[index])) return;
      if (!state && !shouldMount) return;

      const absolute = progress();
      const previous = state?.cards[Math.floor(absolute)];
      const previousNext = state?.cards[Math.floor(absolute) + 1];
      const reading = state && root.getBoundingClientRect().top <= state.top
        && root.getBoundingClientRect().bottom >= state.top + state.height;
      restore();
      if (!shouldMount) return;
      const cards = visibleCards();
      const sticky = document.createElement('div');
      sticky.className = 'response-cover-sticky';
      const deck = document.createElement('div');
      deck.className = 'response-cover-deck';
      const entries = cards.map((card) => {
        const marker = document.createComment('response card position');
        root.insertBefore(marker, card);
        const style = Object.fromEntries(['transform', 'z-index', 'visibility'].map((property) => [property, {
          value: card.style.getPropertyValue(property), priority: card.style.getPropertyPriority(property)
        }]));
        const entry = { card, marker, style, inert: card.hasAttribute('inert'), ariaHidden: card.getAttribute('aria-hidden') };
        card.classList.add('response-cover-card');
        deck.appendChild(card);
        return entry;
      });
      sticky.appendChild(deck);
      root.appendChild(sticky);
      root.classList.add('response-cover-host');
      state = { sticky, deck, cards, entries };
      geometry();
      observe();
      if (reading) {
        const index = cards.indexOf(previous);
        const next = cards[index + 1] === previousNext ? absolute % 1 : 0;
        const position = index >= 0 ? index + next : Math.min(Math.floor(absolute), cards.length - 1);
        const top = root.getBoundingClientRect().top + window.scrollY - state.top + position * state.step;
        window.scrollTo({ top, behavior: 'instant' });
      }
      render();
    }

    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.type === 'attributes'
        || record.target === root || record.target === state?.deck)) {
        refresh();
        observe();
      }
    });
    function observe() {
      observer.disconnect();
      observer.observe(root, { attributes: true, attributeFilter: ['class', 'hidden'], childList: true });
      observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
      if (state) observer.observe(state.deck, { childList: true });
      cardsInRoot().forEach((card) => observer.observe(card, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] }));
    }
    const onResize = () => {
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
