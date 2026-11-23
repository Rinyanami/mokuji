import {useEffect,useLayoutEffect,useRef} from 'react';

type Commands={
  workspace:boolean;paused:boolean;summary:boolean;available:boolean;
  settings:()=>void;toggleSummary:()=>void;index:()=>void;bookmark:()=>void;
  changeChapter:(direction:1|-1)=>void;step:(direction:1|-1)=>void;page:(direction:1|-1)=>void;
};
export function useReaderShortcuts(commands:Commands){
  const latest=useRef(commands);
  useLayoutEffect(()=>{latest.current=commands;},[commands]);
  useEffect(()=>{
    let pointerButton:Element|null=null;
    function pointer(e:PointerEvent){if(e.button===0)pointerButton=e.target instanceof Element?e.target.closest('button'):null;}
    function key(e:KeyboardEvent){
      if(e.key==='Tab')pointerButton=null;
      const cmd=latest.current;
      if(e.defaultPrevented||e.isComposing||cmd.paused||document.querySelector('dialog[open], [role="dialog"]:not([hidden])'))return;
      const target=e.target instanceof Element?e.target:document.activeElement;
      if(target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))return;
      const focused=target?.closest('button,a[href],summary,[role="button"],[role="menuitem"]');
      const mod=e.ctrlKey||e.metaKey;
      if(mod&&!e.shiftKey&&!e.altKey){
        const k=e.key.toLowerCase();
        if(k==='f'){e.preventDefault();if(!e.repeat)cmd.index();}
        if(k==='d'&&cmd.available&&!cmd.summary){e.preventDefault();if(!e.repeat)cmd.bookmark();}
        if(k==='b'&&cmd.workspace){e.preventDefault();if(!e.repeat)window.dispatchEvent(new Event('mokuji-toggle-sidebar'));}
        return;
      }
      if(cmd.workspace&&e.code==='Space'&&!e.altKey&&!e.shiftKey&&!mod&&(!focused||focused===pointerButton)){
        e.preventDefault();if(!e.repeat)cmd.toggleSummary();return;
      }
      if(cmd.workspace&&e.key==='Escape'&&!e.altKey&&!e.shiftKey&&!mod){
        e.preventDefault();if(!e.repeat){if(cmd.summary)cmd.toggleSummary();else cmd.settings();}return;
      }
      if(cmd.workspace&&e.altKey&&e.code==='Comma'&&!mod&&!e.shiftKey){e.preventDefault();if(!e.repeat)cmd.settings();return;}
      if(mod||e.shiftKey||cmd.summary||!cmd.available)return;
      if(e.altKey&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){
        e.preventDefault();if(!e.repeat)cmd.changeChapter(e.key==='ArrowRight'?1:-1);return;
      }
      if(e.altKey||(focused&&focused!==pointerButton))return;
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();cmd.step(e.key==='ArrowDown'?1:-1);}
      if(e.key==='PageDown'||e.key==='PageUp'){e.preventDefault();cmd.page(e.key==='PageDown'?1:-1);}
    }
    document.addEventListener('pointerdown',pointer,true);window.addEventListener('keydown',key);
    return ()=>{document.removeEventListener('pointerdown',pointer,true);window.removeEventListener('keydown',key);};
  },[]);
}

export function useSidebarShortcut(toggle:()=>void){
  const current=useRef(toggle);
  useLayoutEffect(()=>{current.current=toggle;},[toggle]);
  useEffect(()=>{const handle=()=>current.current();window.addEventListener('mokuji-toggle-sidebar',handle);return ()=>window.removeEventListener('mokuji-toggle-sidebar',handle);},[]);
}