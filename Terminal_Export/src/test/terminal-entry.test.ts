import {waitForVisibleFeedImages} from '@/lib/terminal-entry';
function image(visible=true){const root=document.createElement('div'),img=document.createElement('img');root.append(img);Object.defineProperty(img,'complete',{value:false});img.getBoundingClientRect=()=>({width:400,height:225,top:visible?20:2000,left:0,bottom:visible?245:2225,right:400,x:0,y:0,toJSON:()=>{}});return {root,img};}
afterEach(()=>vi.useRealTimers());
it('awaits visible and offscreen feed covers and their decoding before opening',async()=>{
 const {root,img}=image();let finish!:()=>void;img.decode=vi.fn(()=>new Promise<void>(resolve=>finish=resolve));const pending=waitForVisibleFeedImages(root,new AbortController().signal);let ready=false;void pending.then(()=>ready=true);
 img.dispatchEvent(new Event('load'));await Promise.resolve();expect(ready).toBe(false);finish();expect(await pending).toBe(true);expect(img.loading).toBe('eager');
 const offscreen=image(false),hiddenPending=waitForVisibleFeedImages(offscreen.root,new AbortController().signal);let offscreenReady=false;void hiddenPending.then(()=>offscreenReady=true);
 await Promise.resolve();expect(offscreenReady).toBe(false);expect(offscreen.img.loading).toBe('eager');offscreen.img.dispatchEvent(new Event('load'));expect(await hiddenPending).toBe(true);
});
it('settles broken covers, bounds unresponsive covers and cancels stale sessions',async()=>{
 const failed=image();const broken=waitForVisibleFeedImages(failed.root,new AbortController().signal);failed.img.dispatchEvent(new Event('error'));expect(await broken).toBe(true);
 vi.useFakeTimers();const waiting=waitForVisibleFeedImages(image().root,new AbortController().signal,100);await vi.advanceTimersByTimeAsync(100);expect(await waiting).toBe(false);
 const abort=new AbortController(),stale=waitForVisibleFeedImages(image().root,abort.signal);abort.abort();expect(await stale).toBe(false);
});
