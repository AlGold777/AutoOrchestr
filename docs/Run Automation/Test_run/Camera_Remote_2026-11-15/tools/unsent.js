(function(){
  var ed=document.querySelector('#prompt-textarea,[contenteditable=true][id*=prompt],div[contenteditable=true]');
  var txt=ed?(ed.innerText||ed.value||''):'';
  var send=[].slice.call(document.querySelectorAll('button')).filter(function(b){return b.offsetParent&&!b.disabled&&/^(Отправить|Send)/i.test((b.getAttribute('aria-label')||b.textContent||'').trim())})[0];
  var stop=[].slice.call(document.querySelectorAll('button,[role=button]')).some(function(b){return b.offsetParent&&/^(остановить|stop)/i.test((b.getAttribute('aria-label')||b.textContent||'').trim())});
  var marked=/\[\[AO-[a-z0-9]+\]\]\s*$/.test(txt.trim());
  return JSON.stringify({unsent:!!(ed&&send&&!stop&&marked&&txt.length>200),len:txt.length});
})()
