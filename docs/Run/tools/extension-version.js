(function(){var x=new XMLHttpRequest();x.open('GET','manifest.json',false);x.send();return JSON.parse(x.responseText).version})()
