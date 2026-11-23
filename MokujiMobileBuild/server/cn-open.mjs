import html from './wikisource-html.cjs';
import { samples } from './cn-open-samples.mjs';
import { additionalStories, serials } from './cn-open-catalog.mjs';

// Original Chinese tales selected from the branch's attributed, featured archive.
// https://scp-wiki-cn.wikidot.com/event-featured-archive
// Text in each reading view is distributed under the original CC BY-SA 3.0 license.
const origin = 'https://scp-wiki-cn.wikidot.com';
const source = 'SCP 基金会中文分部';
const license = 'CC BY-SA 3.0';
const licenseUrl = 'https://creativecommons.org/licenses/by-sa/3.0/';
const chaptersOfJourney = ['第一章','第二章','第三章','第四章','第五章','第六章','第七章','第八章','第九章','终章'];
const entries = [
  ['simple-things-spring','平凡的故事：春','DrSee'],
  ['my-love-i','我的爱人','Sreason29'],
  ['you-will-ask','你会问','Rye Travis'],
  ['pink-flowers','桃花庵','Sylvia_Blank'],
  ['end-of-map','地图终止的地方','AnyboLancdon'],
  ['lyysc','进入门径的漫长旅程','Lazyyard',chaptersOfJourney],
  ['i-manager-wang','我，王经理','ashausesall'],
  ['foundation-of-the-empire','立國之本','MScarlet'],
  ['the-last-childrens-day','最后的儿童节','Sharethesilence'],
  ['loyal-forever','永远忠诚','varitas096'],
  ...additionalStories,
];
const catalog = new Map(entries.map(([slug,title,author,sections = ['全文']])=>{
  const id = 'open:cn-more-'+slug;
  const credits = '《'+title+'》由“'+author+'”创作，来源为 SCP 基金会中文分部。目次按原段落排版，仅展示文字；本页文字沿用 CC BY-SA 3.0。';
  const book = {id,title,originalTitle:title,author,edition:'中文原创 · 精选故事',language:'zh',
    chapterCount:sections.length,source,sourceType:'online',sourceUrl:origin+'/'+slug,available:true,
    offlineAvailable:Object.hasOwn(samples,slug),license,licenseUrl,credits};
  return [id,{book,sections,slug}];
}));


for (const serial of serials) {
  const id='open:cn-more-'+serial.slug;
  const {title,author}=serial;
  const credits='《'+title+'》由“'+author+'”创作，来源为 SCP 基金会中文分部。目次按原刊章节排版，仅展示文字；本页文字沿用 CC BY-SA 3.0。';
  const book={id,title,originalTitle:title,author,edition:'中文原创 · 分章连载',language:'zh',
    chapterCount:serial.chapters.length,source,sourceType:'online',sourceUrl:origin+'/'+serial.slug,
    available:true,offlineAvailable:false,license,licenseUrl,credits};
  if(catalog.has(id)) throw Error('Duplicate serial: '+id);
  catalog.set(id,{book,slug:serial.slug,sections:serial.chapters.map(row=>row[1]),chapters:serial.chapters});
}

export function listBooks() {
  return Array.from(catalog.values(), item=>({...item.book}));
}
export function getBook(id) {
  const entry=catalog.get(id);
  return entry ? {book:{...entry.book},chapters:entry.sections.map((title,index)=>({n:index+1,title,available:true}))} : null;
}

const maxBytes=900*1024;
const pending=new Map();
const cache=new Map();
const day=24*60*60*1000;
function sourceError(entry, message) {
  return Object.assign(new Error(message),{status:503,sourceUrl:entry.book.sourceUrl});
}

function sectionsFrom(page, entry) {
  const doc=html.parse(page);
  const root=doc.querySelector('#page-content');
  const tags=doc.querySelector('.page-tags')?.querySelectorAll('a').map(el=>el.text.trim()) || [];
  const rights=doc.querySelector('#license-area a')?.getAttribute('href') || '';
  if (!root || doc.querySelector('#page-title')?.text.trim()!==entry.book.title ||
      !tags.includes('原创') || !tags.includes('故事') || !/^https?:\/\/creativecommons\.org\/licenses\/by-sa\/3\.0\/?$/.test(rights)) {
    throw sourceError(entry,'这篇故事的署名页、分类或授权信息已变更，请到原站查看。');
  }
  for (const el of root.querySelectorAll('.page-rate-widget-box,.creditRate,.creditButton,.fader,.modalcontainer,.collapsible-block-folded,.collapsible-block-unfolded-link,.earthworm,script,style,noscript')) el.remove();
  // Some Wikidot themes include their CSS in an invisible interwiki frame.
  for (const el of root.querySelectorAll('iframe')) {
    const src=el.getAttribute('src') || '';
    if ((entry.analyticsFrame && src===entry.analyticsFrame) || /^(?:https?:)?\/\/interwiki\.scpwikicn\.com\/styleFrame\.html\?/.test(src)) el.remove();
  }
  if (entry.seriesSlug) {
    for (const nav of root.querySelectorAll('.footer-wikiwalk-nav')) nav.remove();
    for (const p of root.querySelectorAll('p')) {
      const label=p.text.trim();
      if (!label.startsWith('«') || !label.endsWith('»')) continue;
      const hasHub=p.querySelectorAll('a').some(a=>{
        const href=a.getAttribute('href');
        return href==='/'+entry.seriesSlug || href===origin+'/'+entry.seriesSlug;
      });
      if (hasHub) p.remove();
    }
    // The author's prologue contains a Wikidot missing-image placeholder above a text dossier.
    if (entry.slug==='living-dead-killer-prologue') {
      for(const image of root.querySelectorAll('img')) if(image.getAttribute('alt')==='{$name}' && image.getAttribute('src')?.includes('/{$name}/')) image.remove();
    }
  }
  // Fail back to the linked original if a formerly text-only story becomes interactive.
  if (root.querySelector('iframe,img,audio,video,canvas,form,object,embed,svg')) throw sourceError(entry,'原文加入了图像或互动排版，可到原站完整阅读。');
  const lines=root.structuredText.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  if (lines[0]===entry.book.title) lines.shift();
  if (entry.sections.length===1) {
    if (lines.length<3 || lines.join('').length<200) throw sourceError(entry,'原站未返回完整正文，请稍后重试。');
    return [lines];
  }
  const headings=root.querySelectorAll('h1,h2,h3,h4,h5,h6').map(el=>el.text.trim());
  if (headings.length!==entry.sections.length || headings.some((h,i)=>h!==entry.sections[i])) throw sourceError(entry,'原著章节次序已调整，可到原站查看。');
  const parts=[];let current=-1;
  for (const line of lines) {
    if (current+1<entry.sections.length && line===entry.sections[current+1]) {parts.push([]);current++;continue;}
    if (current===-1) throw sourceError(entry,'原著出现新序章，可到原站查看。');
    parts[current].push(line);
  }
  if (parts.length!==entry.sections.length || parts.some(p=>!p.length || p.join('').length<60)) throw sourceError(entry,'原站未返回完整章节，请稍后重试。');
  return parts;
}

async function download(entry) {
  const response=await fetch(entry.book.sourceUrl,{redirect:'error',signal:AbortSignal.timeout(11000),
    headers:{Accept:'text/html','User-Agent':'MokujiReader/1.1 (on-demand reader for CC BY-SA literature)'}});
  if (!response.ok || !response.body || !/text\/html/i.test(response.headers.get('content-type') || '') || Number(response.headers.get('content-length'))>maxBytes) {
    await response.body?.cancel().catch(()=>{});
    throw new Error('Source unavailable');
  }
  const stream=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  const chunks=[];let size=0;
  try {
    while (true) {
      const part=await stream.read();if(part.done)break;
      size+=part.value.length;
      if (size>maxBytes) {await stream.cancel();throw new Error('Article size exceeded');}
      chunks.push(decoder.decode(part.value,{stream:true}));
    }
    chunks.push(decoder.decode());
  } finally {stream.releaseLock();}
  return sectionsFrom(chunks.join(''),entry);
}

async function read(entry) {
  const id=entry.book.id;
  const cached=cache.get(id);
  if(cached && Date.now()-cached.time<day) return cached.parts;
  if(pending.has(id)) return pending.get(id);
  const task=download(entry).then(parts=>{
    cache.delete(id);
    cache.set(id,{time:Date.now(),parts});
    if (cache.size>16) cache.delete(cache.keys().next().value);
    return parts;
  }).catch(err=>{
    if (err?.sourceUrl) throw err;
    if(cached)return cached.parts;
    if(samples[entry.slug]) return [samples[entry.slug].paragraphs];
    throw sourceError(entry,'暂时无法连接 SCP 基金会中文分部，请稍后重试或打开原文。');
  }).finally(()=>pending.delete(id));
  pending.set(id,task);return task;
}
export async function getChapter(id,n) {
  const entry=catalog.get(id);
  if (!entry || !Number.isInteger(n) || n<1 || n>entry.sections.length) return null;
  if (entry.chapters) {
    const [slug,title,analyticsFrame]=entry.chapters[n-1];
    const sourceUrl=origin+'/'+slug;
    const target={slug,seriesSlug:entry.slug,analyticsFrame,sections:['全文'],
      book:{...entry.book,id:id+':chapter:'+n,title,sourceUrl}};
    const [paragraphs]=await read(target);
    return {id,n,title,chapterCount:entry.book.chapterCount,paragraphs:[...paragraphs],source,sourceType:'online',
      sourceUrl,language:'zh',credits:entry.book.credits,license,licenseUrl};
  }
  const parts=await read(entry);
  const {sourceUrl,credits,language,sourceType,chapterCount}=entry.book;
  return {id,n,title:entry.sections[n-1],chapterCount,paragraphs:[...parts[n-1]],source,sourceType,sourceUrl,language,credits,license,licenseUrl};
}
