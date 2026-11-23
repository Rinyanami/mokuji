import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BookOpen, BookmarkPlus, ExternalLink, Search } from 'lucide-react';
import type { Book } from '@/lib/types';
import { jinjiangSearchUrl } from './jinjiang-search';
import { readerPost, readerRequest, type ReaderIndex, type ShelfInput } from './reading-client';

interface FictionItem {
  id:string; title:string; author?:string; platform:string; sourceUrl?:string;
  intro?:string; status?:string; genre?:string; canReadHere?:boolean; readerId?:string; linkKind?:'detail'|'search';
}
interface ResultPage {results:FictionItem[]; page:number; hasMore:boolean; total?:number; totalReadable?:number; totalOfficial?:number; catalogTotal?:number; platforms?:string[]}
interface Props {
  shelf:Book[]; bindings?:Record<string,string>; onRead:(id:string)=>void; onJump:(id:string)=>void;
  onSave:(book:ShelfInput)=>Promise<string|undefined>;
}
function officialBookLink(input?:string,search=false) {
  if (!input) return;
  try {
    const url=new URL(input);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) return;
    if (search) return {href:url.href,label:''};
    if (/(?:^|\.)qidian\.com$/i.test(url.hostname)) {
      if (!/^\/(?:book|info)\/[1-9]\d*\/?$/.test(url.pathname)) return;
      return {href:url.href,label:'起点'};
    }
    if (/(?:^|\.)fanqienovel\.com$/i.test(url.hostname)) {
      if (!/^\/page\/[1-9]\d*\/?$/.test(url.pathname)) return;
      return {href:url.href,label:'番茄'};
    }
    if (url.pathname==='/' || /(?:^|\/)(?:search|so)(?:[/.]|$)/i.test(url.pathname) ||
      ['q','keyword','search','query'].some(key=>url.searchParams.has(key))) return;
    return {href:url.href,label:''};
  } catch {return;}
}

const platformName=(name:string)=>({qidian:'起点',fanqie:'番茄',fanqienovel:'番茄',jjwxc:'晋江',zongheng:'纵横'}[name?.toLowerCase()] || name);
export default function WebFiction({shelf,bindings,onRead,onJump,onSave}:Props) {
  const [input,setInput]=useState('');
  const [request,setRequest]=useState({term:'',page:1,attempt:0,access:'',platform:''});
  const [platforms,setPlatforms]=useState<string[]>([]);
  const [response,setResponse]=useState<ResultPage|null>(null);
  const [error,setError]=useState('');
  const [saveError,setSaveError]=useState('');
  const [saving,setSaving]=useState('');
  const [known,setKnown]=useState<Record<string,string>>({});
  const [linked,setLinked]=useState<Record<string,string>>({});
  const saveLock=useRef(false);

  useEffect(()=>{
    const controller=new AbortController();
    const params=new URLSearchParams({page:String(request.page)});
    if (request.term) params.set('q',request.term);
    if (request.access) params.set('access',request.access);
    if (request.platform) params.set('platform',request.platform);
    readerRequest<ResultPage>('web-fiction?'+params,{signal:controller.signal})
      .then(result=>{
        if (!Array.isArray(result.results)) throw new Error('网文目录暂时无法读取。');
        if (!controller.signal.aborted) {
          setResponse(result);
          if (Array.isArray(result.platforms)) setPlatforms(result.platforms);
        }
      }).catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error ? reason.message : '无法读取网文目录。');});
    return ()=>controller.abort();
  },[request]);
  function load(term:string,page:number,access=request.access,platform=request.platform) {
    setError('');setResponse(null);setSaveError('');setRequest(prev=>({term,page,access,platform,attempt:prev.attempt+1}));
  }
  function submit(event:FormEvent) {event.preventDefault();load(input.trim(),1);}
  async function save(item:FictionItem,shelfId?:string) {
    if (saveLock.current)return;
    saveLock.current=true;setSaving(item.id);setSaveError('');
    try {
      const id=shelfId || await onSave({title:item.title,author:item.author || '',category:'网文',
        sourceUrl:item.linkKind==='search' ? undefined : officialBookLink(item.sourceUrl)?.href});
      if(!id) throw new Error('书架尚未保存这部作品，请重试。');
      setKnown(current=>({...current,[item.id]:id}));
      if (item.canReadHere && item.readerId) {
        const current=await readerRequest<ReaderIndex>('books?workId='+encodeURIComponent(id));
        const bound=current.boundId || current.bindings?.[id];
        if (bound && bound!==item.readerId) {
          setLinked(prior=>({...prior,[id]:bound}));
          throw new Error('这条书架记录已关联其他正文，可在书架详情中选择来源。');
        }
        if (!bound) await readerPost('bind',{workId:id,bookId:item.readerId});
        const readerId=item.readerId;
        setLinked(prior=>({...prior,[id]:readerId}));
      }
    } catch(reason) {setSaveError(reason instanceof Error ? reason.message : '加入书架失败，请重试。');}
    finally {saveLock.current=false;setSaving('');}
  }

  return <section className="web-fiction" aria-label="中文网文发现">
    <form onSubmit={submit} className="fiction-search" role="search" aria-label="搜索中文网文">
      <label className="reader-source-filter"><Search size={16}/><input type="search" value={input}
        onChange={event=>setInput(event.target.value)} placeholder="输入网文书名或作者" aria-label="网文书名或作者"/></label>
      <button type="submit" className="button button-sage">搜索</button>
    </form>
    <div className="fiction-filters">
      <label className="reader-origin-filter">阅读方式<select aria-label="网文阅读方式" value={request.access} onChange={e=>load(request.term,1,e.target.value)}>
        <option value="">全部</option><option value="inside">站内可读</option><option value="official">原站阅读</option></select></label>
      {platforms.length>0 && <label className="reader-origin-filter">平台<select aria-label="网文平台" value={request.platform} onChange={e=>load(request.term,1,request.access,e.target.value)}>
        <option value="">全部平台</option>{platforms.map(p=><option key={p} value={p}>{platformName(p)}</option>)}</select></label>}
    </div>
    {response && typeof response.total==='number' && <p className="reader-filter-meta" role="status">
      匹配 {response.total.toLocaleString('zh-CN')} 部{typeof response.totalReadable==='number' && ' · 站内可读 '+response.totalReadable.toLocaleString('zh-CN')+' 部'}
      {typeof response.totalOfficial==='number' && ' · 原站阅读 '+response.totalOfficial.toLocaleString('zh-CN')+' 部'}
      {typeof response.catalogTotal==='number' && ' · 全库 '+response.catalogTotal.toLocaleString('zh-CN')+' 部'}
    </p>}
    <div className="reader-group-title"><h2>{request.term?'网文搜索结果':'精选网文'}</h2>
      {request.term && <button type="button" className="text-button" onClick={()=>{setInput('');load('',1);}}>返回精选</button>}</div>
    {error && <div className="reader-hub-error" role="alert">{error} <button type="button" className="text-button" onClick={()=>load(request.term,request.page)}>重新读取</button></div>}
    {!response && !error && <p role="status">正在读取网文目录…</p>}
    {saveError && <p role="alert" className="reader-hub-error">{saveError}</p>}
    {response && !response.results.length && <div className="fiction-empty"><p role="status">暂无匹配作品，可换个书名或作者再搜。</p>
      {request.term && <div className="reader-platform-buttons">
        <a className="button button-outline" href={'https://m.qidian.com/so/'+encodeURIComponent(request.term)+'.html'} target="_blank" rel="noreferrer">去起点搜书<ExternalLink size={12}/></a>
        <a className="button button-outline" href={jinjiangSearchUrl(request.term)} target="_blank" rel="noreferrer">去晋江搜书<ExternalLink size={12}/></a>
      </div>}</div>}
    {response?.results.map(item=>{
      const searchOnly=item.linkKind==='search';
      const link=officialBookLink(item.sourceUrl,searchOnly);
      const platform=platformName(item.platform);
      const sameEdition=shelf.filter(book=>item.author && book.author===item.author && book.title===item.title);
      const saved=known[item.id] || (link && !searchOnly && shelf.find(book=>book.sourceUrl===link.href)?.id) || (sameEdition.length===1 && sameEdition[0].id);
      const bound=saved ? linked[saved] || bindings?.[saved] : undefined;
      return <article className="reader-source-row" key={item.id}>
        <div className="reader-source-data"><strong>{item.title}</strong>
          <p>{[item.author,platform,item.genre,item.status].filter(Boolean).join(' · ')}</p>
          {item.intro && <p className="fiction-intro">{item.intro}</p>}</div>
        <div className="reader-row-actions">
          {item.canReadHere && item.readerId ? <button type="button" className="button button-sage" onClick={()=>onRead(item.readerId!)}><BookOpen size={14}/>在目次阅读</button> :
            link && <a href={link.href} className="button button-outline fiction-official" target="_blank" rel="noreferrer">去{link.label || platform || '原站'}{searchOnly?'搜书':'读'}<ExternalLink size={12}/></a>}
          {saved ? <button type="button" className="text-button" onClick={()=>onJump(saved)}>查看书架记录</button> :
            <button type="button" className="text-button" disabled={!!saving} onClick={()=>void save(item)}><BookmarkPlus size={13}/>{saving===item.id?'正在保存…':'加入想读'}</button>}
          {saved && item.canReadHere && item.readerId && !bound && <button type="button" className="text-button" disabled={!!saving} onClick={()=>void save(item,saved)}>关联站内正文</button>}
        </div>
      </article>;
    })}
    {response && (request.page>1 || response.hasMore) && <nav className="fiction-pages" aria-label="网文搜索翻页">
      <button type="button" className="button button-outline" disabled={request.page===1} onClick={()=>load(request.term,request.page-1)}>上一页</button>
      <span aria-current="page">第 {request.page} 页</span>
      <button type="button" className="button button-outline" disabled={!response.hasMore} onClick={()=>load(request.term,request.page+1)}>下一页</button>
    </nav>}
  </section>;
}

