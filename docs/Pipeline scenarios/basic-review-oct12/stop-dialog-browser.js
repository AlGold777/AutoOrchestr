const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true});const page=await browser.newPage();page.on('pageerror',e=>console.log('PAGEERROR',e.message));
 await page.setContent('<html><body><button>Stop</button></body></html>');
 for(const name of ['disput/basic-output.js','disput/basic-artifacts.js','disput/basic-control.js','disput/custom-engine.js','disput/basic-schema.js','results/choice-dialog.js'])
  await page.addScriptTag({path:require('path').resolve(__dirname, '../../..')+'/'+name});
 await page.evaluate(()=>{window.controller=new AbortController();window.result=window.CustomEngine.run({task:'T',steps:[{ref:'owner:evidence',kind:'owner',task:'Результат исследования',models:[]}],send:async()=>({}),signal:window.controller.signal,provideOwnerResult:()=>window.ChoiceDialog.ask({title:'Ответ владельца',textInput:{label:'Результат'},choices:[{value:'send',label:'Отправить'}]})}).catch(e=>{window.reviewError=e.message;throw e});});
 await page.locator('dialog').waitFor({state:'visible',timeout:5000});
 await page.evaluate(()=>window.controller.abort());
 const result=await page.evaluate(()=>window.result);
 console.log(JSON.stringify({stopReason:result.stopReason,openDialogs:await page.locator('dialog[open]').count(),dialogStillVisible:await page.locator('dialog').isVisible()}));
 await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1});
