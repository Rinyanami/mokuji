import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, FilePlus2, Folder, Pencil, Search, X } from 'lucide-react';
import { readerPost, readerRequest, type ReaderBook, type ReaderIndex } from './reading-client';
import { importBookFile, readerFileAccept } from './reader-file-import';
import { projectAlias } from './reader-work-context';
import { PeekText } from './reader-shell-peek';
import './reader-workspaces.css';

export type WorkProject = {id:string; name:string; realTitle?:string; author?:string; chapterCount?:number; currentChapter?:number; current:boolean};
const describe=(reason:unknown)=>reason instanceof Error?reason.message:'暂时无法打开工作区。';

export function useWorkspaces(id:string,currentBook:ReaderBook|undefined,currentTitle:string,enabled:boolean,
  navigate:(target:string)=>Promise<boolean>,renamed:(name:string)=>void) {
  const [index,setIndex]=useState<ReaderIndex|null>(null);
  const [opened,setOpened]=useState(false),[filter,setFilter]=useState('');
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [rename,setRename]=useState<{id:string;name:string;version:string}|null>(null);
  const [reload,setReload]=useState(0);
  const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null),lock=useRef(false);
  const live=useRef(false);
  useEffect(()=>{live.current=true;return ()=>{live.current=false;};},[]);
  useEffect(()=>{
    if(!enabled || !opened && !currentBook)return;
    const abort=new AbortController();
    readerRequest<ReaderIndex>('books',{signal:abort.signal}).then(value=>{
      if(!abort.signal.aborted)setIndex(value);
    }).catch(reason=>{if(!abort.signal.aborted)setError(describe(reason));});
    return ()=>abort.abort();
  },[enabled,id,!!currentBook,opened,reload]);

  const all=useMemo(()=>{
    const books=[...(index?.books??[])];
    if(currentBook&&!books.some(book=>book.id===id))books.unshift(currentBook);
    const boundIds=new Set(Object.values(index?.bindings??{}));
    const local=books.filter(book=>book.id===id || book.sourceType==='cotex' || (book.available &&
      (book.sourceType!=='online' || book.id.startsWith('wikisource:') || boundIds.has(book.id) || book.progress?.updatedAt)));
    const recent=new Map(local.map(book=>[book.id,Date.parse(book.progress?.updatedAt??'')||0]));
    local.sort((a,b)=>recent.get(b.id)!-recent.get(a.id)!);
    const groups=new Map<string,string[]>();
    const projects=local.map(book=>{
      const name=book.id===id?currentTitle:projectAlias(book.id,book.workAlias,[book.title,book.originalTitle,book.author,...(book.aliases??[])]);
      const realLabel=`《${book.title}》${book.author?' · '+book.author:''}${book.progress?.chapter!==undefined&&book.chapterCount?` (第${book.progress.chapter+1}/${book.chapterCount}章)`:''}`;
      const ids=groups.get(name)??[];ids.push(book.id);groups.set(name,ids);
      return {id:book.id,name,realTitle:realLabel,author:book.author,chapterCount:book.chapterCount,currentChapter:book.progress?.chapter,current:book.id===id,book};
    });
    for(const ids of groups.values())ids.sort();
    return projects.map(project=>{
      const group=groups.get(project.name)!;
      return group.length===1?project:{...project,name:project.name+' · '+(group.indexOf(project.id)+1)};
    });
  },[index,currentBook,currentTitle,id]);
  const current=all.find(project=>project.current);
  const sidebar=current?[current,...all.filter(project=>!project.current)].slice(0,5):all.slice(0,5);
  const needle=filter.trim().toLocaleLowerCase();
  const matches=all.filter(({name,book})=>!needle||[name,book.title,book.author].some(value=>value?.toLocaleLowerCase().includes(needle)));
  const show=useCallback(()=>{setFilter('');setRename(null);setError('');setOpened(true);},[]);
  const close=()=>{if(!lock.current)setOpened(false);};
  useEffect(()=>{
    if(!opened)return;
    const node=dialog.current;
    node?.showModal();
    return ()=>{if(node?.open)node.close();};
  },[opened]);

  async function select(target:string) {
    if(lock.current)return;
    if(target===id){setOpened(false);return;}
    lock.current=true;setBusy(true);
    try {if(await navigate(target)&&live.current)setOpened(false);}
    finally {lock.current=false;if(live.current)setBusy(false);}
  }
  async function importFiles(files:File[]) {
    if(lock.current||!files.length)return;
    lock.current=true;setBusy(true);setRename(null);setError('');setOpened(true);
    let last='',errors:string[]=[];
    try{
      for(const file of files){
        try{last=(await importBookFile(file)).id;}
        catch(reason){errors.push(describe(reason));}
      }
      if(!live.current)return;
      setReload(value=>value+1);
      if(errors.length)setError(errors.join(' · '));
      else if(last && await navigate(last) && live.current)setOpened(false);
    }finally{lock.current=false;if(live.current)setBusy(false);}
  }
  function chooseFiles(){if(!lock.current)input.current?.click();}
  useEffect(()=>{
    if(!enabled)return;
    const keys=(event:KeyboardEvent)=>{
      if(event.defaultPrevented||event.isComposing||!((event.ctrlKey||event.metaKey)&&!event.shiftKey&&!event.altKey))return;
      if(document.querySelector('dialog[open]'))return;
      const key=event.key.toLowerCase();
      if(key!=='o'&&key!=='k')return;
      event.preventDefault();
      if(key==='k')show();else chooseFiles();
    };
    window.addEventListener('keydown',keys);return ()=>window.removeEventListener('keydown',keys);
  },[enabled,show]);
  async function startRename(project:WorkProject) {
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');setOpened(true);
    try {
      const {state}=await readerRequest<{state:{version:string;workAlias:string}}>('cotex-state?id='+encodeURIComponent(project.id));
      if(live.current)setRename({id:project.id,name:state.workAlias||project.name,version:state.version});
    }catch(reason){if(live.current)setError(describe(reason));}
    finally{lock.current=false;if(live.current)setBusy(false);}
  }
  const renameById=useCallback((projectId:string)=>{
    const target=all.find(item=>item.id===projectId);
    if(target)void startRename(target);
  },[all]);
  async function saveName(){
    if(!rename||!rename.name.trim()||lock.current)return;
    lock.current=true;setBusy(true);setError('');
    try{
      const {state}=await readerPost<{state:{workAlias:string}}>('cotex-state',{id:rename.id,version:rename.version,alias:rename.name.trim()});
      if(!live.current)return;
      if(rename.id===id)renamed(state.workAlias);
      setIndex(previous=>previous?{...previous,books:previous.books.map(book=>book.id===rename.id?{...book,workAlias:state.workAlias}:book)}:previous);
      setRename(null);
    }catch(reason){if(live.current){setError(describe(reason));setRename(null);setReload(value=>value+1);}}
    finally{lock.current=false;if(live.current)setBusy(false);}
  }
  const controls=<>
    <input ref={input} type="file" accept={readerFileAccept} hidden multiple onChange={event=>{
      const files=Array.from(event.target.files??[]);event.target.value='';void importFiles(files);
    }}/>
    {opened&&<dialog ref={dialog} className="mokuji-project-picker" aria-labelledby="mokuji-project-title"
      onCancel={event=>{event.preventDefault();close();}} onKeyDown={event=>{
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(rename)setRename(null);else close();}
      }}>
      <header><h2 id="mokuji-project-title">{rename?'重命名工作区':'打开工作区'}</h2>
        <button type="button" aria-label="关闭工作区列表" disabled={busy} onClick={close}><X size={17}/></button></header>
      {rename?<form onSubmit={event=>{event.preventDefault();void saveName();}}>
        <label>工作名称<input autoFocus maxLength={80} required value={rename.name} onChange={e=>setRename({...rename,name:e.target.value})}/></label>
        <div className="mokuji-project-actions"><button type="button" onClick={()=>setRename(null)}>取消</button><button disabled={busy||!rename.name.trim()}>保存</button></div>
      </form>:<>
        <div className="mokuji-project-filter"><Search size={16}/><input autoFocus type="search" value={filter}
          onChange={e=>setFilter(e.target.value)} placeholder="查找项目、真书名或作者…（悬停显真名）" aria-label="查找项目"/></div>
        <div className="mokuji-project-list">{matches.map(project=><div key={project.id}>
          <button type="button" disabled={busy} title={project.realTitle} onClick={()=>void select(project.id)} aria-current={project.current?'page':undefined}><Folder size={15}/><PeekText mask={project.name} real={project.realTitle}/>{project.current&&<Check size={14}/>}</button>
          <button type="button" title="重命名工作区" aria-label={'重命名 '+project.name} disabled={busy} onClick={()=>void startRename(project)}><Pencil size={14}/></button>
        </div>)}
        {!matches.length&&<p>{index?'没有匹配的项目。':'正在读取项目…'}</p>}</div>
        <footer><button type="button" disabled={busy} onClick={chooseFiles}><FilePlus2 size={15}/>从文件新建</button><kbd>Ctrl O</kbd></footer>
      </>}
      {busy&&<p role="status">正在处理…</p>}{error&&<p role="alert">{error}</p>}
    </dialog>}
  </>;
  return {sidebar,show,select,chooseFiles,importFiles,renameById,controls};
}
