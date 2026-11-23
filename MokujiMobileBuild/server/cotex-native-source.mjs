import {createHash} from 'node:crypto';

const ids = new Set(['fanqie','qidian','17k','zongheng','sfacg','wikisource','gutenberg']);
const digits = /^[1-9]\d{0,21}$/;
const isPrivateGlyph = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u;
const domains = {
  fanqie:['fanqienovel.com','www.fanqienovel.com'],
  qidian:['www.qidian.com','qidian.com','m.qidian.com','book.qidian.com','read.qidian.com','vipreader.qidian.com'],
  '17k':['17k.com','www.17k.com'], zongheng:['www.zongheng.com','book.zongheng.com','read.zongheng.com'],
  sfacg:['book.sfacg.com'], wikisource:['zh.wikisource.org'], gutenberg:['gutenberg.org','www.gutenberg.org']
};
const bookPaths = {
  fanqie:/^\/page\/(\d{1,22})\/?$/, qidian:/^\/(?:book|info)\/(\d{1,22})\/?$/,
  '17k':/^\/book\/(\d{1,22})\.html$/, zongheng:/^\/(?:detail\/(\d{1,22})\/?|book\/(\d{1,22})\.html)$/,
  sfacg:/^\/Novel\/(\d{1,22})\/?$/i, gutenberg:/^\/(?:ebooks|files|cache\/epub)\/(\d{1,9})(?:[/.]|$)/
};

function parse(value) {
  if(typeof value!=='string'||value.length>2400)return null;
  try {const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.port?u:null;}catch{return null;}
}
function wikiPath(value) {
  if(!value?.startsWith('/wiki/'))return '';
  try{
    const title=decodeURIComponent(value.slice(6));
    if(!title || title.length>380 || /[:?#\\\x00-\x1f\x7f]/.test(title) || title.split('/').some(part=>!part||part==='.'||part==='..'))return '';
    return '/wiki/'+title.split('/').map(encodeURIComponent).join('/');
  }catch{return '';}
}
function bookUrl(id,remote) {
  if(id==='wikisource') {
    const path=wikiPath('/wiki/'+String(remote).split('/').map(encodeURIComponent).join('/'));
    return path?'https://zh.wikisource.org'+path:'';
  }
  if(!digits.test(remote))return '';
  switch(id){
    case 'fanqie':return 'https://fanqienovel.com/page/'+remote;
    case 'qidian':return 'https://www.qidian.com/book/'+remote+'/';
    case '17k':return 'https://www.17k.com/book/'+remote+'.html';
    case 'zongheng':return 'https://www.zongheng.com/detail/'+remote;
    case 'sfacg':return 'https://book.sfacg.com/Novel/'+remote+'/';
    case 'gutenberg':return 'https://www.gutenberg.org/ebooks/'+remote;
    default:return '';
  }
}

/** Only public book/chapter paths from Cotex's named, known providers; never propagate saved queries, tokens or other credentials. */
export function cotexOrigin(source){
  if(!source||typeof source!=='object')return null;
  const u=parse(source.url);
  const id=ids.has(source.id)?source.id:Object.keys(domains).find(key=>u&&domains[key].includes(u.hostname));
  if(!id || (source.url && (!u||!domains[id].includes(u.hostname))))return null;
  let remote=typeof source.remoteId==='string'||typeof source.remoteId==='number'?String(source.remoteId):'';
  if(u) {
    const match=bookPaths[id]?.exec(u.pathname);
    const fromUrl=id==='wikisource'?wikiPath(u.pathname):match?.[1]||match?.[2];
    if(!fromUrl)return null;
    const key=id==='wikisource'?decodeURIComponent(fromUrl.slice(6)):fromUrl;
    if(remote&&remote.replaceAll('_',' ')!==key.replaceAll('_',' '))return null;
    remote=key;
  }
  if(!remote)return null;
  const url=bookUrl(id,remote);
  return url?{id,remote,url}:null;
}
export function cotexChapterUrl(origin,value){
  if(!origin)return '';
  const u=parse(value);
  if(!u||!domains[origin.id].includes(u.hostname))return '';
  const path=u.pathname.replace(/\/$/,'');
  let match;
  switch(origin.id){
    case 'fanqie':return /^\/reader\/\d{1,22}$/.test(path)?'https://fanqienovel.com'+path:'';
    case 'qidian': {
      match=/^\/(chapter|book)\/([A-Za-z0-9_~=-]{1,140})\/([A-Za-z0-9_~=-]{1,140})$/.exec(path);
      if(!match || (digits.test(match[2]) && match[2]!==origin.remote))return '';
      return 'https://'+u.hostname+path+'/';
    }
    case 'zongheng': case '17k':
      match=/^\/chapter\/(\d{1,22})\/(\d{1,22})\.html$/.exec(path);
      return match?.[1]===origin.remote?'https://'+(origin.id==='17k'?'www.17k.com':'read.zongheng.com')+path:'';
    case 'sfacg':
      match=/^\/Novel\/(\d{1,22})\/\d{1,22}\/\d{1,22}$/i.exec(path);
      return match?.[1]===origin.remote||/^\/vip\/c\/\d{1,22}$/i.test(path)?'https://book.sfacg.com'+path+'/':'';
    case 'wikisource': {
      const safe=wikiPath(u.pathname);
      if(!safe)return '';
      const title=decodeURIComponent(safe.slice(6)).replaceAll('_',' '),book=origin.remote.replaceAll('_',' ');
      return title===book||title.startsWith(book+'/')?'https://zh.wikisource.org'+safe:'';
    }
    default:return '';
  }
}
const locked = c=> c?.locked===true || c?.isLocked===true || c?.hasAccess===false || c?.readable===false || c?.canRead===false || (c?.purchased===false&&(c?.vip===true||c?.isVip===true));
export {locked as cotexChapterLocked};

function safeFont(f) {
  if(!f || !/^[a-f0-9]{24}$/.test(f.id) || typeof f.data!=='string' || f.data.length>2800000)return null;
  const match=/^data:font\/(?:woff2?|ttf|otf);base64,([A-Za-z0-9+/]+={0,2})$/.exec(f.data);
  if(!match)return null;
  const bytes=Buffer.from(match[1],'base64');
  if(bytes.length<12 || bytes.length>2*1024*1024)return null;
  const kind=bytes.toString('ascii',0,4);
  const format=kind==='wOF2'?'woff2':kind==='wOFF'?'woff':kind==='OTTO'?'otf':bytes.readUInt32BE(0)===65536?'ttf':'';
  if(!format || createHash('sha256').update(bytes).digest('hex').slice(0,24)!==f.id)return null;
  return {id:f.id,data:'data:font/'+format+';base64,'+match[1]};
}
export function cotexChapterAccess(c,origin,paragraphs,bookFonts){
  const sourceUrl=cotexChapterUrl(origin,c?.url)||origin?.url||'';
  if(locked(c))return {access:'locked',sourceUrl,paragraphs:[]};
  if(!paragraphs.length)return {access:c?.vip||c?.isVip?'platform':'uncached',sourceUrl,paragraphs:[]};
  if(['fanqie','qidian'].includes(origin?.id)&&paragraphs.some(p=>isPrivateGlyph.test(p))){
    const candidates=Array.isArray(c.fonts)&&c.fonts.length?c.fonts:Array.isArray(bookFonts)?bookFonts:[];
    const sourceFonts=candidates.slice(0,4).map(safeFont).filter(Boolean);
    if(!sourceFonts.length)return {access:'font-unavailable',sourceUrl,paragraphs:[],requiresSourceFont:true};
    return {access:'cached',sourceUrl,paragraphs,sourceFonts};
  }
  return {access:'cached',sourceUrl,paragraphs};
}

