import parser from './wikisource-html.cjs';
import editions from './foreign-open-catalog.mjs';

const source = 'Standard Ebooks';
const license = '原作在美国属于公版；Standard Ebooks 校订内容采用 CC0 1.0';
const licenseUrl = 'https://creativecommons.org/publicdomain/zero/1.0/';
const maxBytes = 1024 * 1024;
const byId = new Map(editions.map(book=>['open:foreign-more-'+book.id,book]));
const paragraphsAtOnce = new Set(['p','h1','h2','h3','h4','h5','h6','figcaption','dt','dd','tr','pre']);
const omit = new Set(['script','style','svg','head','noscript']);

function publicBook(book) {
  return {id:'open:foreign-more-'+book.id,title:book.zh,originalTitle:book.original,author:book.author,
    edition:'英文原著 · Standard Ebooks',language:'en',source,sourceType:'online',sourceUrl:book.seurl,
    chapterCount:book.sections.length,available:true,license,licenseUrl,credits:book.authorEn+' · Standard Ebooks 校订',
    progress:{chapter:0,paragraph:0,revision:0,updatedAt:null}};
}

export function listBooks() {return editions.map(publicBook);}
export function getBook(id) {
  const entry=byId.get(id);
  return entry ? {book:publicBook(entry),chapters:entry.sections.map(([,title],i)=>({n:i+1,title,available:true}))} : null;
}

function paragraphText(node) {
  if (node.nodeType===3) return node.text.replace(/\s+/gu,' ');
  const tag=node.rawTagName?.toLowerCase();
  if (node.nodeType!==1 || omit.has(tag)) return '';
  const type=node.getAttribute('epub:type')||'';
  if (type.split(/\s+/).includes('backlink')) return '';
  if (tag==='br') return '\u2028';
  if (tag==='img') return node.getAttribute('alt') || '';
  const text=node.childNodes.map(paragraphText).join('');
  if (type.split(/\s+/).includes('noteref')) return '['+text.trim()+']';
  if (tag==='td' || tag==='th') return text+' ';
  return text;
}

function sectionsOf(element) {
  const paragraphs=[];
  const add=node=>{
    const tag=node.rawTagName?.toLowerCase();
    if (node.nodeType!==1 || omit.has(tag)) return;
    if (paragraphsAtOnce.has(tag) || tag==='img' || (tag==='li' && !node.querySelector('p'))) {
      const text=paragraphText(node).split('\u2028').map(s=>s.replace(/[\t\r\n ]+/g,' ').trim()).filter(Boolean).join('\n');
      if(text)paragraphs.push(text);
      return;
    }
    for (const child of node.childNodes) add(child);
  };
  add(element);
  return paragraphs;
}

async function readLimited(response) {
  if (!response.ok || !response.body || Number(response.headers.get('content-length'))>maxBytes) {
    await response.body?.cancel().catch(()=>{});throw Error('No chapter');
  }
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let text='',bytes=0;
  try {
    for (;;) {
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>maxBytes){await reader.cancel();throw Error('Chapter exceeds size limit');}
      text+=decoder.decode(value,{stream:true});
    }
    return text+decoder.decode();
  } finally {reader.releaseLock();}
}

export async function getChapter(id,n) {
  const book=byId.get(id);
  if(!book || !Number.isInteger(n) || n<1 || n>book.sections.length)return null;
  const [ref,title]=book.sections[n-1], [filename,fragment]=ref.split('#');
  const url='https://raw.githubusercontent.com/standardebooks/'+book.repo+'/'+book.revision+'/src/epub/'+filename;
  const sourceUrl=book.seurl+'/'+ref.replace('.xhtml','');
  try {
    const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(12000),headers:{
      Accept:'application/xhtml+xml, text/plain;q=0.9','User-Agent':'MokujiReader/1.0 (public literature reader)'}});
    const doc=parser.parse(await readLimited(response));
    const body=fragment ? doc.querySelector('#'+fragment) : doc.querySelector('body');
    if(!body)throw Error('Missing reading section');
    const paragraphs=sectionsOf(body);
    if(!paragraphs.length)throw Error('Empty reading section');
    return {id,n,title,chapterCount:book.sections.length,paragraphs,source,sourceType:'online',language:'en',
      sourceUrl,revisionUrl:'https://github.com/standardebooks/'+book.repo+'/blob/'+book.revision+'/src/epub/'+ref,
      license,licenseUrl,credits:book.authorEn+' · Standard Ebooks 英文校订版，目次按原章节呈现正文。'};
  } catch {
    throw Object.assign(new Error('暂时无法读取 Standard Ebooks 本节，可稍后重试或打开英文原站。'),{status:503,sourceUrl});
  }
}
