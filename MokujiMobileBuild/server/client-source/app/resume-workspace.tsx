import { useEffect, useState } from 'react';
import { readAppearance, readerModes, saveAppearance } from './reader-appearance';
import { lastOpened, readerRequest, type ReaderIndex } from './reading-client';
import { setTabAppearance, workspaceFragment } from './work-route';

export function recentWorkspace(index:ReaderIndex,opened=lastOpened()){
  const native=index.recentCotex,reader=index.recentReader;
  return index.books.filter(book=>book.available).map(book=>({book,time:Math.max(
    Date.parse(book.progress?.updatedAt??'')||0,
    opened?.id===book.id?opened.at:0,
    native?.id===book.id?native.at:0,
    reader?.id===book.id?reader.at:0
  )})).sort((a,b)=>b.time-a.time)[0];
}

export default function ResumeWorkspace(){
  const [error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const abort=new AbortController();
    const selected=readAppearance();
    const product=selected==='normal'?'codex':selected;
    saveAppearance(product);
    setTabAppearance(readerModes.find(item=>item.value===product)?.label);
    readerRequest<ReaderIndex>('books',{signal:abort.signal}).then(index=>{
      if(abort.signal.aborted)return;
      const recent=recentWorkspace(index);
      if(recent)location.replace(workspaceFragment(recent.book.id));
      else setError('还没有可打开的项目。');
    }).catch(()=>{if(!abort.signal.aborted)setError('暂时无法连接工作区。');});
    return ()=>{abort.abort();setTabAppearance();};
  },[retry]);
  return <main className="startup"><h1>工作区</h1><p role="status">{error||'正在恢复上次的工作位置…'}</p>
    {error&&<><button onClick={()=>{setError('');setRetry(value=>value+1);}}>重试</button> <a href="#/read">选择资料</a></>}
  </main>;
}
