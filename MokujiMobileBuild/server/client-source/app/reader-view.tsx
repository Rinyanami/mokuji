'use client';

import { Fragment, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bookmark, ChevronLeft, ChevronRight, ExternalLink, List, Search, Type } from 'lucide-react';
import { externalUrl, readerPost, readerRequest, ReaderError, readingPosition, rememberOpened, type BookDetail, type ChapterText, type ReadingMark } from './reading-client';
import { readerModes, readAppearance, saveAppearance, readSurface, saveSurface, readShellTheme, saveShellTheme, defaultShellTheme, defaultWorkspaceMode, readAppTheme, readPaperTheme, savePaperTheme, readLineHeight, saveLineHeight, syncNativeStatusBar, type ReaderPaperTheme, type ReaderSurface, type ReaderAppearance, type UiTheme } from './reader-appearance';
import ReaderSettings from './reader-settings';
import { ReaderMedia } from './reader-media';
import {useReaderShortcuts} from './reader-shortcuts';
import { ReaderRecordIndex, findReaderChapters } from './reader-record-index';
import { useReaderBookmarks, type BookPoint } from './reader-bookmarks';
import { useReaderHighlights, type HighlightColor, type TextHighlight } from './reader-highlights';
import CotexSourceFont from './cotex-source-font';
import { setTabAppearance, syncReaderAddress, workspaceFragment } from './work-route';
import { ReaderLede, ReaderTail } from './reader-shell-lede';
const AgentShell = lazy(() => import('./reader-shell-agents'));
const BuddyShell = lazy(() => import('./reader-shell-buddy'));
const EditorShell = lazy(() => import('./reader-shell-editor'));
const MobileDocsShell = lazy(() => import('./reader-shell-mobile-docs'));
import { projectAlias, showWorkEvent, taskAlias } from './reader-work-context';
import { useWorkspaces } from './reader-workspaces';
import ReaderWorkEvent from './reader-work-event';
import {readWorkHints,saveWorkHints,supportsWorkHints,WorkHintSettings,type WorkHints} from './reader-work-hints';
import { ReaderWorkSummary } from './reader-work-summary';
import './reader-view.css';

type Position = Pick<ReadingMark, 'chapter' | 'paragraph'>;
type OpenText = { text:ChapterText; start:number };
const same = (a:Position | null, b:Position | null) => !!a && !!b && a.chapter === b.chapter && a.paragraph === b.paragraph;
const errorText = (err:unknown) => err instanceof Error ? err.message : '读取失败，请稍后重试。';
const sizes = [16,18,20,22,24,28];
function chapterUnits(text:ChapterText) {
  const count=text.paragraphs.length;
  return Math.max(1,count+(text.images?.some(g=>g.paragraph===count&&g.items.length) ? 1 : 0));
}
function storedSize() {
  try { const previous = Number(localStorage.getItem('duji.reader.font')); return sizes.includes(previous) ? previous : null; }
  catch { return null; }
}

type ReaderViewProps={id:string;onBack:()=>void;onSwitchBook:(id:string)=>void};
export default function ReaderView(props:ReaderViewProps) {
  return <ReaderSession key={props.id} {...props}/>;
}

function ReaderSession({id,onBack,onSwitchBook}:ReaderViewProps) {
  const [detail,setDetail] = useState<BookDetail | null>(null);
  const [open,setOpen] = useState<OpenText | null>(null);
  const [chapter,setChapter] = useState(0);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [sourceUrl,setSourceUrl] = useState('');
  const [saveError,setSaveError] = useState('');
  const [conflict,setConflict] = useState<ReadingMark | null>(null);
  const [preferredSize,setSize] = useState(storedSize);
  const [workHints,setWorkHints]=useState(readWorkHints);
  const [appearance,setAppearance] = useState(()=>{
    const preferred=readAppearance();
    return preferred==='normal' && location.hash===workspaceFragment(id) ? defaultWorkspaceMode() : preferred;
  });
  const [surface,setSurface] = useState(readSurface);
  const [shellTheme,setShellTheme] = useState<UiTheme>(() => {
    const initialMode = readAppearance();
    const initialSurface = readSurface();
    return readShellTheme(initialMode === 'normal' ? defaultWorkspaceMode() : initialMode, initialSurface);
  });
  const [paperTheme, setPaperTheme] = useState<ReaderPaperTheme>(readPaperTheme);
  const [lineHeight, setLineHeight] = useState<number>(readLineHeight);
  const [normalTypoOpen, setNormalTypoOpen] = useState(false);
  const normalSwipe = useRef<{ x: number; y: number; t: number } | null>(null);
  const [copyNote, setCopyNote] = useState('');
  useEffect(() => {
    if (!copyNote) return;
    const t = setTimeout(() => setCopyNote(''), 2500);
    return () => clearTimeout(t);
  }, [copyNote]);
  const [settingsOpen,setSettingsOpen] = useState(false);
  const [summaryOpen,setSummaryOpen] = useState(false);
  const [revealReal,setRevealReal] = useState(false);
  const [index,setIndex] = useState<{tab:'search'|'marks'|'highlights';query:string}|null>(null);
  const [selDraft,setSelDraft] = useState<{chapter:number;paragraph:number;quote:string}|null>(null);
  const [activeHl,setActiveHl] = useState<TextHighlight|null>(null);
  const [hlNoteMode,setHlNoteMode] = useState(false);
  const [hlNoteDraft,setHlNoteDraft] = useState('');
  const hl = useReaderHighlights(id);

  function captureTextSelection() {
    const sel = window.getSelection?.();
    const quote = sel?.toString()?.trim() || '';
    if (!quote || !sel || !sel.rangeCount) return;
    let node: Node | null = sel.anchorNode;
    while (node && node.nodeType !== 1) node = node.parentNode;
    const pEl = (node as HTMLElement | null)?.closest?.('p[data-p]');
    if (!pEl) return;
    const pNum = Number(pEl.getAttribute('data-p'));
    if (!Number.isInteger(pNum)) return;
    setActiveHl(null);
    setHlNoteMode(false);
    setHlNoteDraft('');
    setSelDraft({ chapter, paragraph: pNum, quote });
  }

  function renderParaText(text: string, pIndex: number) {
    const list = hl.highlights.filter(h => h.chapter === chapter && h.paragraph === pIndex && h.quote);
    if (!list.length) return text;
    const parts: Array<string | { text: string; item: TextHighlight }> = [text];
    for (const item of list) {
      const nextParts: typeof parts = [];
      for (const seg of parts) {
        if (typeof seg !== 'string') { nextParts.push(seg); continue; }
        const idx = seg.indexOf(item.quote);
        if (idx < 0) { nextParts.push(seg); continue; }
        if (idx > 0) nextParts.push(seg.slice(0, idx));
        nextParts.push({ text: item.quote, item });
        if (idx + item.quote.length < seg.length) nextParts.push(seg.slice(idx + item.quote.length));
      }
      parts.splice(0, parts.length, ...nextParts);
    }
    return parts.map((seg, idx) =>
      typeof seg === 'string'
        ? seg
        : <mark key={`${seg.item.id}-${idx}`} className={`mokuji-hl mokuji-hl-${seg.item.color}`} title={seg.item.note ? `📝 ${seg.item.note}` : '点击编辑划线笔记'} onClick={e => {
            e.stopPropagation();
            setSelDraft(null);
            setActiveHl(seg.item);
            setHlNoteDraft(seg.item.note || '');
            setHlNoteMode(true);
          }}>{seg.text}</mark>
    );
  }
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      if(e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase()==='v'){
        e.preventDefault();
        setRevealReal(v=>!v);
      }
    };
    window.addEventListener('keydown',onKey);
    return ()=>window.removeEventListener('keydown',onKey);
  },[]);
  const marks=useReaderBookmarks(id,index!==null || settingsOpen);
  const recordedOpen=useRef(false);
  const coverPosition = useRef<{top:number;chapter:number;appearance:ReaderAppearance;surface:ReaderSurface;size:number;workHints:WorkHints}|null>(null);
  const workspace = appearance !== 'normal';
  useLayoutEffect(()=>{
    const enterWorkspace=()=>{
      if (location.hash===workspaceFragment(id)) setAppearance(previous=>previous==='normal'?defaultWorkspaceMode():previous);
    };
    window.addEventListener('hashchange',enterWorkspace);
    return ()=>window.removeEventListener('hashchange',enterWorkspace);
  },[id]);
  useLayoutEffect(()=>{saveAppearance(appearance);},[appearance]);
  useLayoutEffect(()=>{syncReaderAddress(id,workspace);},[id,workspace]);
  useEffect(()=>{
    const activeTheme: UiTheme = workspace
      ? (shellTheme === 'dark' || paperTheme === 'dark' ? 'dark' : 'light')
      : (paperTheme === 'dark' ? 'dark' : readAppTheme());
    syncNativeStatusBar(activeTheme);
    return () => { syncNativeStatusBar(readAppTheme()); };
  },[workspace, shellTheme, paperTheme]);
  const size=preferredSize ?? (workspace ? 16 : 20);
  useLayoutEffect(()=>{
    if (!workspace) return;
    document.body.classList.add('duji-workspace-active');
    return () => document.body.classList.remove('duji-workspace-active');
  },[workspace]);
  const [paragraph,setParagraph] = useState(0);
  const [retry,setRetry] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const manual = useRef(false);
  const visible = useRef<OpenText | null>(null);
  const saved = useRef<ReadingMark | null>(null);
  const pending = useRef<Position | null>(null);
  const latestConflict = useRef<ReadingMark | null>(null);
  const writing = useRef<Promise<boolean> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chapterRequest = useRef<AbortController | null>(null);
  const navLock = useRef(false);

  const flush = useCallback((): Promise<boolean> => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current=null; }
    if (writing.current) return writing.current;
    if (latestConflict.current) return Promise.resolve(false);
    if (!pending.current || !saved.current) return Promise.resolve(true);
    const write = async () => {
      while (pending.current && saved.current) {
        const next = pending.current;
        if (same(next,saved.current)) { pending.current=null; continue; }
        try {
          const response = await readerPost<{progress:ReadingMark}>('progress',{id,...next,revision:saved.current.revision},true);
          saved.current=response.progress;
          if (same(pending.current,next)) pending.current=null;
          if (alive.current) setSaveError('');
        } catch (failure) {
          if (failure instanceof ReaderError && failure.status===409 && failure.progress) {
            latestConflict.current=failure.progress;
            if (alive.current) {setConflict(failure.progress);setSaveError('');}
          } else if (alive.current) setSaveError(errorText(failure));
          return false;
        }
      }
      return true;
    };
    const job=write().finally(()=>{ if(writing.current===job) writing.current=null; });
    writing.current=job;
    return job;
  },[id]);

  const remember = useCallback((position:Position) => {
    if (latestConflict.current) return;
    pending.current=position;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current=setTimeout(()=>{void flush();},450);
  },[flush]);

  const readChapter = useCallback(async (n:number,start:number,fromUser:boolean,bookUrl?:string) => {
    chapterRequest.current?.abort();
    const controller=new AbortController(); chapterRequest.current=controller;
    manual.current=false; visible.current=null;
    setLoading(true);setOpen(null);setChapter(n);setError('');setSourceUrl(bookUrl || '');
    try {
      const text=await readerRequest<ChapterText>('chapter?id='+encodeURIComponent(id)+'&n='+n,{signal:controller.signal});
      if (controller.signal.aborted) return;
      if (!Array.isArray(text.paragraphs) || (!text.paragraphs.length && !text.images?.some(group=>group.items.length))) {
        setError('这一章暂时没有可显示的正文。');setSourceUrl(text.sourceUrl || bookUrl || '');return;
      }
      const index=Math.max(0,Math.min(start,chapterUnits(text)-1));
      rememberOpened(id);
      if(!recordedOpen.current){
        recordedOpen.current=true;
        void readerPost('cotex-open',{id}).catch(()=>{recordedOpen.current=false;});
      }
      setOpen({text,start:index});setParagraph(index);
      if (fromUser) { remember({chapter:n,paragraph:index}); void flush(); }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(errorText(failure));
        setSourceUrl((failure instanceof ReaderError && failure.sourceUrl) || bookUrl || '');
      }
    } finally { if (!controller.signal.aborted) setLoading(false); }
  },[id,remember,flush]);

  useEffect(()=>{
    const controller=new AbortController();
    alive.current=true;
    readerRequest<BookDetail>('book?id='+encodeURIComponent(id),{signal:controller.signal}).then(result=>{
      if (controller.signal.aborted) return;
      setDetail(result);saved.current=result.book.progress;
      if (!result.chapters.length) {
        setError('这本书目前没有可打开的章节。');setSourceUrl(result.book.sourceUrl || '');setLoading(false);return;
      }
      const mark=result.book.progress;
      const savedChapter=result.chapters.find(c=>c.n===mark.chapter);
      const firstCached=!mark.updatedAt && mark.chapter===0 && mark.paragraph===0 && !savedChapter?.available ? result.chapters.find(c=>c.available) : null;
      const n=firstCached?.n ?? savedChapter?.n ?? result.chapters[0].n;
      void readChapter(n,n===mark.chapter ? mark.paragraph : 0,false,result.chapters.find(c=>c.n===n)?.sourceUrl||result.book.sourceUrl);
    }).catch(failure=>{if(!controller.signal.aborted){setError(errorText(failure));setLoading(false);}});
    const leave=()=>{void flush();};
    const hidden=()=>{if(document.visibilityState==='hidden')leave();};
    document.addEventListener('visibilitychange',hidden);
    window.addEventListener('pagehide',leave);
    return ()=>{
      alive.current=false;controller.abort();chapterRequest.current?.abort();
      document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leave);leave();
    };
  },[id,retry,readChapter,flush]);

  useLayoutEffect(()=>{
    visible.current=open;manual.current=false;
    if(!open || !viewport.current) return;
    const container=viewport.current, target=container.querySelector<HTMLElement>('[data-p="'+open.start+'"]');
    if(open.start===0) container.scrollTop=0;
    else if(target) container.scrollTop+=target.getBoundingClientRect().top-container.getBoundingClientRect().top-16;
  },[open]);

  useEffect(()=>{
    if(!open || open.text.n + 1 >= open.text.chapterCount) return;
    const nextN = open.text.n + 1;
    const nextInfo = detail?.chapters.find(c => c.n === nextN);
    if (nextInfo && nextInfo.access === 'locked') return;
    const timer = setTimeout(() => {
      void readerRequest('chapter?id='+encodeURIComponent(id)+'&n='+nextN).catch(()=>{});
    }, 1200);
    return () => clearTimeout(timer);
  },[id, open?.text.n, open?.text.chapterCount, detail]);

  function currentParagraph() {
    if (!viewport.current || !visible.current || !manual.current || latestConflict.current) return;
    const box=viewport.current;
    const lines=box.querySelectorAll<HTMLElement>('[data-p]');
    if (!lines.length) return;
    const line=box.getBoundingClientRect().top+18;
    let lo=0,hi=lines.length;
    while(lo<hi) {const mid=(lo+hi)>>>1;if(lines[mid].getBoundingClientRect().top<=line)lo=mid+1;else hi=mid;}
    const atEnd=box.scrollTop>1 && box.scrollHeight-box.clientHeight-box.scrollTop<2;
    const index=atEnd ? lines.length-1 : Math.max(0,lo-1);
    setParagraph(index);remember({chapter:visible.current.text.n,paragraph:index});
  }

  async function changeChapter(n:number, force=false, start?:number) {
    if (!detail || navLock.current || latestConflict.current || !detail.chapters.some(item=>item.n===n) || (!force && n===chapter)) return;
    navLock.current=true;
    try {
      currentParagraph();
      if (!await flush() || !alive.current) return;
      await readChapter(n,start ?? (force && saved.current?.chapter===n ? saved.current.paragraph : 0),true,detail.chapters.find(c=>c.n===n)?.sourceUrl || detail.book.sourceUrl);
    } finally {navLock.current=false;}
  }
  async function leaveBook(action:()=>void) {
    if(navLock.current)return false;
    navLock.current=true;
    try {
      currentParagraph();
      if ((!latestConflict.current && !await flush()) || !alive.current)return false;
      action();
      return true;
    } finally {navLock.current=false;}
  }
  function back(){return leaveBook(onBack);}
  async function useOtherPosition() {
    const position=latestConflict.current;
    if (!detail || !position || navLock.current) return;
    navLock.current=true;
    try {
      pending.current=null; saved.current=position; latestConflict.current=null;
      setConflict(null);setSaveError('');
      await readChapter(position.chapter,position.paragraph,false,detail.chapters.find(c=>c.n===position.chapter)?.sourceUrl || detail.book.sourceUrl);
    } finally {navLock.current=false;}
  }
  function changeAppearance(value:ReaderAppearance) {
    if (value === appearance) return;
    manual.current=false;
    setAppearance(value);
    if (value==='normal') { setSettingsOpen(false);setSummaryOpen(false);coverPosition.current=null; }
    if (open) setOpen({...open,start:paragraph});
  }
  function changeWorkHints(next:WorkHints){
    manual.current=false;setWorkHints(next);saveWorkHints(next);
    if(open)setOpen({...open,start:paragraph});
  }
  function resize(value:number) {
    const index=paragraph;
    manual.current=false;setSize(value);
    try {localStorage.setItem('duji.reader.font',String(value));} catch {}
    if(open) setOpen({...open,start:index});
  }
  const chapters=detail?.chapters || [];
  const at=chapters.findIndex(item=>item.n===chapter);
  const disabled=loading || !!conflict;
  const imagesByParagraph=useMemo(()=>new Map((open?.text.images||[]).map(g=>[g.paragraph,g])),[open?.text.images]);
  // Import only existing browser-local fold markers for groups present in this chapter.
  // A successful transfer retires the old marker so a later native unfold stays authoritative.
  useEffect(()=>{
    if(!open?.text.images?.length||!marks.loaded)return;
    let active=true;
    const text=open.text;
    void (async()=>{
      for(const group of text.images||[]){
        if(!active)return;
        const key='mokuji.media.closed.'+id+':'+text.n+':'+group.paragraph;
        let legacy=false;try{legacy=localStorage.getItem(key)==='1';}catch{}
        if(legacy && await marks.fold({chapter:text.n,paragraph:group.paragraph},true)){
          try{localStorage.removeItem(key);}catch{}
        }
      }
    })();
    return ()=>{active=false;};
  },[open?.text,id,marks.loaded,marks.fold]);
  const mediaState={ready:marks.loaded,busy:marks.busy,onFold:marks.fold};
  const unitCount=open ? chapterUnits(open.text) : 0;
  function goToPoint(point:BookPoint){
    if(disabled)return;
    setIndex(null);setSettingsOpen(false);setSummaryOpen(false);coverPosition.current=null;
    if(point.chapter!==chapter){void changeChapter(point.chapter,false,point.paragraph);return;}
    if(!open){void changeChapter(chapter,true,point.paragraph);return;}
    const n=Math.min(Math.max(0,point.paragraph),Math.max(0,unitCount-1));
    manual.current=false;setParagraph(n);setOpen({...open,start:n});
    remember({chapter,paragraph:n});void flush();
  }
  const chapterTitle=open?.text.title || chapters[at]?.title || '第 '+(chapter+1)+' 章';
  const bookTitle=detail?.book.title || '';
  const aliasedChapters=useMemo(()=>detail?.chapters.map(c=>({
    n:c.n,
    available:c.available||externalUrl(c.sourceUrl),
    title:taskAlias(c.n),
    realTitle:c.title || '第 '+(c.n+1)+' 章',
  })) || [],[detail]);
  const workTitle=useMemo(()=>projectAlias(id,detail?.book.workAlias,detail ? [
    detail.book.title,detail.book.originalTitle,detail.book.author,...(detail.book.aliases || []),...detail.chapters.map(c=>c.title)
  ] : []),[id,detail]);
  const workspaces=useWorkspaces(id,detail?.book,workTitle,workspace,
    target=>target===id?Promise.resolve(true):leaveBook(()=>onSwitchBook(target)),
    alias=>setDetail(previous=>previous?{...previous,book:{...previous.book,workAlias:alias}}:previous));
  const modeLabel=readerModes.find(item=>item.value===appearance)!.label;

  useLayoutEffect(()=>{
    if (!workspace) return;
    setTabAppearance(modeLabel);
    return ()=>setTabAppearance();
  },[workspace,modeLabel]);

  const toggleSummary=useCallback(()=>{
    manual.current=false;
    if (!summaryOpen) {
      coverPosition.current={top:viewport.current?.scrollTop || 0,chapter,appearance,surface,size,workHints};
      setSettingsOpen(false);
      setRevealReal(false);
    }
    setSummaryOpen(!summaryOpen);
  },[summaryOpen,chapter,appearance,surface,size,workHints]);

  useLayoutEffect(()=>{
    if (summaryOpen || !coverPosition.current) return;
    const before=coverPosition.current;
    coverPosition.current=null;
    const node=viewport.current;
    if (!node || before.chapter!==chapter) return;
    manual.current=false;
    if (before.appearance===appearance && before.surface===surface && before.size===size && before.workHints===workHints) node.scrollTop=before.top;
    else {
      const anchor=node.querySelector<HTMLElement>('[data-p="'+paragraph+'"]');
      if (anchor && paragraph>0) node.scrollTop+=anchor.getBoundingClientRect().top-node.getBoundingClientRect().top-16;
    }
  },[summaryOpen,chapter,appearance,surface,size,paragraph,workHints]);

  function searchRecords(query=''){
    setSummaryOpen(false);setSettingsOpen(false);
    const hits=query.trim()?findReaderChapters(chapters,query):[];
    if(hits.length===1)goToPoint({chapter:hits[0].n,paragraph:0});
    else setIndex({tab:'search',query});
  }
  function stepChapter(direction:1|-1,start=0){
    const dest=chapters[at+direction];
    if(dest)void changeChapter(dest.n,false,start);
  }
  function stepParagraph(direction:1|-1){
    if(!open||disabled)return;
    const next=paragraph+direction;
    if(next>=0&&next<unitCount)goToPoint({chapter,paragraph:next});
    else stepChapter(direction,direction===1?0:Number.MAX_SAFE_INTEGER);
  }
  function pageBy(direction:1|-1){
    const box=viewport.current;
    if(!box||!open||disabled)return;
    const beyond=direction===1
      ? box.scrollHeight-box.scrollTop-box.clientHeight<3
      : box.scrollTop<2;
    if(beyond){stepChapter(direction,direction===1?0:Number.MAX_SAFE_INTEGER);return;}
    manual.current=true;box.scrollBy({top:direction*Math.max(48,box.clientHeight-48),behavior:'auto'});
  }
  useReaderShortcuts({workspace,paused:settingsOpen||!!index,summary:summaryOpen,available:!!open&&!disabled,
    settings:()=>setSettingsOpen(true),toggleSummary,index:()=>searchRecords(),bookmark:()=>void marks.change({chapter,paragraph}),
    changeChapter:stepChapter,step:stepParagraph,page:pageBy});

  function changeSurface(value:ReaderSurface) {
    if (surface===value) return;
    manual.current=false;
    setSurface(value);saveSurface(value);
    if (open) setOpen({...open,start:paragraph});
  }

  const picker=<label className="duji-appearance-picker">阅读界面<select aria-label="阅读界面" value={appearance} onChange={event=>changeAppearance(event.target.value as ReaderAppearance)}>
    {readerModes.map(mode=><option key={mode.value} value={mode.value}>{mode.label}</option>)}
  </select></label>;
  const chapterTools = detail && (!workspace || settingsOpen) && <div className="duji-reader-controls">
    {chapters.length>0 && <label>目录<select aria-label="选择章节" value={chapter} disabled={disabled} onChange={event=>void changeChapter(Number(event.target.value))}>
      {chapters.map(item=><option value={item.n} key={item.n}>{item.title || '第 '+(item.n+1)+' 章'}{item.available?'':'（暂无正文）'}</option>)}
    </select></label>}
    <label>字号<select aria-label="正文字号" value={size} onChange={event=>resize(Number(event.target.value))}>{sizes.map(value=><option key={value} value={value}>{value}px</option>)}</select></label>
  </div>;
  const navigation=at>=0 && <nav className="duji-reader-nav" aria-label="逐章阅读">
    <button className="button button-outline" type="button" disabled={disabled || at===0} onClick={()=>void changeChapter(chapters[at-1].n)}><ChevronLeft size={15}/>上一章</button>
    <button className="button button-sage" type="button" disabled={disabled || at===chapters.length-1} onClick={()=>void changeChapter(chapters[at+1].n)}>下一章<ChevronRight size={15}/></button>
  </nav>;
  const attribution=open && (open.text.source || open.text.credits || open.text.license || externalUrl(open.text.sourceUrl)) && <footer className="duji-reader-credit">
          {externalUrl(open.text.sourceUrl) ? <a href={open.text.sourceUrl} target="_blank" rel="noreferrer">{open.text.source || '原文来源'} <ExternalLink size={12}/></a> : open.text.source && <span>{open.text.source}</span>}
          {open.text.credits && <span>{open.text.credits}</span>}
          {externalUrl(open.text.licenseUrl) ? <a href={open.text.licenseUrl} target="_blank" rel="noreferrer">{open.text.license || '使用许可'} <ExternalLink size={12}/></a> : open.text.license && <span>{open.text.license}</span>}
        </footer>;
  const notices=<>
    {conflict && <div className="duji-reader-message" role="alert"><p>另一端已更新到{readingPosition(conflict)}。</p>
      <button type="button" className="button button-sage" onClick={()=>void useOtherPosition()}>采用另一端的位置</button></div>}
    {saveError && <div className="duji-reader-message" role="alert"><p>阅读位置尚未保存。{saveError}</p>
      <button type="button" className="button button-outline" onClick={()=>void flush()}>重试保存</button></div>}
    {loading && <p className="duji-reader-state" role="status">正在读取正文…</p>}
    {!loading && error && <div className="duji-reader-message" role="alert"><p>{error}</p>
      {externalUrl(sourceUrl) && <a className="button button-sage" href={sourceUrl} target="_blank" rel="noreferrer">前往来源网站<ExternalLink size={13}/></a>}
      <button type="button" className="button button-outline" onClick={()=>{if(detail && at>=0) void changeChapter(chapter,true);else{setLoading(true);setError('');setRetry(v=>v+1);}}}>重新读取</button></div>}
  </>;
  const content=<>
    {workspace && !summaryOpen && (saveError || conflict || error) ?
      <button type="button" className="mokuji-work-status" onClick={()=>setSettingsOpen(true)}>查看同步状态</button>
      : !workspace && notices}
    {workspace && !summaryOpen && loading && <p className="mokuji-work-status" role="status">正在载入工作区…</p>}
    {open && <div className={'duji-reader-sheet'+(workspace?' mokuji-shell-text':'')} ref={viewport} hidden={workspace && summaryOpen} inert={workspace && summaryOpen} tabIndex={0} role="region" aria-label={workspace?"工作记录正文":"章节正文"}
      onScroll={currentParagraph} onWheel={()=>{manual.current=true;}}
      onTouchStart={e=>{
        manual.current=true;
        if(!workspace && e.touches.length===1) normalSwipe.current={x:e.touches[0].clientX,y:e.touches[0].clientY,t:Date.now()};
      }}
      onPointerDown={()=>{manual.current=true;}} onMouseUp={captureTextSelection}
      onTouchEnd={e=>{
        setTimeout(captureTextSelection, 60);
        if(!workspace && normalSwipe.current && e.changedTouches.length===1 && !disabled){
          const s=normalSwipe.current; normalSwipe.current=null;
          const sel=window.getSelection?.()?.toString()?.trim();
          const dx=e.changedTouches[0].clientX-s.x, dy=e.changedTouches[0].clientY-s.y;
          if(!sel && Date.now()-s.t<550 && Math.abs(dx)>72 && Math.abs(dx)>Math.abs(dy)*1.6){
            if(dx<0 && at>=0 && at+1<chapters.length) void changeChapter(chapters[at+1].n);
            else if(dx>0 && at>0) void changeChapter(chapters[at-1].n);
          }
        } else {
          normalSwipe.current=null;
        }
      }}
      onKeyDown={event=>{if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(event.key))manual.current=true;}}>
      <article style={{fontSize:size, lineHeight}}><CotexSourceFont fonts={open.text.sourceFonts} sourceUrl={open.text.sourceUrl}/>{workspace && <ReaderLede/>}
        {!workspace && <header className="duji-chapter-heading"><h2>{chapterTitle}</h2></header>}
        {open.text.paragraphs.map((text,i)=><Fragment key={chapter+':'+i}>{imagesByParagraph.has(i)&&<ReaderMedia bookId={id} chapter={chapter} group={imagesByParagraph.get(i)!} {...mediaState} remoteClosed={marks.collapsedImages.includes(chapter+':'+i)} media={open.text.media} workspace={workspace}/>}<div data-line={i+1} className={'duji-reader-paragraph'+(paragraph===i?' marked':'')}>
          <p data-p={i}>{renderParaText(text, i)}</p>
          {!workspace && <button type="button" className="duji-reader-bookmark" aria-label={'记到第 '+(i+1)+' 段'} title={'记到第 '+(i+1)+' 段'}
            aria-pressed={marks.marks.some(point=>point.chapter===chapter&&point.paragraph===i)} disabled={!!conflict||marks.busy} onClick={()=>{
              manual.current=false;setParagraph(i);remember({chapter:open.text.n,paragraph:i});void flush().then(ok=>{if(ok)void marks.change({chapter:open.text.n,paragraph:i});});
            }}><Bookmark size={15} fill={marks.marks.some(point=>point.chapter===chapter&&point.paragraph===i)?'currentColor':'none'}/></button>}
        </div>{appearance!=='normal' && showWorkEvent(appearance,surface,chapter,i,workHints) &&
          <ReaderWorkEvent product={appearance} chapter={chapter} paragraph={i}/>}</Fragment>)}
        {imagesByParagraph.has(open.text.paragraphs.length)&&<ReaderMedia key={chapter+':tail'} bookId={id} chapter={chapter} group={imagesByParagraph.get(open.text.paragraphs.length)!} {...mediaState} remoteClosed={marks.collapsedImages.includes(chapter+':'+open.text.paragraphs.length)} media={open.text.media} workspace={workspace} comicMode={!workspace && open.text.paragraphs.length===0} anchor={open.text.paragraphs.length}/>}
        {workspace && <ReaderTail/>}
        {!workspace && attribution}
      </article>
    </div>}
  </>;

  const indexUI=<>
    {index&&<ReaderRecordIndex bookId={id} bookTitle={bookTitle} chapters={chapters} marks={marks.marks} highlights={hl.highlights} current={{chapter,paragraph}} workspace={workspace} tab={index.tab} initialQuery={index.query} busy={marks.busy} loading={disabled}
      onGo={goToPoint} onClose={()=>setIndex(null)} onRemove={p=>void marks.change(p,'remove')} onMark={()=>{if(open)void marks.change({chapter,paragraph});}} onSaveNote={marks.setNote} onUpdateHighlightNote={hl.updateHighlightNote} onRemoveHighlight={hl.removeHighlight}/>}
    {(selDraft || activeHl) && <div className="mokuji-sel-bar" role="dialog" aria-label="划线笔记工具条">
      {selDraft && !hlNoteMode && <>
        {(['yellow','purple','green'] as HighlightColor[]).map(c=><button key={c} type="button" className={`mokuji-sel-dot is-${c}`} aria-label={`划线(${c})`} onClick={()=>{
          hl.addHighlight({ ...selDraft, color: c });
          setCopyNote('已添加划线高亮');
          setSelDraft(null);
          window.getSelection?.()?.removeAllRanges();
        }}/>)}
        <button type="button" className="mokuji-sel-btn" onClick={()=>setHlNoteMode(true)}>记笔记</button>
        <button type="button" className="mokuji-sel-btn" onClick={()=>{
          void navigator.clipboard?.writeText(selDraft.quote).catch(()=>{});
          setCopyNote('已复制选中片段');
          setSelDraft(null);
        }}>复制</button>
      </>}
      {hlNoteMode && (selDraft || activeHl) && <form style={{display:'flex',alignItems:'center',gap:6}} onSubmit={e=>{
        e.preventDefault();
        if (activeHl) {
          hl.updateHighlightNote(activeHl.id, hlNoteDraft);
          setCopyNote('已更新划线笔记');
          setActiveHl(null);
        } else if (selDraft) {
          hl.addHighlight({ ...selDraft, color: 'yellow', note: hlNoteDraft });
          setCopyNote('已保存划线与笔记');
          setSelDraft(null);
          window.getSelection?.()?.removeAllRanges();
        }
        setHlNoteMode(false);
        setHlNoteDraft('');
      }}>
        <input value={hlNoteDraft} onChange={e=>setHlNoteDraft(e.target.value)} placeholder="写下划线笔记…" autoFocus/>
        <button type="submit" className="mokuji-sel-btn" style={{background:'#5e6ad2',color:'#fff'}}>保存</button>
        {activeHl && <button type="button" className="mokuji-sel-btn" onClick={()=>{hl.removeHighlight(activeHl.id);setActiveHl(null);setHlNoteMode(false);setCopyNote('已删除划线');}}>删除</button>}
      </form>}
      <button type="button" className="mokuji-sel-btn" aria-label="关闭划线条" onClick={()=>{setSelDraft(null);setActiveHl(null);setHlNoteMode(false);}}>✕</button>
    </div>}
    {marks.message&&<div className="mokuji-mark-toast" role="status">{marks.message}</div>}
  </>;
  const indexActions=<div className="mokuji-reader-actions"><button type="button" className="button button-outline" disabled={!detail} onClick={()=>{setSettingsOpen(false);setIndex({tab:'search',query:''});}}>搜索章节</button>
    <button type="button" className="button button-outline" disabled={!detail} onClick={()=>{setSettingsOpen(false);setIndex({tab:'marks',query:''});}}>我的书签</button>
    <button type="button" className="button button-outline" disabled={!detail} onClick={()=>{setSettingsOpen(false);setIndex({tab:'highlights',query:''});}}>划线笔记 ({hl.highlights.length})</button>
    <button type="button" className="button button-outline" disabled={!open||disabled||marks.busy} onClick={()=>void marks.change({chapter,paragraph})}>切换当前位置书签</button></div>;
  function changeShellTheme(value: UiTheme) {
    setShellTheme(value);
    saveShellTheme(value);
  }
  function changePaperTheme(value: ReaderPaperTheme) {
    setPaperTheme(value);
    savePaperTheme(value);
  }
  function changeLineHeight(value: number) {
    setLineHeight(value);
    saveLineHeight(value);
  }
  const bookmarked = marks.marks.some(point => point.chapter === chapter && point.paragraph === paragraph);
  const progressPercent = chapters.length
    ? Math.min(100, Math.max(0, ((Math.max(0, at) + (paragraph + 1) / Math.max(1, unitCount)) / chapters.length) * 100))
    : 0;
  function copyCurrentChapter() {
    if (!open?.text.paragraphs.length) return;
    const text = chapterTitle + '\n\n' + open.text.paragraphs.join('\n\n');
    void navigator.clipboard.writeText(text)
      .then(() => setCopyNote('已复制当前工作记录'))
      .catch(() => setCopyNote('复制失败，请检查剪贴板权限'));
  }

  if (appearance==='normal') return <section className="duji-reader" data-appearance="normal" data-paper={paperTheme} aria-label="正文阅读">
    <div className="duji-reader-top">
      <button type="button" className="button button-outline" onClick={()=>void back()}><ArrowLeft size={15}/>返回</button>
      <div className="duji-reader-heading"><h1>{bookTitle || '正文阅读'}</h1>{detail?.book.author && <p>{detail.book.author}</p>}</div>
      {picker}
    </div>
    {chapterTools}
    <div className="duji-reader-quickbar">
      <button type="button" className="button button-outline" disabled={!detail} onClick={()=>{setSettingsOpen(false);setIndex({tab:'search',query:''});}}><List size={14}/>目录/搜正文</button>
      <button type="button" className="button button-outline" disabled={!detail} onClick={()=>{setSettingsOpen(false);setIndex({tab:'highlights',query:''});}}><Search size={14}/>笔记 ({marks.marks.length + hl.highlights.length})</button>
      <button type="button" className="button button-outline" aria-pressed={normalTypoOpen} onClick={()=>setNormalTypoOpen(v=>!v)}><Type size={14}/>排版护眼</button>
      <button type="button" className="button button-outline" disabled={!open||disabled||marks.busy} onClick={()=>void marks.change({chapter,paragraph})}><Bookmark size={14} fill={bookmarked?'currentColor':'none'}/>{bookmarked?'已标记':'记书签'}</button>
    </div>
    {normalTypoOpen && <div className="duji-normal-typo" role="region" aria-label="纸张与排版设置">
      <div className="duji-typo-group">
        <span>纸张</span>
        {([['default','默认'],['sepia','暖纸'],['green','护眼绿'],['dark','暗夜']] as const).map(([val,label])=>(
          <button key={val} type="button" className={'duji-paper-btn is-'+val+(paperTheme===val?' active':'')} aria-pressed={paperTheme===val} onClick={()=>changePaperTheme(val)}>{label}</button>
        ))}
      </div>
      <div className="duji-typo-group">
        <span>行距</span>
        {([[1.6,'紧凑'],[1.85,'舒适'],[2.15,'宽松']] as const).map(([val,label])=>(
          <button key={val} type="button" className={'duji-lh-btn'+(Math.abs(lineHeight-val)<0.05?' active':'')} aria-pressed={Math.abs(lineHeight-val)<0.05} onClick={()=>changeLineHeight(val)}>{label}</button>
        ))}
      </div>
    </div>}
    {content}
    {indexUI}
    {open && <div className="duji-reader-position"><span>第 {chapter+1}/{chapters.length} 章 · {progressPercent.toFixed(0)}% · 第 {paragraph+1}/{unitCount} 段</span><span>左右滑切章 · 选字可划线记笔记</span></div>}
    {navigation}
  </section>;

  const Shell=(appearance==='notes'||appearance==='feishu')?MobileDocsShell:
    (appearance==='codex'||appearance==='claude')?AgentShell:
    (appearance==='antigravity'||appearance==='vscode')?EditorShell:BuddyShell;
  return <section className={'mokuji-immersive' + (revealReal && !summaryOpen ? ' mk-reveal-all' : '')} data-work-hints={workHints.enabled?'on':'off'} data-appearance={appearance} data-surface={surface} data-shell-theme={shellTheme} aria-label={modeLabel}
    onDragOver={event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();}}
    onDrop={event=>{if(event.dataTransfer.files.length){event.preventDefault();void workspaces.importFiles(Array.from(event.dataTransfer.files));}}}>
    <Suspense fallback={<div className="duji-reader-state">正在载入工作区…</div>}><Shell product={appearance} surface={surface} shellTheme={shellTheme} onShellTheme={changeShellTheme} bookTitle={workTitle} realBookTitle={bookTitle} author="工作组" chapterTitle={taskAlias(chapter)} realChapterTitle={chapterTitle} revealReal={revealReal} onToggleReveal={()=>setRevealReal(v=>!v)}
      projects={workspaces.sidebar} onProjects={workspaces.show} onProject={target=>void workspaces.select(target)} onImportFiles={workspaces.chooseFiles}
      onFindRecord={searchRecords} onToggleSummary={toggleSummary} summaryOpen={summaryOpen} chapters={aliasedChapters} chapter={chapter} paragraph={paragraph} paragraphCount={unitCount} disabled={disabled}
      onChapter={n=>{if (summaryOpen) toggleSummary();void changeChapter(n);}} onSettings={()=>setSettingsOpen(true)} onBack={()=>void back()}
      fontSize={size} onFontSize={resize} paperTheme={paperTheme} onPaperTheme={changePaperTheme} lineHeight={lineHeight} onLineHeight={changeLineHeight} workHints={workHints} onWorkHints={changeWorkHints}
      onSwitchAppearance={(next, nextSurface)=>{
        changeAppearance(next);
        if(nextSurface) changeSurface(nextSurface);
        if(next!=='normal') {
          try { if (!localStorage.getItem('mokuji.reader.shellTheme')) setShellTheme(defaultShellTheme(next, nextSurface ?? surface)); } catch {}
        }
      }}
      bookmarked={bookmarked} bookmarks={marks.marks} onBookmark={()=>void marks.change({chapter,paragraph})}
      onOpenBookmarks={()=>{setSummaryOpen(false);setSettingsOpen(false);setIndex({tab:'marks',query:''});}}
      onJumpPoint={goToPoint} onCopyChapter={copyCurrentChapter} onNextPage={()=>pageBy(1)}
      onRenameProject={workspaces.renameById} progressPercent={progressPercent}>
      {content}
      {summaryOpen && <div className="mokuji-work-summary-host"><ReaderWorkSummary seed={chapter} onResume={toggleSummary}/></div>}
    </Shell></Suspense>
    {workspaces.controls}
    {indexUI}
    {copyNote && !marks.message && <div className="mokuji-mark-toast" role="status">{copyNote}</div>}
    {settingsOpen && <ReaderSettings onClose={()=>setSettingsOpen(false)}>
      <p className="mokuji-settings-book">{bookTitle}{open && <><br/>{chapterTitle} · 第 {paragraph+1} / {unitCount} 段</>}</p>
      <div className="mokuji-settings-pickers">{picker}
        <label>模拟外观<select aria-label="模拟外观" value={surface} onChange={event=>changeSurface(event.target.value as ReaderSurface)}>
          <option value="web">网页版</option><option value="desktop">桌面客户端</option>
        </select></label>
        <label>明暗主题<select aria-label="明暗主题" value={shellTheme} onChange={event=>changeShellTheme(event.target.value as UiTheme)}>
          <option value="light">浅色</option><option value="dark">深色</option>
        </select></label>
      </div>
      {notices}
      {indexActions}
      {chapterTools}
      {supportsWorkHints(appearance,surface)&&<WorkHintSettings value={workHints} onChange={changeWorkHints}/>}
      {open && <form key={chapter+':'+paragraph} className="mokuji-paragraph-jump" onSubmit={event=>{
        event.preventDefault();
        const target=Number(new FormData(event.currentTarget).get('paragraph'))-1;
        if (conflict || !Number.isInteger(target) || target<0 || target>=unitCount) return;
        manual.current=false;setParagraph(target);setOpen({...open,start:target});
        remember({chapter:open.text.n,paragraph:target});void flush();setSettingsOpen(false);
      }}>
        <label>段落书签<input name="paragraph" aria-label="段落书签" type="number" inputMode="numeric" min={1} max={unitCount} required defaultValue={paragraph+1}/></label>
        <button className="button button-outline" type="submit" disabled={!!conflict}>定位并记住</button>
      </form>}
      {navigation}
      {attribution}
      <button type="button" className="button button-outline mokuji-settings-cover" onClick={()=>{setSettingsOpen(false);toggleSummary();}}>{summaryOpen?'恢复工作视图':'显示工作摘要'}</button>
      <div className="mokuji-settings-bottom">
        <button className="button button-outline" type="button" onClick={()=>void back()}><ArrowLeft size={14}/>返回书库</button>
        <button className="button button-sage" type="button" onClick={()=>setSettingsOpen(false)}>继续阅读</button>
      </div>
      <small>↑ / ↓ 逐段移动，PageUp / PageDown 翻页，Alt + ← / → 切章。Ctrl + F 搜索章节，Ctrl + D 切换书签。空格切换工作摘要，Esc 或 Alt + , 打开设置。</small>
    </ReaderSettings>}
  </section>;
}
