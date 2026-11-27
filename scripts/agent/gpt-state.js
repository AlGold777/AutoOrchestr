(()=>{const t=(document.querySelector('main')||document.body).innerText;
const p=t.split(/\nChatGPT сказал:\n/);const last=p.length>1?p[p.length-1].split(/\nВы сказали:\n/)[0]:'';
const gen=!![...document.querySelectorAll('button')].find(b=>b.dataset.testid==='stop-button'||/^(Остановить|Stop)/.test(b.getAttribute('aria-label')||''));
return JSON.stringify({generating:gen,answers:p.length-1,users:t.split(/\nВы сказали:\n/).length-1,lastLen:last.length,lastHead:last.slice(0,200)});})()
