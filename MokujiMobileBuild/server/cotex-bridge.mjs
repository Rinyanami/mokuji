import { createHash, randomUUID } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const MB=1024*1024;
const failure=(status,message,extra={})=>Object.assign(new Error(message),{status,extra});
const integer=n=>Number.isSafeInteger(n) && n>=0;
const pos=p=>({chapter:integer(p?.chapter)?p.chapter:0,paragraph:integer(p?.paragraph)?p.paragraph:0});
const same=(a,b)=>a.chapter===b.chapter && a.paragraph===b.paragraph;
const digest=text=>createHash("sha256").update(text).digest("hex");
const iso=stamp=>Number.isFinite(stamp) && stamp>0 && stamp<8.64e15?new Date(stamp).toISOString():null;

function readDocument(file,limit) {
  try {
    const info=lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size>limit) throw Error();
    const bytes=readFileSync(file);
    if (bytes.length>limit) throw Error();
    const obj=JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/,""));
    if (!obj || typeof obj!=="object" || Array.isArray(obj)) throw Error();
    return {obj,bytes,mtime:info.mtimeMs};
  } catch (e) {
    if (e.code==="ENOENT") return null;
    throw failure(503,"Cotex 文件正忙或暂时无法读取，请稍后重试。");
  }
}

function validateMetadata(input) {
  if (typeof input.version!=="string" || !/^[a-f0-9]{64}$/.test(input.version)) throw failure(400,"请提供当前资料版本");
  const {alias,bookmark,imageFold}=input;
  if (alias===undefined && bookmark===undefined && imageFold===undefined) throw failure(400,"没有要保存的变更");
  if (alias!==undefined && (typeof alias!=="string" || !alias.trim() || alias.length>100 || /[\x00-\x1f\x7f]/.test(alias))) throw failure(400,"工作标题应为 1 到 100 个可见字符");
  if (bookmark!==undefined && (!bookmark || !["add","remove"].includes(bookmark.action) || !integer(bookmark.chapter) || !integer(bookmark.paragraph))) throw failure(400,"书签位置无效");
  if (imageFold!==undefined && (!imageFold || !integer(imageFold.chapter) || !integer(imageFold.paragraph) || typeof imageFold.closed!=="boolean")) throw failure(400,"插图折叠状态无效");
}

export function createCotexBridge({db,cotexDir}) {
  db.exec(`CREATE TABLE IF NOT EXISTS reader_cotex_progress (
    book_id TEXT PRIMARY KEY,old_chapter INTEGER,old_paragraph INTEGER,
    chapter INTEGER,paragraph INTEGER,revision INTEGER,updated_at TEXT);
    CREATE TABLE IF NOT EXISTS reader_item_meta(book_id TEXT PRIMARY KEY,alias TEXT,bookmarks TEXT);
    CREATE TABLE IF NOT EXISTS reader_cotex_recent(book_id TEXT PRIMARY KEY,opened_at INTEGER);
    `);
  if(!db.prepare("PRAGMA table_info(reader_item_meta)").all().some(c=>c.name==="collapsed_images")) {
    db.exec("ALTER TABLE reader_item_meta ADD COLUMN collapsed_images TEXT NOT NULL DEFAULT '[]'");
  }
  const prev=db.prepare("SELECT old_chapter,old_paragraph,chapter,paragraph,revision,updated_at AS updatedAt FROM reader_cotex_progress WHERE book_id=?");
  const put=db.prepare("INSERT OR REPLACE INTO reader_cotex_progress VALUES(?,?,?,?,?,?,?)");
  const meta=db.prepare("SELECT alias,bookmarks,collapsed_images FROM reader_item_meta WHERE book_id=?");
  const setMeta=db.prepare("INSERT INTO reader_item_meta(book_id,alias,bookmarks,collapsed_images) VALUES(?,?,?,?) ON CONFLICT(book_id) DO UPDATE SET alias=excluded.alias,bookmarks=excluded.bookmarks,collapsed_images=excluded.collapsed_images");
  const opened=db.prepare("SELECT opened_at FROM reader_cotex_recent WHERE book_id=?");
  const metadataCache=new Map();
  const native=id=>typeof id==="string" && id.startsWith("cotex:");
  function embeddedMeta(file,info) {
    const key=info.mtimeMs+":"+info.size;
    const cached=metadataCache.get(file);
    if(cached?.key===key)return cached.value;
    const original=readDocument(file,96*MB)?.obj;
    if(!original)throw failure(404,"Cotex 书档不存在");
    const value={};
    for(const field of ["alias","progress","bookmarks","collapsed","collapsedImages","updatedAt"]) {
      if(original[field]!==undefined)value[field]=original[field];
    }
    // Cache only metadata. A native novel can be tens of megabytes.
    metadataCache.set(file,{key,value});
    if(metadataCache.size>32)metadataCache.delete(metadataCache.keys().next().value);
    return value;
  }
  function nativeFile(id) {
    const suffix=id.slice(6);
    if (!cotexDir || !/^[A-Za-z0-9_-]{1,100}$/.test(suffix)) throw failure(404,"未找到该本地书档");
    return path.join(cotexDir,"books",suffix+".json");
  }
  function tx(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {const value=fn();db.exec("COMMIT");return value;}
    catch(e){db.exec("ROLLBACK");throw e;}
  }
  function retryNativeWrite(fn,onCollision) {
    for(let attempt=0;;attempt++) {
      try{return tx(fn);}catch(e){
        if(!e.nativeRace)throw e;
        if(attempt>=2)throw failure(409,"Cotex 正在更新该书，请刷新后重试",onCollision());
      }
    }
  }
  function observed(book,raw,legacy) {
    const current=pos(raw.progress);
    const state=prev.get(book.id);
    if (state && state.old_chapter===current.chapter && state.old_paragraph===current.paragraph) {
      const {chapter,paragraph,revision,updatedAt}=state;
      return {chapter,paragraph,revision,updatedAt};
    }
    const time=Number(raw.updatedAt)||0;
    const keepLegacy=!state && legacy && (same(legacy,current) || Date.parse(legacy.updatedAt)>time);
    const next=keepLegacy?legacy:{...current,revision:state ? state.revision+1 : legacy ? legacy.revision+1 : 0,updatedAt:iso(time)};
    put.run(book.id,current.chapter,current.paragraph,next.chapter,next.paragraph,next.revision,next.updatedAt);
    return next;
  }
  function decorate(book,legacy) {
    if (!native(book.id)) {
      const record=meta.get(book.id);
      return {...book,...(record?.alias?{workAlias:record.alias}:{}),progress:legacy || book.progress || {chapter:0,paragraph:0,revision:0,updatedAt:null}};
    }
    return tx(()=>{
      const {nativeUpdatedAt,...result}=book;
      let snapshot;
      try {
        const filename=nativeFile(book.id)+".state";
        let doc;
        try {doc=readDocument(filename,3*MB);}
        catch(e) {
          doc=readDocument(filename+".bak",3*MB);
          if(!doc)throw e;
        }
        snapshot=(doc || readDocument(filename+".bak",3*MB))?.obj;
      } catch {
        // One unreadable book cannot prevent opening the rest of the shelf.
        const held=prev.get(book.id);
        const known=held ? {chapter:held.chapter,paragraph:held.paragraph,revision:held.revision,updatedAt:held.updatedAt} : legacy || book.progress;
        return {...result,progress:known};
      }
      const raw={progress:snapshot?.progress || book.progress,updatedAt:snapshot?.updatedAt || nativeUpdatedAt};
      return {...result,workAlias:snapshot?.alias || book.workAlias,progress:observed(book,raw,legacy)};
    });
  }

  function nativeContext(book,forWrite=false) {
    const file=nativeFile(book.id);
    let primary;
    try {primary=readDocument(file+".state",3*MB);} catch(e) {
      if(forWrite)throw e;
      primary=readDocument(file+".state.bak",3*MB);
      if(!primary)throw e;
    }
    for(const dir of [cotexDir,path.dirname(file)]) if (lstatSync(dir).isSymbolicLink()) throw failure(503,"Cotex 书库位置无法安全写入");
    const info=lstatSync(file,{throwIfNoEntry:false});
    if (!info?.isFile()) throw failure(404,"该书已从 Cotex 移除");
    const base=(primary || readDocument(file+".state.bak",3*MB))?.obj;
    const needsBook=!base || !Array.isArray(base.bookmarks) || !Array.isArray(base.collapsedImages) || !base.progress || typeof base.alias!=="string";
    const values=needsBook?embeddedMeta(file,info):{};
    return {file,primary,values:{...values,...base}};

  }
  function writeNative(context,changes) {
    const file=context.file+".state";
    const temp=file+".mokuji-"+randomUUID()+".tmp";
    let descriptor;
    try {
      descriptor=openSync(temp,"wx");
      writeFileSync(descriptor,JSON.stringify({...context.values,...changes,updatedAt:Date.now()}),"utf8");
      fsyncSync(descriptor);closeSync(descriptor);descriptor=undefined;
      // Keep a recoverable copy without replacing previous native backups.
      if(context.primary) {
        try {writeFileSync(file+".bak",context.primary.bytes,{flag:"wx"});}
        catch(e){if(e.code!=="EEXIST")throw e;}
      }
      const current=readDocument(file,3*MB);
      // Cotex does not provide a file lock or compare-and-swap. Re-read immediately
      // before the rename; a native writer can still race in that final interval.
      const unchanged=(!current&&!context.primary) || (current && context.primary && current.bytes.equals(context.primary.bytes));
      if (!unchanged) throw Object.assign(failure(409,"Cotex 正在更新该书，请刷新后重试"),{nativeRace:true});
      renameSync(temp,file);
    } catch(e) {if(e.status)throw e;throw failure(503,"Cotex 状态文件暂不可写。请稍后重试。");}
    finally {if(descriptor!==undefined)closeSync(descriptor);try{unlinkSync(temp);}catch{}}
  }
  function mutateProgress(book,chapter,paragraph,revision,legacy) {
    // A native rename and a SQLite commit cannot be one transaction. On a crash,
    // the next read observes the rename; repeating the same request is idempotent.
    return retryNativeWrite(()=>{
      const ctx=nativeContext(book,true);
      const latest=observed(book,ctx.values,legacy);
      if(same(latest,{chapter,paragraph}) && same(pos(ctx.values.progress),{chapter,paragraph}))return {progress:latest};
      if(latest.revision!==revision)throw failure(409,"另一端已保存了新位置",{progress:latest});
      const next={chapter,paragraph,revision:latest.revision+1,updatedAt:new Date().toISOString()};
      writeNative(ctx,{progress:{...ctx.values.progress,chapter,paragraph,finished:!!ctx.values.progress?.finished && same(pos(ctx.values.progress),next)}});
      put.run(book.id,chapter,paragraph,chapter,paragraph,next.revision,next.updatedAt);
      return {progress:next};
    },()=>({progress:decorate(book,legacy).progress}));
  }
  function view(book,values) {
    const workAlias=typeof values.alias==="string"?values.alias:"";
    const bookmarks=Array.isArray(values.bookmarks)?values.bookmarks.filter(m=>integer(m?.chapter)&&integer(m?.paragraph)).map(({chapter,paragraph,createdAt})=>({chapter,paragraph,createdAt:integer(createdAt)?createdAt:0})):[];
    const collapsedImages=Array.isArray(values.collapsedImages)?[...new Set(values.collapsedImages.filter(k=>typeof k==="string" && /^\d+:\d+$/.test(k)))]:[];
    const version=digest(JSON.stringify([book.id,workAlias,bookmarks,collapsedImages]));
    return {id:book.id,workAlias,bookmarks,collapsedImages,version,lastOpenedAt:iso(opened.get(book.id)?.opened_at)};
  }
  function ownMeta(id){const r=meta.get(id);return {alias:r?.alias||"",bookmarks:r?JSON.parse(r.bookmarks):[],collapsedImages:r?JSON.parse(r.collapsed_images):[]};}
  function readMetadata(book) {return view(book,native(book.id)?nativeContext(book).values:ownMeta(book.id));}
  function applyMetadata(book,input) {
    validateMetadata(input);
    return retryNativeWrite(()=>{
      const ctx=native(book.id)?nativeContext(book,true):null;
      const values=ctx?ctx.values:ownMeta(book.id);
      const state=view(book,values);
      const alias=input.alias?.trim() ?? state.workAlias;
      const mark=input.bookmark;
      const exists=mark && state.bookmarks.some(b=>same(b,mark));
      const changedBookmark=!!mark && exists!==(mark.action==="add");
      const fold=input.imageFold;
      const group=fold ? fold.chapter+":"+fold.paragraph : null;
      const changedFold=!!fold && state.collapsedImages.includes(group)!==fold.closed;
      if(!changedBookmark && !changedFold && alias===state.workAlias)return {state};
      if(state.version!==input.version)throw failure(409,"其他设备已更新工作标题或书签",{state});
      let bookmarks=Array.isArray(values.bookmarks)?values.bookmarks:[];
      if(changedBookmark) {
        if(mark.action==="add" && bookmarks.length>=500)throw failure(400,"每本书最多可收藏 500 个书签");
        bookmarks=mark.action==="add"?[...bookmarks,{chapter:mark.chapter,paragraph:mark.paragraph,createdAt:Date.now()}]:
          bookmarks.filter(b=>!b || !same(b,mark));
      }
      let collapsedImages=Array.isArray(values.collapsedImages)?values.collapsedImages:[];
      if(changedFold)collapsedImages=fold.closed?[...collapsedImages,group]:collapsedImages.filter(k=>k!==group);
      if(ctx)writeNative(ctx,{...(input.alias===undefined?{}:{alias}),...(changedBookmark?{bookmarks}:{}),...(changedFold?{collapsedImages}:{})});
      else setMeta.run(book.id,alias,JSON.stringify(bookmarks),JSON.stringify(collapsedImages));
      return {state:view(book,{alias,bookmarks,collapsedImages})};
    },()=>({state:readMetadata(book)}));
  }
  function touch(id) {
    return tx(()=>{
      const previous=db.prepare("SELECT MAX(opened_at) AS stamp FROM reader_cotex_recent").get().stamp || 0;
      const time=Math.max(Date.now(),previous+1);
      db.prepare("INSERT OR REPLACE INTO reader_cotex_recent VALUES(?,?)").run(id,time);
      return {openedAt:iso(time)};
    });
  }
  function recent(items) {
    const ids=new Set(items.map(b=>b.id));
    let recentCotex=null;
    if(cotexDir && items.some(b=>native(b.id))) {
      let index;
      try {index=readDocument(path.join(cotexDir,"library.json"),12*MB);}catch{}
      const id="cotex:"+index?.obj?.activeId;
      // Cotex exposes its active id but has no dedicated last-open timestamp.
      if(ids.has(id))recentCotex={id,at:Math.round(index.mtime),source:"native-active"};
    }
    let recentReader=recentCotex;
    const rows=db.prepare("SELECT book_id,opened_at FROM reader_cotex_recent ORDER BY opened_at DESC").iterate();
    for(const row of rows) {
      if(!ids.has(row.book_id))continue;
      const entry={id:row.book_id,at:row.opened_at,source:"mokuji-open"};
      if(!recentReader || entry.at>recentReader.at)recentReader=entry;
      if(native(row.book_id)) {
        if(!recentCotex || entry.at>recentCotex.at)recentCotex=entry;
        break;
      }
    }
    return {recentCotex,recentReader};
  }
  return {decorate,mutateProgress,readMetadata,validateMetadata,applyMetadata,touch,recent};
}
