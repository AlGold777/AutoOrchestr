(function(){
var H=location.hostname;
var SITE={
 'claude.ai':{send:'button[data-testid="chat-input-send"],button[aria-label*="Send" i],button[aria-label*="Отправ" i]',stop:'button[aria-label*="Stop" i],button[aria-label*="Останов" i]',ans:'div.standard-markdown'},
 'chatgpt.com':{send:'button[type="submit"],button[data-testid="send-button"]',stop:'button[data-testid="stop-button"]',ans:'[data-markdown-text-style="assistant-message"]'},
 'chat.deepseek.com':{send:'div.ds-button--primary.ds-button--filled',stop:'div[role="button"] svg rect',ans:'div.ds-message div.ds-markdown'},
 'chat.qwen.ai':{send:'button.send-button,button[type="submit"]',stop:'button[aria-label*="Stop" i]',ans:'div.qwen-chat-message-assistant div.response-message-content'},
 'www.perplexity.ai':{send:'button[aria-label*="Submit" i],button[aria-label*="Отправ" i],button[data-testid="submit-button"]',stop:'button[aria-label*="Stop" i]',ans:'div[id^="markdown-content"],.prose'},
};
var S=SITE[H]||{send:'button[type="submit"]',stop:'button[aria-label*="Stop" i]',ans:'article,.markdown'};
function vis(e){return e&&e.offsetParent!==null&&e.getBoundingClientRect().height>0}
function composer(){
 var c=Array.from(document.querySelectorAll('textarea,div[contenteditable="true"],[role="textbox"]')).filter(vis);
 c.sort(function(a,b){return b.getBoundingClientRect().top-a.getBoundingClientRect().top});
 return c[0]||null}
function sendBtn(){var l=Array.from(document.querySelectorAll(S.send)).filter(vis);return l[l.length-1]||null}
function answers(){var l=Array.from(document.querySelectorAll(S.ans)).filter(function(e){return !e.parentElement||!e.parentElement.closest(S.ans)});if(l.length)return l;
 var M='КОНЕЦ-ОТВЕТА',c=composer(),m=document.querySelector('main')||document.body,r=[];
 Array.from(m.querySelectorAll('*')).forEach(function(e){if(c&&(e===c||c.contains(e)))return;var t=(e.innerText||'').trim();if(t.endsWith(M)&&e.children.length<40)r.push(e)});
 if(!r.length)return [];var e=r[r.length-1];
 while(e.parentElement&&e.parentElement!==m&&(e.parentElement.innerText||'').trim().endsWith(M)&&e.parentElement.innerText.length<=e.innerText.length*1.2+50)e=e.parentElement;return [e]}
function lastAnswer(){var a=answers();if(!a.length)return null;
 for(var i=a.length-1;i>=0;i--){if(/КОНЕЦ-ОТВЕТА\s*$/.test(a[i].innerText))return a[i]}
 for(var j=a.length-1;j>=0;j--){if(a[j].innerText.trim().length)return a[j]}
 return a[a.length-1]}
function composerText(){var c=composer();return c?(c.value!==undefined&&c.tagName=='TEXTAREA'?c.value:c.innerText):''}
window.__M={
 state:function(){var c=composer(),b=sendBtn(),a=lastAnswer(),st=document.querySelector(S.stop);
  return JSON.stringify({site:H,composer:!!c,composerLen:composerText().length,send:!!b,sendEnabled:!!b&&!b.disabled&&b.getAttribute('aria-disabled')!=='true',stopVisible:!!st&&vis(st),answers:answers().length,lastLen:a?a.innerText.length:0,lastEnds:a?/КОНЕЦ-ОТВЕТА\s*$/.test(a.innerText):false,lastTail:a?a.innerText.slice(-80):'',hidden:document.hidden,limit:(function(){var m=document.body.innerText.slice(0,200000).match(/.{0,50}(лимит использования|usage limit|limit reached|достигнут лимит).{0,70}/i);return m?m[0].replace(/\s+/g,' '):''})(),dialog:(function(){var d=Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"]')).filter(vis)[0];return d?d.innerText.trim().replace(/\s+/g,' ').slice(0,120):''})()})},
 paste:function(t){var c=composer();if(!c)return 'NO COMPOSER';c.focus();
  if(c.tagName=='TEXTAREA'){var d=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value');d.set.call(c,t);c.dispatchEvent(new Event('input',{bubbles:true}))}
  else{document.execCommand('selectAll',false,null);document.execCommand('delete',false,null);document.execCommand('insertText',false,t)}
  return 'pasted '+composerText().length+' of '+t.length},
 send:function(){var b=sendBtn();if(b&&!b.disabled){b.click();return 'clicked'}
  var c=composer();if(!c)return 'NO COMPOSER';c.focus();['keydown','keypress','keyup'].forEach(function(n){c.dispatchEvent(new KeyboardEvent(n,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}))});return 'enter'},
 read:function(){var a=lastAnswer();return a?a.innerText:'NO ANSWER'},
 modes:function(){var c=composer();if(!c)return 'NO COMPOSER';var r=c.getBoundingClientRect(),o=[];document.querySelectorAll('button,[role="button"],[role="switch"],[role="combobox"],.ds-toggle-button').forEach(function(b){if(!vis(b))return;var q=b.getBoundingClientRect();if(Math.abs(q.top-r.top)<160){var t=(b.innerText||b.getAttribute('aria-label')||'').trim().replace(/\s+/g,' ');if(t)o.push(t+(b.getAttribute('aria-pressed')||b.getAttribute('aria-checked')?' ['+(b.getAttribute('aria-pressed')||b.getAttribute('aria-checked'))+']':''))}});return o.join(' | ')},
 down:function(){var a=lastAnswer();if(a)a.scrollIntoView({block:'end'});window.scrollTo(0,document.body.scrollHeight);return 'down'},
 items:function(){return Array.from(document.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[role="option"],[role="radio"],[role="switch"]')).filter(vis).map(function(e){var st=e.getAttribute('aria-checked')||e.getAttribute('aria-pressed')||e.getAttribute('data-state')||'';return (e.innerText||e.getAttribute('aria-label')||'').trim().replace(/\s+/g,' ').slice(0,60)+(st?' ['+st+']':'')}).filter(Boolean).join(' | ')||'NO ITEMS'},
 click:function(t){var q=String(t).trim().toLowerCase();var c=Array.from(document.querySelectorAll('button,[role="button"],[role="menuitem"],[role="menuitemradio"],[role="option"],[role="radio"],[role="switch"],[role="combobox"],[role="tab"],li,.ds-toggle-button')).filter(vis).filter(function(e){var x=((e.innerText||'')+' '+(e.getAttribute('aria-label')||'')).trim().replace(/\s+/g,' ').toLowerCase();return x===q||x.indexOf(q)===0});
  if(!c.length)return 'NO MATCH';c.sort(function(a,b){return (a.innerText||'').length-(b.innerText||'').length});c[0].click();return 'clicked '+(c[0].innerText||'').trim().slice(0,40)},
 attach:function(name,text){var f=new File([text],name,{type:'text/markdown'}),dt=new DataTransfer();dt.items.add(f);
  var inp=Array.from(document.querySelectorAll('input[type="file"]'))[0];
  if(inp){inp.files=dt.files;inp.dispatchEvent(new Event('change',{bubbles:true}));return 'attached via input '+name+' '+text.length}
  var c=composer();if(!c)return 'NO COMPOSER';c.focus();var ev=new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true});c.dispatchEvent(ev);return 'attached via paste '+name+' '+text.length},
 attached:function(n){return document.body.innerText.indexOf(n)>=0?'yes':'no'},
 text:function(){return (document.body.innerText||'').replace(/\n{3,}/g,'\n\n').slice(0,6000)},
 size:function(){var a=lastAnswer();return a?String(Array.from(a.innerText.replace(/\s/g,'')).length):'0'},
 top:function(){var a=lastAnswer();if(a)a.scrollIntoView({block:'start'});return a?'scrolled':'NO ANSWER'}
};})();
