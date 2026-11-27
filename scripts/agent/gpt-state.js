(()=>{const t=(document.querySelector('main')||document.body).innerText;
// ChatGPT держит в DOM только последние ходы, поэтому счётчики замирают: новый ход виден по data-turn-key.
const turns=document.querySelectorAll('[data-turn-key]'),el=turns[turns.length-1];
const p=t.split(/\nChatGPT сказал:\n/);
const last=el?[...el.querySelectorAll('[data-content-search-unit-key$=":assistant"]')].map(u=>u.innerText.replace(/^\s*ChatGPT сказал:/,'')).join('\n').trim()
 :p.length>1?p[p.length-1].split(/\nВы сказали:\n/)[0]:'';
// Только поле сообщения (тот же выбор, что в gpt-type.js), а не редактор документа внутри ответа.
const box=document.querySelector('#prompt-textarea,.ProseMirror[data-composer-markdown],[data-composer-input] .ProseMirror[contenteditable="true"]');
const gen=!![...document.querySelectorAll('button')].find(b=>b.dataset.testid==='stop-button'||/^(Остановить|Stop)/.test(b.getAttribute('aria-label')||''));
return JSON.stringify({generating:gen,answers:p.length-1,users:t.split(/\nВы сказали:\n/).length-1,turn:el?el.getAttribute('data-turn-key'):'',draft:box?box.innerText.trim().length:0,lastLen:last.length,lastHead:last.slice(0,200)});})()
