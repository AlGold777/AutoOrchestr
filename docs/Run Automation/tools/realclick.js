ObjC.import('ApplicationServices');
function run(argv){var x=+argv[0],y=+argv[1];var p=$.CGPointMake(x,y);
var mv=$.CGEventCreateMouseEvent($(),$.kCGEventMouseMoved,p,0);$.CGEventPost($.kCGHIDEventTap,mv);delay(0.15);
var dn=$.CGEventCreateMouseEvent($(),$.kCGEventLeftMouseDown,p,0);$.CGEventPost($.kCGHIDEventTap,dn);delay(0.08);
var up=$.CGEventCreateMouseEvent($(),$.kCGEventLeftMouseUp,p,0);$.CGEventPost($.kCGHIDEventTap,up);return 'clicked '+x+','+y}
