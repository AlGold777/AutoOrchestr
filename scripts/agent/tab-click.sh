#!/bin/zsh
# Настоящий клик (CGEvent) по элементу вкладки Chrome.
# usage: tab-click.sh <подстрока URL вкладки> '<css-селектор>' | --text 'Continue'
# Печатает HIT (клик сделан) или MISS (элемент перекрыт, например модальным окном) / NOEL.
D=$(cd "$(dirname "$0")" && pwd); URL="$1"; SEL="$2"; TXT=""
[[ "$SEL" == "--text" ]] && { TXT="$3"; SEL=""; }
J=$(mktemp /tmp/tabclick.XXXXXX.js)
cat > $J <<JS
(function(){var e=null;var txt=${(qqq)TXT:-""};if(txt){e=[...document.querySelectorAll('button,[role=button],a')].find(b=>b.offsetParent&&b.innerText.trim().toLowerCase()===txt.toLowerCase())}else{e=document.querySelector('$SEL')}
if(!e)return 'NOEL';e.scrollIntoView({block:'center'});var r=e.getBoundingClientRect();
var x=window.screenX+r.left+r.width/2;var y=window.screenY+(window.outerHeight-window.innerHeight)+r.top+r.height/2;
var t=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return x+','+y+','+((t===e||e.contains(t))?'HIT':'MISS:'+(t&&t.tagName))})()
JS
R=$($D/tab-js.sh "$URL" $J); rm -f $J; echo "$R"; [[ "$R" == *HIT ]] || exit 1
X=${R%%,*}; rest=${R#*,}; Y=${rest%%,*}
osascript <<AS
tell application "Google Chrome"
 repeat with w in windows
  set i to 0
  repeat with t in tabs of w
   set i to i+1
   if URL of t contains "$URL" then
    set active tab index of w to i
    set index of w to 1
   end if
  end repeat
 end repeat
 activate
end tell
delay 1
AS
osascript -l JavaScript -e "ObjC.import('CoreGraphics');function ev(t,x,y){var e=\$.CGEventCreateMouseEvent(null,t,{x:x,y:y},0);\$.CGEventPost(\$.kCGHIDEventTap,e)};ev(\$.kCGEventMouseMoved,$X,$Y);delay(0.2);ev(\$.kCGEventLeftMouseDown,$X,$Y);delay(0.08);ev(\$.kCGEventLeftMouseUp,$X,$Y);'clicked'"
