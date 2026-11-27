(()=>{const p=((document.querySelector('main')||document.body).innerText).split(/\nChatGPT сказал:\n/);return p.length>1?p[p.length-1].split(/\nВы сказали:\n/)[0]:'';})()
