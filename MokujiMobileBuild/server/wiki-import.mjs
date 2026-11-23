import html from './wikisource-html.cjs';

const origin = 'https://zh.wikisource.org';
const source = '中文维基文库';
const licenseUrl = 'https://creativecommons.org/licenses/by-sa/4.0/';
const headers = {Accept:'application/json', 'User-Agent':'MokujiReader/1.2 (https://duji-reading-journal.tsuichiahowe.chatgpt.site)'};
const inFlight = new Map();
const issue = (status, message) => Object.assign(new Error(message), {status});
const useLeaf = () => issue(422, '这个页面没有可独立导入的完整正文。请粘贴单篇作品或具体一章的链接。');

function pageTitle(input) {
  if (typeof input !== 'string' || input.length > 2400) throw issue(400,'请输入中文维基文库作品链接。');
  let u, title;
  try {
    u=new URL(input.trim());
    const match=u.pathname.match(/^\/(?:wiki|zh|zh-(?:hans|hant|cn|tw|hk|mo|sg|my))\/(.+)$/i);
    if (u.origin!==origin || u.username || u.password || !match || u.search) throw Error();
    title=decodeURIComponent(match[1]).replace(/_/g,' ').trim().normalize('NFC');
  } catch { throw issue(400,'请粘贴 zh.wikisource.org 上的 HTTPS 单篇作品链接。'); }
  if (!title || title.length>250 || /[:#<>{}\[\]|\u0000-\u001f\u007f\\]/u.test(title)) {
    throw issue(400,'仅支持作品正文页，请检查链接。');
  }
  return title;
}

async function api(params, signal, limit) {
  const url=new URL('/w/api.php',origin);
  url.search=new URLSearchParams({...params,format:'json',formatversion:'2',maxlag:'5'});
  let res;
  try { res=await fetch(url,{signal,redirect:'error',headers}); }
  catch { throw issue(503,'暂时连不上中文维基文库，请稍后重试。'); }
  if (!res.ok || !res.body) {await res.body?.cancel();throw issue(503,'中文维基文库暂时无法提供正文。');}
  if (Number(res.headers.get('content-length')||0)>limit) {await res.body.cancel();throw issue(413,'页面太长，请导入具体一章。');}
  const chunks=[];
  let bytes=0;
  for await (const chunk of res.body) {
    bytes+=chunk.length;
    if (bytes>limit) throw issue(413,'页面太长，请导入具体一章。');
    chunks.push(chunk);
  }
  let data;
  try {data=JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));}
  catch {throw issue(503,'中文维基文库返回了无法识别的内容。');}
  if (data.error) {
    if (['missingtitle','missingrev','nosuchpageid','invalidtitle'].includes(data.error.code)) throw issue(404,'来源没有这篇作品。');
    throw issue(503,'中文维基文库暂时无法完成请求。');
  }
  return data;
}

function cleanText(node) {
  return node.structuredText.replace(/[\u200b\ufeff]/gu,'').replace(/\u00a0/g,' ').trim();
}
function extractWork(parsed, page) {
  if (parsed?.pageid!==page.pageid || parsed.revid!==page.lastrevid || typeof parsed.text!=='string') throw issue(503,'来源版本发生变化，请重试。');
  const root=html.parse(parsed.text).querySelector('.mw-parser-output');
  if (!root) throw useLeaf();
  const templates = (parsed.templates||[]).map(t=>t.title.toLowerCase());
  const categories=(parsed.categories||[]).map(c=>c.category);
  if (categories.some(x=>/消歧[義义]|未完成|未完成本|未校[對对]/u.test(x)) ||
      templates.some(t=>/^template:(?:disambig|versions|消歧義|消歧义|ambox\/incomplete)$/u.test(t))) throw useLeaf();

  const notice=root.querySelector('.licenseContainer');
  const publicDomain=notice && templates.includes('template:pd-old') &&
    /全世界.{0,8}(?:公有[領领]域|公[眾众][領领]域)/u.test(cleanText(notice));
  if (!publicDomain) throw issue(422,'此页未标明原作在全球属于公有领域；请在来源网站阅读，或选其他单篇。');
  const container=root.querySelector('#headerContainer');
  const authorCell=container?.querySelectorAll('td').find(td=>Array.from(td.childNodes).some(node=>node.rawTagName==='span' && /^作者[：:]\s*$/u.test(node.text?.trim())));
  const authors=authorCell?.querySelectorAll('a').filter(a=>/^\/wiki\/(?:Author|作者):/i.test(a.getAttribute('href')||'')).map(a=>a.text.trim())||[];
  const author=Array.from(new Set(authors)).join('、');
  const removeSelectors=[
    '#headerContainer','.licenseContainer','.ws-header','.ws-noexport','.noprint',
    '.navbox','.navbox-styles','.sisterproject','.authority-control','.thumb','figure',
    '.mw-editsection','style','script','noscript','.pagenum','.variant-tooltip',
    '.reference','.references','.reflist','.toc','[hidden]','.mw-empty-elt',
  ];
  for (const node of root.querySelectorAll(removeSelectors.join(','))) node.remove();
  // Pages composed primarily of links or subpage listings are indexes, not chapter text.
  const links=root.querySelectorAll('a');
  const body=cleanText(root);
  const linkedLength=links.reduce((n,a)=>n+cleanText(a).length,0);
  const subpageLinks=links.filter(a=>{
    const href=a.getAttribute('href')||'';
    try {return decodeURIComponent(href).replace(/_/g,' ').startsWith('/wiki/'+page.title+'/');}
    catch {return false;}
  });
  if ((links.length>=2 && linkedLength>body.length*.48) || subpageLinks.length>=5) throw useLeaf();

  // Reading view contains prose/poetry. Tables may encode layouts or separate versions.
  // Accept them only after removal of navigation and only when the remaining text is independent.
  if (root.querySelectorAll('table').some(t=>cleanText(t).length>0)) throw useLeaf();
  const headingsToSkip=/^(?:[注註][释釋解]|校[注註]|校勘[记記]?|参考[文資资][献獻料]|參考[文資][獻料]|[竪豎竖]排版)$/u;
  const paragraphs=body.split(/\n+/).map(line=>line.trim()).filter(line=>line && !headingsToSkip.test(line));
  if (!paragraphs.length || body.length>300000 || paragraphs.length>6000) throw useLeaf();
  // A minimal prose signal also excludes headings and lists of book titles.
  if (body.length<12 || !/[，。！？；、,.!?]/u.test(body)) throw useLeaf();
  return {title:page.title,author,paragraphs,source,stableId:'wikisource:'+page.pageid,
    revisionId:parsed.revid,sourceUrl:origin+'/wiki/'+page.title.split('/').map(s=>encodeURIComponent(s.replace(/ /g,'_'))).join('/'),
    revisionUrl:origin+'/w/index.php?oldid='+parsed.revid,license:'原作公有领域；维基校录 CC BY-SA 4.0',licenseUrl,
    credits:[author&&('原作：'+author),'中文维基文库贡献者校录；目次将正文转换为纯文本，原注与图版请见来源版本。'].filter(Boolean).join('。')};
}
async function read(title) {
  const signal=AbortSignal.timeout(18000);
  try {
    const info=await api({action:'query',titles:title,redirects:'1',converttitles:'1',prop:'info|pageprops',ppprop:'disambiguation'},signal,65536);
    const page=info.query?.pages?.[0];
    if (!page || page.missing || !Number.isSafeInteger(page.pageid) || !page.lastrevid) throw issue(404,'来源没有这篇作品。');
    if (page.ns!==0 || page.pageprops?.disambiguation!==undefined) throw useLeaf();
    const data=await api({action:'parse',oldid:String(page.lastrevid),prop:'text|templates|categories|revid',disabletoc:'1',disableeditsection:'1'},signal,1024*1024);
    return extractWork(data.parse,page);
  } catch (e) {
    if (e?.status) throw e;
    throw issue(503,'读取中文维基文库失败，请稍后重试。');
  }
}
export async function resolveWikiText(url) {
  const title=pageTitle(url);
  if (!inFlight.has(title)) {
    if (inFlight.size>=6) throw issue(429,'已有多个来源正在读取，请稍后重试。');
    inFlight.set(title,read(title).finally(()=>inFlight.delete(title)));
  }
  return inFlight.get(title);
}
