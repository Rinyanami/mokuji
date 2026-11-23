export type ReadingMark = {chapter:number; paragraph:number; revision:number; updatedAt:string|null};
export type ReaderBook = {id:string; title:string; workAlias?:string; nativeSourceId?:string; cachedChapterCount?:number; originalTitle?:string; aliases?:string[]; language?:string; edition?:string; author:string; source:string; category?:string; unit?:string; sourceType?:'cotex'|'upload'|'online'|'custom'; sourceUrl?:string; chapterCount:number; available:boolean; progress:ReadingMark};
export type BookSourceRule = {id?:string; name:string; baseUrl:string; enabled?:boolean; searchUrl:string; method?:'GET'|'POST'; charset?:string; headers?:Record<string,string>; searchList:string; searchTitle:string; searchAuthor?:string; searchIntro?:string; searchBookUrl:string; tocUrlSelector?:string; catalogList:string; catalogTitle?:string; catalogUrl?:string; bookTitle?:string; bookAuthor?:string; bookIntro?:string; contentSelector:string; contentExclude?:string; nextPageSelector?:string};
export type BookSourceItem = {id:string; name:string; baseUrl:string; enabled:boolean; kind:'builtin'|'rule'; category?:string; unit?:string; description?:string; rule?:BookSourceRule};
export type SourceSearchHit = {sourceId:string; sourceName:string; category?:'网文'|'轻小说'|'文学'|'漫画'; remoteId:string; title:string; author:string; intro:string; detailUrl:string};
export type ShelfInput = Pick<ReaderBook,'title'|'author'|'sourceUrl'> & {category?:string};
export type ReaderIndex = {books:ReaderBook[]; bindings?:Record<string,string>; boundId?:string|null; recentCotex?:{id:string;at:number}|null; recentReader?:{id:string;at:number}|null};
export type ChapterInfo = {n:number; title:string; realTitle?:string; available:boolean; sourceUrl?:string; cached?:boolean; access?:'cached'|'locked'|'platform'|'uncached'|'font-unavailable'};
export type BookDetail = {book:ReaderBook; chapters:ChapterInfo[]};
export type ChapterImageGroup = {paragraph:number;items:{asset?:string;alt:string;missing?:boolean}[]};
export type SourceFont = {id:string;data:string};
export type ChapterText = {sourceFonts?:SourceFont[];id:string;n:number;title:string;paragraphs:string[];chapterCount:number;source?:string;sourceUrl?:string;license?:string;licenseUrl?:string;credits?:string;images?:ChapterImageGroup[];media?:Record<string,string>};
export class ReaderError extends Error {
  constructor(message:string,readonly status:number,readonly sourceUrl?:string,readonly progress?:ReadingMark) {super(message);}
}
export async function readerRequest<T>(path:string, options?:RequestInit):Promise<T> {
  const res = await fetch('/api/reader/'+path,{cache:'no-store',...options});
  const data = await res.json();
  if (!res.ok) throw new ReaderError(data.error || '暂时无法读取，请重试。',res.status,data.sourceUrl,data.progress);
  return data as T;
}
export function readerPost<T>(path:string, payload:unknown, keepalive=false) {
  return readerRequest<T>(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),keepalive});
}
export const readingPosition = (mark:ReadingMark) => `第 ${mark.chapter+1} 章 · 第 ${mark.paragraph+1} 段`;
export const externalUrl = (url?:string) => !!url && /^https?:\/\//i.test(url);
const labels:Record<string,string> = {cotex:'Cotex',qidian:'起点中文网',fanqie:'番茄小说',fanqienovel:'番茄小说',jjwxc:'晋江文学城',sfacg:'SF 轻小说',esjzone:'ESJ 轻小说',syosetu:'成为小说家吧',mangadex:'MangaDex 漫画',sniff:'网页嗅探',bgm:'Bangumi',bangumi:'Bangumi',txt:'本地 TXT',local:'本地文件',file:'本地文件',epub:'EPUB',cbz:'CBZ/ZIP 漫画',import:'本地 TXT','17k':'17K 小说网',zongheng:'纵横中文网',wikisource:'中文维基文库',custom:'自定义书源'};
export const sourceLabel = (source:string) => labels[source.toLowerCase()] || source;
export function onDesktop() {return ['localhost','127.0.0.1','[::1]','::1'].includes(location.hostname);}


const openedKey = 'duji.reader.last-open.v1';
export function rememberOpened(id:string) {
  try { localStorage.setItem(openedKey, JSON.stringify({id, at:Date.now()})); } catch { /* The server still tracks reading progress. */ }
}
export function lastOpened():{id:string;at:number}|null {
  try {
    const value=JSON.parse(localStorage.getItem(openedKey) || 'null');
    return value && typeof value.id==='string' && Number.isFinite(value.at) && value.at>0 ? value : null;
  } catch { return null; }
}
