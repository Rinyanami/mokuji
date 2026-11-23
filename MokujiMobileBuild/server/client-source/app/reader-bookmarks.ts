import {useCallback,useEffect,useRef,useState} from 'react';
import {readerRequest,readerPost,ReaderError} from './reading-client';

export type BookPoint={chapter:number;paragraph:number};
export type SavedPoint=BookPoint&{createdAt:number;note?:string};
type BookState={version:string;bookmarks:SavedPoint[];collapsedImages?:string[]};
type Response={state:BookState};
const samePoint=(a:BookPoint,b:BookPoint)=>a.chapter===b.chapter&&a.paragraph===b.paragraph;
const noteKey=(id:string)=>'mokuji.bookmark.notes.v1:'+id;
function readNotes(id:string):Record<string,string>{
  try{return JSON.parse(localStorage.getItem(noteKey(id))||'{}') as Record<string,string>;}
  catch{return {};}
}
function writeNotes(id:string,notes:Record<string,string>){
  try{localStorage.setItem(noteKey(id),JSON.stringify(notes));}catch{}
}

export function useReaderBookmarks(id:string,visible:boolean){
  const [state,setState]=useState<BookState|null>(null);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const writing=useRef(false),generation=useRef(0),alive=useRef(true);
  const fetchState=useCallback((signal?:AbortSignal)=>readerRequest<Response>('cotex-state?id='+encodeURIComponent(id),{signal}),[id]);
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
  useEffect(()=>{
    const abort=new AbortController();
    function refresh(){
      if(writing.current)return;
      const seen=++generation.current;
      fetchState(abort.signal).then(r=>{if(!abort.signal.aborted&&!writing.current&&seen===generation.current)setState(r.state);})
        .catch(e=>{if(!abort.signal.aborted&&visible)setMessage(e.message);});
    }
    refresh();window.addEventListener('focus',refresh);
    return ()=>{abort.abort();window.removeEventListener('focus',refresh);};
  },[visible,fetchState]);
  const update=useCallback(async(point:BookPoint,request:'toggle'|'add'|'remove'|'open'|'close')=>{
    if(writing.current)return false;
    writing.current=true;generation.current++;setBusy(true);setMessage('');
    try{
      let current=(await fetchState()).state;
      const markExists=(state:BookState)=>state.bookmarks.some(mark=>samePoint(mark,point));
      const op=request==='toggle'?(markExists(current)?'remove':'add'):request;
      const fold=(op==='open'||op==='close'),groupKey=point.chapter+':'+point.paragraph;
      const payload=fold?{imageFold:{...point,closed:op==='close'}}:{bookmark:{...point,action:op}};
      const done=(state:BookState)=>fold?((state.collapsedImages||[]).includes(groupKey)===(op==='close')):markExists(state)===(op==='add');
      const send=(version:string)=>readerPost<Response>('cotex-state',{id,version,...payload});
      if(!done(current)){
        try{current=(await send(current.version)).state;}
        catch(e){
          if(!(e instanceof ReaderError&&e.status===409))throw e;
          current=(await fetchState()).state;
          if(!done(current))current=(await send(current.version)).state;
        }
      }
      if(alive.current){setState(current);if(!fold)setMessage(op==='add'?'已标记当前位置':'已取消标记');}
      return true;
    }catch(e){if(alive.current)setMessage(e instanceof Error?e.message:'同步失败');return false;}
    finally{writing.current=false;if(alive.current)setBusy(false);}
  },[id,fetchState]);
  const change=useCallback((point:BookPoint,action?:'add'|'remove')=>update(point,action||'toggle'),[update]);
  const fold=useCallback((point:BookPoint,closed:boolean)=>update(point,closed?'close':'open'),[update]);
  const [notesMap,setNotesMap]=useState<Record<string,string>>(()=>readNotes(id));
  useEffect(()=>{setNotesMap(readNotes(id));},[id]);
  const setNote=useCallback((point:BookPoint,note:string)=>{
    const k=point.chapter+':'+point.paragraph;
    setNotesMap(prev=>{
      const next={...prev};
      if(note.trim())next[k]=note.trim();
      else delete next[k];
      writeNotes(id,next);
      return next;
    });
    setMessage(note.trim()?'已保存段落批注':'已清除批注');
  },[id]);
  useEffect(()=>{if(message){const t=setTimeout(()=>setMessage(''),3500);return ()=>clearTimeout(t);}},[message]);
  const marks=(state?.bookmarks||[]).map(m=>({...m,note:notesMap[m.chapter+':'+m.paragraph]||m.note||''}));
  return {marks,collapsedImages:state?.collapsedImages||[],loaded:state!==null,message,busy,change,fold,setNote};
}
