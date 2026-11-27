(()=>{const turns=document.querySelectorAll('[data-turn-key]'),el=turns[turns.length-1];
if(el)return [...el.querySelectorAll('[data-content-search-unit-key$=":assistant"]')].map(u=>u.innerText.replace(/^\s*ChatGPT сказал:/,'')).join('\n').trim();
const p=((document.querySelector('main')||document.body).innerText).split(/\nChatGPT сказал:\n/);return p.length>1?p[p.length-1].split(/\nВы сказали:\n/)[0]:'';})()
