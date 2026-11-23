import { readFile, stat } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { webFictionPage } from "./web-fiction.mjs";
import { listOnlineBooks, findOnlineBook, onlineDetails, onlineChapter } from "./online-catalog.mjs";
import { createOnlineCache } from "./online-cache.mjs";
import { resolveWikiText } from "./wiki-import.mjs";
import { cotexOrigin, cotexChapterAccess, cotexChapterLocked } from "./cotex-native-source.mjs";
import { createKodoStore } from "./kodo-storage.mjs";
import { createEpubStorage, decodeUploadedText, nativePictures, readBookUpload } from "./epub-storage.mjs";
import { createCotexBridge } from "./cotex-bridge.mjs";
import { createCustomSources } from "./custom-sources.mjs";
import { createWebSniffer } from "./web-sniffer.mjs";

const MB = 1024 * 1024;
const textLimit = 8 * MB;
const maxNative = 96 * MB;
const memoLimit = 48 * MB;
const nativeId = /^[A-Za-z0-9_-]{1,100}$/;
function chapterUnits(chapter) {
  return (chapter.images || []).reduce((count,image)=>Number.isSafeInteger(image?.paragraph)
    ? Math.max(count,image.paragraph+1) : count, Math.max(1,chapter.paragraphs.length));
}
const integral = n => Number.isSafeInteger(n) && n >= 0;
const brief = (v, max = 240) => typeof v === "string" ? v.trim().slice(0, max) : "";
const zero = () => ({chapter:0, paragraph:0, revision:0, updatedAt:null});
const failure = (status, message, extra = {}) => Object.assign(new Error(message), {status, extra});
const result = (data, status = 200) => Response.json(data, {
  status, headers: {"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}
});
const badBook = () => failure(404, "没有找到这本书");
const flatProgress = p => ({
  chapter:integral(p?.chapter) ? p.chapter : 0,
  paragraph:integral(p?.paragraph) ? p.paragraph : 0, revision:0, updatedAt:null
});
async function tryJson(filename, limit) {
  try {
    const info = await stat(filename);
    if (!info.isFile() || info.size > limit) return null;
    return JSON.parse((await readFile(filename, "utf8")).replace(/^\uFEFF/,""));
  } catch { return null; }
}
function nativeText(c) {
  if (!c || cotexChapterLocked(c)) return [];
  if (!Array.isArray(c.paragraphs)) return [];
  // Some source adapters store a single access prompt in place of actual paragraphs.
  const p = c.paragraphs.filter(x => typeof x === "string");
  if (p.length <= 2 && p.join("").length < 170 && /(?:请先登录后阅读|本章(?:节)?(?:需要|需)订阅|订阅本章后(?:继续|即可)阅读|本章尚未(?:下载|缓存)|正文尚未(?:下载|缓存))/.test(p.join(""))) return [];
  return p.some(x => /\S/.test(x)) ? p : [];
}
function chapterHeading(line) {
  return line.length <= 105 && (/^(?:正文[\s：:]+)?第[零〇一二两三四五六七八九十百千万亿廿壹贰叁\d０-９]+[章节回卷篇部集幕](?:[\s、，,:：.．\-—].*|.{0,40})$/u.test(line) ||
    /^(?:chapter|book|part)\s+(?:\d+|[ivxlcdm]+)\b/i.test(line) ||
    /^(?:序章|序言|楔子|引子|尾声|后记|番外)(?:$|[\s：:、].*)/.test(line));
}
function splitUpload(text) {
  const chapters = [];
  let title = "", paragraphs = [], chars = 0, part = 1;
  function finish() {
    if (paragraphs.length) chapters.push({title:title || "正文",paragraphs});
    paragraphs = []; chars = 0;
  }
  function append(value) {
    if (chars >= 18000 || paragraphs.length >= 280) {
      finish(); part++;
      title = title.replace(/（续 \d+）$/,"") || "正文";
      title += "（续 " + part + "）";
    }
    paragraphs.push(value); chars += value.length;
  }
  for (const raw of text.replace(/^\uFEFF/,"").split(/\r\n?|\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (chapterHeading(line)) {
      finish(); title=line; part=1; continue;
    }
    for (let i=0; i<line.length;) {
      let end=Math.min(i+6000,line.length);
      const last=line.charCodeAt(end-1);
      if (end<line.length && last>=0xd800 && last<=0xdbff) end--;
      append(line.slice(i,end)); i=end;
    }
  }
  finish();
  if (!chapters.length && title) chapters.push({title,paragraphs:[title]});
  return chapters;
}
function getWork(value) {
  if (typeof value !== "string" || !value.trim() || value.length>300 || /[\u0000-\u001f]/.test(value)) throw failure(400,"作品标识无效");
  return value;
}
async function readPayload(req, limit) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") || "")) throw failure(415,"请发送 JSON");
  if (Number(req.headers.get("content-length"))>limit) throw failure(413,"文件过大");
  if (!req.body) throw failure(400,"缺少数据");
  const reader=req.body.getReader(), buffers=[];
  let bytes=0;
  try {
    while(true) {
      const part=await reader.read(); if (part.done) break;
      bytes+=part.value.byteLength;
      if (bytes>limit) {reader.cancel().catch(()=>{});throw failure(413,"文件过大");}
      buffers.push(Buffer.from(part.value));
    }
  } finally {reader.releaseLock();}
  try {
    const payload=JSON.parse(Buffer.concat(buffers).toString("utf8"));
    if (!payload || typeof payload!=="object" || Array.isArray(payload)) throw Error();
    return payload;
  } catch { throw failure(400,"JSON 格式无效"); }
}

export function createReaderSource({dataDir,objectStore=createKodoStore(),cotexDir = process.env.COTEX_DATA || process.env.DESKREADER_DATA || (process.env.APPDATA ? path.join(process.env.APPDATA,"DeskReader") : null)} = {}) {
  if (!dataDir) throw Error("dataDir is required");
  mkdirSync(dataDir,{recursive:true});
  const db=new DatabaseSync(path.join(dataDir,"reader.sqlite"));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3500");
  db.exec([
    "CREATE TABLE IF NOT EXISTS reader_bindings (work_id TEXT PRIMARY KEY,book_id TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS reader_progress (book_id TEXT PRIMARY KEY,chapter INTEGER NOT NULL,paragraph INTEGER NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS reader_uploads (id TEXT PRIMARY KEY,title TEXT NOT NULL,author TEXT NOT NULL,chapter_count INTEGER NOT NULL)",
    "CREATE TABLE IF NOT EXISTS reader_chapters (book_id TEXT NOT NULL REFERENCES reader_uploads(id), n INTEGER NOT NULL,title TEXT NOT NULL,paragraphs TEXT NOT NULL,PRIMARY KEY(book_id,n))"
  ].join(";"));
  db.exec("CREATE TABLE IF NOT EXISTS reader_kodo_text (book_id TEXT PRIMARY KEY REFERENCES reader_uploads(id), digest TEXT NOT NULL, format INTEGER NOT NULL DEFAULT 1)");
  const epub=createEpubStorage(db);
  const customSources=createCustomSources({db});
  db.exec(`CREATE TABLE IF NOT EXISTS reader_wiki_pages (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL, source TEXT NOT NULL,
    sourceUrl TEXT NOT NULL, revisionUrl TEXT NOT NULL, credits TEXT NOT NULL,
    license TEXT NOT NULL, licenseUrl TEXT NOT NULL, paragraphs TEXT NOT NULL
  )`);
  const wikiFields="id,title,author,source,sourceUrl,revisionUrl,credits,license,licenseUrl";
  const wikiList=db.prepare("SELECT "+wikiFields+" FROM reader_wiki_pages ORDER BY rowid DESC");
  const wikiLookup=db.prepare("SELECT "+wikiFields+" FROM reader_wiki_pages WHERE id=?");
  const wikiBody=db.prepare("SELECT paragraphs FROM reader_wiki_pages WHERE id=?");
  const wikiInsert=db.prepare("INSERT OR IGNORE INTO reader_wiki_pages("+wikiFields+",paragraphs) VALUES(?,?,?,?,?,?,?,?,?,?)");
  const wikiRecord=row=>row ? {...row,sourceType:"online",chapterCount:1,available:true,offlineAvailable:true,edition:"保存的维基文库版本"} : null;
  const findRemote=db.prepare("SELECT digest,format FROM reader_kodo_text WHERE book_id=?");
  const remoteBooks=new Map(), remotePending=new Map();
  function rememberRemote(digest, chapters) {
    remoteBooks.delete(digest);
    remoteBooks.set(digest,chapters);
    if (remoteBooks.size>2) remoteBooks.delete(remoteBooks.keys().next().value);
  }
  async function remoteChapters(reference) {
    if (reference.format!==1) throw failure(422,"请更新目次以阅读此版本的云端正文");
    const {digest}=reference;
    const cached=remoteBooks.get(digest);
    if (cached) {rememberRemote(digest,cached);return cached;}
    if (!objectStore) throw failure(503,"此书的正文保存在七牛，请在当前目次服务上配置原存储空间。");
    if (!remotePending.has(digest)) {
      const task=objectStore.getText(digest).then(text=>{
        const chapters=splitUpload(text);
        rememberRemote(digest,chapters);
        return chapters;
      }).finally(()=>remotePending.delete(digest));
      remotePending.set(digest,task);
    }
    return remotePending.get(digest);
  }
  const webCache=createOnlineCache(db,onlineChapter);
  const localCache=new Map(), loading=new Map();
  const progressStmt=db.prepare("SELECT chapter,paragraph,revision,updated_at AS updatedAt FROM reader_progress WHERE book_id=?");
  const byWork=db.prepare("SELECT book_id AS id FROM reader_bindings WHERE work_id=?");
  const bind=db.prepare("INSERT INTO reader_bindings(work_id,book_id) VALUES(?,?) ON CONFLICT(work_id) DO UPDATE SET book_id=excluded.book_id");
  const bridge=createCotexBridge({db,cotexDir});
  const pickProgress = b => bridge.decorate(b,progressStmt.get(b.id));
  const nativePath = id => path.join(cotexDir,"books",id+".json");

  const nativeCounts=new Map();
  async function nativeBooks({counts=false}={}) {
    if (!cotexDir) return [];
    const main=path.join(cotexDir,"library.json");
    const lib=await tryJson(main,12*MB) || await tryJson(main+".bak",12*MB);
    if (!Array.isArray(lib?.books)) return [];
    const entries=lib.books.filter(b=>b && typeof b.id==="string" && nativeId.test(b.id));
    const books=[];
    const batchSize=counts?3:24;
    for (let i=0; i<entries.length; i+=batchSize) {
      const page=await Promise.all(entries.slice(i,i+batchSize).map(async b=>{
        const file=nativePath(b.id);
        const fileStat=await stat(file).catch(()=>null);
        const origin=cotexOrigin(b.source);
        const sourceUrl=origin?.url || "";
        const book={
          id:"cotex:"+b.id,title:brief(b.title)||"未命名作品",author:brief(b.author,160),
          workAlias:brief(b.alias,100),nativeUpdatedAt:b.updatedAt,
          source:brief(b.source?.name,80)||"Cotex",sourceType:"cotex",sourceUrl,...(origin?{nativeSourceId:origin.id}:{}),
          chapterCount:integral(b.chapterCount)?b.chapterCount:0,
          available:!!(fileStat?.isFile() && fileStat.size<=maxNative),
          progress:flatProgress(b.progress)
        };
        if(counts && origin && book.available) {
          const stamp=fileStat.mtimeMs+":"+fileStat.size;
          let count=nativeCounts.get(book.id);
          if(count?.stamp!==stamp) {
            try {
              const rows=await loadNativeBook(book);
              count={stamp,total:rows.length,cached:rows.filter(c=>c.paragraphs.length||c.images?.length).length};
              nativeCounts.set(book.id,count);
              if(nativeCounts.size>800)nativeCounts.delete(nativeCounts.keys().next().value);
            } catch {count=null;}
          }
          if(count)return {...book,chapterCount:count.total,cachedChapterCount:count.cached,available:count.cached>0};
        }
        return book;
      }));
      books.push(...page);
    }
    return books;
  }
  async function loadNativeBook(book) {
    const file=nativePath(book.id.slice(6));
    const info=await stat(file).catch(()=>null);
    if (!book.available || !info?.isFile() || info.size>maxNative) throw failure(422,"这本书在 Cotex 中没有可读取的本地正文",{sourceUrl:book.sourceUrl});
    const stamp=info.mtimeMs+":"+info.size;
    const cached=localCache.get(book.id);
    if (cached?.stamp===stamp) {
      localCache.delete(book.id);localCache.set(book.id,cached);return cached.chapters;
    }
    const key=book.id+"@"+stamp;
    if (!loading.has(key)) {
      const task=(async()=>{
        const raw=await tryJson(file,maxNative);
        if (!Array.isArray(raw?.chapters)) throw failure(422,"本地书档暂不可读，可到 Cotex 检查后重试",{sourceUrl:book.sourceUrl});
        const origin=cotexOrigin(raw.source)||cotexOrigin({id:book.nativeSourceId,url:book.sourceUrl});
        const pictureCache=new Map();
        const chapters=raw.chapters.map((c,i)=>{
          const title=brief(c?.title,300)||"第 "+(i+1)+" 章";
          const paragraphs=nativeText(c);
          const native=cotexChapterAccess(c,origin,paragraphs,raw.fonts);
          const includePictures=native.access==="cached" || (!origin && native.access==="uncached");
          const pictures=includePictures ? nativePictures(c,raw.media,pictureCache) : {};
          return {title,...native,...pictures};
        });
        if (info.size<=memoLimit) {
          localCache.delete(book.id);
          localCache.set(book.id,{stamp,bytes:info.size,chapters});
          let total=[...localCache.values()].reduce((n,v)=>n+v.bytes,0);
          while(total>memoLimit || localCache.size>3) {
            const first=localCache.keys().next().value;
            total-=localCache.get(first).bytes;localCache.delete(first);
          }
        }
        return chapters;
      })().finally(()=>loading.delete(key));
      loading.set(key,task);
    }
    return loading.get(key);
  }
  function uploads() {
    return db.prepare("SELECT u.id,u.title,u.author,u.chapter_count AS chapterCount,CASE WHEN k.digest IS NULL THEN 'sqlite' ELSE 'kodo' END AS textStorage FROM reader_uploads u LEFT JOIN reader_kodo_text k ON k.book_id=u.id ORDER BY u.rowid DESC").all()
      .map(b=>({...b,source:b.id.startsWith("cbz:")?"CBZ/ZIP 漫画":b.id.startsWith("epub:")?"EPUB 导入":"TXT 导入",category:b.id.startsWith("cbz:")?"漫画":undefined,sourceType:"upload",sourceUrl:"",available:true,progress:zero()}));
  }
  async function books() {
    const native=await nativeBooks({counts:true});
    return [...native,...uploads(),...customSources.listBooks(),...wikiList.all().map(wikiRecord),...listOnlineBooks()].map(pickProgress);
  }
  async function getBook(id) {
    if (typeof id!=="string" || id.length>200) throw badBook();
    let found;
    if (id.startsWith("open:")) found=findOnlineBook(id);
    else if (id.startsWith("cotex:") && nativeId.test(id.slice(6))) found=(await nativeBooks()).find(b=>b.id===id);
    else if (id.startsWith("src:")) found=customSources.getBook(id);
    else if (/^wikisource:[1-9]\d{0,15}$/.test(id)) found=wikiRecord(wikiLookup.get(id));
    else if (id.startsWith("txt:") || id.startsWith("epub:") || id.startsWith("cbz:")) found=uploads().find(b=>b.id===id);
    if (!found) throw badBook();
    return pickProgress(found);
  }
  async function getDetails(book) {
    if (book.id.startsWith("src:")) return customSources.getDetails(book);
    if (book.id.startsWith("wikisource:")) {
      return {book,chapters:[{n:0,title:book.title,available:true}]};
    }
    if (book.sourceType==="online") {
      const d=await onlineDetails(book.id); if(!d) throw badBook();
      return {book:{...d.book,...book},chapters:d.chapters.map(c=>({...c,n:c.n-1}))};
    }
    let chapters;
    if (book.sourceType==="upload") {
      chapters=db.prepare("SELECT n,title FROM reader_chapters WHERE book_id=? ORDER BY n").all(book.id).map(c=>({...c,available:true}));
    } else {
      const rows=await loadNativeBook(book);
      chapters=rows.map((c,n)=>({n,title:c.title,available:c.paragraphs.length>0 || !!c.images?.length,...(book.nativeSourceId?{access:c.access,sourceUrl:c.sourceUrl,cached:c.access==="cached"}:{})}));
    }
    const availableCount=chapters.filter(c=>c.available).length;
    return {book:{...book,chapterCount:chapters.length,available:availableCount>0,...(book.nativeSourceId?{cachedChapterCount:availableCount}:{})},chapters};
  }
  async function getChapter(book,n) {
    if (!integral(n)) throw failure(400,"章节位置无效");
    if (book.id.startsWith("src:")) return customSources.getChapter(book,n);
    if (book.id.startsWith("wikisource:")) {
      if (n!==0) throw failure(404,"没有找到这一章");
      const {progress,...metadata}=book;
      return {...metadata,n,paragraphs:JSON.parse(wikiBody.get(book.id).paragraphs)};
    }
    if (book.sourceType==="online") {
      if (n>=book.chapterCount) throw failure(404,"没有找到这一章");
      const c=await webCache.read(book,n+1);
      if (!c) throw failure(404,"没有找到这一章");
      return {...c,n};
    }
    let body, count=book.chapterCount;
    if (book.sourceType==="cotex") {
      const rows=await loadNativeBook(book); count=rows.length;body=rows[n];
    } else {
      const row=db.prepare("SELECT title,paragraphs FROM reader_chapters WHERE book_id=? AND n=?").get(book.id,n);
      if (row) {
        const reference=findRemote.get(book.id);
        body=reference ? (await remoteChapters(reference))[n] : {title:row.title,paragraphs:JSON.parse(row.paragraphs),...((book.id.startsWith("epub:")||book.id.startsWith("cbz:"))?epub.pictures(book.id,n):{})};
      }
    }
    if (!body) throw failure(404,"没有找到这一章");
    const sourceUrl=body.sourceUrl||book.sourceUrl;
    if (body.requiresSourceFont) throw failure(422,"缺少本章需要的原站字体，请前往原站阅读。",{sourceUrl});
    if (body.access==="locked" || body.access==="platform") throw failure(422,"本章需在原站确认登录或订阅状态，请前往原站阅读。",{sourceUrl});
    if (!body.paragraphs?.length && !body.images?.length) throw failure(422,"本机尚未缓存这一章的正文。"+(sourceUrl?"可打开原站继续阅读。":""),{sourceUrl});
    return {id:book.id,n,title:body.title,paragraphs:body.paragraphs,chapterCount:count,source:book.source,sourceUrl,
      ...(body.images?.length?{images:body.images,media:body.media}:{}),...(body.sourceFonts?{sourceFonts:body.sourceFonts}:{})};
  }

  async function saveProgress(input) {
    const book=await getBook(input.id);
    const {chapter,paragraph,revision}=input;
    if (![chapter,paragraph,revision].every(integral) || paragraph>100000) throw failure(400,"阅读位置或版本号无效");
    if (chapter===book.progress.chapter && paragraph===book.progress.paragraph && revision!==book.progress.revision) return {progress:book.progress};
    if (revision!==book.progress.revision) throw failure(409,"另一台设备已保存了新位置",{progress:book.progress});
    if (book.sourceType==="online" && chapter>=book.chapterCount) throw failure(400,"所选章节超出目录");
    const current=await getChapter(book,chapter);
    if (paragraph>=chapterUnits(current)) throw failure(400,"所选段落超出正文");
    if (book.sourceType==="cotex") return bridge.mutateProgress(book,chapter,paragraph,revision,progressStmt.get(book.id));
    const stamp=new Date().toISOString();
    // Check again inside the transaction. Another client may save while we read the chapter.
    db.exec("BEGIN IMMEDIATE");
    try {
      const latest=progressStmt.get(book.id)||book.progress;
      if (latest.revision!==revision) {
        if (latest.chapter===chapter && latest.paragraph===paragraph) {
          db.exec("COMMIT");return {progress:latest};
        }
        throw failure(409,"另一台设备已保存了新位置",{progress:latest});
      }
      const next={chapter,paragraph,revision:latest.revision+1,updatedAt:stamp};
      db.prepare("INSERT INTO reader_progress(book_id,chapter,paragraph,revision,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(book_id) DO UPDATE SET chapter=excluded.chapter,paragraph=excluded.paragraph,revision=excluded.revision,updated_at=excluded.updated_at").run(book.id,chapter,paragraph,next.revision,stamp);
      db.exec("COMMIT");return {progress:next};
    } catch (error) {db.exec("ROLLBACK");throw error;}
  }
  async function importText(input,fromFile=false) {
    if (input.workId!==undefined) getWork(input.workId);
    const text=input.text;
    if(typeof text!=="string" || !text.trim()) throw failure(400,"TXT 文件没有正文");
    const textBytes=Buffer.byteLength(text,"utf8");
    if(!fromFile && textBytes>textLimit) throw failure(413,"大于 8 MiB 的 TXT 请用文件导入入口上传。");
    if (/[\0]/.test(text)) throw failure(400,"文件含有空字节，请导入可读的 TXT 文本");
    const filename=brief(input.filename,240).split(/[\\/]/).pop().replace(/\.te?xt$/i,"");
    const title=brief(input.title)||filename||"导入的 TXT",author=brief(input.author,160);
    const normalized=text.replace(/^\uFEFF/,"").replace(/\r\n?/g,"\n");
    const id="txt:"+createHash("sha256").update(JSON.stringify([title,author])).update("\0").update(normalized).digest("hex").slice(0,32);
    if (!db.prepare("SELECT 1 FROM reader_uploads WHERE id=?").get(id)) {
      const chapters=splitUpload(normalized);
      if (!chapters.length) throw failure(400,"TXT 文件没有正文");
      if (chapters.length>20000) throw failure(413,"章节数量超出上限");
      // The deterministic object is written before committing a library entry.
      // An interrupted import can safely retry without creating another object.
      const digest=objectStore && Buffer.byteLength(normalized,"utf8")<=textLimit ? createHash("sha256").update(normalized).digest("hex") : null;
      if (digest) await objectStore.putText(digest,normalized);
      db.exec("BEGIN IMMEDIATE");
      try {
        const inserted=db.prepare("INSERT OR IGNORE INTO reader_uploads(id,title,author,chapter_count) VALUES(?,?,?,?)").run(id,title,author,chapters.length);
        if (inserted.changes) {
          const insert=db.prepare("INSERT INTO reader_chapters(book_id,n,title,paragraphs) VALUES(?,?,?,?)");
          chapters.forEach((c,n)=>insert.run(id,n,c.title,digest ? "[]" : JSON.stringify(c.paragraphs)));
          if (digest) db.prepare("INSERT INTO reader_kodo_text(book_id,digest) VALUES(?,?)").run(id,digest);
        }
        if (input.workId!==undefined) bind.run(input.workId,id);
        db.exec("COMMIT");
      } catch(error) {db.exec("ROLLBACK");throw error;}
      if (digest) rememberRemote(digest,chapters);
    } else if (input.workId!==undefined) {bind.run(input.workId,id);}
    return {book:await getBook(id)};
  }
  async function importWiki(input) {
    if (input.workId!==undefined) getWork(input.workId);
    if (typeof input.url!=="string" || input.url.length>4096) throw failure(400,"请输入中文维基文库的作品网址");
    const page=await resolveWikiText(input.url);
    if (!/^wikisource:[1-9]\d{0,15}$/.test(page.stableId) || !Array.isArray(page.paragraphs) || !page.paragraphs.length) {
      throw failure(502,"来源没有返回可识别的作品");
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      // Saving the same page twice preserves its original revision and paragraph marks.
      wikiInsert.run(page.stableId,page.title,page.author||"",page.source,page.sourceUrl,page.revisionUrl,
        page.credits,page.license,page.licenseUrl,JSON.stringify(page.paragraphs));
      if (input.workId!==undefined) bind.run(input.workId,page.stableId);
      db.exec("COMMIT");
    } catch(error) {db.exec("ROLLBACK");throw error;}
    return {book:await getBook(page.stableId)};
  }
  async function deleteBookById(id) {
    const book=await getBook(id);
    if (book.id.startsWith("cotex:") || book.id.startsWith("open:")) {
      throw failure(400, book.id.startsWith("cotex:") ? "Cotex 原生书库书目请在 Cotex 中管理，此处可解除关联或取消收藏" : "内置在线公版书目不可删除");
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      if (book.id.startsWith("src:")) {
        customSources.deleteBook(book.id);
      } else if (book.id.startsWith("wikisource:")) {
        db.prepare("DELETE FROM reader_wiki_pages WHERE id=?").run(book.id);
      } else if (book.id.startsWith("txt:") || book.id.startsWith("epub:") || book.id.startsWith("cbz:")) {
        db.prepare("DELETE FROM reader_epub_images WHERE book_id=?").run(book.id);
        db.prepare("DELETE FROM reader_epub_media WHERE book_id=?").run(book.id);
        db.prepare("DELETE FROM reader_kodo_text WHERE book_id=?").run(book.id);
        db.prepare("DELETE FROM reader_chapters WHERE book_id=?").run(book.id);
        db.prepare("DELETE FROM reader_uploads WHERE id=?").run(book.id);
      }
      db.prepare("DELETE FROM reader_bindings WHERE book_id=?").run(book.id);
      db.prepare("DELETE FROM reader_progress WHERE book_id=?").run(book.id);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return { deletedId: book.id };
  }
  async function renameBookById(id, rawTitle, rawAuthor) {
    const book=await getBook(id);
    const title=brief(rawTitle, 240);
    const author=typeof rawAuthor === "string" ? brief(rawAuthor, 160) : book.author || "";
    if (!title) throw failure(400, "请输入有效的书名");
    if (book.id.startsWith("txt:") || book.id.startsWith("epub:") || book.id.startsWith("cbz:")) {
      db.prepare("UPDATE reader_uploads SET title=?, author=? WHERE id=?").run(title, author, book.id);
    } else if (book.id.startsWith("src:")) {
      db.prepare("UPDATE reader_custom_books SET title=?, author=?, updated_at=? WHERE id=?").run(title, author, new Date().toISOString(), book.id);
    } else if (book.id.startsWith("wikisource:")) {
      db.prepare("UPDATE reader_wiki_pages SET title=?, author=? WHERE id=?").run(title, author, book.id);
    } else {
      throw failure(400, "该来源书目不支持重命名");
    }
    return { book: await getBook(book.id) };
  }
  const sniffer=createWebSniffer({
    customSources,
    epub,
    importTextBuffer:async (buf,meta)=>(await importText({...meta,text:decodeUploadedText(buf)},true)).book.id,
    bindStmt:bind,
  });
  async function handle(request) {
    const url=new URL(request.url);
    if (url.pathname!=="/api/reader" && !url.pathname.startsWith("/api/reader/")) return null;
    const route=url.pathname.slice("/api/reader".length).replace(/\/$/,"");
    try {
      if (request.method==="GET" && route==="/img") return await sniffer.proxyImage(url.searchParams.get("url"));
      if (request.method==="GET" && route==="/web-fiction") return result(webFictionPage(url.searchParams));
      if (request.method==="GET" && route==="/sources") return result(customSources.listSources());
      if (request.method==="GET" && (route==="" || route==="/books")) {
        const workId=url.searchParams.get("workId");
        const bindings=Object.fromEntries(db.prepare("SELECT work_id,book_id FROM reader_bindings").all().map(row=>[row.work_id,row.book_id]));
        const items=await books();
        const recent=bridge.recent(items);
        return result({books:items,bindings,...recent,boundId:workId!==null ? byWork.get(getWork(workId))?.id||null : null});
      }
      if (route==="/cotex-state" && request.method==="GET") {
        const book=await getBook(url.searchParams.get("id"));
        return result({state:bridge.readMetadata(book)});
      }
      if (route==="/cotex-state" && request.method==="POST") {
        const data=await readPayload(request,16*1024);
        const book=await getBook(data.id);
        bridge.validateMetadata(data);
        if(data.bookmark?.action==="add" && !bridge.readMetadata(book).bookmarks.some(mark=>
          mark.chapter===data.bookmark.chapter && mark.paragraph===data.bookmark.paragraph)) {
          const chapter=await getChapter(book,data.bookmark.chapter);
          if(data.bookmark.paragraph>=chapterUnits(chapter))throw failure(400,"书签段落超出正文");
        }
        if(data.imageFold?.closed && !bridge.readMetadata(book).collapsedImages.includes(data.imageFold.chapter+":"+data.imageFold.paragraph)) {
          const chapter=await getChapter(book,data.imageFold.chapter);
          if(!chapter.images?.some(g=>g.paragraph===data.imageFold.paragraph))throw failure(400,"找不到这组插图");
        }
        return result(bridge.applyMetadata(book,data));
      }
      if(route==="/cotex-open" && request.method==="POST"){
        const data=await readPayload(request,8192);
        const book=await getBook(data.id);
        return result(bridge.touch(book.id));
      }
      if (request.method==="GET" && (route==="/book" || route==="/chapter")) {
        const workId=url.searchParams.get("workId");
        const id=url.searchParams.get("id")||(workId!==null ? byWork.get(getWork(workId))?.id : null);
        const book=await getBook(id);
        if (route==="/book") return result(await getDetails(book));
        const n=url.searchParams.get("n");
        if (!n || !/^(?:0|[1-9]\d{0,6})$/.test(n)) throw failure(400,"章节位置无效");
        return result(await getChapter(book,Number(n)));
      }
      if (request.method==="POST" && ["/import","/wiki-import","/bind","/progress","/delete-book","/rename-book","/sources/save","/sources/delete","/sources/test","/sources/search","/sources/add","/sources/refresh","/sources/cache","/sources/import-url","/sniff"].includes(route)) {
        if (route==="/import" && /^multipart\/form-data\s*;/i.test(request.headers.get("content-type")||"")) {
          const {file,metadata,isEpub,isComic}=await readBookUpload(request);
          if(metadata.workId!==undefined)getWork(metadata.workId);
          if(isComic){
            const id=await epub.importComicFile(file,metadata,bind);
            return result({book:await getBook(id)},201);
          }
          if(!isEpub)return result(await importText({...metadata,text:decodeUploadedText(await file.bytes())},true),201);
          const id=await epub.importFile(file,metadata,bind);
          return result({book:await getBook(id)},201);
        }
        const data=await readPayload(request,route==="/import"?16*MB:route==="/sources/save"||route==="/sources/test"?128*1024:16*1024);
        if (route==="/wiki-import") return result(await importWiki(data),201);
        if (route==="/import") return result(await importText(data),201);
        if (route==="/sniff") {
          if(data.workId!==undefined)getWork(data.workId);
          const res=await sniffer.sniff(data);
          if(res.kind==="imported")return result({kind:"book",book:await getBook(res.importedId)},201);
          return result(res,res.kind==="book"?201:200);
        }
        if (route==="/progress") return result(await saveProgress(data));
        if (route==="/delete-book") return result(await deleteBookById(data.id));
        if (route==="/rename-book") return result(await renameBookById(data.id, data.title, data.author));
        if (route==="/sources/save") return result(customSources.saveSource(data));
        if (route==="/sources/delete") return result(customSources.deleteSource(data.id));
        if (route==="/sources/test") return result(await customSources.testSource(data.rule || data, data.keyword || "诡秘"));
        if (route==="/sources/search") return result(await customSources.search(data.query || "", data.sourceId || ""));
        if (route==="/sources/import-url") return result(await customSources.importFromUrl(data.url));
        if (route==="/sources/add") {
          const added=await customSources.addBook(data.sourceId, data.remoteId || data.detailUrl);
          if (data.workId!==undefined) bind.run(getWork(data.workId), added.book.id);
          return result({book: await getBook(added.book.id)}, 201);
        }
        if (route==="/sources/refresh") return result(await customSources.refreshBook(data.id));
        if (route==="/sources/cache") return result(await customSources.cacheChapters(data.id, Number(data.start)||0, Number(data.count)||20));
        const workId=getWork(data.workId);
        if (data.bookId===null) db.prepare("DELETE FROM reader_bindings WHERE work_id=?").run(workId);
        else {const book=await getBook(data.bookId);bind.run(workId,book.id);}
        return result({workId,bookId:data.bookId});
      }
      const known=["","/img","/sniff","/cotex-state","/cotex-open","/web-fiction","/books","/book","/chapter","/import","/wiki-import","/bind","/progress","/delete-book","/rename-book","/sources","/sources/save","/sources/delete","/sources/test","/sources/search","/sources/add","/sources/refresh","/sources/cache","/sources/import-url"].includes(route);
      return result({error:known?"请求方法无效":"没有这个阅读入口"},known?405:404);
    } catch (error) {
      const status=Number.isInteger(error?.status)&&error.status>=400&&error.status<=599 ? error.status : 500;
      const extra={...error.extra};
      if (error.sourceUrl && !extra.sourceUrl) extra.sourceUrl=error.sourceUrl;
      return result({error:status===500?"阅读服务暂不可用":error.message,...extra},status);
    }
  }
  return {handle,db,books,getBook,getDetails,getChapter,saveProgress,customSources,txtStorage:objectStore ? "kodo" : "sqlite",close(){localCache.clear();remoteBooks.clear();db.close();}};
}

