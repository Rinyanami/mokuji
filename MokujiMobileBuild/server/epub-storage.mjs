import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

export const bookFileLimit=60*1024*1024;
export const bookFormLimit=bookFileLimit+64*1024;
const require=createRequire(import.meta.url);
const fail=(status,message)=>Object.assign(new Error(message),{status});
const text=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';

export async function readBookUpload(request) {
  if(Number(request.headers.get('content-length'))>bookFormLimit)throw fail(413,'文件上限为 60 MiB。');
  let form;
  try{form=await request.formData();}catch{throw fail(400,'文件上传不完整，请重新选择。');}
  const file=form.get('file');
  if(!file || typeof file==='string' || !file.size)throw fail(400,'请选择包含内容的 TXT、EPUB 或 CBZ/ZIP 漫画文件。');
  if(file.size>bookFileLimit)throw fail(413,'文件上限为 60 MiB。');
  const lower=(file.name||'').toLowerCase();
  const isEpub=/\.epub$/.test(lower)||file.type==='application/epub+zip';
  const isComic=/\.(?:cbz|zip)$/.test(lower)||['application/vnd.comicbook+zip','application/zip','application/x-zip-compressed'].includes(file.type);
  const isTxt=/\.te?xt$/.test(lower)||file.type==='text/plain';
  if(!isEpub && !isComic && !isTxt)throw fail(415,'请选择 TXT、EPUB 或 CBZ / ZIP 漫画包。');
  const metadata={filename:file.name,title:text(form.get('title'),240),author:text(form.get('author'),160)};
  if(form.has('workId'))metadata.workId=form.get('workId');
  return {file,metadata,isEpub,isComic};
}

export function decodeUploadedText(bytes) {
  const encoding=bytes[0]===255 && bytes[1]===254 ? 'utf-16le' : bytes[0]===254 && bytes[1]===255 ? 'utf-16be' : 'utf-8';
  try{return new TextDecoder(encoding,{fatal:true}).decode(bytes);}
  catch{
    if(encoding==='utf-8')try{return new TextDecoder('gb18030',{fatal:true}).decode(bytes);}catch{}
    throw fail(422,'无法识别 TXT 编码，请保存为 UTF-8 后重试。');
  }
}

// A local Cotex backup can contain missing images or SVGs from an older
// importer. Expose only the assets a readable chapter actually references.
export function nativePictures(chapter,allMedia,cache) {
  if(!Array.isArray(chapter?.images) || !chapter.images.length)return {};
  const images=[],media={};
  for(const group of chapter.images) {
    if(!Number.isSafeInteger(group?.paragraph)||group.paragraph<0||group.paragraph>(chapter.paragraphs?.length||0)||!Array.isArray(group.items))continue;
    const items=[];
    for(const item of group.items) {
      const alt=text(item?.alt,300),asset=item?.asset;
      if(!/^[0-9a-f]{24}$/.test(asset||'') || !Object.hasOwn(allMedia||{},asset)){items.push({alt,missing:true});continue;}
      if(!cache.has(asset)) {
        const src=allMedia[asset];
        let safe=null;
        if(typeof src==='string' && src.length<=28*1024*1024 && /^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml);base64,[a-zA-Z0-9+/=]+$/.test(src)) {
          if(src.startsWith('data:image/svg+xml;')) {
            try{safe=require('./epub-reader.cjs').imageData(Buffer.from(src.slice(src.indexOf(',')+1),'base64'),'image.svg');}catch{/* Preserve the missing-image location. */}
          } else safe=src;
        }
        cache.set(asset,safe);
      }
      const data=cache.get(asset);
      if(data){media[asset]=data;items.push({alt,asset});}else items.push({alt,missing:true});
    }
    if(items.length) images.push({paragraph:group.paragraph,items});
  }
  return images.length ? {images,media} : {};
}

export function createEpubStorage(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS reader_epub_images (
    book_id TEXT NOT NULL, n INTEGER NOT NULL, groups_json TEXT NOT NULL, PRIMARY KEY(book_id,n),
    FOREIGN KEY(book_id,n) REFERENCES reader_chapters(book_id,n) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS reader_epub_media (
    book_id TEXT NOT NULL REFERENCES reader_uploads(id) ON DELETE CASCADE, asset TEXT NOT NULL,
    data_url TEXT NOT NULL, PRIMARY KEY(book_id,asset)
  );`);
  const bookExists=db.prepare('SELECT 1 FROM reader_uploads WHERE id=?');
  const addBook=db.prepare('INSERT INTO reader_uploads(id,title,author,chapter_count) VALUES(?,?,?,?)');
  const addChapter=db.prepare('INSERT INTO reader_chapters(book_id,n,title,paragraphs) VALUES(?,?,?,?)');
  const addGroups=db.prepare('INSERT INTO reader_epub_images(book_id,n,groups_json) VALUES(?,?,?)');
  const addMedia=db.prepare('INSERT INTO reader_epub_media(book_id,asset,data_url) VALUES(?,?,?)');
  const groupsFor=db.prepare('SELECT groups_json FROM reader_epub_images WHERE book_id=? AND n=?');
  const mediaFor=db.prepare('SELECT data_url FROM reader_epub_media WHERE book_id=? AND asset=?');

  function pictures(id,n) {
    const saved=groupsFor.get(id,n);
    if(!saved) return {};
    const images=JSON.parse(saved.groups_json), media={};
    for(const group of images)for(const {asset} of group.items) {
      if(asset && !Object.hasOwn(media,asset))media[asset]=mediaFor.get(id,asset)?.data_url;
    }
    return {images,media};
  }

  async function importComicBytes(bytes,fileName,metadata,bind) {
    const {JSZip}=require('./epub-deps.cjs');
    let zip;
    try{zip=await JSZip.loadAsync(bytes);}catch{throw fail(422,'CBZ / ZIP 文件损坏或无法打开');}
    const entries=Object.values(zip.files).filter(f=>!f.dir && !/^__MACOSX\//i.test(f.name) && !path.posix.basename(f.name).startsWith('.') && /\.(?:jpe?g|png|webp|gif|avif|bmp)$/i.test(f.name));
    if(!entries.length)throw fail(422,'压缩包内没有可读取的图片文件（支持 JPG/PNG/WebP/GIF/AVIF）');
    entries.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true,sensitivity:'base'}));

    const groups=new Map();
    for(const entry of entries){
      const parts=entry.name.split('/').filter(Boolean);
      const chName=parts.length>1 ? parts.slice(0,-1).join(' / ') : '第 1 话';
      if(!groups.has(chName))groups.set(chName,[]);
      groups.get(chName).push(entry);
    }

    const title=metadata.title||text(fileName.replace(/\.(?:cbz|zip)$/i,''),240)||'导入的漫画';
    const author=metadata.author||'';
    const id='cbz:'+createHash('sha256').update(bytes).update('\0').update(JSON.stringify([title,author])).digest('hex').slice(0,32);
    if(!bookExists.get(id)){
      const chapters=[];
      const media={};
      for(const [chTitle,imgs] of groups.entries()){
        const items=[];
        for(const imgFile of imgs.slice(0,250)){
          const buf=await imgFile.async('nodebuffer');
          if(!buf.length || buf.length>15*1024*1024)continue;
          const ext=path.posix.extname(imgFile.name).toLowerCase();
          const mime=ext==='.png'?'image/png':ext==='.webp'?'image/webp':ext==='.gif'?'image/gif':ext==='.avif'?'image/avif':ext==='.bmp'?'image/bmp':'image/jpeg';
          const asset=createHash('sha256').update(buf).digest('hex').slice(0,24);
          if(!media[asset])media[asset]=`data:${mime};base64,${buf.toString('base64')}`;
          items.push({asset,alt:path.posix.basename(imgFile.name)});
        }
        if(items.length)chapters.push({title:chTitle,images:[{paragraph:0,items}]});
      }
      if(!chapters.length)throw fail(422,'未能从漫画压缩包读取到有效图片');
      db.exec('BEGIN IMMEDIATE');
      try{
        if(!bookExists.get(id)){
          addBook.run(id,title,author,chapters.length);
          for(const [n,c] of chapters.entries()){
            addChapter.run(id,n,c.title,'[]');
            addGroups.run(id,n,JSON.stringify(c.images));
          }
          for(const [asset,data] of Object.entries(media))addMedia.run(id,asset,data);
        }
        if(metadata.workId!==undefined)bind.run(metadata.workId,id);
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
    } else if(metadata.workId!==undefined){
      bind.run(metadata.workId,id);
    }
    return id;
  }

  async function importComicFile(file,metadata,bind) {
    const bytes=Buffer.from(await file.arrayBuffer());
    return importComicBytes(bytes,path.basename(file.name),metadata,bind);
  }

  async function importEpubBytes(bytes,fileName,metadata,bind) {
    let parsed;
    try{parsed=await require('./epub-reader.cjs').parseEPUB(bytes,fileName);}
    catch(error){
      const message=String(error?.message||'');
      throw fail(422,/EPUB|60 MB|DRM/.test(message) && /[\u3400-\u9fff]/.test(message)?message:'EPUB 文件无法解析，请确认文件完整且未加密。');
    }
    const title=metadata.title||text(parsed.title,240)||text(fileName.replace(/\.epub$/i,''),240)||'导入的 EPUB';
    const author=metadata.author||text(parsed.author,160);
    const id='epub:'+createHash('sha256').update(bytes).update('\0').update(JSON.stringify([title,author])).digest('hex').slice(0,32);
    db.exec('BEGIN IMMEDIATE');
    try{
      if(!bookExists.get(id)) {
        addBook.run(id,title,author,parsed.chapters.length);
        for(const [n,c] of parsed.chapters.entries()){
          addChapter.run(id,n,c.title,JSON.stringify(c.paragraphs));
          if(c.images.length)addGroups.run(id,n,JSON.stringify(c.images));
        }
        for(const [asset,data] of Object.entries(parsed.media))addMedia.run(id,asset,data);
      }
      if(metadata.workId!==undefined)bind.run(metadata.workId,id);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return id;
  }

  async function importFile(file,metadata,bind) {
    const bytes=Buffer.from(await file.arrayBuffer());
    return importEpubBytes(bytes,path.basename(file.name),metadata,bind);
  }
  return {importFile,importEpubBytes,importComicFile,importComicBytes,pictures};
}

