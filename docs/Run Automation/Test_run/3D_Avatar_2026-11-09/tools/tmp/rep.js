(function(){var b=[...document.querySelectorAll('button')].filter(function(x){return x.offsetParent&&x.textContent.trim()==='Заменить'})[0];if(!b)return 'no';b.click();return 'replaced'})()
