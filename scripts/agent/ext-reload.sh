#!/bin/zsh
# Перезагрузить расширение AutoOrchestr без кликов (chrome://extensions, shadow DOM). Закрывает его вкладки и сбрасывает UI.
D=$(cd "$(dirname "$0")" && pwd); J=$(mktemp /tmp/extreload.XXXXXX.js)
cat > $J <<'JS'
(function(){var m=document.querySelector('extensions-manager');var l=m.shadowRoot.querySelector('extensions-item-list');for(const it of l.shadowRoot.querySelectorAll('extensions-item')){if(it.id==='egfijmjjpedpikkfmfaekjbhjjjlhlgo'){it.shadowRoot.querySelector('#dev-reload-button').click();return 'RELOADED'}}return 'NOT FOUND'})()
JS
osascript -e 'tell application "Google Chrome" to open location "chrome://extensions"'; sleep 3
$D/tab-js.sh "chrome://extensions" $J; rm -f $J
