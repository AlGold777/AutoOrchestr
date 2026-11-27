// Вставляет текст в поле сообщения ChatGPT и нажимает «Отправить». Выполняется на странице: (этот код)(текст).
// Поле ищется только по своим признакам: редактор документа внутри ответа — тоже .ProseMirror, и он стоит в DOM раньше.
(text=>{
const box=document.querySelector('#prompt-textarea,.ProseMirror[data-composer-markdown],[data-composer-input] .ProseMirror[contenteditable="true"]');
if(!box)return 'NO_COMPOSER';
if([...document.querySelectorAll('button')].find(b=>b.dataset.testid==='stop-button'||/^(Остановить|Stop)/.test(b.getAttribute('aria-label')||'')))return 'BUSY';
box.focus();
// Без фокуса в поле команда правки изменила бы другой редактор страницы.
if(!box.contains(document.activeElement))return 'NO_FOCUS';
document.execCommand('selectAll',false,null);document.execCommand('insertText',false,text);
const area=box.closest('fieldset')||box.closest('form')||box.closest('[data-composer-body]');
setTimeout(()=>{const b=area&&area.querySelector('[data-testid="send-button"],#composer-submit-button,button[aria-label*="Отправ"],button[aria-label*="Send"]');if(b&&!b.disabled)b.click();},800);
return 'TYPED';
})
