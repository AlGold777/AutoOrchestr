ObjC.import('ApplicationServices');
// Real mouse drag (HTML5 drag and drop works): osascript -l JavaScript realdrag.js x1 y1 x2 y2  (screen points)
function run(argv){var x1=+argv[0],y1=+argv[1],x2=+argv[2],y2=+argv[3];
function post(type,x,y){var e=$.CGEventCreateMouseEvent($(),type,$.CGPointMake(x,y),0);$.CGEventPost($.kCGHIDEventTap,e);}
post($.kCGEventMouseMoved,x1,y1);delay(0.2);post($.kCGEventLeftMouseDown,x1,y1);delay(0.2);
for(var i=1;i<=20;i++){post($.kCGEventLeftMouseDragged,x1+(x2-x1)*i/20,y1+(y2-y1)*i/20);delay(0.04);}
delay(0.3);post($.kCGEventLeftMouseUp,x2,y2);return 'dragged '+x1+','+y1+' -> '+x2+','+y2}
