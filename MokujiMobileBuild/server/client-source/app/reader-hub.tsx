import { useConnection, txtLocation } from './connection-mode';
import { importBookFile, readerFileAccept } from './reader-file-import';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, BookOpen, ChevronLeft, Download, ExternalLink, FileText, Globe, Link2, PenLine, RefreshCw, Search, Trash2, Upload, X } from 'lucide-react';
import type { Book } from '@/lib/types';
import { externalUrl, lastOpened, readerPost, readerRequest, readingPosition, sourceLabel, type ShelfInput, type ReaderBook, type ReaderIndex } from './reading-client';
import WebFiction from './web-fiction';
import CustomSourcesPanel from './custom-sources-panel';
import { recentWorkspace } from './resume-workspace';
import { readAppearance, readShellTheme, readSurface, readerModes, saveAppearance, saveShellTheme, saveSurface, type ReaderAppearance, type UiTheme } from './reader-appearance';
import './reader-hub.css';

interface HubProps {
  work?:Book;
  browse:'library'|'fiction'|'sources';
  onBrowse:(mode:'library'|'fiction'|'sources')=>void;
  shelf:Book[];
  onRead:(id:string)=>void;
  onBack:()=>void;
  onJump:(workId:string)=>void;
  onAdd:(book:ShelfInput & {initialStatus?:'在读'|'想读'})=>Promise<string | undefined>;
}
const normalized=(value:string)=>value.normalize('NFKC').trim().toLowerCase();
const message=(reason:unknown)=> reason instanceof Error ? reason.message : '暂时无法完成，请重试。';

const pageSize=6;
function sourceInfo(item:ReaderBook) {
  const online=item.sourceType==='online' || item.sourceType==='custom';
  const name=sourceLabel(item.source || (item.sourceType==='custom'?'自定义书源':online?'在线书源':item.sourceType==='upload'?'TXT 导入':'本地书库'));
  return {key:(online?'online:':'local:')+name,name,online};
}

export default function ReaderHub({work,shelf,onRead,onBack,onJump,onAdd,browse,onBrowse}:HubProps) {
  const storageNotice=txtLocation(useConnection());
  const [appearance,setAppearance]=useState(readAppearance);
  const [surface,setSurface]=useState(readSurface);
  const [shellTheme,setShellTheme]=useState<UiTheme>(()=>readShellTheme(readAppearance()==='normal'?'codex':readAppearance() as Exclude<ReaderAppearance,'normal'>,readSurface()));
  const [index,setIndex]=useState<ReaderIndex | null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  const [filter,setFilter]=useState('');
  const [selectedSource,setSelectedSource]=useState('');
  const [shown,setShown]=useState<Record<string,number>>({});
  const [opened]=useState(lastOpened);
  const [importPanel,setImportPanel]=useState<'txt'|'wiki'|null>(null);
  const [wikiUrl,setWikiUrl]=useState('');
  const [wikiError,setWikiError]=useState('');
  const [file,setFile]=useState<File | null>(null);
  const [title,setTitle]=useState('');
  const [author,setAuthor]=useState('');
  const [autoShelf,setAutoShelf]=useState(true);
  const [cacheNotice,setCacheNotice]=useState('');
  const [showAll,setShowAll]=useState(false);
  const [newBind,setNewBind]=useState('');
  const lock=useRef(false);
  const workId=work?.id;
  useEffect(()=>{
    const controller=new AbortController();
    readerRequest<ReaderIndex>(`books${workId ? '?workId='+encodeURIComponent(workId) : ''}`,{signal:controller.signal})
      .then(data=>{if(!controller.signal.aborted){setIndex(data);setLoading(false);}})
      .catch(reason=>{if(!controller.signal.aborted){setError(message(reason));setLoading(false);}});
    return ()=>controller.abort();
  },[workId,retry]);
  function reload(){setError('');setLoading(true);setRetry(value=>value+1);}
  const boundId=index?.boundId || (workId ? index?.bindings?.[workId] : undefined);
  const bound=index?.books.find(item=>item.id===boundId);
  const worksFor=(id:string)=>shelf.filter(item=>index?.bindings?.[item.id]===id);
  const library=useMemo(()=>index?.books || [],[index]);
  const sources=useMemo(()=>{
    const groups=new Map<string,{key:string;name:string;online:boolean;items:ReaderBook[]}>();
    for(const item of library){
      const info=sourceInfo(item);
      const group=groups.get(info.key);
      if(group)group.items.push(item);
      else groups.set(info.key,{...info,items:[item]});
    }
    return [...groups.values()];
  },[library]);
  const terms=normalized(filter).split(/\s+/).filter(Boolean);
  const groups=sources.filter(group=>!selectedSource || group.key===selectedSource)
    .map(group=>({...group,items:group.items.filter(item=>{
      const fields=normalized([item.title,item.workAlias,item.originalTitle,item.author,...(item.aliases ?? []),item.source,group.name].join(' '));
      return terms.every(term=>fields.includes(term));
    })})).filter(group=>group.items.length);
  const count=groups.reduce((total,group)=>total+group.items.length,0);
  const suggested=work ? library.filter(item=>normalized(item.title)===normalized(work.title) && item.id!==boundId) : [];
  const recent=useMemo(()=>index?recentWorkspace(index,opened):undefined,[index,opened]);
  const latest=recent&&recent.time>0?recent.book:undefined;
  function clearSearch(){setSelectedSource('');setFilter('');setShown({});}
  async function openSource(item:ReaderBook){
    if(lock.current)return;
    if(!workId || boundId===item.id){onRead(item.id);return;}
    if(work && !boundId && normalized(work.title)!==normalized(item.title) && !window.confirm(`将《${item.title}》用作《${work.title}》的正文？`))return;
    if(boundId && !window.confirm(`将《${work?.title}》的正文来源切换为「${item.title} · ${item.source}」？`))return;
    lock.current=true;setBusy(true);setError('');
    try{await readerPost('bind',{workId,bookId:item.id});onRead(item.id);}
    catch(reason){setError(message(reason));}
    finally{lock.current=false;setBusy(false);}
  }
  async function addToShelf(item:ReaderBook){
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');
    try{
      const shelfId=await onAdd(item);
      if(!shelfId)throw new Error('未能加入书架，请查看书架提示后重试。');
      const old=index?.bindings?.[shelfId];
      if(old && old!==item.id){onJump(shelfId);return;}
      await readerPost('bind',{workId:shelfId,bookId:item.id});
      setNewBind(item.id);reload();
    }catch(reason){setError(message(reason));}
    finally{lock.current=false;setBusy(false);}
  }
  async function unlink(){
    if(!workId || lock.current || !window.confirm('解除这本书的正文关联？阅读位置和私人笔记都会保留。'))return;
    lock.current=true;setBusy(true);setError('');
    try{await readerPost('bind',{workId,bookId:null});reload();}
    catch(reason){setError(message(reason));}
    finally{lock.current=false;setBusy(false);}
  }
  async function importFile(event:FormEvent){
    event.preventDefault();
    if(!file || lock.current)return;
    if(workId && boundId && !window.confirm('将导入的文件设为这本书的新正文来源？'))return;
    lock.current=true;setBusy(true);setError('');
    try{
      const book=await importBookFile(file,{...(title.trim()?{title:title.trim()}:{}),author:author.trim(),...(workId?{workId}:{})});
      if(!workId && autoShelf){
        const inferredCat=/\.(?:cbz|zip)$/i.test(file.name)?'漫画':/轻小说/.test(file.name)?'轻小说':undefined;
        const shelfId=await onAdd({title:book.title,author:book.author||'',sourceUrl:'',...(inferredCat?{category:inferredCat}:{}),initialStatus:'在读'}).catch(()=>undefined);
        if(shelfId)await readerPost('bind',{workId:shelfId,bookId:book.id}).catch(()=>undefined);
      }
      onRead(book.id);
    }catch(reason){setError(message(reason));}
    finally{lock.current=false;setBusy(false);}
  }
  async function importWiki(event:FormEvent){
    event.preventDefault();
    const url=wikiUrl.trim();
    if(!url || lock.current)return;
    if(workId && boundId && !window.confirm('将这个维基文库页面设为这本书的新正文来源？'))return;
    lock.current=true;setBusy(true);setWikiError('');
    try{
      const {book}=await readerPost<{book:{id:string}}>('wiki-import',{url,...(workId?{workId}:{})});
      if(!book?.id)throw new Error('暂时未能打开导入的作品，请重试。');
      onRead(book.id);
    }catch(reason){setWikiError(message(reason));}
    finally{lock.current=false;setBusy(false);}
  }
  async function renameReaderBook(item:ReaderBook){
    const next=window.prompt('输入新的书名',item.title);
    if(!next || !next.trim() || next.trim()===item.title || lock.current)return;
    lock.current=true;setBusy(true);setError('');
    try{await readerPost('rename-book',{id:item.id,title:next.trim()});reload();}
    catch(reason){setError(message(reason));}
    finally{lock.current=false;setBusy(false);}
  }
  async function deleteReaderBook(item:ReaderBook){
    if(lock.current || !window.confirm(`确定从阅读书库中删除《${item.title}》？章节正文将一并移除。`))return;
    lock.current=true;setBusy(true);setError('');
    try{await readerPost('delete-book',{id:item.id});reload();}
    catch(reason){setError(message(reason));}
    finally{lock.current=false;setBusy(false);}
  }
  async function refreshCustomBook(item:ReaderBook){
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');setCacheNotice('');
    try{const r=await readerPost<{chapterCount:number}>('sources/refresh',{id:item.id});setCacheNotice(`已刷新《${item.title}》最新目录（共 ${r.chapterCount} 章）`);reload();}
    catch(reason){setError(message(reason));}
    finally{lock.current=false;setBusy(false);}
  }
  async function cacheCustomChapters(item:ReaderBook){
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');setCacheNotice('');
    try{
      const r=await readerPost<{cached:number;errors:number}>('sources/cache',{id:item.id,start:item.progress?.chapter||0,count:20});
      setCacheNotice(`《${item.title}》离线缓存完成：新缓存 ${r.cached} 章${r.errors?`（${r.errors} 章暂未抓取或为 VIP）`:''}`);
      reload();
    }catch(reason){setError(message(reason));}
    finally{lock.current=false;setBusy(false);}
  }
  function card(item:ReaderBook){
    const linked=worksFor(item.id);
    const marked=!!item.progress?.updatedAt;
    const manageable=item.sourceType==='upload'||item.sourceType==='custom'||item.id.startsWith('wikisource:');
    return <article key={item.id} className="reader-source-row">
      <div className="reader-book-icon" aria-hidden="true"><BookOpen size={19}/></div>
      <div className="reader-source-data"><strong>{item.title}</strong>
        {item.sourceType==='online' && item.language==='en' && item.edition?.includes('英文原著') && <span className="reader-edition">英文原著</span>}
        {item.originalTitle && item.originalTitle!==item.title && <div className="reader-original-title">{item.originalTitle}</div>}
        <p>{[item.author,item.source && sourceLabel(item.source),item.cachedChapterCount!==undefined ? `本机可读 ${item.cachedChapterCount} / ${item.chapterCount} 章` : item.chapterCount ? `${item.chapterCount} 章` : ''].filter(Boolean).join(' · ')}</p>
        {marked && <small>{readingPosition(item.progress)}</small>}
        {!work && linked.length>0 && <div className="reader-shelf-links">{linked.map(record=><button key={record.id} type="button" onClick={()=>onJump(record.id)}>书架记录 · {record.title}</button>)}</div>}
      </div>
      <div className="reader-row-actions"><button type="button" className="button button-sage" disabled={busy} onClick={()=>openSource(item)}>
        {work && boundId!==item.id ? '关联并阅读' : item.cachedChapterCount===0 ? '查看目录' : marked ? '继续阅读' : '开始阅读'}<ArrowRight size={13}/></button>
        {!work && !linked.length && <button type="button" className="text-button" disabled={busy} onClick={()=>addToShelf(item)}><Link2 size={12}/>加入目次 Mokuji书架</button>}
        {item.sourceType==='custom' && <>
          <button type="button" className="text-button" disabled={busy} onClick={()=>refreshCustomBook(item)}><RefreshCw size={12}/>更新目录</button>
          <button type="button" className="text-button" disabled={busy} onClick={()=>cacheCustomChapters(item)}><Download size={12}/>缓存20章</button>
        </>}
        {manageable && <>
          <button type="button" className="text-button" disabled={busy} onClick={()=>renameReaderBook(item)}><PenLine size={12}/>重命名</button>
          <button type="button" className="text-button danger" disabled={busy} onClick={()=>deleteReaderBook(item)}><Trash2 size={12}/>删除</button>
        </>}
        {externalUrl(item.sourceUrl) && <a href={item.sourceUrl} target="_blank" rel="noreferrer">原站<ExternalLink size={11}/></a>}
      </div>
    </article>;
  }
  return <main className="reader-hub">
    {work && <button type="button" className="text-button reader-return" onClick={onBack}><ChevronLeft size={14}/>返回作品详情</button>}
    <div className="reader-hub-head"><div><h1>{work ? work.title : browse==='sources' ? '找书与嗅探' : browse==='fiction' ? '中文网文' : '阅读书库'}</h1><p>{work ? '选择、全网搜索或粘贴网页链接嗅探，将此书与正文绑定。' : browse==='sources' ? '全网多源检索小说与漫画，或粘贴任意网页目录 / 直链一键嗅探入库。' : '管理本机可读作品、导入 TXT / EPUB / CBZ 漫画包，或切换工作区摸鱼界面。'}</p></div>
      <div className="reader-import-actions">
        <button type="button" className="button button-outline" disabled={busy} onClick={()=>setImportPanel(importPanel==='txt'?null:'txt')} aria-expanded={importPanel==='txt'}><Upload size={15}/>导入 TXT / EPUB / CBZ</button>
        {!work && <a className="button button-outline" href="#/workspace">进入工作区<ArrowRight size={14}/></a>}
      </div></div>
    {(work || browse!=='sources') && <>
      <div className="reader-layout-options">
        <label className="reader-origin-filter reader-appearance-choice">
          <span>站内阅读界面</span>
          <select value={appearance} onChange={event=>{
            const mode=event.target.value as ReaderAppearance;
            saveAppearance(mode);
            setAppearance(mode);
          }}>
            <option value="normal">{readerModes[0].label}</option>
            <optgroup label="摸鱼阅读">
              {readerModes.filter(mode=>mode.value!=='normal').map(mode=><option value={mode.value} key={mode.value}>{mode.label}</option>)}
            </optgroup>
          </select>
        </label>
        {appearance!=='normal' && <div role="group" aria-label="界面版本" className="reader-surface-picker">
          {(['web','desktop'] as const).map(value=><button type="button" key={value} aria-pressed={surface===value}
            onClick={()=>{saveSurface(value);setSurface(value);}}>{value==='web'?'网页版':'桌面版'}</button>)}
        </div>}
        {appearance!=='normal' && <div role="group" aria-label="明暗主题" className="reader-surface-picker">
          {(['light','dark'] as const).map(value=><button type="button" key={value} aria-pressed={shellTheme===value}
            onClick={()=>{saveShellTheme(value);setShellTheme(value);}}>{value==='light'?'浅色':'深色'}</button>)}
        </div>}
      </div>
      {importPanel===null && <p className="reader-txt-location">{storageNotice}</p>}
    </>}
    {importPanel==='wiki' && <form className="reader-import" onSubmit={importWiki}>
      <label className="field-label">中文维基文库链接<input type="url" inputMode="url" value={wikiUrl} required disabled={busy}
        placeholder="https://zh.wikisource.org/wiki/…" aria-describedby="wiki-import-help"
        onChange={event=>{setWikiUrl(event.target.value);setWikiError('');}}/></label>
      <p id="wiki-import-help">支持已标明原作全球公有领域的单篇或章节。整部目录暂不支持，请打开具体章节再复制链接。{work?'添加后将关联当前作品。':''}</p>
      {wikiError && <p className="reader-hub-error" role="alert">{wikiError}</p>}
      <button className="button button-sage" type="submit" disabled={busy || !wikiUrl.trim()}>{busy?'正在读取…':'添加并阅读'}</button>
    </form>}
    {!work && browse==='library' && latest && !filter && !selectedSource && <section className="reader-resume" aria-label="继续阅读">
      <div><h2>继续阅读</h2><strong>{latest.title}</strong><p>{[latest.author,sourceInfo(latest).name,readingPosition(latest.progress)].filter(Boolean).join(' · ')}</p></div>
      <div style={{display:'flex',gap:8,flexShrink:0}}><a className="button button-outline" href="#/workspace">工作区</a><button className="button button-sage" type="button" onClick={()=>onRead(latest.id)}>接着读<ArrowRight size={14}/></button></div>
    </section>}
    {importPanel==='txt' && <form className="reader-import" onSubmit={importFile}><h2><FileText size={16}/>导入 TXT / EPUB / CBZ 漫画</h2>
      <label className="field-label">本地文件<input type="file" accept={readerFileAccept} required disabled={busy} onChange={event=>{const next=event.target.files?.[0]||null;setFile(next);setTitle(work?.title || (next && !/\.(?:epub|cbz|zip)$/i.test(next.name) ? next.name.replace(/\.te?xt$/i,'') : next?.name.replace(/\.(?:epub|cbz|zip)$/i,'')||''));setAuthor(work?.author || '');}}/></label>
      <div className="form-row"><label className="field-label">书名<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={200} placeholder="自动读取书名" disabled={busy}/></label>
        <label className="field-label">作者（选填）<input value={author} onChange={e=>setAuthor(e.target.value)} maxLength={200} disabled={busy}/></label></div>
      {!workId && <label className="checkbox-label"><input type="checkbox" checked={autoShelf} onChange={e=>setAutoShelf(e.target.checked)}/>导入后同时加入「我的书架 · 在读」并绑定进度</label>}
      <p>{storageNotice}上限 60 MiB。TXT 支持 UTF-8 / GB18030 / UTF-16；EPUB 支持图文轻小说；CBZ / ZIP 支持多话图片漫画包。{work?'导入后将关联当前作品。':''}</p>
      <button className="button button-sage" type="submit" disabled={busy || !file}>{busy?'正在处理…':'导入并阅读'}</button>
    </form>}
    {error && <p className="reader-hub-error" role="alert">{error} <button type="button" className="text-button" onClick={reload}>重新读取书库</button></p>}
    {cacheNotice && !error && <p className="reader-hub-note" role="status">{cacheNotice}</p>}
    {newBind && !error && <p className="reader-hub-note" role="status">已关联目次 Mokuji书架，随时可以从书架打开正文。</p>}
    {loading && <p role="status">正在读取本机书库…</p>}
    {bound && <section className="reader-source-section"><div className="reader-group-title"><h2>当前正文来源</h2><button type="button" className="text-button" disabled={busy} onClick={unlink}>解除关联</button></div>{card(bound)}</section>}
    {work && !!suggested.length && <section className="reader-source-section"><h2>同名的正文来源</h2>{suggested.map(card)}</section>}
    {work && !showAll && <div style={{display:'flex',flexWrap:'wrap',gap:8}}><button type="button" className="button button-outline" onClick={()=>setShowAll(true)}><Search size={14}/>从已有书源选择</button>{browse!=='sources' && <button type="button" className="button button-sage" onClick={()=>onBrowse('sources')}><Globe size={14}/>去全网书源搜索 / 网页嗅探</button>}</div>}
    {!work && <nav className="reader-browse-tabs" aria-label="选择阅读书库">
      {(browse==='sources' || browse==='fiction') ? <>
        <button type="button" aria-pressed={browse==='sources'} onClick={()=>onBrowse('sources')}><Globe size={13} style={{marginRight:4,verticalAlign:'-2px'}}/>书源与嗅探</button>
        <button type="button" aria-pressed={browse==='fiction'} onClick={()=>onBrowse('fiction')}>开源中文网文</button>
        <a className="text-button" style={{marginLeft:'auto',alignSelf:'center',fontSize:12.5}} href="#/discover">Bangumi 资料库 →</a>
      </> : <>
        <button type="button" aria-pressed={browse==='library'} onClick={()=>onBrowse('library')}>正文书库</button>
        <button type="button" aria-pressed={false} onClick={()=>onBrowse('sources')}><Globe size={13} style={{marginRight:4,verticalAlign:'-2px'}}/>找书与嗅探</button>
        <a className="text-button" style={{marginLeft:'auto',alignSelf:'center',fontSize:12.5}} href="#/shelf">返回书架 →</a>
      </>}
    </nav>}
    {browse==='sources' && <CustomSourcesPanel workId={workId} initialQuery={work?.title || ''} onAddShelf={onAdd} onRead={onRead} onReloadLibrary={reload}/>}
    {!work && browse==='fiction' && <WebFiction shelf={shelf} bindings={index?.bindings} onRead={onRead} onSave={onAdd} onJump={onJump}/>}
    {((!work && browse==='library') || showAll) && <>
      <section className="reader-find" aria-label="查找作品">
        <h2>查找作品</h2>
        <div className="reader-filter-fields">
          <label className="reader-source-filter"><Search size={16}/><input type="search" value={filter} onChange={event=>{setFilter(event.target.value);setShown({});}} placeholder="搜索书名、作者或来源" aria-label="搜索书名、作者或来源"/></label>
          <label className="reader-origin-filter"><span>来源</span><select value={selectedSource} aria-label="来源筛选" onChange={event=>{setSelectedSource(event.target.value);setShown({});}}>
            <option value="">全部来源</option>
            {[{online:false,label:'本机书源'},{online:true,label:'在线书源'}].map(type=>{
              const choices=sources.filter(source=>source.online===type.online);
              return choices.length>0 && <optgroup key={type.label} label={type.label}>{choices.map(source=><option key={source.key} value={source.key}>{source.name}（{source.items.length}）</option>)}</optgroup>;
            })}
          </select></label>
        </div>
        {!!library.length && <div className="reader-filter-meta"><span role="status">{count} 部作品 · {groups.length} 个来源</span>
          {(!!filter || !!selectedSource) && <button type="button" className="text-button" onClick={clearSearch}><X size={13}/>清除筛选</button>}</div>}
      </section>
      {groups.map(group=>{
        const max=shown[group.key] || pageSize;
        const visible=group.items.slice(0,max);
        return <section key={group.key} className="reader-source-section" aria-label={group.name}>
          <div className="reader-group-title"><h2>{group.name}</h2><span className="reader-group-meta">{group.online?'在线阅读':'本机书库'} · {group.items.length} 部</span></div>
          {visible.map(card)}
          {group.items.length>max && <button type="button" className="text-button reader-show-more" onClick={()=>setShown(current=>({...current,[group.key]:max+pageSize}))}>再显示 {Math.min(pageSize,group.items.length-max)} 部</button>}
        </section>;
      })}
      {!loading && !count && <p className="reader-hub-note">{filter || selectedSource?'没有匹配的正文来源，请调整搜索条件。':'书库中还没有正文，可导入 TXT 或 EPUB 开始阅读。'}</p>}
    </>}
  </main>;
}
