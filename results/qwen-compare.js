// Page qwen-compare.html: one question goes to two local models at once, each keeps its own conversation.
(function initQwenCompare(root) {
  'use strict';

  const OPTIONS = { temperature: 0.3, num_ctx: 16384 };
  const OFFLINE = 'Ollama не отвечает. Запустите её и повторите вопрос.';
  const seconds = (ms) => `${(ms / 1000).toFixed(1).replace('.', ',')} с`;
  const statsText = (firstMs, totalMs, last) => {
    const parts = [`первое слово ${seconds(firstMs)}`, `всего ${seconds(totalMs)}`];
    if (last?.eval_count && last?.eval_duration) {
      parts.push(`${last.eval_count} ток.`, `${Math.round(last.eval_count / (last.eval_duration / 1e9))} ток/с`);
    }
    return parts.join(' · ');
  };

  function start(doc, { endpoint, prepare, fetchImpl = (...args) => root.fetch(...args) }) {
    const form = doc.getElementById('composer');
    const prompt = doc.getElementById('prompt');
    const send = doc.getElementById('send');
    const clear = doc.getElementById('clear');
    const panels = [...doc.querySelectorAll('.panel')].map((node) => ({
      model: node.dataset.model,
      log: node.querySelector('.log'),
      status: node.querySelector('.panel-status'),
      history: []
    }));
    let control = null;

    const nearBottom = (log) => log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    const add = (panel, className, text = '') => {
      const stick = nearBottom(panel.log);
      const node = doc.createElement('p');
      node.className = className;
      node.textContent = text;
      panel.log.append(node);
      if (stick) panel.log.scrollTop = panel.log.scrollHeight;
      return node;
    };

    async function ask(panel, question, signal) {
      panel.history.push({ role: 'user', content: question });
      add(panel, 'msg user', question);
      const answer = add(panel, 'msg');
      const started = performance.now();
      let firstMs = null;
      let text = '';
      let last = null;
      panel.status.textContent = 'думает…';

      const consume = (line) => {
        if (!line.trim()) return;
        const chunk = JSON.parse(line);
        if (chunk.error) throw new Error(chunk.error);
        const piece = chunk.message?.content || '';
        if (piece) {
          if (firstMs === null) { firstMs = performance.now() - started; panel.status.textContent = 'отвечает…'; }
          const stick = nearBottom(panel.log);
          text += piece;
          answer.textContent = text;
          if (stick) panel.log.scrollTop = panel.log.scrollHeight;
        }
        if (chunk.done) last = chunk;
      };

      try {
        const response = await fetchImpl(`${endpoint}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: panel.model, messages: panel.history, stream: true, think: false, keep_alive: '30m', options: OPTIONS }),
          signal
        });
        if (!response.ok) throw new Error((await response.text()) || `Ollama ответила ${response.status}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          lines.forEach(consume);
        }
        consume(buffer);
        panel.history.push({ role: 'assistant', content: text });
        add(panel, 'stats', statsText(firstMs ?? 0, performance.now() - started, last));
        panel.status.textContent = 'готова';
      } catch (error) {
        if (error.name === 'AbortError') {
          if (text) panel.history.push({ role: 'assistant', content: text });
          else panel.history.pop();
          add(panel, 'stats', 'остановлено');
          panel.status.textContent = 'остановлена';
        } else {
          panel.history.pop();
          if (!text) answer.remove();
          add(panel, 'msg error', error instanceof TypeError ? OFFLINE : error.message);
          panel.status.textContent = 'ошибка';
        }
      }
    }

    function setBusy(busy) {
      send.textContent = busy ? 'Стоп' : 'Отправить';
      send.type = busy ? 'button' : 'submit';
      clear.disabled = busy;
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const question = prompt.value.trim();
      if (!question || control) return;
      prompt.value = '';
      control = new AbortController();
      setBusy(true);
      try { await prepare(); } catch (_) { /* without the rule the request fails and the panels say so */ }
      await Promise.all(panels.map((panel) => ask(panel, question, control.signal)));
      control = null;
      setBusy(false);
      prompt.focus();
    });

    send.addEventListener('click', () => { if (control) control.abort(); });

    prompt.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        form.requestSubmit();
      }
    });

    clear.addEventListener('click', () => {
      panels.forEach((panel) => { panel.history.length = 0; panel.log.textContent = ''; panel.status.textContent = 'готова'; });
      prompt.value = '';
      prompt.focus();
    });
  }

  const api = Object.freeze({ start });
  root.QwenCompare = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else start(root.document, { endpoint: root.LocalModel.ENDPOINT, prepare: root.LocalModel.allowOwnOrigin });
})(typeof window !== 'undefined' ? window : globalThis);
