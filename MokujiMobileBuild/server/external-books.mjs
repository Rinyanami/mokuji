// Only work files listed in Aozora Bunko's official downloadable catalog are requested.
// The seven selected works and every credited author have copyright flag "なし"
// in https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip .
const origin = "https://www.aozora.gr.jp";
const source = "青空文庫";
const license = "青空文庫收录文件使用规范（日本公版作品）";
const licenseUrl = origin + "/guide/kijyunn.html";
const numeral = [..."一二三四五六七八九十"];
const catalog = [
  ["000879", "92_14545", "蜘蛛の糸", "芥川龍之介", numeral.slice(0,3)],
  ["000121", "628_14895", "ごん狐", "新美南吉", numeral.slice(0,6)],
  ["000081", "43754_17659", "注文の多い料理店", "宮沢賢治", ["全文"]],
  ["000879", "127_15260", "羅生門", "芥川龍之介", ["全文"]],
  ["000148", "799_14972", "夢十夜", "夏目漱石", numeral.map(n=>"第"+n+"夜")],
  ["000081", "473_42318", "よだかの星", "宮沢賢治", ["全文"]],
  ["000035", "1567_14913", "走れメロス", "太宰治", ["全文"]]
].map(([person,file,title,author,sections])=>{
  const work = file.split("_")[0], root = origin + "/cards/" + person;
  return {id:"open:aozora-"+work,title,author,sections,sourceUrl:root+"/card"+work+".html",fileUrl:root+"/files/"+file+".html"};
});
const cache = new Map(), pending = new Map();
const fileLimit = 384 * 1024, maxAge = 24 * 60 * 60 * 1000;

function publicBook(b) {
  return {id:b.id,title:b.title,originalTitle:b.title,author:b.author,edition:"日文原版",language:"ja",
    chapterCount:b.sections.length,source,sourceType:"online",sourceUrl:b.sourceUrl,
    available:true,license,licenseUrl,progress:{chapter:0,paragraph:0,revision:0,updatedAt:null}};
}
export function listExternalBooks() { return catalog.map(publicBook); }
export function getExternalBook(id) {
  const b=catalog.find(b=>b.id===id);
  return b ? {book:publicBook(b),chapters:b.sections.map((title,i)=>({n:i+1,title,available:true}))} : null;
}

const jisGlyphs = {"2-12-93":"扭","1-84-66":"戢","1-87-71":"犍","1-88-81":"眶","1-88-85":"睜"};
function lines(html) {
  const clean = html
    .replace(/<!--[\s\S]*?-->/g,"").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,"")
    .replace(/<img\b[^>]*>/gi,tag=>{
      const alt=tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] || "";
      const code=alt.match(/\b([12]-\d+-\d+)\b/)?.[1];
      return jisGlyphs[code] || alt;
    })
    // Original XHTML contains explicit fallback brackets around ruby readings.
    .replace(/<br\s*\/?>|<\/(?:p|div|h[1-6])>/gi,"\n")
    .replace(/<[^>]*>/g,"")
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(all,key)=>{
      if(key[0]!=="#") return ({amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" "})[key.toLowerCase()];
      const hex=key[1].toLowerCase()==="x";
      const cp=Number.parseInt(key.slice(hex?2:1),hex?16:10);
      return cp>0&&cp<=0x10ffff&&!(cp>=0xd800&&cp<=0xdfff)?String.fromCodePoint(cp):"\ufffd";
    });
  return clean.split(/\r\n?|\n/).map(line=>line.trim()).filter(Boolean);
}
function sourceError(message, sourceUrl) {
  return Object.assign(new Error(message), {status:503,sourceUrl});
}
function sectionize(book,html) {
  const main=/<div\b[^>]*\bclass=["']main_text["'][^>]*>([\s\S]*?)<div\b[^>]*\bclass=["']bibliographical_information["'][^>]*>([\s\S]*?)<\/div>/i.exec(html);
  if(!main) throw sourceError("青空文庫的正文版式暂时无法读取，可打开原文。",book.fileUrl);
  const body=main[1], bibliography=lines(main[2]).join(" · ");
  if (!bibliography) throw sourceError("青空文庫本次未提供版本和校录资料。",book.fileUrl);
  const headings=[...body.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)];
  let paragraphs, anchors;
  if (headings.length) {
    if(headings.length!==book.sections.length || headings.some((h,i)=>lines(h[1]).join("")!==book.sections[i])) {
      throw sourceError("青空文庫已调整本书分节，可打开原文查看。",book.fileUrl);
    }
    paragraphs=headings.map((h,i)=>lines(body.slice(h.index+h[0].length,headings[i+1]?.index)));
    anchors=headings.map(h=>h[1].match(/\bid="([a-zA-Z0-9_-]+)"/)?.[1]||"");
  } else {
    if(book.sections.length!==1) throw sourceError("青空文庫本次缺少原书分节。",book.fileUrl);
    paragraphs=[lines(body)];anchors=[""];
  }
  if(paragraphs.some(items=>items.join("").length<80)) throw sourceError("青空文庫本次未返回完整正文，可稍后重试。",book.fileUrl);
  return {paragraphs,anchors,bibliography};
}
async function loadWork(book) {
  const cached=cache.get(book.id);
  if(cached && Date.now()-cached.time<maxAge) return cached.data;
  if(pending.has(book.id)) return pending.get(book.id);
  const loading=(async()=>{
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),10000);
    try {
      const res=await fetch(book.fileUrl,{signal:controller.signal,redirect:"error",
        headers:{"User-Agent":"MokujiReader/1.0 (on-demand public literature reader)",Accept:"text/html,application/xhtml+xml"}});
      if(res.status!==200 || !/(?:text\/html|application\/xhtml\+xml)/i.test(res.headers.get("content-type")||"") || !res.body || Number(res.headers.get("content-length"))>fileLimit) {
        await res.body?.cancel().catch(()=>{});
        throw sourceError("青空文庫暂时无法提供这篇作品，可打开原文。",book.fileUrl);
      }
      const reader=res.body.getReader(), chunks=[]; let n=0;
      try {
        while(true) {
          const part=await reader.read();
          if(part.done) break;
          n+=part.value.byteLength;
          if(n>fileLimit) { await reader.cancel();throw sourceError("作品大小超出本地阅读限制。",book.fileUrl); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const bytes=new Uint8Array(n);let offset=0;
      for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
      const header=new TextDecoder("latin1").decode(bytes.subarray(0,1600));
      const utf8=(bytes[0]===0xef && bytes[1]===0xbb && bytes[2]===0xbf) || /(?:encoding|charset)\s*=\s*["']?utf-8/i.test(header);
      const html=new TextDecoder(utf8?"utf-8":"shift_jis",{fatal:true}).decode(bytes);
      const data=sectionize(book,html);
      cache.set(book.id,{time:Date.now(),data});return data;
    } catch(e) {
      if(cached) return cached.data;
      if(e?.status===503) throw e;
      throw sourceError("暂时连接不到青空文庫，可稍后重试或打开原文。",book.fileUrl);
    } finally {clearTimeout(timer);}
  })().finally(()=>pending.delete(book.id));
  pending.set(book.id,loading);return loading;
}
export async function getExternalChapter(id,n) {
  const b=catalog.find(b=>b.id===id);
  if(!b || !Number.isInteger(n) || n<1 || n>b.sections.length) return null;
  const {paragraphs,anchors,bibliography}=await loadWork(b);
  const sourceUrl=b.fileUrl+(anchors[n-1]?"#"+anchors[n-1]:"");
  return {id,n,title:b.sections[n-1],chapterCount:b.sections.length,paragraphs:[...paragraphs[n-1]],
    source,sourceType:"online",language:"ja",sourceUrl,license,licenseUrl,
    credits:"青空文庫电子化。目次按原分节排版，注音以括号呈现。"+bibliography};
}
