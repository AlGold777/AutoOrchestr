(function(){
  var btns=[].slice.call(document.querySelectorAll('button,[role=button]')).filter(function(b){return b.offsetParent!==null});
  var label=function(b){return ((b.getAttribute('aria-label')||'')+' '+(b.getAttribute('title')||'')+' '+(b.textContent||'')).trim()};
  var stop=btns.some(function(b){var l=label(b);return /^(стоп|stop|остановить|stop generating|остановить генерацию)\b/i.test(l)||/^[■⏹◼]\s*$/.test(l.trim())||/stop (generating|response)|остановить (генерацию|ответ)/i.test(l)});
  var t=(document.body.innerText||'');
  var tail=t.slice(-700);
  var thinking=/(думаю|thinking|поиск источников|идет поиск|идёт поиск|searching|выполняется|анализирую|reasoning|generating)/i.test(tail);
  var spinner=/[⠁-⣿]/.test(t.slice(-150));
  return JSON.stringify({stop:stop,thinking:thinking,spinner:spinner,len:t.length});
})()
