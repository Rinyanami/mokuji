"use client";
import {useState,useEffect,useRef,useMemo,type FormEvent,type ReactNode,type CSSProperties} from 'react';
import {BookOpen,Search,Plus,ArrowUpRight,ChevronRight,Bookmark,MessageCircle,Star,X,Check,PenLine,Clock3,Upload,Download,Leaf,Undo2,LockKeyhole,Trash2,ExternalLink,CheckCircle2,AlertCircle,Sun,Moon,FolderPlus,Globe,Sparkles,LayoutGrid,List,ListChecks,SlidersHorizontal,Tag,ArrowUp,ArrowDown,Briefcase,Home as HomeIcon,Library,Compass,User,ArrowLeft} from 'lucide-react';
import './mobile-linear.css';
import {categories,statuses,units,defaultTaxonomy,progressLabel,type Book,type Category,type Entry,type Post,type ReadingStatus,type ProgressUnit,type Snapshot,type Review,type ShelfTaxonomy} from '@/lib/types';
import { getLocalEngineMode, subscribeLocalEngineMode } from '@/lib/local-first-engine';
import BangumiCatalog from './bangumi-catalog';
import MobileConnection from './mobile-connection';
import ReaderHub from './reader-hub';
import ReaderView from './reader-view';
import ResumeWorkspace from './resume-workspace';
import SyncPanel from './sync-panel';
import { readAppearance, readAppTheme, saveAppTheme, type UiTheme } from './reader-appearance';
import { workspaceBookId, workspaceFragment } from './work-route';
import { PlatformButtons } from './catalog-sources';
import { useConnection } from './connection-mode';
import { onDesktop, readerPost, readerRequest, readingPosition, type ShelfInput, type ReaderIndex } from './reading-client';
import { importBookFile, readerFileAccept } from './reader-file-import';
import { recentWorkspace } from './resume-workspace';
import { WorkSources, type SharedWork } from './catalog-sources';
import type { BangumiBook } from '@/lib/bangumi';


type ApiResult={snapshot?:Snapshot;error?:string};
type CollectionItem={id:string;name:string;description:string;workIds:string[];updatedAt:string};
type ShelfMetaState={collections:CollectionItem[];overrides:Record<string,Partial<Book>>;taxonomy?:ShelfTaxonomy};
type Page='webfiction'|'sources'|'read'|'workspace'|'body'|'mobile'|'home'|'shelf'|'discover'|'community'|'profile'|'book'|'post';
function currentRoute(): {page: Page; id: string} {
  const [name,...tail]=location.hash.replace(/^#\/?/,'').split('/');
  if(name==='workspace')return {page:'workspace',id:''};
  if (name==='work') {
    const id=workspaceBookId(tail.join('/'));
    return id ? {page:'body',id} : {page:'read',id:''};
  }
  const allowed=['home','shelf','discover','community','profile','book','post','webfiction','sources','read','body',...(onDesktop()?['mobile']:[])];
  const page=allowed.includes(name) ? name as Page : 'shelf';
  try { return {page,id:decodeURIComponent(tail.join('/'))}; } catch { return {page,id:''}; }
}
type Dialog={type:'resume';title:string;url:string}|{type:'progress'|'review'|'editBook';bookId:string}|{type:'collection';collection?:CollectionItem;bookId?:string}|{type:'taxonomy';tab:'categories'|'rating'|'tags'}|{type:'add'}|{type:'post';bookId?:string}|{type:'reply';postId:string}|{type:'import';backup:Record<string,unknown>;count:number}|{type:'confirm';title:string;body:string;action:string;payload:Record<string,unknown>}|null;
const nav=[{key:'shelf',title:'我的书架'},{key:'sources',title:'找书与嗅探'},{key:'read',title:'阅读'},{key:'profile',title:'个人主页'}] as const;
const dateText=(value:string)=>{const d=new Date(value);return !value||isNaN(d.getTime())?'':d.toLocaleDateString('zh-CN',{month:'short',day:'numeric',timeZone:'Asia/Shanghai'});};
const num=(value:FormDataEntryValue|null)=>value===null||String(value).trim()===''?null:Number(value);
const safeLink=(value:string|undefined)=>!!value&&/^https?:\/\//i.test(value);
function Cover({book,className=''}:{book:Book;className?:string}){const[failed,setFailed]=useState(false);return <div className={`book-cover ${className}`} style={{'--cover-color':book.color||'#677c77'} as CSSProperties}>{book.cover&&!failed?<img src={book.cover} alt={`${book.title}封面`} loading="lazy" onError={()=>setFailed(true)}/>:<div className="cover-fallback"><span>{book.category}</span><strong>{book.title}</strong><span>{book.author||'作者待补充'}</span></div>}</div>;}
function Heading({title,caption,action}:{title:string;caption?:string;action?:ReactNode}){return <div className="section-heading"><h2>{title}{caption&&<span>{caption}</span>}</h2>{action}</div>;}
function Empty({title,text,action}:{title:string;text:string;action?:ReactNode}){return <div className="empty-state"><BookOpen size={27}/><h3>{title}</h3><p>{text}</p>{action}</div>;}
function Corner(){return <div className="corner-panel"><div className="reading-corner" aria-hidden="true"><div className="corner-sun"/><div className="corner-cloud"/><div className="corner-book book-one"/><div className="corner-book book-two"/><div className="corner-book book-three"/><div className="corner-plant"><i/><i/><i/><i/><b/></div><div className="corner-shelf"/><span>ONE MORE PAGE</span></div><h3>阅读没有固定的步调。</h3><p>一页、一章，或是一个喜欢的段落。<br/>在这里，记下你的阅读日常。</p></div>;}
function Modal({title,subtitle,busy,onClose,children}:{title:string;subtitle?:string;busy:boolean;onClose:()=>void;children:ReactNode}){const ref=useRef<HTMLDivElement>(null);const closeRef=useRef(onClose);closeRef.current=onClose;const busyRef=useRef(busy);busyRef.current=busy;useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const old=document.body.style.overflow;document.body.style.overflow='hidden';ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busyRef.current)closeRef.current();if(e.key==='Tab'){const list=Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]')||[]).filter(n=>n.getClientRects().length);if(!list.length)return;if(e.shiftKey&&document.activeElement===list[0]){e.preventDefault();list.at(-1)?.focus();}if(!e.shiftKey&&document.activeElement===list.at(-1)){e.preventDefault();list[0].focus();}}};document.addEventListener('keydown',key);return()=>{document.body.style.overflow=old;document.removeEventListener('keydown',key);previous?.focus();};},[]);return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose();}}><div className="modal" ref={ref} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div><h2 id="modal-title">{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button className="icon-button" aria-label="关闭窗口" disabled={busy} onClick={onClose}><X size={20}/></button></div>{children}</div></div>;}
export default function ReaderApp({initial}:{initial:Snapshot}){
 const connection=useConnection();
 const [localEngineMode, setLocalEngineMode] = useState(getLocalEngineMode);
 useEffect(() => subscribeLocalEngineMode(setLocalEngineMode), []);
 const [initialRoute]=useState(currentRoute);
 const[data,setData]=useState(initial),[page,setPage]=useState<Page>(initialRoute.page),[id,setId]=useState(initialRoute.id),[dialog,setDialog]=useState<Dialog>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[unauthorized,setUnauthorized]=useState(false),[toast,setToast]=useState(''),[search,setSearch]=useState(''),[query,setQuery]=useState(''),[category,setCategory]=useState<Category|'全部'>('全部'),[status,setStatus]=useState<ReadingStatus|'全部'>('全部'),[tab,setTab]=useState('概览'),[communityTab,setCommunityTab]=useState('讨论');
 const [appTheme, setAppTheme] = useState<UiTheme>(readAppTheme);
 const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
 useEffect(() => {
   saveAppTheme(appTheme);
   try {
     (window as unknown as { MokujiNative?: { setSystemTheme?: (t: string) => void } }).MokujiNative?.setSystemTheme?.(appTheme);
   } catch {}
 }, [appTheme]);
 const [shelfMeta,setShelfMeta]=useState<ShelfMetaState>({collections:[],overrides:{},taxonomy:defaultTaxonomy});
 const taxonomy=shelfMeta.taxonomy||defaultTaxonomy;
 const customCategories=taxonomy.categories?.length?taxonomy.categories:defaultTaxonomy.categories;
 const customCategoryNames=customCategories.map(c=>c.name);
 const ratingLabels=taxonomy.ratingLabels||defaultTaxonomy.ratingLabels;
 const ratingBands=taxonomy.ratingBands?.length?taxonomy.ratingBands:defaultTaxonomy.ratingBands;
 const [collectionId,setCollectionId]=useState('');
 const [shelfSort,setShelfSort]=useState<'recent'|'rating'|'progress'|'title'>('recent');
 const [tagFilter,setTagFilter]=useState('');
 const [ratingBand,setRatingBand]=useState<string>('all');
 const [boundOnly,setBoundOnly]=useState(false);
 const [shelfView,setShelfView]=useState<'list'|'grid'>('list');
 const [batchMode,setBatchMode]=useState(false);
 const [selectedIds,setSelectedIds]=useState<string[]>([]);
 const [batchStatus,setBatchStatus]=useState('');
 const [batchCollectionId,setBatchCollectionId]=useState('');
 const [batchCategory,setBatchCategory]=useState('');
 const [batchTag,setBatchTag]=useState('');
 const [guideHidden,setGuideHidden]=useState(()=>{try{return localStorage.getItem('mokuji.onboarding.v1')==='1';}catch{return false;}});
 function dismissGuide(){setGuideHidden(true);try{localStorage.setItem('mokuji.onboarding.v1','1');}catch{}}
 async function refreshMeta(){try{const r=await fetch('/api/shelf-meta',{cache:'no-store'});if(r.ok)setShelfMeta(await r.json());}catch{}}
 async function mutateMeta(payload:Record<string,unknown>,message='已保存整理设置'){
   if(busyRef.current)return null;busyRef.current=true;setBusy(true);setError('');
   try{
     const res=await fetch('/api/shelf-meta',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
     const b=await res.json() as ShelfMetaState & {error?:string};
     if(!res.ok)throw new Error(b.error||'操作失败');
     setShelfMeta({collections:b.collections||[],overrides:b.overrides||{},taxonomy:b.taxonomy||defaultTaxonomy});
     const lib=await fetch('/api/library',{cache:'no-store'});
     if(lib.ok){const j=await lib.json() as ApiResult;if(j.snapshot)update(j.snapshot);}
     setToast(message);
     return b;
   }catch(e){setError(e instanceof Error?e.message:'操作失败');return null;}
   finally{busyRef.current=false;setBusy(false);}
 }
 async function refreshAll(){
   try{
     const [r1,r2]=await Promise.all([fetch('/api/library',{cache:'no-store'}),fetch('/api/shelf-meta',{cache:'no-store'})]);
     if(r1.ok){const j=await r1.json() as ApiResult;if(j.snapshot)update(j.snapshot);}
     if(r2.ok)setShelfMeta(await r2.json());
   }catch{}
 }
 useEffect(()=>{void refreshMeta();},[]);
 const [readerIndex,setReaderIndex]=useState<ReaderIndex|null>(null);
 const [readerOrigin,setReaderOrigin]=useState('');
 const [fromFiction,setFromFiction]=useState(false);
 useEffect(()=>{
   if(!['book','shelf','home','read'].includes(page))return;
   const controller=new AbortController();
   function refresh(){readerRequest<ReaderIndex>('books',{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setReaderIndex(value);}).catch(()=>{});}
   refresh();window.addEventListener('focus',refresh);
   return ()=>{controller.abort();window.removeEventListener('focus',refresh);};
 },[page,id]);
 const boundBook=(shelfId:string)=>readerIndex?.books.find(item=>item.id===readerIndex.bindings?.[shelfId]);
 function readBook(sourceId:string,from=''){setFromFiction(page==='webfiction');setReaderOrigin(from);go('body',sourceId);}
 const dataRef=useRef(initial),busyRef=useRef(false),fileRef=useRef<HTMLInputElement>(null),shelfImportRef=useRef<HTMLInputElement>(null);
 async function handleQuickShelfImport(file?:File){
   if(!file)return;
   setBusy(true);setError('');
   try{
     const imported=await importBookFile(file,{});
     const shelfId=await addReaderBook({title:imported.title,author:imported.author||'',category:imported.category||'文学',initialStatus:'在读'});
     if(shelfId)await readerPost('bind',{workId:shelfId,bookId:imported.id}).catch(()=>{});
     await refreshAll();
     const idx=await readerRequest<ReaderIndex>('books').catch(()=>null);
     if(idx)setReaderIndex(idx);
     setToast(`已导入《${imported.title}》并加入在读书架`);
   }catch(e){setError(e instanceof Error?e.message:'导入本地书失败');}
   finally{setBusy(false);if(shelfImportRef.current)shelfImportRef.current.value='';}
 }
 const update=(value:Snapshot)=>{if(value.revision<dataRef.current.revision)return;dataRef.current=value;setData(value);};
 useEffect(()=>{
   const read=()=>{const route=currentRoute();setPage(route.page);setId(route.id);setDialog(null);};
   window.addEventListener('hashchange',read);
   return ()=>window.removeEventListener('hashchange',read);
 },[]);
 useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),4500);return()=>clearTimeout(t);},[toast]);
 useEffect(()=>{
  async function refresh(onlyChanged:boolean){
   if(document.hidden||busyRef.current)return;
   try{
    const res=await fetch('/api/library',{cache:'no-store'});
    if(!res.ok)return;
    const result=await res.json() as ApiResult;
    if(result.snapshot&&!busyRef.current&&(!onlyChanged||result.snapshot.revision>dataRef.current.revision))update(result.snapshot);
   }catch{}
  }
  const focused=()=>{void refresh(false);};
  const timer=window.setInterval(()=>{void refresh(true);},30000);
  window.addEventListener('focus',focused);
  return()=>{clearInterval(timer);window.removeEventListener('focus',focused);};
 },[]);
 useEffect(()=>{if(page==='profile'&&id==='cotex')document.getElementById('cotex-connect')?.scrollIntoView({block:'start'});},[page,id]);
 function go(next:Page,bookId=''){
   setPage(next);setId(bookId);setTab('概览');setError('');
   location.hash=next==='body' && bookId && readAppearance()!=='normal'
     ? workspaceFragment(bookId)
     : '/'+next+(bookId?'/'+encodeURIComponent(bookId):'');
   window.scrollTo({top:0,behavior:'instant'});
 }
 function open(value:Dialog){setError('');setDialog(value);}function close(){if(!busyRef.current){setDialog(null);setError('');}}
 async function mutate(action:string,payload:Record<string,unknown>={},message='已保存'){if(busyRef.current)return null;busyRef.current=true;setBusy(true);setError('');try{const res=await fetch('/api/library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,revision:dataRef.current.revision,...payload})});const b=await res.json() as ApiResult;if(!res.ok){if(res.status===401)setUnauthorized(true);if(res.status===409){const r=await fetch('/api/library',{cache:'no-store'});const fresh=await r.json() as ApiResult;if(fresh.snapshot)update(fresh.snapshot);}throw new Error(b.error||'暂时无法保存，请稍后再试。');}if(!b.snapshot)throw new Error('没有收到保存结果，请刷新后检查。');update(b.snapshot);setToast(message);if(action==='saveEntry'){const bid=(payload.entry as {bookId?:string}|undefined)?.bookId;if(bid){void fetch('/api/bangumi-sync/status',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(st=>{if(st?.hasToken&&st?.autoPush!==false){void fetch('/api/bangumi-sync/push-one',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bookId:bid})}).catch(()=>{});}}).catch(()=>{});}}return b.snapshot as Snapshot;}catch(e){setError(e instanceof Error?e.message:'网络连接失败，你的输入仍然保留。');return null;}finally{busyRef.current=false;setBusy(false);}}
 async function bindBookBangumi(bookId:string,currentSid?:number){
   const raw=window.prompt('请输入 Bangumi 书籍条目数字 ID 或条目网址（例如 294207 或 https://bgm.tv/subject/294207）：',currentSid?String(currentSid):'');
   if(!raw)return;
   const m=/(?:subject\/|^)(\d+)/.exec(raw.trim());
   const sid=m?Number(m[1]):0;
   if(!sid){setError('未能识别 Bangumi 条目数字 ID');return;}
   try{
     const res=await fetch('/api/bangumi-sync/push-one',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'bindSubject',bookId,bangumiId:sid})});
     const j=await res.json();
     if(!res.ok)throw new Error(j.error||'绑定失败');
     await refreshAll();
     setToast(`已关联 Bangumi 条目 #${sid}`);
   }catch(e){setError(e instanceof Error?e.message:'绑定 Bangumi 条目失败');}
 }
 async function pushBookToBangumi(bookId:string,bangumiId?:number){
   try{
     const res=await fetch('/api/bangumi-sync/push-one',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({bookId,bangumiId})});
     const j=await res.json();
     if(!res.ok)throw new Error(j.error||'同步到 Bangumi 失败');
     setToast(j.statusInfo?.lastSummary||`已同步到 Bangumi #${j.subjectId}`);
   }catch(e){setError(e instanceof Error?e.message:'同步到 Bangumi 失败');}
 }
 async function attachCatalog(work: SharedWork, bookId?: string, source?: BangumiBook) {
  const snapshot = await mutate('attachCatalog', {
    workId: work.id, bookId,
    ...(source ? {book:{description:source.summary,category:source.category,tags:source.tags,originalTitle:source.originalTitle}} : {}),
  }, '作品已保存到书架');
  if (!snapshot) return false;
  const entry = snapshot.entries.find(item => item.catalogWorkId === work.id);
  if (entry) go('book', entry.bookId);
  return !!entry;
 }
 async function addReaderBook(item:ShelfInput & {initialStatus?:'在读'|'想读'}):Promise<string|undefined>{
  const norm=(text:string)=>text.normalize('NFKC').trim().toLowerCase();
  const author=norm(item.author||'');
  const sameUrl=item.sourceUrl && effectiveBooks.find(book=>book.sourceUrl===item.sourceUrl);
  const matches=sameUrl ? [sameUrl] : author ? effectiveBooks.filter(book=>norm(book.title)===norm(item.title) && norm(book.author)===author) : [];
  if(matches.length>1)throw new Error('书架中有多部同名同作者作品，请打开具体作品详情选择正文来源。');
  if(matches.length===1){
    const prior=matches[0];
    if(entries.has(prior.id))return prior.id;
    const statusTarget=item.initialStatus||'想读';
    const result=await mutate('saveEntry',{entry:{bookId:prior.id,status:statusTarget,unit:prior.unit}},`已加入${statusTarget}`);
    return result ? prior.id : undefined;
  }
  const before=new Set(effectiveBooks.map(book=>book.id));
  const useWant=item.initialStatus==='想读' || (!item.initialStatus && item.category==='网文');
  const result=await mutate('addBook',{...(useWant?{initialStatus:'想读'}:{}),book:{title:item.title,author:item.author||'',category:item.category || '文学',unit:'章',sourceUrl:item.sourceUrl||''}},'已加入书架');
  return result?.books.find(book=>!before.has(book.id)&&book.title===item.title)?.id;
 }
 async function saveClose(action:string,payload:Record<string,unknown>,message?:string){const result=await mutate(action,payload,message);if(result)setDialog(null);return result;}
 const effectiveBooks=useMemo(()=>data.books.map(b=>{const ov=shelfMeta.overrides[b.id];return ov?{...b,...ov}:b;}),[data.books,shelfMeta.overrides]);
 const books=useMemo(()=>new Map(effectiveBooks.map(b=>[b.id,b])),[effectiveBooks]);const entries=useMemo(()=>new Map(data.entries.map(e=>[e.bookId,e])),[data.entries]);const active=data.entries.filter(e=>e.status==='在读').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));const events=[...data.events].sort((a,b)=>b.at.localeCompare(a.at));const selected=books.get(id);const selectedPost=data.posts.find(p=>p.id===id);
 const cotexSources=useMemo(()=>{
  const sources=[...(data.cotexSources||[])].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  const byBook=new Map<string,typeof sources>();
  for(const item of sources){const list=byBook.get(item.bookId);if(list)list.push(item);else byBook.set(item.bookId,[item]);}
  return byBook;
 },[data.cotexSources]);
 const showResume=(title:string,url:string)=>open({type:'resume',title,url});
 const activeCollection=useMemo(()=>shelfMeta.collections.find(c=>c.id===collectionId),[shelfMeta.collections,collectionId]);
 const tagCountMap=useMemo(()=>{const counts=new Map<string,number>();for(const t of taxonomy.pinnedTags||[])counts.set(t,0);for(const e of data.entries){const b=books.get(e.bookId);for(const t of b?.tags||[])counts.set(t,(counts.get(t)||0)+1);}return counts;},[data.entries,books,taxonomy.pinnedTags]);
 const shelfTags=useMemo(()=>[...tagCountMap.entries()].sort((a,b)=>b[1]-a[1]).slice(0,24).map(([t])=>t),[tagCountMap]);
 const allCatalogTagCounts=useMemo(()=>{const counts=new Map<string,number>();for(const t of taxonomy.pinnedTags||[])counts.set(t,0);for(const b of effectiveBooks){for(const t of b.tags||[])counts.set(t,(counts.get(t)||0)+1);}return [...counts.entries()].sort((a,b)=>b[1]-a[1]);},[effectiveBooks,taxonomy.pinnedTags]);
 const filtered=useMemo(()=>{
   const activeBand=ratingBands.find(b=>b.id===ratingBand);
   const list=effectiveBooks.filter(b=>{
     const e=entries.get(b.id);
     if(page==='shelf'){
       if(!e)return false;
       if(status!=='全部'&&e.status!==status)return false;
       if(activeCollection&&!activeCollection.workIds.includes(b.id))return false;
       if(tagFilter&&!b.tags.includes(tagFilter))return false;
       if(ratingBand!=='all'&&activeBand){
         if(activeBand.min===null){if(e.rating!==null)return false;}
         else{if(e.rating===null||e.rating<activeBand.min||e.rating>(activeBand.max??activeBand.min))return false;}
       }
       if(boundOnly&&!boundBook(b.id))return false;
     }
     if(category!=='全部'&&b.category!==category)return false;
     return !query||[b.title,b.originalTitle,b.author,b.category,b.country,b.language,b.description,...b.tags].join(' ').toLowerCase().includes(query.toLowerCase());
   });
   if(page!=='shelf')return list;
   return [...list].sort((a,b)=>{
     const ea=entries.get(a.id),eb=entries.get(b.id);
     if(shelfSort==='rating')return (eb?.rating??-1)-(ea?.rating??-1);
     if(shelfSort==='title')return a.title.localeCompare(b.title,'zh-CN');
     if(shelfSort==='progress'){
       const sa=boundBook(a.id),sb=boundBook(b.id);
       const pa=sa?.chapterCount?((sa.progress.chapter+1)/sa.chapterCount):ea?.position&&a.total?ea.position/a.total:0;
       const pb=sb?.chapterCount?((sb.progress.chapter+1)/sb.chapterCount):eb?.position&&b.total?eb.position/b.total:0;
       return pb-pa;
     }
     return String(eb?.updatedAt||'').localeCompare(String(ea?.updatedAt||''));
   });
 },[effectiveBooks,entries,page,status,activeCollection,tagFilter,ratingBand,boundOnly,category,query,shelfSort,readerIndex]);
 const add=(book:Book)=>mutate('saveEntry',{entry:{bookId:book.id,status:'想读',unit:book.unit}},'已加入想读书架');
 function exportData(){const backup={format:'duji-library',version:1,exportedAt:new Date().toISOString(),state:{customBooks:effectiveBooks.filter(b=>b.isCustom),entries:data.entries,events:data.events,cotexSources:data.cotexSources||[]}};const fname=`目次 Mokuji-阅读备份-${new Date().toISOString().slice(0,10)}.json`;const jsonStr=JSON.stringify(backup,null,2);const nativeSave=(window as unknown as {MokujiNative?:{saveTextFile?:(n:string,c:string)=>boolean}}).MokujiNative?.saveTextFile;if(nativeSave?.(fname,jsonStr)){setToast('已调起手机文件保存');return;}const url=URL.createObjectURL(new Blob([jsonStr],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=fname;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setToast('阅读记录已导出');}
 async function importData(file?:File){if(!file)return;try{if(file.size>10*1024*1024)throw new Error('请选择小于 10 MB 的备份文件。');const b=JSON.parse(await file.text());if(b.format!=='duji-library'||b.version!==1||!Array.isArray(b.state?.entries)||!Array.isArray(b.state?.customBooks)||!Array.isArray(b.state?.events))throw new Error('这不是有效的目次 Mokuji备份文件。');open({type:'import',backup:b,count:b.state.entries.length});}catch(e){setError(e instanceof Error?e.message:'文件读取失败');}finally{if(fileRef.current)fileRef.current.value='';}}
 function resetCatalog(next:Page){setCategory('全部');setQuery('');setStatus('全部');setCollectionId('');setTagFilter('');setRatingBand('all');setBoundOnly(false);setBatchMode(false);setSelectedIds([]);go(next);}
 function toggleSelected(bookId:string){setSelectedIds(cur=>cur.includes(bookId)?cur.filter(x=>x!==bookId):[...cur,bookId]);}
 async function applyBatchOrganize(){
   if(!selectedIds.length)return;
   const existingTags:Record<string,string[]>={};
   for(const bid of selectedIds){const b=books.get(bid);if(b?.tags?.length)existingTags[bid]=b.tags;}
   const res=await mutateMeta({
     action:'batchOrganize',
     workIds:selectedIds,
     ...(batchStatus?{status:batchStatus}:{}),
     ...(batchCollectionId?{collectionId:batchCollectionId}:{}),
     ...(batchCategory?{category:batchCategory}:{}),
     ...(batchTag.trim()?{addTag:batchTag.trim(),existingTags}:{}),
   },`已批量整理 ${selectedIds.length} 部作品`);
   if(res){setBatchTag('');setBatchStatus('');setBatchCollectionId('');setBatchCategory('');setSelectedIds([]);setBatchMode(false);}
 }
 function Row({book,entry,selectable}:{book:Book;entry?:Entry;selectable?:boolean}){
   const numeric=entry?.position!==null&&entry?.position!==undefined&&entry.unit!=='位置';
   const source=boundBook(book.id);
   const readerPercent=source?.chapterCount?Math.min(100,Math.max(0,((source.progress.chapter+1)/source.chapterCount)*100)):null;
   const entryPercent=entry&&numeric?(entry.unit==='%'?entry.position:book.total&&entry.unit===book.unit?entry.position!/book.total*100:null):null;
   const percent=entryPercent??readerPercent;
   const cols=shelfMeta.collections.filter(c=>c.workIds.includes(book.id));
   const checked=selectable&&selectedIds.includes(book.id);
   return <article className={`reading-row ${checked?'selected-row':''}`}>{selectable&&<label className="row-check"><input type="checkbox" checked={!!checked} onChange={()=>toggleSelected(book.id)} aria-label={`选择 ${book.title}`}/></label>}<button className="cover-button" onClick={()=>go('book',book.id)} aria-label={`查看${book.title}`}><Cover book={book}/></button><div className="reading-content"><div className="reading-title"><button onClick={()=>go('book',book.id)}>{book.title}</button><span className={`type-label type-${book.category}`}>{book.category}</span>{cols.slice(0,2).map(c=><span key={c.id} className="collection-pill">{c.name}</span>)}</div><div className="book-meta">{book.author||'作者待补充'}<span>·</span>{entry?.edition||book.edition||book.country||'资料待补充'}</div>{entry?<><div className={`progress-text ${entry.position===null&&!entry.locationText&&entry.volume===null&&!source?.progress?.updatedAt?'unrecorded':''}`}><Bookmark size={13}/>{entry.position===null&&!entry.locationText&&source?.progress?.updatedAt?`正读：${readingPosition(source.progress)}${readerPercent!==null?` (${Math.round(readerPercent)}%)`:''}`:progressLabel(entry)}{entry.status!=='在读'&&<span className="small-status">{entry.status}</span>}</div>{percent!==null&&<div className="progress-track"><span style={{width:`${Math.max(0,Math.min(100,percent))}%`}}/></div>}<div className="reading-footnote">{entry.updatedAt?`上次记录 ${dateText(entry.updatedAt)}`:'从你现在读到的地方开始'}{entry.rating!==null&&<span className="personal-score"><Star size={10}/>{entry.rating} 分{ratingLabels[String(entry.rating)]?` · ${ratingLabels[String(entry.rating)]}`:''}</span>}</div></>:<p className="book-description-short">{book.description}</p>}{source?.progress?.updatedAt&&<small className="reader-app-position">正文 · {readingPosition(source.progress)}</small>}</div><div className="reading-actions"><button className="button button-outline" onClick={()=>source?readBook(source.id,book.id):go('read',book.id)}><BookOpen size={13}/>{source?'继续阅读':'阅读正文'}</button>{entry?<><button className="button button-sage" disabled={busy} onClick={()=>open({type:'progress',bookId:book.id})}><PenLine size={13}/>{entry.position===null&&!entry.locationText?'登记进度':'更新进度'}</button>{numeric&&entry.unit!=='%'&&entry.unit!=='页'&&!(book.total&&entry.unit===book.unit&&entry.position!>=book.total)?<button className="quick-next" disabled={busy} onClick={()=>mutate('saveEntry',{entry:{bookId:book.id,position:entry.position!+1}},'进度已更新')}><Plus size={12}/>下一{entry.unit}</button>:<button className="text-button quiet" onClick={()=>go('book',book.id)}>查看详情<ChevronRight size={12}/></button>}</>:<button className="button button-outline" disabled={busy} onClick={()=>add(book)}><Plus size={13}/>加入书架</button>}</div></article>;
 }
 function Tile({book,selectable}:{book:Book;selectable?:boolean}){const e=entries.get(book.id);const checked=selectable&&selectedIds.includes(book.id);return <article className={`book-tile ${checked?'selected-row':''}`}>{selectable&&<label className="tile-check"><input type="checkbox" checked={!!checked} onChange={()=>toggleSelected(book.id)} aria-label={`选择 ${book.title}`}/></label>}<button className="tile-cover-button" onClick={()=>go('book',book.id)}><Cover book={book}/>{e&&<span className="cover-ribbon">{e.status}{e.rating!==null?` · ${e.rating}★`:''}</span>}</button><button className="tile-title" onClick={()=>go('book',book.id)}>{book.title}</button><p>{book.author||'作者待补充'}</p><span className="tile-type">{book.category}</span></article>;}
 function Timeline({limit=8}:{limit?:number}){return events.length?<div className="timeline">{events.slice(0,limit).map(event=><div className="timeline-row" key={event.id}><span className="timeline-point"/><div><button className="inline-book-link" onClick={()=>go('book',event.bookId)}>{books.get(event.bookId)?.title||'阅读记录'}</button><p>{event.detail}</p><time>{dateText(event.at)}</time></div>{!!(event.resultUpdatedAt||(event.kind==='移出书架'&&event.previous))&&events.find(e=>e.bookId===event.bookId)?.id===event.id&&<button className="icon-button undo-button" disabled={busy} onClick={()=>mutate('undo',{eventId:event.id},'已撤销上次记录')} aria-label="撤销这次记录"><Undo2 size={14}/></button>}</div>)}</div>:<div className="timeline-empty"><div className="timeline-empty-line"><span/><span/><span/></div><p>阅读留下的足迹，会在这里慢慢积累。</p><span>记下当前位置，就从今天开始。</span></div>;}
 function Sidebar(){return <aside className="sidebar"><div className="side-section"><Heading title="我的书架" action={<button className="text-button quiet" aria-label="查看全部书架" onClick={()=>resetCatalog('shelf')}><ChevronRight size={15}/></button>}/><div className="shelf-counts">{statuses.map(s=><button key={s} onClick={()=>{setStatus(s);setCategory('全部');setQuery('');go('shelf');}}><strong>{data.entries.filter(e=>e.status===s).length}</strong><span>{s}</span></button>)}</div><button className="add-to-shelf" onClick={()=>open({type:'add'})}><Plus size={14}/>手动添加一本书</button></div><Corner/><div className="side-section"><Heading title="按类型看看" action={<button type="button" className="text-button quiet" onClick={()=>open({type:'taxonomy',tab:'categories'})}><SlidersHorizontal size={13}/></button>}/><div className="side-categories">{customCategoryNames.map(c=><button key={c} onClick={()=>{setCategory(c);setQuery('');go(page==='shelf'?'shelf':'discover');}}><span>{c}</span><ChevronRight size={12}/></button>)}</div></div><div className="sidebar-note"><LockKeyhole size={14}/><p>你的进度与私人笔记仅自己可见。<br/>书评与讨论由你选择发布。</p></div></aside>;}
 function ReviewCard({review}:{review:Review}){return <article className="review-card"><div className="review-header"><div className="mini-avatar">{review.displayName.slice(0,1)}</div><span className="review-author">{review.displayName}</span>{review.score!==null&&<span className="review-score"><Star size={12} fill="currentColor"/>{review.score} 分</span>}<time>{dateText(review.createdAt)}</time></div>{page!=='book'&&<button className="review-book-title" onClick={()=>go('book',review.bookId)}>《{review.bookTitle}》<ChevronRight size={12}/></button>}{review.spoiler?<details className="spoiler"><summary>包含剧透，点击展开</summary><p className="long-text">{review.body}</p></details>:<p className="long-text">{review.body}</p>}<div className="review-bottom">{review.progress&&<span>评价时读到：{review.progress}</span>}{review.userId===data.user.id&&<button className="text-button quiet" onClick={()=>open({type:'confirm',title:'删除这条书评？',body:'这条公开书评和评分将被删除。私人阅读记录不受影响。',action:'deleteReview',payload:{id:review.id}})}>删除</button>}</div></article>;}
 function PostRow({post}:{post:Post}){return <article className="post-row"><div className="post-icon"><MessageCircle size={19}/></div><div className="post-main"><button className="post-title" onClick={()=>go('post',post.id)}>{post.title}{post.spoiler&&<span className="spoiler-badge">剧透</span>}</button><div className="post-meta"><span>{post.displayName}</span><span>·</span><time>{dateText(post.createdAt)}</time>{post.bookTitle&&<><span>·</span><button onClick={()=>go('book',post.bookId)}>{post.bookTitle}</button></>}</div></div><button className="reply-count" onClick={()=>go('post',post.id)} aria-label="查看回复"><MessageCircle size={13}/>{data.replies.filter(r=>r.postId===post.id).length}</button></article>;}
 function Home(){const list=active.filter(e=>category==='全部'||books.get(e.bookId)?.category===category);return <><div className="page-intro"><div><div className="eyebrow"><span className="tiny-leaf">✦</span> YOUR READING, ALL TOGETHER</div><h1>每一次翻页，都有迹可循<span>。</span></h1><p>不同的书，不同的世界。把阅读的进度，都留在这里。</p></div><div className="intro-actions"><button className="button button-outline" onClick={()=>go('sources')}><Globe size={15}/>搜书源 / 导入</button><button className="button button-coral" onClick={()=>open({type:'add'})}><Plus size={15}/>添加书籍</button></div></div>{!guideHidden&&<section className="onboarding-banner" aria-label="新手快速上手"><div className="onboarding-head"><div className="onboarding-title"><Sparkles size={15}/><strong>首次使用目次 Mokuji？三步开启长期阅读管理</strong></div><button type="button" className="text-button quiet" onClick={dismissGuide}><X size={14}/>不再提示</button></div><div className="onboarding-steps"><button type="button" onClick={()=>go('read')}><span>01 · 放入书</span><strong>导入本地 TXT / EPUB 或启用书源搜书</strong><small>支持 60 MiB 文件，自动按章切分并与书架联动</small></button><button type="button" onClick={()=>resetCatalog('shelf')}><span>02 · 整理与评分</span><strong>用想读 / 在读 / 读过与自定义书单收纳作品</strong><small>记录 1-10 分私密评价、标签、页码进度或关联 Bangumi</small></button><button type="button" onClick={()=>go('profile')}><span>03 · 摸鱼与跨端同步</span><strong>在工作区伪装办公界面读小说 · 七牛云 / NAS / 电纸书同步</strong><small>按空格瞬切工作文档，手机、电纸书 OPDS 随时接力阅读</small></button></div></section>}<div className="content-grid"><main className="main-column"><section className="section"><Heading title="正在阅读" caption={`${active.length} 本`} action={<button className="text-button" onClick={()=>resetCatalog('shelf')}>全部书架<ArrowUpRight size={14}/></button>}/><div className="category-tabs">{['全部',...Array.from(new Set(active.map(e=>books.get(e.bookId)?.category).filter(Boolean)))].map(c=><button key={c} className={category===c?'selected':''} onClick={()=>setCategory(c as Category|'全部')}>{c}</button>)}</div><div className="reading-list">{list.length?list.map(e=>{const b=books.get(e.bookId);return b?<Row key={e.bookId} book={b} entry={e}/>:null;}):<Empty title="让阅读从这里继续" text="把正在读的书放进书架，随手记下当前位置。" action={<button className="button button-sage" onClick={()=>open({type:'add'})}><Plus size={14}/>添加在读书籍</button>}/>}</div><div className="reading-list-bottom"><Leaf size={13}/><span>不必补齐过去的记录，从现在读到的地方开始。</span></div></section><section className="section"><Heading title="书架之外" caption="精选资料" action={<button className="text-button" onClick={()=>resetCatalog('discover')}>发现更多<ArrowUpRight size={14}/></button>}/><div className="book-grid home-book-grid">{effectiveBooks.filter(b=>!entries.has(b.id)).slice(0,6).map(b=><Tile key={b.id} book={b}/>)}</div></section><section className="section"><Heading title="最近的阅读足迹" action={<button className="text-button" onClick={()=>go('profile')}>查看记录<ArrowUpRight size={14}/></button>}/><Timeline limit={4}/></section></main><Sidebar/></div></>;}
 function Catalog(){
  const isShelf=page==='shelf';
  const totalEntries=data.entries.length;
  const ratedEntries=data.entries.filter(e=>e.rating!==null);
  const personalAvg=ratedEntries.length?(ratedEntries.reduce((s,e)=>s+(e.rating||0),0)/ratedEntries.length).toFixed(1):null;
  const colDoneCount=activeCollection?activeCollection.workIds.filter(wid=>entries.get(wid)?.status==='已读').length:0;
  const latestSource=isShelf&&readerIndex?recentWorkspace(readerIndex)?.book:undefined;
  return <><div className="page-intro compact"><div><div className="eyebrow">{isShelf?'YOUR PERSONAL LIBRARY':'A WORLD BETWEEN THE PAGES'}</div><h1>{isShelf?'我的书架':'发现一本好书'}<span>。</span></h1><p>{isShelf?'像 Bangumi 一样自定义分类、评分体系、Tag 与专题书单。':'从文字到画面，从一个世界，到另一个世界。'}</p></div><div className="intro-actions">{isShelf&&<><button className="button button-outline" onClick={()=>open({type:'taxonomy',tab:'categories'})}><SlidersHorizontal size={15}/>自定义分类/评分/标签</button><button className={`button ${batchMode?'button-sage':'button-outline'}`} onClick={()=>{setBatchMode(v=>!v);setSelectedIds([]);}}><ListChecks size={15}/>{batchMode?'退出批量整理':'批量整理'}</button><button className="button button-outline" onClick={()=>open({type:'collection'})}><FolderPlus size={15}/>新建书单</button><button className="button button-outline" disabled={busy} onClick={()=>shelfImportRef.current?.click()}><Upload size={15}/>导入本地书</button></>}<button className="button button-coral" onClick={()=>open({type:'add'})}><Plus size={15}/>添加书籍</button></div></div>{isShelf&&latestSource&&<section className="reader-resume" aria-label="继续阅读" style={{margin:'0 0 14px'}}><div><h2>继续阅读</h2><strong>{latestSource.title}</strong><p>{[latestSource.author,readingPosition(latestSource.progress)].filter(Boolean).join(' · ')}</p></div><div style={{display:'flex',gap:8,flexShrink:0}}><a className="button button-outline" href="#/workspace">工作区</a><button className="button button-sage" type="button" onClick={()=>readBook(latestSource.id)}>接着读</button></div></section>}{isShelf&&!guideHidden&&<section className="onboarding-banner" aria-label="新手快速上手"><div className="onboarding-head"><div className="onboarding-title"><Sparkles size={15}/><strong>初次使用目次？三步开启全能阅读</strong></div><button type="button" className="text-button quiet" onClick={dismissGuide}><X size={14}/>不再提示</button></div><div className="onboarding-steps"><button type="button" onClick={()=>shelfImportRef.current?.click()}><span>01 · 导书或找书</span><strong>直接导入 TXT / EPUB / CBZ 或全网嗅探</strong><small>支持 60 MiB 本地文件，自动分章直接加入书架</small></button><button type="button" onClick={()=>open({type:'taxonomy',tab:'categories'})}><span>02 · Bangumi 级规整</span><strong>自定义门类、1–10 评分档位与专题书单</strong><small>支持关联 Bangumi 条目自动回写阅读进度与评价</small></button><button type="button" onClick={()=>go('workspace')}><span>03 · 摸鱼与云同步</span><strong>伪装开发工作台阅读 · 七牛云 / NAS / 手机离线</strong><small>按空格瞬切工作摘要，随时跨设备无感续读</small></button></div></section>}<div className="content-grid"><main className="main-column"><section className="section">{isShelf&&<>{totalEntries>0&&<div className="shelf-stats-strip" aria-label="书架状态分布"><div className="shelf-dist-bar">{statuses.map(s=>{const c=data.entries.filter(e=>e.status===s).length;return c>0?<span key={s} className={`dist-${s}`} style={{width:`${c/totalEntries*100}%`}} title={`${s} ${c} 本`}/>:null;})}</div><div className="shelf-stats-summary"><span>总计 {totalEntries} 部</span>{personalAvg&&<span>均分 ★ {personalAvg}（{ratedEntries.length} 部已评）</span>}</div></div>}<div className="status-tabs">{(['全部',...statuses] as const).map(s=><button className={status===s?'selected':''} key={s} onClick={()=>setStatus(s)}>{s}<span>{s==='全部'?totalEntries:data.entries.filter(e=>e.status===s).length}</span></button>)}</div><div className="collection-bar" role="region" aria-label="自定义书单"><span className="filter-label">书单</span><div className="filter-tags"><button className={!collectionId?'selected':''} onClick={()=>setCollectionId('')}>全部书单</button>{shelfMeta.collections.map(c=><button key={c.id} className={collectionId===c.id?'selected':''} onClick={()=>setCollectionId(collectionId===c.id?'':c.id)}>{c.name}<span>{c.workIds.length}</span></button>)}<button className="add-col-chip" onClick={()=>open({type:'collection'})}><Plus size={12}/>新建书单</button></div>{activeCollection&&<div className="collection-bar-actions"><span className="col-progress">已读 {colDoneCount}/{activeCollection.workIds.length}</span><button type="button" className="text-button" onClick={()=>open({type:'collection',collection:activeCollection})}><PenLine size={12}/>编辑书单</button><button type="button" className="text-button danger" onClick={async()=>{if(window.confirm(`删除书单「${activeCollection.name}」？（不会删除书架中的作品）`)){await mutateMeta({action:'deleteCollection',id:activeCollection.id},'书单已删除');setCollectionId('');}}}><Trash2 size={12}/>删除</button></div>}</div>{activeCollection?.description&&<p className="collection-desc-note">{activeCollection.description}</p>}</>}<div className="catalog-toolbar"><span className="filter-label">门类</span><div className="filter-tags">{['全部',...customCategoryNames].map(c=><button className={category===c?'selected':''} key={c} onClick={()=>setCategory(c)}>{c}</button>)}<button type="button" className="add-col-chip" onClick={()=>open({type:'taxonomy',tab:'categories'})}><SlidersHorizontal size={11}/>管理分类</button></div></div>{isShelf&&<div className="catalog-toolbar"><span className="filter-label">评分</span><div className="filter-tags"><button className={ratingBand==='all'?'selected':''} onClick={()=>setRatingBand('all')}>全部评分</button>{ratingBands.map(b=><button key={b.id} className={ratingBand===b.id?'selected':''} onClick={()=>setRatingBand(b.id)}>{b.label}</button>)}<button type="button" className="add-col-chip" onClick={()=>open({type:'taxonomy',tab:'rating'})}><Star size={11}/>自定义评分</button></div></div>}{isShelf&&<div className="catalog-toolbar"><span className="filter-label">标签</span><div className="filter-tags"><button className={!tagFilter?'selected':''} onClick={()=>setTagFilter('')}>不限</button>{shelfTags.map(t=><button key={t} className={tagFilter===t?'selected':''} onClick={()=>setTagFilter(tagFilter===t?'':t)}>{t}</button>)}<button type="button" className="add-col-chip" onClick={()=>open({type:'taxonomy',tab:'tags'})}><Tag size={11}/>管理标签</button></div></div>}{isShelf&&<div className="shelf-search-sort"><div className="catalog-search"><Search size={16}/><input aria-label="筛选书籍" placeholder="搜索书名、原名、作者、国家或标签…" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button aria-label="清除搜索" onClick={()=>setQuery('')}><X size={14}/></button>}</div><select className="shelf-sort-select" aria-label="排序方式" value={shelfSort} onChange={e=>setShelfSort(e.target.value as typeof shelfSort)}><option value="recent">按最近记录</option><option value="rating">按个人评分</option><option value="progress">按阅读进度</option><option value="title">按书名排序</option></select><label className="bound-toggle"><input type="checkbox" checked={boundOnly} onChange={e=>setBoundOnly(e.target.checked)}/>仅看可正文读</label><div className="view-switcher" role="group" aria-label="视图模式"><button type="button" className={shelfView==='list'?'selected':''} onClick={()=>setShelfView('list')} title="列表视图"><List size={15}/></button><button type="button" className={shelfView==='grid'?'selected':''} onClick={()=>setShelfView('grid')} title="封面墙视图"><LayoutGrid size={15}/></button></div></div>}{isShelf&&batchMode&&<div className="batch-bar"><div className="batch-bar-left"><button type="button" className="text-button" onClick={()=>setSelectedIds(selectedIds.length===filtered.length?[]:filtered.map(b=>b.id))}>{selectedIds.length===filtered.length?'取消全选':'全选当前'}（已选 {selectedIds.length}）</button></div><div className="batch-bar-controls"><select value={batchStatus} onChange={e=>setBatchStatus(e.target.value)} aria-label="批量修改状态"><option value="">状态不变</option>{statuses.map(s=><option key={s} value={s}>设为：{s}</option>)}</select><select value={batchCategory} onChange={e=>setBatchCategory(e.target.value)} aria-label="批量修改门类"><option value="">门类不变</option>{customCategoryNames.map(c=><option key={c} value={c}>门类：{c}</option>)}</select><select value={batchCollectionId} onChange={e=>setBatchCollectionId(e.target.value)} aria-label="批量加入书单"><option value="">不加书单</option>{shelfMeta.collections.map(c=><option key={c.id} value={c.id}>+ 书单：{c.name}</option>)}</select><input className="batch-tag-input" value={batchTag} onChange={e=>setBatchTag(e.target.value)} placeholder="追加标签…"/><button type="button" className="button button-sage" disabled={busy||!selectedIds.length} onClick={()=>void applyBatchOrganize()}>应用批量整理</button></div></div>}{!isShelf&&<BangumiCatalog key={query} initialQuery={query} onQuery={setQuery} onAttach={attachCatalog} books={effectiveBooks} entries={data.entries} busy={busy} onSave={payload=>mutate('attachBangumi',payload,'Bangumi 条目已保存')} onOpen={bookId=>go('book',bookId)}/>}<div className="result-count">{query?`“${query}” · `:''}共 {filtered.length} 部作品<span>{isShelf?'你的私人收藏':'精选书目与手动补充的资料'}</span></div>{filtered.length?(isShelf&&shelfView==='list'?<div className="reading-list">{filtered.map(b=><Row key={b.id} book={b} entry={entries.get(b.id)} selectable={batchMode}/>)}</div>:<div className="book-grid catalog-book-grid">{filtered.map(b=><Tile key={b.id} book={b} selectable={isShelf&&batchMode}/>)}</div>):<Empty title="暂时没有找到这本书" text="试试原名或作者名，也可以先添加书名，其他资料以后再补。" action={<button className="button button-sage" onClick={()=>open({type:'add'})}><Plus size={14}/>手动添加</button>}/>}</section></main><Sidebar/></div></>;
 }
 function Detail({book}:{book:Book}){const source=boundBook(book.id);const entry=entries.get(book.id);const reviews=data.reviews.filter(r=>r.bookId===book.id);const posts=data.posts.filter(p=>p.bookId===book.id);const rated=reviews.filter(r=>r.score!==null);const avg=rated.length?rated.reduce((sum,r)=>sum+(r.score||0),0)/rated.length:null;return <><div className="breadcrumbs"><button onClick={()=>resetCatalog('discover')}>资料库</button><ChevronRight size={12}/><span>{book.category}</span><ChevronRight size={12}/><span>{book.title}</span></div><div className="content-grid detail-grid"><main className="main-column"><section className="section book-hero"><Cover book={book} className="detail-cover"/><div className="book-heading"><div className="book-heading-top"><span className="type-label">{book.category}</span><button type="button" className="text-button" onClick={()=>open({type:'editBook',bookId:book.id})}><PenLine size={12}/>编辑作品信息</button></div><h1>{book.title}</h1>{book.originalTitle&&book.originalTitle!==book.title&&<p className="original-title">{book.originalTitle}</p>}<dl className="book-facts">{[['作者',book.author],['国家 / 地区',book.country],['语言',book.language],['作品状态',book.publicationStatus]].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v||'待补充'}</dd></div>)}</dl><div className="tag-list">{book.tags.map(t=><button key={t} onClick={()=>{setQuery(t);setCategory('全部');go('discover');}}>{t}</button>)}</div><p className="cover-disclaimer">封面仅供识别，阅读版本可自行填写。</p></div></section><div className="mobile-reading"><button className="button button-sage" onClick={()=>open({type:'progress',bookId:book.id})}><PenLine size={14}/>{entry?progressLabel(entry):'加入书架并登记进度'}</button></div><section className="reader-detail-prompt"><h2>阅读正文</h2>
    {source?<><p>{source.title} · {source.source}{source.progress?.updatedAt ? ' · '+readingPosition(source.progress) : ''}</p>
      <button className="button button-sage" onClick={()=>readBook(source.id,book.id)}><BookOpen size={14}/>继续阅读</button> <button className="button button-outline" onClick={()=>go('read',book.id)}>选择其他正文来源</button></>:
      <><p>关联本机 Cotex 书库、导入 TXT/EPUB/CBZ 漫画包，或全网搜书源 / 网页嗅探直链绑定阅读。</p><div style={{display:'flex',flexWrap:'wrap',gap:8}}><button className="button button-sage" onClick={()=>go('sources',book.id)}><Globe size={14}/>全网搜源 / 网页嗅探加书</button><button className="button button-outline" onClick={()=>go('read',book.id)}><BookOpen size={14}/>从已有书库关联 / 导入文件</button></div></>}
    {!entry?.catalogWorkId&&<PlatformButtons urls={[book.sourceUrl||'',entry?.sourceUrl||'']}/>}
    </section>{entry?.catalogWorkId&&<WorkSources key={entry.catalogWorkId} id={entry.catalogWorkId}/>}<div className="detail-tabs">{['概览','书评','讨论','我的记录'].map(t=><button key={t} className={tab===t?'selected':''} onClick={()=>setTab(t)}>{t}{t==='书评'&&<span>{reviews.length}</span>}{t==='讨论'&&<span>{posts.length}</span>}</button>)}</div>{tab==='概览'&&<section className="section detail-section"><Heading title="关于这本书"/><p className="book-synopsis long-text">{book.description||'简介尚未补充，可以先开始记录阅读。'}</p><div className="edition-note"><BookOpen size={16}/><div><strong>版本与阅读位置</strong><p>{entry?.edition||book.edition||'可在登记进度时备注译本、出版社或电子书版本。'}不同版本的页码与章节编号不自动换算。</p></div></div> {!entry?.catalogWorkId&&entry?.bangumiId&&<a className="source-link" href={`https://bgm.tv/subject/${entry.bangumiId}`} target="_blank" rel="noreferrer">Bangumi 条目<ExternalLink size={12}/></a>}{safeLink(book.sourceUrl)&&!(entry?.bangumiId&&book.sourceUrl===`https://bgm.tv/subject/${entry.bangumiId}`)&&<a className="source-link" href={book.sourceUrl} target="_blank" rel="noreferrer">资料来源<ExternalLink size={12}/></a>}</section>}{(tab==='概览'||tab==='书评')&&<section className="section detail-section"><Heading title="评分与短评" caption={`${reviews.length} 条`} action={<button className="text-button" onClick={()=>open({type:'review',bookId:book.id})}><PenLine size={13}/>写短评</button>}/>{reviews.length?reviews.slice(0,tab==='概览'?3:undefined).map(r=><ReviewCard key={r.id} review={r}/>):<Empty title="还没有人写下感受" text="你读到哪里，又有什么想法？留下第一条短评吧。"/>}</section>}{(tab==='概览'||tab==='讨论')&&<section className="section detail-section"><Heading title="关于这本书的讨论" action={<button className="text-button" onClick={()=>open({type:'post',bookId:book.id})}><Plus size={14}/>发起讨论</button>}/>{posts.length?posts.map(p=><PostRow key={p.id} post={p}/>):<div className="compact-empty">这里还很安静。聊聊喜欢的章节，或一个没想明白的问题。</div>}</section>}{tab==='我的记录'&&<section className="section detail-section"><Heading title="我的读迹" action={<span className="private-label"><LockKeyhole size={12}/>仅自己可见</span>}/>{entry?<><div className="private-entry"><div><span>当前状态</span><strong>{entry.status}</strong></div><div><span>阅读位置</span><strong>{progressLabel(entry)}</strong></div><div><span>我的评分</span><strong>{entry.rating===null?'暂未评分':`${entry.rating} / 10`}</strong></div></div><div className="private-note"><h3><LockKeyhole size={13}/>私人笔记</h3><p className="long-text">{entry.note||'还没有笔记。留一个想法，给下次翻开这本书的自己。'}</p></div>{safeLink(entry.sourceUrl)&&<a className="source-link" href={entry.sourceUrl} target="_blank" rel="noreferrer">打开阅读来源<ExternalLink size={13}/></a>}<button className="button button-sage" onClick={()=>open({type:'progress',bookId:book.id})}><PenLine size={13}/>编辑我的记录</button><div className="book-event-list">{events.filter(e=>e.bookId===book.id).map(e=><div key={e.id}><Clock3 size={13}/><span>{e.detail}</span><time>{dateText(e.at)}</time></div>)}</div></>:<Empty title="先把它放进书架吧" text="添加后，就可以记录进度、评分和私人笔记。" action={<button className="button button-sage" onClick={()=>add(book)}><Plus size={13}/>加入书架</button>}/>}</section>}</main><aside className="sidebar"><section className="side-section my-book-card"><Heading title="我的阅读" action={<LockKeyhole size={13}/>}/>{entry?<><span className="reading-status-pill">{entry.status}</span><strong className="my-position">{progressLabel(entry)}</strong><p>{entry.updatedAt?`上次记录于 ${dateText(entry.updatedAt)}`:'从当前位置开始，随手记一笔。'}</p><button className="button button-sage full" onClick={()=>open({type:'progress',bookId:book.id})}><PenLine size={14}/>更新进度与笔记</button>{safeLink(entry.sourceUrl)&&<a className="button button-outline full" href={entry.sourceUrl} target="_blank" rel="noreferrer">继续阅读<ExternalLink size={13}/></a>}</>:<><p>把它加入书架，开启你的阅读记录。</p><button className="button button-sage full" disabled={busy} onClick={()=>add(book)}><Plus size={14}/>加入想读</button><button className="text-button center" onClick={()=>open({type:'progress',bookId:book.id})}>我正在读这本书<ChevronRight size={13}/></button></>}<div className="bgm-side-box" style={{marginTop:10,paddingTop:10,borderTop:'1px solid var(--line)',display:'flex',flexDirection:'column',gap:6}}>{(entry?.bangumiId||book.id.startsWith('custom-bgm-'))?<><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:12}}><span>Bangumi #{entry?.bangumiId||book.id.slice(11)}</span><a href={`https://bgm.tv/subject/${entry?.bangumiId||book.id.slice(11)}`} target="_blank" rel="noreferrer" className="text-link">原条目<ExternalLink size={11}/></a></div><button type="button" className="button button-outline full" onClick={()=>void pushBookToBangumi(book.id,entry?.bangumiId||Number(book.id.slice(11)))}>同步进度/评分到 Bangumi</button><button type="button" className="text-button quiet center" onClick={()=>void bindBookBangumi(book.id,entry?.bangumiId||Number(book.id.slice(11)))}>更换 Bangumi 条目 ID</button></>:<button type="button" className="button button-outline full" onClick={()=>void bindBookBangumi(book.id)}>绑定 Bangumi 条目 ID 联动</button>}</div></section><section className="side-section collection-card"><Heading title="收纳到书单" action={<button type="button" className="text-button" onClick={()=>open({type:'collection',bookId:book.id})}><FolderPlus size={13}/>新建</button>}/>{shelfMeta.collections.length?<div className="collection-checks">{shelfMeta.collections.map(c=>{const checked=c.workIds.includes(book.id);return <label key={c.id} className="collection-check"><input type="checkbox" checked={checked} disabled={busy} onChange={()=>void mutateMeta({action:'toggleItem',collectionId:c.id,workId:book.id,present:!checked},checked?`已从「${c.name}」移出`:`已加入「${c.name}」`)}/><span>{c.name}</span><small>{c.workIds.length}</small></label>;})}</div>:<p className="small-muted">还没有书单，建一个归类长期收藏的作品。</p>}</section><section className="side-section rating-card"><Heading title="社区评分"/><div className="rating-number">{avg===null?<span className="no-rating">暂无评分</span>:<><strong>{avg.toFixed(1)}</strong><span>/ 10</span></>}</div><p>{rated.length?`${rated.length} 人评分`:'等待第一位读者的评价'}</p><div className="score-bars">{[10,8,6,4,2].map(v=>{const count=rated.filter(r=>r.score!<=v&&r.score!>v-2).length;return <div key={v}><span>{v-1}–{v}</span><i><b style={{width:`${rated.length?count/rated.length*100:0}%`}}/></i><span>{count}</span></div>;})}</div><button className="button button-outline full" onClick={()=>open({type:'review',bookId:book.id})}><Star size={14}/>评分与短评</button></section><div className="sidebar-note"><BookOpen size={14}/><p>作品评价聚合在这里。<br/>版本与私人笔记保存在你的阅读记录中。</p></div></aside></div></>;}
 function Community(){return <><div className="page-intro compact"><div><div className="eyebrow">BETWEEN READERS</div><h1>书页之间，也有回声<span>。</span></h1><p>聊聊故事、分享感受，或是寻找下一本想读的书。</p></div><button className="button button-coral" onClick={()=>open({type:'post'})}><Plus size={15}/>发起讨论</button></div><div className="content-grid"><main className="main-column"><section className="section community-section"><div className="status-tabs">{['讨论','书评'].map(t=><button key={t} className={communityTab===t?'selected':''} onClick={()=>setCommunityTab(t)}>{t}<span>{t==='讨论'?data.posts.length:data.reviews.length}</span></button>)}</div>{communityTab==='讨论'?(data.posts.length?data.posts.map(p=><PostRow key={p.id} post={p}/>):<Empty title="第一场讨论，等你开始" text="关于一本书的疑问、一个喜欢的段落，都值得留下来。" action={<button className="button button-sage" onClick={()=>open({type:'post'})}><PenLine size={14}/>写下一个话题</button>}/>):(data.reviews.length?data.reviews.map(r=><ReviewCard key={r.id} review={r}/>):<Empty title="还没有公开书评" text="在作品详情页写下评分与短评，你的感受会出现在这里。" action={<button className="button button-outline" onClick={()=>resetCatalog('discover')}>去看看作品<ArrowUpRight size={14}/></button>}/>)}</section></main><aside className="sidebar"><div className="side-section community-guidelines"><Heading title="让交流舒服一点"/><p><span>01</span>观点可以不同，彼此保持尊重。</p><p><span>02</span>涉及情节，记得标记剧透。</p><p><span>03</span>讨论作品，也分享真实的感受。</p><div className="private-community"><LockKeyhole size={13}/>内容仅对有权访问本站的人可见</div></div><Corner/></aside></div></>;}
 function PostDetail({post}:{post:Post}){const replies=data.replies.filter(r=>r.postId===post.id);return <><div className="breadcrumbs"><button onClick={()=>go('community')}>社区</button><ChevronRight size={12}/><span>讨论详情</span></div><div className="content-grid"><main className="main-column"><article className="section post-detail"><div className="post-detail-category">{post.bookTitle?<button onClick={()=>go('book',post.bookId)}>{post.bookTitle}<ArrowUpRight size={12}/></button>:<span>阅读交流</span>}</div><h1>{post.title}</h1><div className="post-detail-author"><div className="mini-avatar">{post.displayName.slice(0,1)}</div><strong>{post.displayName}</strong><time>{dateText(post.createdAt)}</time>{post.spoiler&&<span className="spoiler-badge">剧透</span>}</div>{post.spoiler?<details className="spoiler post-body"><summary>本话题包含剧透，点击展开正文</summary><p className="long-text">{post.body}</p></details>:<p className="post-body long-text">{post.body}</p>}<div className="post-detail-actions"><button className="button button-sage" onClick={()=>open({type:'reply',postId:post.id})}><MessageCircle size={14}/>回复话题</button>{post.userId===data.user.id&&<button className="text-button quiet" onClick={()=>open({type:'confirm',title:'删除这篇讨论？',body:'这篇讨论及其回复将被删除，请确认。',action:'deletePost',payload:{id:post.id}})}><Trash2 size={13}/>删除讨论</button>}</div></article><section className="section reply-section"><Heading title="回复" caption={`${replies.length} 条`}/>{replies.length?replies.map(r=><article className="review-card" key={r.id}><div className="review-header"><div className="mini-avatar">{r.displayName.slice(0,1)}</div><span className="review-author">{r.displayName}</span><time>{dateText(r.createdAt)}</time></div><p className="long-text">{r.body}</p>{r.userId===data.user.id&&<div className="review-bottom"><button className="text-button quiet" onClick={()=>open({type:'confirm',title:'删除这条回复？',body:'删除后将无法在讨论中看到这条回复。',action:'deleteReply',payload:{id:r.id}})}>删除</button></div>}</article>):<div className="compact-empty">还没有回复。写下你的想法，让讨论继续。</div>}</section></main><Sidebar/></div></>;}
 function Profile(){
  const reviews=data.reviews.filter(r=>r.userId===data.user.id),posts=data.posts.filter(p=>p.userId===data.user.id);
  const ratedEntries=data.entries.filter(e=>e.rating!==null);
  const meanScore=ratedEntries.length?(ratedEntries.reduce((s,e)=>s+(e.rating||0),0)/ratedEntries.length).toFixed(2):'—';
  const scoreBuckets=[10,9,8,7,6,5,4,3,2,1].map(score=>({score,count:ratedEntries.filter(e=>e.rating===score).length}));
  const maxBucket=Math.max(1,...scoreBuckets.map(b=>b.count));
  const statsCats = Array.from(new Set([...customCategoryNames, ...data.entries.map(e=>books.get(e.bookId)?.category||'').filter(Boolean)]));
  const categoryBreakdown=statsCats.map(c=>({c,count:data.entries.filter(e=>books.get(e.bookId)?.category===c).length})).filter(x=>x.count>0);
  return <><div className="profile-hero"><div className="profile-avatar">{data.user.name.slice(0,1)||'读'}</div><div><div className="eyebrow">MY READING JOURNAL</div><h1>{data.user.name||'我的阅读空间'}</h1><p>把读过的世界，慢慢收藏起来。</p></div><span className="private-label"><LockKeyhole size={13}/>个人阅读记录仅自己可见</span></div><div className="profile-stats">{[{label:'收藏作品',value:data.entries.length},{label:'正在阅读',value:active.length},{label:'已经读完',value:data.entries.filter(e=>e.status==='已读').length},{label:'个人均分',value:meanScore}].map(s=><div key={s.label}><strong>{s.value}</strong><span>{s.label}</span></div>)}</div><div className="content-grid"><main className="main-column"><section className="section bangumi-stats-card"><Heading title="收藏规划与评分统计" caption={`${ratedEntries.length}/${data.entries.length} 部已评分`} action={<button type="button" className="text-button" onClick={()=>open({type:'taxonomy',tab:'rating'})}><SlidersHorizontal size={13}/>自定义分类 / 评分 / 标签</button>}/>{data.entries.length>0?<div className="bangumi-stats-grid"><div className="score-hist"><h3>个人评分分布</h3><div className="hist-bars">{scoreBuckets.map(b=><div key={b.score} className="hist-col" title={`${b.score}分${ratingLabels[String(b.score)]?`（${ratingLabels[String(b.score)]}）`:''}：${b.count} 本`}><span>{b.count||''}</span><div className="hist-track"><div className="hist-fill" style={{height:`${b.count?Math.max(10,b.count/maxBucket*100):0}%`}}/></div><small>{b.score}</small></div>)}</div></div><div className="cat-breakdown"><h3>门类收藏统计</h3><div className="cat-bars">{categoryBreakdown.map(item=><button key={item.c} type="button" className="cat-bar-row" onClick={()=>{setStatus('全部');setCategory(item.c);go('shelf');}}><span>{item.c}</span><i><b style={{width:`${item.count/data.entries.length*100}%`}}/></i><em>{item.count} 本</em></button>)}</div>{shelfTags.length>0&&<div className="profile-tag-cloud"><h4>高频标签</h4><div>{shelfTags.map(t=><button key={t} type="button" onClick={()=>{setStatus('全部');setCategory('全部');setTagFilter(t);go('shelf');}}>#{t}</button>)}</div></div>}</div></div>:<p className="small-muted">把作品加入书架并打分后，这里会自动生成你的 Bangumi 风格阅读雷达。</p>}</section><SyncPanel onPulled={()=>{void refreshAll();}}/><section className="section"><Heading title="我的读迹"/><Timeline limit={30}/></section><section className="section detail-section"><Heading title="我写的短评" caption={`${reviews.length} 条`}/>{reviews.length?reviews.map(r=><ReviewCard key={r.id} review={r}/>):<div className="compact-empty">尚未发布短评。进度窗口里的笔记会一直保持私密。</div>}</section><section className="section detail-section"><Heading title="我发起的讨论" caption={`${posts.length} 条`}/>{posts.length?posts.map(p=><PostRow key={p.id} post={p}/>):<div className="compact-empty">还没有发起讨论。</div>}</section></main><aside className="sidebar"><section className="side-section data-card"><Heading title="把记录握在手里"/><p>随时备份书架、进度和私人笔记，也可以从目次 Mokuji备份中恢复。</p><button className="button button-outline full" onClick={exportData}><Download size={14}/>导出阅读记录</button><button className="button button-outline full" onClick={()=>fileRef.current?.click()}><Upload size={14}/>导入目次 Mokuji备份</button><span className="small-muted">备份包含私人笔记，请妥善保存。</span></section><section className="side-section"><Heading title="关于目次 Mokuji"/><p className="about-copy">不论在哪个国家的文字里，<br/>不论在哪一台设备上阅读，<br/>这里都为你留一个书签。</p></section></aside></div></>;
 }
 const dialogBook=dialog&&'bookId'in dialog&&dialog.bookId?books.get(dialog.bookId):undefined;
 if(page==='workspace')return <ResumeWorkspace/>;
 const mobileTitles: Record<Page, string> = {
   home: '目次', shelf: '我的书架', read: '阅读中心', webfiction: '全网找书', sources: '书源与嗅探',
   discover: '发现好书', book: '作品详情', community: '阅读社区', post: '话题讨论', profile: '个人主页',
   body: '阅读正文', workspace: '工作区', mobile: '手机连接',
 };
 const showMobileBack = page === 'book' || page === 'post';
 const mobileBottomNav = [
   { key: 'shelf' as const, label: '书架', icon: Library, active: page === 'shelf' || page === 'home' },
   { key: 'sources' as const, label: '找书', icon: Compass, active: page === 'sources' || page === 'webfiction' || page === 'discover' || page === 'book' || page === 'community' || page === 'post' },
   { key: 'read' as const, label: '阅读', icon: BookOpen, active: page === 'read' },
   { key: 'profile' as const, label: '我的', icon: User, active: page === 'profile' },
 ];
 return <div className={page==='body'?'duji-app reader-focused':'duji-app'}><div className="top-accent"/><div className="local-notice"><strong>{localEngineMode==='local-offline'?'目次 Mokuji · 本机离线模式':connection?.mode==='server'?'目次 Mokuji · 服务器版':connection?'目次 Mokuji · 本地版':'目次 Mokuji'}</strong><span>{localEngineMode==='local-offline'?'数据已独立保存在本机（无需连电脑），点右侧可选填同步链接。':connection?.mode==='server'?'手机和电脑登录同一网址即可续读。':connection?.mode==='desktop'?'书架保存在这台电脑（已自动镜像本机离线缓存）。':connection?.mode==='mobile'?'正在与主机互通同步，离线时自动切回本机书架。':''}</span><a href="#/workspace" style={{display:'inline-flex',alignItems:'center',gap:4}}><Briefcase size={12}/>摸鱼工作区</a><a href="#/profile">云同步与可选连接</a><a href="/eink" target="_blank" rel="noreferrer">墨水屏版</a>{connection?.mode==='desktop'&&<a href="#/mobile">手机连接</a>}{connection?.mode==='mobile'&&<a href="/install/">手机安装</a>}</div><header className="site-header"><div className="header-inner">{showMobileBack?<button type="button" className="brand" onClick={()=>window.history.length>1?window.history.back():resetCatalog('shelf')} aria-label="返回"><span className="brand-mark"><ArrowLeft size={17}/></span><span className="mobile-screen-title">{mobileTitles[page]}</span></button>:<button className="brand" onClick={()=>{setCategory('全部');go('home');}} aria-label="目次 Mokuji 首页"><span className="brand-mark"><BookOpen size={24} strokeWidth={1.8}/></span><span className="brand-word">目次<small className="brand-latin"> Mokuji</small></span>{localEngineMode==='local-offline'&&<span className="mobile-mode-dot mobile-only-flex">本机</span>}</button>}<nav className="main-nav" aria-label="主导航">{nav.map(n=><button key={n.key} className={page===n.key||(n.key==='shelf'&&page==='home')||(n.key==='sources'&&(page==='webfiction'||page==='discover'||page==='book'||page==='community'||page==='post'))?'active':''} onClick={()=>resetCatalog(n.key)}>{n.title}</button>)}</nav><form className="header-search" onSubmit={e=>{e.preventDefault();setQuery(search.trim());setCategory('全部');go('discover');}}><Search size={15}/><input aria-label="全站搜索" placeholder="找一本书，一位作者…" value={search} onChange={e=>setSearch(e.target.value)}/><button type="submit" aria-label="搜索"><ArrowUpRight size={14}/></button></form><div className="mobile-top-actions"><a href="#/workspace" className="mobile-ws-pill"><Briefcase size={12}/>工作区</a><button type="button" className={'icon-button'+(mobileSearchOpen?' is-active':'')} aria-label="全站搜索" onClick={()=>setMobileSearchOpen(v=>!v)}><Search size={17}/></button><button type="button" className="icon-button" onClick={()=>setAppTheme(t=>t==='light'?'dark':'light')} aria-label={appTheme==='light'?'切换深色主题':'切换浅色主题'}>{appTheme==='light'?<Moon size={17}/>:<Sun size={17}/>}</button></div><button type="button" className="icon-button theme-toggle" onClick={()=>setAppTheme(t=>t==='light'?'dark':'light')} aria-label={appTheme==='light'?'切换深色主题':'切换浅色主题'} title={appTheme==='light'?'切换深色主题':'切换浅色主题'}>{appTheme==='light'?<Moon size={16}/>:<Sun size={16}/>}</button><button className="user-avatar" onClick={()=>go('profile')} aria-label="我的读迹" title="我的读迹">{data.user.name.slice(0,1)||'读'}</button></div>{mobileSearchOpen&&<div className="mobile-search-sheet"><form className="mobile-search-form" onSubmit={e=>{e.preventDefault();setMobileSearchOpen(false);setQuery(search.trim());setCategory('全部');go('discover');}}><Search size={15}/><input autoFocus aria-label="搜索书名或作者" placeholder="搜索书名、作者或标签…" value={search} onChange={e=>setSearch(e.target.value)}/><button type="submit" className="button button-sage" style={{height:28,padding:'0 10px',fontSize:12}}>搜索</button></form></div>}</header><div className={page==='profile'?'app-container is-profile':'app-container'}>{error&&!dialog&&<div className="error-banner" role="alert"><AlertCircle size={16}/><span>{error}</span><button aria-label="关闭错误提示" onClick={()=>setError('')}><X size={15}/></button></div>}{(page==='read'||page==='webfiction'||page==='sources')&&<ReaderHub browse={page==='webfiction'?'fiction':page==='sources'?'sources':'library'} onBrowse={mode=>go(mode==='fiction'?'webfiction':mode==='sources'?'sources':'read',id)} key={`${page}:${id||'all'}`} work={id?books.get(id):undefined} shelf={effectiveBooks.filter(item=>entries.has(item.id))} onRead={source=>readBook(source,id)} onBack={()=>go(id?'book':'shelf',id)} onJump={shelfId=>go('book',shelfId)} onAdd={addReaderBook}/>}
  {page==='body'&&<ReaderView key={id} id={id} onSwitchBook={sourceId=>{setReaderOrigin('');setFromFiction(false);go('body',sourceId);}} onBack={()=>go(readerOrigin?'book':fromFiction?'webfiction':'read',readerOrigin)}/>}
  {page==='mobile'&&connection?.mode==='desktop'&&<MobileConnection/>}
  {page==='home'&&Home()}{(page==='shelf'||page==='discover')&&Catalog()}{page==='book'&&(selected?Detail({book:selected}):<Empty title="没有找到这部作品" text="它可能尚未收录，或来自另一份书架。" action={<button className="button button-outline" onClick={()=>resetCatalog('shelf')}>返回书架</button>}/>)}{page==='community'&&Community()}{page==='post'&&(selectedPost?PostDetail({post:selectedPost}):<Empty title="这篇讨论暂时不在这里" text="它可能已经被删除。" action={<button className="button button-outline" onClick={()=>go('community')}>返回社区</button>}/>)}{page==='profile'&&Profile()}<footer className="site-footer"><span><BookOpen size={14}/>目次 Mokuji<span className="footer-dot">·</span>把阅读，留在这里。</span><div><button onClick={()=>go('profile')}>数据与备份</button><span>文字有边界，阅读没有。</span></div></footer></div>{page!=='body'&&<nav className="mobile-tabbar" aria-label="底部导航">{mobileBottomNav.map(item=>{const Icon=item.icon;return <button key={item.key} type="button" className={'mobile-tab-item'+(item.active?' active':'')} onClick={()=>resetCatalog(item.key)}><span className="mobile-tab-icon"><Icon size={18}/></span><span>{item.label}</span></button>;})}</nav>}{toast&&<div className="toast" role="status"><CheckCircle2 size={17}/>{toast}<button onClick={()=>setToast('')} aria-label="关闭通知"><X size={13}/></button></div>}<input ref={shelfImportRef} type="file" className="sr-only" accept={readerFileAccept} aria-label="导入本地书籍文件" onChange={e=>void handleQuickShelfImport(e.target.files?.[0])}/><input ref={fileRef} type="file" className="sr-only" accept="application/json,.json" aria-label="导入目次 Mokuji备份" onChange={e=>importData(e.target.files?.[0])}/>{dialog&&<Modal title={dialog.type==='resume'?'继续阅读':dialog.type==='progress'?'记下阅读的位置':dialog.type==='editBook'?'编辑作品资料':dialog.type==='taxonomy'?'自定义分类、评分与标签体系':dialog.type==='collection'?(dialog.collection?'编辑自定义书单':'新建自定义书单'):dialog.type==='add'?'让一本书加入你的世界':dialog.type==='review'?'写下阅读感受':dialog.type==='post'?'发起一场阅读讨论':dialog.type==='reply'?'回复这个话题':dialog.type==='import'?'导入阅读备份':dialog.type==='confirm'?dialog.title:'阅读记录'} subtitle={dialog.type==='resume'?dialog.title:dialog.type==='taxonomy'?'参考 Bangumi 打造完全属于你的门类、评分档位与 Tag 库':dialogBook?.title} busy={busy} onClose={close}>{error&&<div className="form-error" role="alert"><AlertCircle size={15}/><span>{error}</span></div>}{dialog.type==='progress'&&dialogBook&&<ProgressForm key={dialogBook.id} book={dialogBook} entry={entries.get(dialogBook.id)} ratingLabels={ratingLabels} busy={busy} onSave={e=>saveClose('saveEntry',{entry:e},'阅读记录已保存')} onCancel={close} onRemove={()=>open({type:'confirm',title:'将这本书移出书架？',body:'移出后不再显示在个人书架中。需要保留当前记录时，可以先在个人主页导出备份。',action:'removeEntry',payload:{bookId:dialogBook.id}})}/>}{dialog.type==='editBook'&&dialogBook&&<EditBookForm key={dialogBook.id} book={dialogBook} categoryNames={customCategoryNames} tagSuggestions={shelfTags} busy={busy} onCancel={close} onSave={async patch=>{const res=await mutateMeta({action:'editBook',workId:dialogBook.id,patch},'作品信息已更新');if(res)setDialog(null);}}/>}{dialog.type==='taxonomy'&&<TaxonomyManager key={dialog.tab} initialTab={dialog.tab} taxonomy={taxonomy} books={effectiveBooks} tagCounts={allCatalogTagCounts} busy={busy} onMutate={mutateMeta} onClose={close}/>}{dialog.type==='collection'&&<CollectionForm initial={dialog.collection} busy={busy} onCancel={close} onSave={async values=>{const res=await mutateMeta(dialog.collection?{action:'renameCollection',id:dialog.collection.id,...values}:{action:'createCollection',...values,workId:dialog.bookId},dialog.collection?'书单已更新':'书单已创建');if(res)setDialog(null);}}/>}{dialog.type==='add'&&<AddForm busy={busy} title={query} categoryDefs={customCategories} tagSuggestions={shelfTags} onCancel={close} onSave={async b=>{const rawCat=b.category||'文学';const isBase=categories.includes(rawCat as never);const beforeIds=new Set(effectiveBooks.map(x=>x.id));const res=await saveClose('addBook',{book:{...b,category:isBase?rawCat:'文学'}},'已添加到你的书架');if(res){const created=res.books.find(x=>!beforeIds.has(x.id)&&x.title===b.title);if(created&&(!isBase||b.tags?.length)){await mutateMeta({action:'editBook',workId:created.id,patch:{...(!isBase?{category:rawCat}:{}),...(b.tags?.length?{tags:b.tags}:{})}},'已添加到你的书架');}}resetCatalog('shelf');}}/>}{dialog.type==='review'&&dialogBook&&<ReviewForm entry={entries.get(dialogBook.id)} review={data.reviews.find(r=>r.bookId===dialogBook.id&&r.userId===data.user.id)} ratingLabels={ratingLabels} busy={busy} onCancel={close} onSave={v=>saveClose('review',{bookId:dialogBook.id,...v},'书评已发布')}/>}{dialog.type==='post'&&<PostForm books={effectiveBooks} initialBook={dialog.bookId||''} busy={busy} onCancel={close} onSave={async v=>{const r=await saveClose('post',v,'讨论已发布');if(r)go('community');}}/>}{dialog.type==='reply'&&<ReplyForm busy={busy} onCancel={close} onSave={body=>saveClose('reply',{postId:dialog.postId,body},'回复已发布')}/>}{dialog.type==='import'&&<div className="confirm-content"><div className="import-summary"><Upload size={25}/><strong>{dialog.count} 条阅读记录</strong></div><p>新作品会加入书架；同一本书的个人记录将以备份中的内容替换。未出现在备份中的记录会保留。</p><p className="small-muted">建议先导出当前记录。此操作不导入公开书评和讨论。</p><div className="modal-actions"><button className="button button-outline" disabled={busy} onClick={exportData}><Download size={14}/>先导出当前记录</button><button className="button button-coral" disabled={busy} onClick={()=>saveClose('import',{backup:dialog.backup},'备份已导入')}>{busy?'导入中…':'确认合并导入'}</button></div></div>}{dialog.type==='confirm'&&<div className="confirm-content"><p>{dialog.body}</p><div className="modal-actions"><button className="button button-outline" onClick={close} disabled={busy}>取消</button><button className="button button-danger" disabled={busy} onClick={()=>saveClose(dialog.action,dialog.payload,'已完成')}>{busy?'处理中…':'确认删除'}</button></div></div>}</Modal>}</div>;
}
function EditBookForm({book,categoryNames,tagSuggestions,busy,onSave,onCancel}:{book:Book;categoryNames:string[];tagSuggestions:string[];busy:boolean;onSave:(patch:Record<string,unknown>)=>Promise<unknown>;onCancel:()=>void}){
  const [cat,setCat]=useState<Category>(book.category);
  const [unit,setUnit]=useState<ProgressUnit>(book.unit);
  const [tagsVal,setTagsVal]=useState((book.tags||[]).join(', '));
  const opts = Array.from(new Set([...categoryNames, ...(cat ? [cat] : [])]));
  function toggleQuickTag(t:string){
    const cur=tagsVal.split(/[，,\s]+/).map(x=>x.trim()).filter(Boolean);
    const next=cur.includes(t)?cur.filter(x=>x!==t):[...cur,t];
    setTagsVal(next.join(', '));
  }
  return <form className="editor-form" onSubmit={e=>{
    e.preventDefault();
    const f=new FormData(e.currentTarget);
    const totalRaw=String(f.get('total')||'').trim();
    onSave({
      title:String(f.get('title')||'').trim(),
      originalTitle:String(f.get('originalTitle')||'').trim(),
      author:String(f.get('author')||'').trim(),
      country:String(f.get('country')||'').trim(),
      publicationStatus:String(f.get('publicationStatus')||'').trim(),
      edition:String(f.get('edition')||'').trim(),
      category:cat,
      unit,
      total:totalRaw?Number(totalRaw):null,
      tags:tagsVal.trim(),
      description:String(f.get('description')||'').trim(),
      color:String(f.get('color')||'').trim(),
    });
  }}>
    <fieldset disabled={busy}>
      <div className="form-row">
        <label className="field-label">书名 *<input name="title" required maxLength={160} defaultValue={book.title}/></label>
        <label className="field-label">外文/原名<input name="originalTitle" maxLength={160} defaultValue={book.originalTitle||''} placeholder="如日文原名或副标题"/></label>
      </div>
      <div className="form-row">
        <label className="field-label">作者<input name="author" maxLength={120} defaultValue={book.author}/></label>
        <label className="field-label">门类<select value={cat} onChange={e=>setCat(e.target.value as Category)}>{opts.map(c=><option key={c}>{c}</option>)}</select></label>
        <label className="field-label">连载/出版状态<select name="publicationStatus" defaultValue={book.publicationStatus||'未记录'}><option value="连载中">连载中</option><option value="已完结">已完结</option><option value="停更">停更 / 断更</option><option value="未记录">未记录</option></select></label>
      </div>
      <div className="form-row">
        <label className="field-label">国家 / 地区<input name="country" maxLength={40} defaultValue={book.country||''} placeholder="中国 / 日本 / 英国"/></label>
        <label className="field-label">连载平台 / 出版社<input name="edition" maxLength={120} defaultValue={book.edition||''} placeholder="如：起点 / 晋江 / 人民文学"/></label>
      </div>
      <div className="form-row">
        <label className="field-label">进度单位<select value={unit} onChange={e=>setUnit(e.target.value as ProgressUnit)}>{units.map(u=><option key={u}>{u}</option>)}</select></label>
        <label className="field-label">总章数/总页数<input name="total" type="number" min="1" max="999999" defaultValue={book.total??''} placeholder="例如 320"/></label>
        <label className="field-label">封面色<input name="color" type="color" defaultValue={book.color||'#5e6ad2'} style={{height:38,padding:4}}/></label>
      </div>
      <label className="field-label">标签（用空格或逗号分隔）<input value={tagsVal} onChange={e=>setTagsVal(e.target.value)} placeholder="如：悬疑, 推理, 群像, 必看"/></label>
      {!!tagSuggestions.length&&<div className="quick-tag-picks">{tagSuggestions.slice(0,14).map(t=><button type="button" key={t} className={tagsVal.split(/[，,\s]+/).includes(t)?'selected':''} onClick={()=>toggleQuickTag(t)}>+{t}</button>)}</div>}
      <label className="field-label">作品简介<textarea name="description" rows={4} maxLength={2000} defaultValue={book.description||''}/></label>
    </fieldset>
    <Actions busy={busy} onCancel={onCancel} label="保存作品资料"/>
  </form>;
}
function CollectionForm({initial,busy,onSave,onCancel}:{initial?:CollectionItem;busy:boolean;onSave:(v:{name:string;description:string})=>Promise<unknown>;onCancel:()=>void}){
  return <form className="editor-form" onSubmit={e=>{
    e.preventDefault();
    const f=new FormData(e.currentTarget);
    onSave({name:String(f.get('name')||'').trim(),description:String(f.get('description')||'').trim()});
  }}>
    <fieldset disabled={busy}>
      <label className="field-label">书单名称 *<input name="name" required maxLength={40} defaultValue={initial?.name||''} placeholder="如：2026 年度必看 / 通勤摸鱼长篇"/></label>
      <label className="field-label">书单说明（选填）<textarea name="description" rows={3} maxLength={160} defaultValue={initial?.description||''} placeholder="记录这个书单的筛选主题或收藏理由…"/></label>
    </fieldset>
    <Actions busy={busy} onCancel={onCancel} label={initial?'更新书单':'创建书单'}/>
  </form>;
}
function Actions({busy,onCancel,label='保存'}:{busy:boolean;onCancel:()=>void;label?:string}){return <div className="modal-actions"><button type="button" className="button button-outline" disabled={busy} onClick={onCancel}>取消</button><button type="submit" className="button button-sage" disabled={busy}><Check size={14}/>{busy?'保存中…':label}</button></div>;}
function ProgressForm({book,entry,ratingLabels,busy,onSave,onCancel,onRemove}:{book:Book;entry?:Entry;ratingLabels:Record<string,string>;busy:boolean;onSave:(v:Partial<Entry>&{bookId:string})=>Promise<unknown>;onCancel:()=>void;onRemove:()=>void}){const[unit,setUnit]=useState<ProgressUnit>(entry?.unit||book.unit);const[ratingVal,setRatingVal]=useState<number|null>(entry?.rating??null);return <form className="editor-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);onSave({bookId:book.id,status:f.get('status') as ReadingStatus,unit,position:unit==='位置'?null:num(f.get('position')),volume:unit==='章'||unit==='话'?num(f.get('volume')):null,locationText:String(f.get('location')||''),note:String(f.get('note')||''),edition:String(f.get('edition')||''),sourceUrl:String(f.get('source')||''),rating:ratingVal});}}><fieldset disabled={busy}><label className="field-label">阅读状态<select name="status" defaultValue={entry?.status||'在读'}>{statuses.map(s=><option key={s}>{s}</option>)}</select></label><div className="progress-form-box"><div className="form-row"><label className="field-label">记录方式<select value={unit} onChange={e=>setUnit(e.target.value as ProgressUnit)}>{units.map(u=><option key={u} value={u}>{u==='%'?'百分比':u==='位置'?'文字位置':`按${u}记录`}</option>)}</select></label>{unit!=='位置'&&<label className="field-label">{unit==='%'?'阅读百分比':`当前${unit}数`}<div className="input-with-unit"><input key={unit} name="position" type="number" min="0" max={unit==='%'?100:undefined} step={unit==='%'?'0.1':'1'} defaultValue={entry?.unit===unit?entry.position??'':''} placeholder="可以暂时不填"/><span>{unit}</span></div></label>}{(unit==='章'||unit==='话')&&<label className="field-label narrow-field">卷数（选填）<input name="volume" type="number" min="0" step="1" defaultValue={entry?.volume??''} placeholder="第几卷"/></label>}</div><label className="field-label">{unit==='位置'?'当前位置':'位置备注（选填）'}<input name="location" maxLength={300} defaultValue={entry?.locationText||''} placeholder="例如：第二篇第三章，下次从这一节开始"/></label><p className="field-help">只记录你读到哪里。未知总量也能保存，不会自动标记读完。</p></div><div className="rating-picker compact-picker"><span>我的评分（私密 · {ratingVal?`${ratingVal} 分「${ratingLabels[String(ratingVal)]||''}」`:'暂未评分'}）</span><div>{Array.from({length:10},(_,i)=>i+1).map(v=><button key={v} type="button" className={ratingVal!==null&&ratingVal>=v?'filled':''} title={`${v} 分 · ${ratingLabels[String(v)]||''}`} onClick={()=>setRatingVal(ratingVal===v?null:v)}><Star size={20} fill={ratingVal!==null&&ratingVal>=v?'currentColor':'none'}/></button>)}</div></div><label className="field-label">版本 / 设备备注<input name="edition" maxLength={200} defaultValue={entry?.edition||book.edition||''} placeholder="译本、出版社或阅读软件"/></label><label className="field-label">阅读链接（选填）<input name="source" type="url" maxLength={2000} defaultValue={entry?.sourceUrl||''} placeholder="https://…"/></label><label className="field-label">私人笔记 <span className="inline-private"><LockKeyhole size={11}/>仅自己可见</span><textarea name="note" rows={3} maxLength={10000} defaultValue={entry?.note||''} placeholder="留下一个想法，或给下次阅读的提醒。"/></label></fieldset><div className="modal-actions split">{entry?<button className="text-button danger" type="button" onClick={onRemove} disabled={busy}>移出书架</button>:<span/>}<div><button className="button button-outline" type="button" onClick={onCancel} disabled={busy}>取消</button><button className="button button-sage" type="submit" disabled={busy}><Check size={14}/>{busy?'保存中…':'保存阅读记录'}</button></div></div></form>;}
function AddForm({busy,title,categoryDefs,tagSuggestions,onSave,onCancel}:{busy:boolean;title:string;categoryDefs:{name:string;unit:ProgressUnit}[];tagSuggestions:string[];onSave:(v:Partial<Book>)=>Promise<unknown>;onCancel:()=>void}){const[category,setCategory]=useState<Category>(categoryDefs[0]?.name||'文学'),[unit,setUnit]=useState<ProgressUnit>(categoryDefs[0]?.unit||'页'),[tagsVal,setTagsVal]=useState(''),[expanded,setExpanded]=useState(false);function toggleTag(t:string){const cur=tagsVal.split(/[，,\s]+/).map(x=>x.trim()).filter(Boolean);setTagsVal((cur.includes(t)?cur.filter(x=>x!==t):[...cur,t]).join(', '));}return <form className="editor-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);const tags=tagsVal.split(/[，,\s]+/).map(x=>x.trim()).filter(Boolean);onSave({title:String(f.get('title')).trim(),author:String(f.get('author')||''),category,unit,tags,description:String(f.get('description')||''),edition:String(f.get('edition')||''),sourceUrl:String(f.get('source')||'')});}}><fieldset disabled={busy}><div className="form-hint"><Bookmark size={16}/><p>填一个书名就能开始，支持选用自定义门类与快捷打 Tag。</p></div><label className="field-label">书名 <span className="required">*</span><input name="title" defaultValue={title} maxLength={200} required placeholder="你正在读哪一本书？"/></label><div className="form-row"><label className="field-label">作品门类<select value={category} onChange={e=>{const c=e.target.value as Category;setCategory(c);const def=categoryDefs.find(x=>x.name===c);setUnit(def?.unit||(c==='漫画'?'话':c==='网文'||c==='轻小说'?'章':'页'));}}>{categoryDefs.map(c=><option key={c.name}>{c.name}</option>)}</select></label><label className="field-label">进度单位<select value={unit} onChange={e=>setUnit(e.target.value as ProgressUnit)}>{units.map(u=><option key={u} value={u}>{u==='%'?'百分比':u==='位置'?'文字位置':u}</option>)}</select></label></div><label className="field-label">作者（选填）<input name="author" maxLength={200} placeholder="作者姓名"/></label><label className="field-label">标签 Tag（选填，逗号或空格分隔）<input value={tagsVal} onChange={e=>setTagsVal(e.target.value)} placeholder="如：轻小说, 群像, 神展开"/></label>{!!tagSuggestions.length&&<div className="quick-tag-picks">{tagSuggestions.slice(0,12).map(t=><button type="button" key={t} className={tagsVal.split(/[，,\s]+/).includes(t)?'selected':''} onClick={()=>toggleTag(t)}>+{t}</button>)}</div>}<button type="button" className="text-button more-fields" onClick={()=>setExpanded(!expanded)}>{expanded?'收起补充资料':'补充简介、版本与阅读链接'}<ChevronRight size={13}/></button>{expanded&&<><label className="field-label">简介<textarea name="description" rows={3} maxLength={5000}/></label><label className="field-label">版本备注<input name="edition" maxLength={200}/></label><label className="field-label">阅读链接<input name="source" type="url" maxLength={2000} placeholder="https://…"/></label></>}</fieldset><Actions busy={busy} onCancel={onCancel} label="加入我的书架"/></form>;}
function ReviewForm({entry,review,ratingLabels,busy,onSave,onCancel}:{entry?:Entry;review?:Review;ratingLabels:Record<string,string>;busy:boolean;onSave:(v:Record<string,unknown>)=>Promise<unknown>;onCancel:()=>void}){const[score,setScore]=useState<number|null>(review?.score??null);return <form className="editor-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);onSave({score,body:String(f.get('body')).trim(),spoiler:f.get('spoiler')==='on',progress:f.get('progress')==='on'&&entry?progressLabel(entry):''});}}><fieldset disabled={busy}><div className="rating-picker"><span>给这本书打几分？</span><div>{Array.from({length:10},(_,i)=>i+1).map(v=><button key={v} type="button" className={score!==null&&score>=v?'filled':''} aria-label={`${v} 分`} title={`${v} 分 · ${ratingLabels[String(v)]||''}`} aria-pressed={score===v} onClick={()=>setScore(score===v?null:v)}><Star size={24} fill={score!==null&&score>=v?'currentColor':'none'}/></button>)}</div><p>{score?`${score} / 10 · ${ratingLabels[String(score)]||''}`:'也可以只写感受，暂不评分'}</p></div><label className="field-label">你的短评<textarea name="body" rows={6} defaultValue={review?.body||''} maxLength={10000} placeholder="读这本书时，有什么想留下来的？"/></label><label className="checkbox-label"><input name="spoiler" type="checkbox" defaultChecked={review?.spoiler||false}/>内容包含剧透，默认折叠</label>{entry&&<label className="checkbox-label"><input name="progress" type="checkbox" defaultChecked={!!review?.progress}/>附上当前阅读位置：{progressLabel(entry)}</label>}<p className="field-help">发布后对有权访问本站的人可见。私人评分和笔记不会自动公开。</p></fieldset><Actions busy={busy} onCancel={onCancel} label={review?'更新书评':'发布书评'}/></form>;}
function TaxonomyManager({initialTab,taxonomy,books,tagCounts,busy,onMutate,onClose}:{initialTab:'categories'|'rating'|'tags';taxonomy:ShelfTaxonomy;books:Book[];tagCounts:[string,number][];busy:boolean;onMutate:(payload:Record<string,unknown>,msg?:string)=>Promise<unknown>;onClose:()=>void}){
  const [tab,setTab]=useState(initialTab);
  const [catList,setCatList]=useState(taxonomy.categories);
  const [newCat,setNewCat]=useState('');
  const [newUnit,setNewUnit]=useState<ProgressUnit>('章');
  const [labels,setLabels]=useState<Record<string,string>>(taxonomy.ratingLabels);
  const [bands,setBands]=useState(taxonomy.ratingBands);
  const [newTag,setNewTag]=useState('');
  const [editingTag,setEditingTag]=useState('');
  const [renameTo,setRenameTo]=useState('');

  useEffect(()=>{setCatList(taxonomy.categories);setLabels(taxonomy.ratingLabels);setBands(taxonomy.ratingBands);},[taxonomy]);

  function moveCat(idx:number,dir:-1|1){
    const target=idx+dir;
    if(target<0||target>=catList.length)return;
    const next=[...catList];
    [next[idx],next[target]]=[next[target],next[idx]];
    setCatList(next);
  }
  function addCatLocal(){
    const name=newCat.trim();
    if(!name||catList.some(c=>c.name===name))return;
    setCatList([...catList,{name,unit:newUnit}]);
    setNewCat('');
  }
  function buildExistingTagsMap(){
    const m:Record<string,string[]>={};
    for(const b of books){if(b.tags?.length)m[b.id]=b.tags;}
    return m;
  }

  return <div className="taxonomy-manager">
    <div className="status-tabs" style={{marginBottom:14}}>
      <button type="button" className={tab==='categories'?'selected':''} onClick={()=>setTab('categories')}>自定义门类</button>
      <button type="button" className={tab==='rating'?'selected':''} onClick={()=>setTab('rating')}>评分文案与筛选档位</button>
      <button type="button" className={tab==='tags'?'selected':''} onClick={()=>setTab('tags')}>标签 Tag 库</button>
    </div>

    {tab==='categories'&&<div className="tax-pane">
      <p className="field-help" style={{marginTop:0}}>添加、改名、调整排序或设置默认计数单位（章/话/页）。所有下拉选框与筛选栏会立即同步。</p>
      <div className="tax-cat-add">
        <input value={newCat} onChange={e=>setNewCat(e.target.value)} maxLength={24} placeholder="新门类名称（如：同人、剧本、画集、哲学）"/>
        <select value={newUnit} onChange={e=>setNewUnit(e.target.value as ProgressUnit)}>{units.map(u=><option key={u} value={u}>默认按 {u}</option>)}</select>
        <button type="button" className="button button-outline" disabled={!newCat.trim()||busy} onClick={addCatLocal}><Plus size={14}/>添加</button>
      </div>
      <div className="tax-cat-list">
        {catList.map((c,i)=><div key={`${c.name}-${i}`} className="tax-cat-row">
          <input value={c.name} maxLength={24} onChange={e=>{const v=e.target.value;setCatList(list=>list.map((x,j)=>j===i?{...x,name:v}:x));}}/>
          <select value={c.unit} onChange={e=>{const u=e.target.value as ProgressUnit;setCatList(list=>list.map((x,j)=>j===i?{...x,unit:u}:x));}}>{units.map(u=><option key={u} value={u}>{u}</option>)}</select>
          <button type="button" className="icon-button" disabled={i===0} onClick={()=>moveCat(i,-1)} title="上移"><ArrowUp size={14}/></button>
          <button type="button" className="icon-button" disabled={i===catList.length-1} onClick={()=>moveCat(i,1)} title="下移"><ArrowDown size={14}/></button>
          <button type="button" className="icon-button" disabled={catList.length<=1} onClick={()=>setCatList(list=>list.filter((_,j)=>j!==i))} title="删除"><Trash2 size={14}/></button>
        </div>)}
      </div>
      <div className="modal-actions split" style={{marginTop:14}}>
        <button type="button" className="text-button quiet" disabled={busy} onClick={()=>void onMutate({action:'saveCategories',reset:true},'已恢复默认门类')}>恢复默认门类</button>
        <div>
          <button type="button" className="button button-outline" onClick={onClose}>关闭</button>
          <button type="button" className="button button-sage" disabled={busy} onClick={async()=>{if(await onMutate({action:'saveCategories',categories:catList},'自定义门类已保存'))onClose();}}><Check size={14}/>保存门类</button>
        </div>
      </div>
    </div>}

    {tab==='rating'&&<div className="tax-pane">
      <div className="tax-presets">
        <span>一键切换体系：</span>
        <button type="button" className="button button-outline" disabled={busy} onClick={()=>void onMutate({action:'saveRatingConfig',preset:'bangumi'},'已切换为 Bangumi 标准 10 分制')}>Bangumi 标准（超神作 ~ 不忍直视）</button>
        <button type="button" className="button button-outline" disabled={busy} onClick={()=>void onMutate({action:'saveRatingConfig',preset:'webnovel'},'已切换为网文仙草评分体系')}>网文/轻小说（仙草 ~ 毒草）</button>
        <button type="button" className="button button-outline" disabled={busy} onClick={()=>void onMutate({action:'saveRatingConfig',preset:'compact'},'已切换为精简筛选档位')}>精简档位</button>
      </div>
      <div className="tax-score-grid">
        {[10,9,8,7,6,5,4,3,2,1].map(s=><label key={s} className="tax-score-item">
          <span>{s} 分</span>
          <input value={labels[String(s)]||''} maxLength={20} onChange={e=>setLabels({...labels,[String(s)]:e.target.value})}/>
        </label>)}
      </div>
      <h4 style={{margin:'12px 0 6px',fontSize:13}}>书架评分筛选按钮</h4>
      <div className="tax-band-list">
        {bands.map((b,i)=><div key={b.id+i} className="tax-band-row">
          <input value={b.label} maxLength={24} onChange={e=>{const v=e.target.value;setBands(list=>list.map((x,j)=>j===i?{...x,label:v}:x));}} placeholder="按钮名称"/>
          {b.min===null?<span className="small-muted">未评分项</span>:<>
            <input type="number" min={1} max={10} value={b.min} onChange={e=>{const v=Number(e.target.value);setBands(list=>list.map((x,j)=>j===i?{...x,min:v}:x));}}/>
            <span>~</span>
            <input type="number" min={1} max={10} value={b.max??b.min} onChange={e=>{const v=Number(e.target.value);setBands(list=>list.map((x,j)=>j===i?{...x,max:v}:x));}}/>
          </>}
          <button type="button" className="icon-button" disabled={bands.length<=1} onClick={()=>setBands(list=>list.filter((_,j)=>j!==i))}><Trash2 size={14}/></button>
        </div>)}
        <button type="button" className="text-button" onClick={()=>setBands([...bands,{id:'b'+Date.now(),label:'自定义分段',min:7,max:9}])}><Plus size={13}/>新增筛选分数段</button>
      </div>
      <div className="modal-actions" style={{marginTop:14}}>
        <button type="button" className="button button-outline" onClick={onClose}>关闭</button>
        <button type="button" className="button button-sage" disabled={busy} onClick={async()=>{if(await onMutate({action:'saveRatingConfig',ratingLabels:labels,ratingBands:bands},'评分体系已保存'))onClose();}}><Check size={14}/>保存评分配置</button>
      </div>
    </div>}

    {tab==='tags'&&<div className="tax-pane">
      <p className="field-help" style={{marginTop:0}}>参考 Bangumi 的用户常用 Tag 机制：可以预先固定高频常用 Tag（添加作品时可一键点击打标），也能重命名或批量清理全站标签。</p>
      <div className="tax-cat-add">
        <input value={newTag} onChange={e=>setNewTag(e.target.value)} placeholder="批量固定新标签（用空格或逗号分隔，如：日轻, 群像, 买股）"/>
        <button type="button" className="button button-sage" disabled={!newTag.trim()||busy} onClick={async()=>{if(await onMutate({action:'manageTag',op:'pin',tag:newTag},'已添加到常用标签库'))setNewTag('');}}><Plus size={14}/>加入常用</button>
      </div>
      <div className="tax-tag-table">
        {tagCounts.length?tagCounts.map(([tag,count])=><div key={tag} className="tax-tag-row">
          {editingTag===tag?<>
            <input value={renameTo} onChange={e=>setRenameTo(e.target.value)} maxLength={24}/>
            <button type="button" className="button button-sage" disabled={!renameTo.trim()||busy} onClick={async()=>{await onMutate({action:'manageTag',op:'rename',oldTag:tag,newTag:renameTo,existingTags:buildExistingTagsMap()},`已将标签 #${tag} 改为 #${renameTo}`);setEditingTag('');}}>确认</button>
            <button type="button" className="button button-outline" onClick={()=>setEditingTag('')}>取消</button>
          </>:<>
            <span className="tag-chip-name">#{tag}</span>
            <small>{count} 部作品使用</small>
            <button type="button" className="text-button" onClick={()=>{setEditingTag(tag);setRenameTo(tag);}}><PenLine size={12}/>改名</button>
            <button type="button" className="text-button danger" disabled={busy} onClick={()=>{if(window.confirm(`从常用列表和所有作品中移除标签 #${tag} ？`))void onMutate({action:'manageTag',op:'delete',tag,existingTags:buildExistingTagsMap()},`已移除标签 #${tag}`);}}><Trash2 size={12}/>删除</button>
          </>}
        </div>):<p className="small-muted">还没有标签，可在上方先预置几个常用 Tag。</p>}
      </div>
    </div>}
  </div>;
}
function PostForm({books,initialBook,busy,onSave,onCancel}:{books:Book[];initialBook:string;busy:boolean;onSave:(v:Record<string,unknown>)=>Promise<unknown>;onCancel:()=>void}){return <form className="editor-form" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);onSave({bookId:String(f.get('bookId')||''),title:String(f.get('title')).trim(),body:String(f.get('body')).trim(),spoiler:f.get('spoiler')==='on'});}}><fieldset disabled={busy}><label className="field-label">关联作品<select name="bookId" defaultValue={initialBook}><option value="">阅读交流 / 不关联作品</option>{books.map(b=><option key={b.id} value={b.id}>{b.title}</option>)}</select></label><label className="field-label">话题标题<input name="title" required minLength={2} maxLength={120} placeholder="你想和大家聊些什么？"/></label><label className="field-label">正文<textarea name="body" rows={7} required maxLength={10000} placeholder="一个问题、一段感想，或一次阅读发现。"/></label><label className="checkbox-label"><input name="spoiler" type="checkbox"/>涉及作品情节，标记为剧透</label><p className="field-help">讨论保存在当前书架。</p></fieldset><Actions busy={busy} onCancel={onCancel} label="发布讨论"/></form>;}
function ReplyForm({busy,onSave,onCancel}:{busy:boolean;onSave:(body:string)=>Promise<unknown>;onCancel:()=>void}){return <form className="editor-form" onSubmit={e=>{e.preventDefault();onSave(String(new FormData(e.currentTarget).get('body')).trim());}}><label className="field-label">你的回复<textarea name="body" rows={7} required maxLength={10000} disabled={busy} placeholder="写下你的想法…"/></label><Actions busy={busy} onCancel={onCancel} label="发布回复"/></form>;}
