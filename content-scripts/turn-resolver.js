// Authoritative current-assistant-turn resolver shared by watcher, extractor and verifier.
(function initTurnResolver(root) {
  'use strict';

  function selectorList(value) {
    if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item.trim());
    return typeof value === 'string' && value.trim() ? [value] : [];
  }

  // Kimi renders its private reasoning trace in the same assistant turn as
  // the answer. Broad assistant/markdown selectors can therefore admit the
  // trace as a later DOM candidate even when the specific answer selector is
  // correct. Keep this guard in the authoritative resolver so every consumer
  // (watcher, pipeline and skeleton capture) shares the same exclusion.
  const KIMI_REASONING_SELECTOR = [
    '[class*="think" i]', '[class*="thought" i]', '[class*="reason" i]',
    '[class*="analysis" i]', '[class*="scratch" i]', '[class*="trace" i]',
    '[class*="internal" i]', '[class*="reflection" i]',
    '[data-testid*="think" i]', '[data-testid*="thought" i]',
    '[data-testid*="reason" i]', '[data-testid*="analysis" i]',
    '[data-type*="think" i]', '[data-type*="thought" i]',
    '[data-type*="reason" i]', '[data-type*="analysis" i]'
  ].join(',');

  function isKimiReasoningNode(node) {
    if (!node || typeof node.matches !== 'function') return false;
    try {
      return Boolean(node.matches(KIMI_REASONING_SELECTOR) || node.closest?.(KIMI_REASONING_SELECTOR));
    } catch (_) {
      return false;
    }
  }

  function sortDocumentOrder(nodes = []) {
    return nodes.slice().sort((a, b) => {
      if (a === b) return 0;
      try {
        const position = a.compareDocumentPosition(b);
        const following = root.Node?.DOCUMENT_POSITION_FOLLOWING || 4;
        const preceding = root.Node?.DOCUMENT_POSITION_PRECEDING || 2;
        if (position & following) return -1;
        if (position & preceding) return 1;
      } catch (_) {}
      return 0;
    });
  }

  function createDeepQuery(scope = root.document) {
    let roots = null;
    const collectRoots = () => {
      if (roots) return roots;
      roots = [];
      const seenRoots = new Set();
      const visit = (queryRoot) => {
        if (!queryRoot || seenRoots.has(queryRoot) || typeof queryRoot.querySelectorAll !== 'function') return;
        seenRoots.add(queryRoot);
        roots.push(queryRoot);
        try {
          queryRoot.querySelectorAll('*').forEach((node) => {
            if (node?.shadowRoot) visit(node.shadowRoot);
          });
        } catch (_) {}
      };
      visit(scope);
      return roots;
    };
    const all = (selector) => {
      const matches = [];
      const seen = new Set();
      collectRoots().forEach((queryRoot) => {
        try {
          queryRoot.querySelectorAll(selector).forEach((node) => {
            if (!seen.has(node)) {
              seen.add(node);
              matches.push(node);
            }
          });
        } catch (_) {}
      });
      return matches;
    };
    const one = (selector) => all(selector)[0] || null;
    return Object.freeze({ all, one, roots: collectRoots });
  }

  // ChatGPT draws one turn as sibling blocks: progress lines ("Уточнил план ответа…"), the draft and the
  // final answer. The delivery token ([[AO-xxxxxx]]) is written only at the end of the final answer.
  const DELIVERY_TOKEN_RE = /\[\[AO-[a-z0-9]{6}\]\]/i;
  const PROGRESS_LINE_MAX_CHARS = 200;

  // A progress line sits inside span > span, or has no token and is a progress verb without a verdict
  // («Проверил и уточнил технические риски», review L-3), or is short, has no token and is followed by a longer block.
  function isChatGptProgressLine(node, text, laterEntries) {
    const outerSpan = node.closest?.('span');
    if (outerSpan && outerSpan.parentElement?.closest?.('span')) return true;
    if (DELIVERY_TOKEN_RE.test(text)) return false;
    const classifier = root.AnswerContentClassifier;
    if (text.length < PROGRESS_LINE_MAX_CHARS && classifier?.isProgressLine?.(text)) return true;
    return text.length < PROGRESS_LINE_MAX_CHARS
      && laterEntries.some((entry) => entry.text.length > text.length);
  }

  // The last block with the delivery token is the answer. Without a token: while Stop is visible the turn is
  // still being written, so the answer is awaited (null), never a preamble block (review L-3); otherwise the
  // last block that is not a progress line.
  function pickChatGptAnswerNode(entries, { stopVisible = false } = {}) {
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      if (DELIVERY_TOKEN_RE.test(entries[i].text)) return entries[i].node;
    }
    if (stopVisible) return null;
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      if (!isChatGptProgressLine(entries[i].node, entries[i].text, entries.slice(i + 1))) return entries[i].node;
    }
    return entries.length ? entries[entries.length - 1].node : null;
  }

  // New ChatGPT markup: the turn is the last div[data-turn-key] that holds an answer candidate. Its state
  // (data-talvt-turn-state) is `complete` when the turn is finished; any other state means it is still written.
  function pickChatGptTurn(deepQuery, newMarkup, candidates) {
    if (!newMarkup?.turnSelector || !candidates.length) return null;
    let turns = [];
    try { turns = sortDocumentOrder(deepQuery.all(newMarkup.turnSelector)); } catch (_) { return null; }
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const turn = turns[i];
      if (!candidates.some((node) => turn.contains(node))) continue;
      let stateNode = null;
      try { stateNode = turn.querySelector(newMarkup.turnStateSelector || '[data-talvt-turn-state]'); } catch (_) {}
      const state = stateNode ? String(stateNode.getAttribute('data-talvt-turn-state') || '') : null;
      return { turn, state, generating: state !== null && state !== (newMarkup.completeState || 'complete') };
    }
    return null;
  }

  function resolveTurn(options = {}) {
    const selectors = options.selectors || {};
    const deepQuery = createDeepQuery(options.document || root.document);
    const queryAll = typeof options.queryAll === 'function'
      ? options.queryAll
      : deepQuery.all;
    const queryOne = typeof options.queryOne === 'function'
      ? options.queryOne
      : deepQuery.one;
    const primary = selectorList(selectors.lastMessage);
    const secondary = selectorList(options.answerSelectors);
    const candidateSelectors = [
      ...primary.map((selector, index) => ({ selector, index, sourceKind: 'primary' })),
      ...secondary.map((selector, index) => ({ selector, index: primary.length + index, sourceKind: 'secondary' }))
    ].filter((descriptor) => typeof options.selectorAllowed !== 'function'
      || options.selectorAllowed(descriptor.selector, descriptor));
    const candidates = [];
    const seen = new Set();
    const metadataByElement = new Map();
    const matchedIndices = new Set();

    const add = (node, descriptor) => {
      if (!node || node.nodeType !== 1 || seen.has(node)) return;
      seen.add(node);
      candidates.push(node);
      metadataByElement.set(node, descriptor);
    };
    candidateSelectors.forEach((descriptor) => {
      let nodes = [];
      try { nodes = Array.from(queryAll(descriptor.selector) || []); } catch (_) { nodes = []; }
      if (!nodes.length) {
        try {
          const one = queryOne(descriptor.selector);
          if (one) nodes.push(one);
        } catch (_) {}
      }
      if (nodes.length) matchedIndices.add(descriptor.index);
      nodes.forEach((node) => add(node, descriptor));
    });

    let usedContainerFallback = false;
    // A conversation container is not an assistant turn. On a new chat this
    // fallback counted the composer/main as answer #1, so the real first answer
    // was excluded by the pre-send anchor. Only explicit answer selectors may
    // contribute candidates (including configured secondary selectors).

    // Primary selectors can match both a complete answer and a nested fragment.
    // Collapse matches inside the same message before applying the turn anchor.
    // Do not promote to the message wrapper itself: it can also hold reasoning.
    // ChatGPT also repeats assistant roles on nested fragments, so its existing
    // role-wrapper rule does not require identical nearest roots.
    const primaryRootSelector = selectorList(selectors.messageRoot).join(',');
    const enclosingMessage = node => {
      try { return primaryRootSelector ? node.closest?.(primaryRootSelector) : null; }
      catch (_) { return null; }
    };
    const turnCandidates = candidates.filter(node => !candidates.some(parent => parent !== node
        && metadataByElement.get(parent)?.sourceKind === 'primary'
        && metadataByElement.get(node)?.sourceKind === 'primary'
        && parent.contains(node)
        && (options.platform === 'chatgpt' || options.platform === 'gemini'
          || (enclosingMessage(node) && enclosingMessage(parent) !== parent
            && enclosingMessage(node) === enclosingMessage(parent)))));
    const sorted = sortDocumentOrder(turnCandidates);
    const anchor = Math.max(0, Number(options.anchorAnswerCount || 0));
    // An anchor is a hard boundary, not a preference. If the current candidate
    // count has not exceeded it, the new-turn pool is empty; falling back to
    // the full list here reclassifies a previous answer as the current turn.
    let pool = anchor > 0 ? sorted.slice(anchor) : sorted;
    let answerNode = null;
    let chatGptAwaitingFinal = false;
    const minimumTextLength = Number(options.minimumTextLength || 1);
    const readNodeText = typeof options.readText === 'function'
      ? options.readText
      : (node) => root.AnswerStructure?.linearizeText?.(node)
        ?? String(node?.innerText || node?.textContent || '').trim();
    const candidateEligible = typeof options.candidateEligible === 'function'
      ? options.candidateEligible
      : null;
    const rejectedCandidates = [];
    const isIneligible = (node, text, index) => {
      if (node.closest?.('[hidden], [aria-hidden="true"], [inert], [data-message-part-type="reasoning"], [data-role="user"], [data-message-author-role="user"], [data-author-role="user"]')) {
        return true;
      }
      if (String(options.platform || '').toLowerCase() === 'kimi' && isKimiReasoningNode(node)) return true;
      if (candidateEligible) {
        let eligible = false;
        try { eligible = candidateEligible({ node, text, index, pool }) !== false; } catch (_) { eligible = false; }
        if (!eligible) return true;
      }
      return false;
    };
    let chatGptTurn = null;
    if (String(options.platform || '').toLowerCase() === 'chatgpt') {
      // New markup: only the nodes of the last turn may be answer candidates.
      chatGptTurn = pickChatGptTurn(deepQuery, selectors.newMarkup, pool);
      if (chatGptTurn) pool = pool.filter((node) => chatGptTurn.turn.contains(node));
      const chatGptStopVisible = options.stopVisible === true || chatGptTurn?.generating === true;
      const entries = [];
      pool.forEach((node, index) => {
        const text = String(readNodeText(node) || '').trim();
        if (text.length < minimumTextLength) return;
        if (isIneligible(node, text, index)) {
          rejectedCandidates.push(node);
          return;
        }
        entries.push({ node, text });
      });
      answerNode = pickChatGptAnswerNode(entries, { stopVisible: chatGptStopVisible });
      // Stop visible (or turn not complete) and no block with the delivery token yet: the generic fallback below must not pick a preamble.
      if (!answerNode && chatGptStopVisible) chatGptAwaitingFinal = true;
    }
    for (let index = (answerNode || chatGptAwaitingFinal) ? -1 : pool.length - 1; index >= 0; index -= 1) {
      const node = pool[index];
      const text = String(readNodeText(node) || '').trim();
      if (text.length < minimumTextLength) continue;
      if (isIneligible(node, text, index)) {
        rejectedCandidates.push(node);
        continue;
      }
      answerNode = node;
      break;
    }
    if (!answerNode && minimumTextLength <= 0) answerNode = pool[pool.length - 1] || null;

    // Gemini (2.81.950, anchor 3 and candidate count 3 for minutes while the answer was on the page):
    // Send added a response node, but the positional pool stayed empty, so the turn never bound.
    // Node identity is the proof here: a model-response that did not exist when the dispatch baseline
    // was reported is this turn's node. Nodes present at baseline are never picked, so an old answer
    // cannot be attached even when the count did not grow. A delivery token, if present, wins.
    let freshTurnNode = false;
    if (!answerNode && options.preDispatchNodes && typeof options.preDispatchNodes.has === 'function'
      && String(options.platform || '').toLowerCase() === 'gemini') {
      const fresh = [];
      let rawNodes = [];
      try { rawNodes = Array.from(queryAll('model-response') || []); } catch (_) { rawNodes = []; }
      rawNodes.forEach((node) => {
        if (!node || node.nodeType !== 1 || options.preDispatchNodes.has(node)) return;
        const text = String(readNodeText(node) || '').trim();
        if (text.length < minimumTextLength || isIneligible(node, text, -1)) return;
        fresh.push({ node, text });
      });
      const tokenEntries = fresh.filter((entry) => DELIVERY_TOKEN_RE.test(entry.text));
      const picked = tokenEntries[tokenEntries.length - 1] || fresh[fresh.length - 1] || null;
      if (picked) {
        answerNode = picked.node;
        freshTurnNode = true;
      }
    }

    // A configured fallback may match a paragraph/code block inside the exact
    // answer. DOM order puts that fragment last, but it is not a newer turn.
    if (answerNode && metadataByElement.get(answerNode)?.sourceKind === 'secondary') {
      const enclosing = pool.filter((node) => node !== answerNode
        && metadataByElement.get(node)?.sourceKind === 'primary'
        && node.contains(answerNode) && !rejectedCandidates.includes(node));
      for (let index = enclosing.length - 1; index >= 0; index -= 1) {
        const node = enclosing[index];
        const text = String(readNodeText(node) || '').trim();
        if (text.length < minimumTextLength) continue;
        if (candidateEligible) {
          try { if (candidateEligible({ node, text, index: pool.indexOf(node), pool }) === false) continue; }
          catch (_) { continue; }
        }
        answerNode = node;
        break;
      }
    }

    const answerMeta = answerNode ? metadataByElement.get(answerNode) || null : null;
    const rootSelectors = selectorList(selectors.messageRoot);
    let messageRoot = null;
    let messageRootSelector = null;
    if (answerNode) {
      for (const selector of rootSelectors) {
        try {
          const candidate = answerNode.matches?.(selector) ? answerNode : answerNode.closest?.(selector);
          if (candidate && candidate.contains(answerNode)) {
            messageRoot = candidate;
            messageRootSelector = selector;
            break;
          }
        } catch (_) {}
      }
    }

    let resolution = 'unresolved';
    let reason = answerNode ? 'message_root_unresolved' : 'answer_node_unresolved';
    const selectorSourceKind = answerMeta?.sourceKind || (freshTurnNode ? 'primary' : null);
    if (answerNode && messageRoot && freshTurnNode) {
      resolution = 'exact';
      reason = 'gemini_fresh_turn_node';
    } else if (answerNode && messageRoot && answerMeta?.sourceKind === 'primary' && !usedContainerFallback) {
      resolution = 'exact';
      reason = 'platform_answer_and_root_matched';
    } else if (answerNode) {
      resolution = 'fallback';
      reason = messageRoot ? `answer_source_${answerMeta?.sourceKind || 'unknown'}` : 'message_root_unresolved';
    }

    return {
      platform: options.platform || 'generic',
      resolution,
      reason,
      messageRoot,
      messageRootSelector,
      answerNode,
      candidates: sorted,
      candidatePool: pool,
      rejectedCandidates,
      selectorUsed: answerMeta?.selector || (freshTurnNode ? 'model-response' : null),
      selectorIndex: answerMeta?.index ?? null,
      selectorSource: selectorSourceKind,
      selectorTier: selectorSourceKind === 'primary' ? 'platform_primary'
        : (selectorSourceKind === 'secondary' ? 'configured_fallback' : 'container_fallback'),
      positionalFiltered: pool !== sorted,
      chatGptTurnState: chatGptTurn ? chatGptTurn.state : null,
      metadataByElement,
      matchedIndices,
      candidateSelectors
    };
  }

  const api = Object.freeze({ selectorList, sortDocumentOrder, createDeepQuery, resolveTurn, pickChatGptAnswerNode, pickChatGptTurn, isChatGptProgressLine });
  root.TurnResolver = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
