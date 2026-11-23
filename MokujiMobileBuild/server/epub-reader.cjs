/*! Adapted from Cotex.
MIT License

Copyright (c) 2026 Cotex

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

const path=require('node:path'), crypto=require('node:crypto');

const {load,JSZip,XMLParser}=require('./epub-deps.cjs');

const cheerio={load};

const MAX_BYTES = 60 * 1024 * 1024;

function safeText(v,limit=500) {return typeof v==='string'?v.slice(0,limit):'';}

function cleanText(text) {return String(text).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').replace(/\u0000/g,'').trim();}

function paragraphs(text,wrapped=false) {
  const t=cleanText(text);
  const groups=wrapped?t.split(/\n\s*\n+|\n(?=[ \t\u3000]{2,})/):t.split(/\n+/);
  return groups.map(s=>wrapped?s.replace(/([\u3400-\u9fff，。！？；：、」』”’])\n\s*/g,'$1').replace(/\n/g,' ').trim():s.trim()).filter(Boolean);
}
function splitLongParagraphs(p,max=1600) {
  const result=[];
  for(const x of p) {if(x.length<=max){result.push(x);continue;} let start=0;while(start<x.length){let end=Math.min(start+max,x.length);if(end<x.length){const cut=Math.max(x.lastIndexOf('。',end),x.lastIndexOf('！',end),x.lastIndexOf('. ',end));if(cut>start+max/2)end=cut+1;}result.push(x.slice(start,end));start=end;}}
  return result;
}

function resolveEntry(base, href) {
  if (typeof href !== 'string' || /^(?:[a-z][\w+.-]*:|\/\/|[\\/])/i.test(href)) return null;
  let decoded;
  try { decoded = decodeURIComponent(href.split(/[?#]/)[0]); } catch { return null; }
  if (!decoded || decoded.includes('\\') || decoded.includes('\0')) return null;
  const result = path.posix.normalize(path.posix.join(base, decoded));
  return result === '..' || result.startsWith('../') || result.startsWith('/') ? null : result;
}

// SVGs are displayed as images, never inserted into the document as HTML.
function cleanSVG(source) {
  const $ = cheerio.load(source, {xmlMode:true});
  if (!$('svg').length) return null;
  $('script,foreignObject,iframe,object,embed,audio,video,style,animate,set,animateTransform').remove();
  $('*').each((_, el) => {
    for (const [name, value] of Object.entries(el.attribs || {})) {
      if (/^on/i.test(name) || /^(?:href|xlink:href)$/i.test(name) && !value.startsWith('#') || /(?:url\(\s*['"]?(?!#)|@import|expression\s*\()/i.test(value)) $(el).removeAttr(name);
    }
  });
  return $.xml($('svg').first());
}

function imageData(bytes, filename = '') {
  let mime;
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mime='image/png';
  else if (bytes[0]===255 && bytes[1]===216 && bytes[2]===255) mime='image/jpeg';
  else if (/^GIF8[79]a/.test(bytes.subarray(0,6).toString())) mime='image/gif';
  else if (bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP') mime='image/webp';
  else if (bytes.subarray(4,8).toString()==='ftyp' && /avif|avis/.test(bytes.subarray(8,32).toString())) mime='image/avif';
  else if (/\.svg$/i.test(filename) || /<svg[\s>]/i.test(bytes.subarray(0,1000).toString())) {
    const svg=cleanSVG(bytes.toString('utf8')); if (!svg) return null;
    bytes=Buffer.from(svg); mime='image/svg+xml';
  }
  return mime ? 'data:'+mime+';base64,'+bytes.toString('base64') : null;
}

function createImageReader(zip) {
  const media={}; const cache=new Map();
  async function read(href, base, alt='') {
    const name=resolveEntry(base, href);
    const result={alt:String(alt).slice(0,300)};
    let data;
    if (/^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(href||'')) {
      const bytes=Buffer.from(href.slice(href.indexOf(',')+1),'base64');
      if(bytes.length<=20*1024*1024)data=imageData(bytes);
    } else if(name) {
      if(cache.has(name))return {...result,...cache.get(name)};
      const entry=zip.file(name);
      if(entry && (entry._data?.uncompressedSize||0)<=20*1024*1024) data=imageData(await entry.async('nodebuffer'),name);
    }
    const state=data?{asset:crypto.createHash('sha256').update(data).digest('hex').slice(0,24)}:{missing:true};
    if(data)media[state.asset]=data;
    if(name)cache.set(name,state);
    return {...result,...state};
  }
  return {read,media};
}

const array=x=>x===undefined?[]:Array.isArray(x)?x:[x];
function htmlText(html) {
  const $=cheerio.load(html);
  $('script,style,iframe,object,svg,nav').remove();
  $('br').replaceWith('\n');
  $('p,div,h1,h2,h3,h4,li,blockquote,section').append('\n');
  return cleanText($.root().text()).replace(/[ \t]+\n/g,'\n');
}
async function parseEPUB(bytes,filename) {
  if(bytes.length>MAX_BYTES)throw new Error('单个文件最多支持 60 MB。');
  const zip=await JSZip.loadAsync(bytes);
  const files=Object.values(zip.files);if(files.length>20000)throw new Error('EPUB 内文件数量过多。');
  let total=0;for(const f of files){total+=f._data?.uncompressedSize||0;if(total>150*1024*1024)throw new Error('EPUB 解压内容过大。');}
  if(zip.file('META-INF/encryption.xml'))throw new Error('暂不支持包含加密资源的 EPUB，请导入无 DRM 的 EPUB 或 TXT。');
  const xml=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',removeNSPrefix:true,processEntities:false});
  const container=zip.file('META-INF/container.xml');if(!container)throw new Error('不是有效的 EPUB 文件。');
  const c=xml.parse(await container.async('string'));
  const opfPath=array(c.container?.rootfiles?.rootfile)[0]?.['@_full-path'];
  const opf=zip.file(opfPath||'');if(!opf)throw new Error('EPUB 缺少书籍目录。');
  const data=xml.parse(await opf.async('string')).package;
  const textVal=v=>typeof v==='object'?v?.['#text']:v;
  const title=textVal(array(data.metadata?.title)[0])||path.basename(filename,'.epub');
  const author=textVal(array(data.metadata?.creator)[0])||'';
  const manifest=new Map(array(data.manifest?.item).map(i=>[i['@_id'],i]));
  const base=path.posix.dirname(opfPath);let chapters=[];
  const imageReader=createImageReader(zip);
  for(const ref of array(data.spine?.itemref)){
    if(ref['@_linear']==='no')continue;
    const item=manifest.get(ref['@_idref']);if(!item)continue;
    const rel=resolveEntry(base,item['@_href']);if(!rel)continue;
    const file=zip.file(rel);if(!file)continue;
    const html=await file.async('string');const $=cheerio.load(html);
    const heading=$('h1,h2,h3').first().text().trim();
    $('script,style,iframe,object,nav').remove();
    const marker='COTEX_IMAGE_'+crypto.randomBytes(8).toString('hex')+'_';
    const pictures=[];
    const token=async(href,alt)=>{const index=pictures.length;pictures.push(await imageReader.read(href,path.posix.dirname(rel),alt));return '\n'+marker+index+'\n';};
    for(const node of $('img,svg').toArray()){
      const el=$(node);let replacement='';
      if(node.name==='img')replacement=await token(el.attr('src')||el.attr('data-src'),el.attr('alt')||'');
      else if(el.find('image').length){for(const img of el.find('image').toArray()){const i=$(img);replacement+=await token(i.attr('href')||i.attr('xlink:href'),'');}}
      else replacement=await token('data:image/svg+xml;base64,'+Buffer.from($.html(node)).toString('base64'),el.find('title').text());
      el.replaceWith(replacement);
    }
    const content=htmlText($('body').html()||$.html());
    let ps=[],images=[];
    for(const line of paragraphs(content)){
      if(line.startsWith(marker)&&/^\d+$/.test(line.slice(marker.length))){
        const image=pictures[Number(line.slice(marker.length))];if(!image)continue;
        let group=images.at(-1);if(!group||group.paragraph!==ps.length){group={paragraph:ps.length,items:[]};images.push(group);}group.items.push(image);
      }else ps.push(...splitLongParagraphs([line]));
    }
    if(heading&&ps[0]===heading){ps=ps.slice(1);images=images.map(g=>({...g,paragraph:Math.max(0,g.paragraph-1)}));}
    // Coalesce pictures separated only by the chapter heading.
    images=images.reduce((out,g)=>{if(out.at(-1)?.paragraph===g.paragraph)out.at(-1).items.push(...g.items);else out.push(g);return out;},[]);
    if(ps.length||images.length)chapters.push({title:heading||$('title').text().trim()||'第'+(chapters.length+1)+'节',paragraphs:ps,images,epubPath:rel});
  }
  if(!chapters.length)throw new Error('EPUB 没有可读取的正文或图片。');
  return {title:safeText(title),author:safeText(author),chapters,format:'EPUB',contentVersion:2,media:imageReader.media};
}

module.exports={parseEPUB,imageData};
