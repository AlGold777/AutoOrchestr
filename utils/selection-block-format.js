(function initSelectionBlockFormat() {
  if (window.SelectionBlockFormat) return;

  const BLOCK_SELECTOR = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, div';
  const INDENT_PX = 24;

  function selectedBlocks(range, root) {
    if (!range || range.collapsed || !root?.contains(range.startContainer) || !root.contains(range.endContainer)) return [];
    const blocks = new Set();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue?.trim() || !range.intersectsNode(node)) continue;
      let block = node.parentElement?.closest(BLOCK_SELECTOR);
      while (block && block !== root && !root.contains(block)) block = block.parentElement?.closest(BLOCK_SELECTOR);
      // A plain response body is itself the paragraph when it has no child blocks.
      blocks.add(block && root.contains(block) ? block : root);
    }
    return Array.from(blocks);
  }

  function makeList(block) {
    if (block.tagName === 'LI' || (block.closest('ul, ol') && block.tagName !== 'DIV')) return;
    const item = document.createElement('li');
    if (block.matches('p, h1, h2, h3, h4, h5, h6, blockquote, pre')) {
      const previousList = block.previousElementSibling;
      const list = previousList?.tagName === 'UL' ? previousList : document.createElement('ul');
      if (list !== previousList) block.parentNode?.insertBefore(list, block);
      item.appendChild(block);
      list.appendChild(item);
    } else {
      // Keep the response root and its event handlers; move only its content.
      const list = document.createElement('ul');
      while (block.firstChild) item.appendChild(block.firstChild);
      list.appendChild(item);
      block.appendChild(list);
    }
  }

  function apply(range, root, command) {
    const blocks = selectedBlocks(range, root);
    if (!blocks.length) return false;
    blocks.forEach((block) => {
      if (command === 'list') {
        makeList(block);
      } else if (command === 'indent' || command === 'outdent') {
        const current = Number.parseFloat(block.style.marginLeft) || 0;
        block.style.marginLeft = `${Math.max(0, current + (command === 'indent' ? INDENT_PX : -INDENT_PX))}px`;
      } else if (['left', 'center', 'right'].includes(command)) {
        block.style.textAlign = command;
      }
    });
    return true;
  }

  window.SelectionBlockFormat = { apply };
})();
