import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ImageOff, Images, X } from 'lucide-react';
import type { ChapterText } from './reading-client';
import './reader-interaction.css';

type Group = NonNullable<ChapterText['images']>[number];
type Preview = {src:string; label:string};

function imageSource(value?:string) {
  if (!value) return '';
  if (/^\/api\/reader\/img\?/.test(value)) return value;
  return /^data:image\/(?:png|jpeg|gif|webp|svg\+xml|avif|bmp);base64,/i.test(value) ? value : '';
}

export function ReaderMedia({bookId,chapter,group,media,workspace,comicMode,anchor,remoteClosed,ready,busy,onFold}:{
  bookId:string;chapter:number;group:Group;media?:Record<string,string>;workspace:boolean;comicMode?:boolean;anchor?:number;remoteClosed:boolean;ready:boolean;busy:boolean;onFold:(point:{chapter:number;paragraph:number},closed:boolean)=>Promise<boolean>
}) {
  const storageKey='mokuji.media.closed.'+bookId+':'+chapter+':'+group.paragraph;
  const [legacyClosed,setLegacyClosed]=useState(()=>{try{return localStorage.getItem(storageKey)==='1';}catch{return false;}});
  const closed=!ready||remoteClosed||legacyClosed;
  useEffect(()=>{
    if(!remoteClosed||!legacyClosed)return;
    try{localStorage.removeItem(storageKey);}catch{}
    setLegacyClosed(false);
  },[remoteClosed,legacyClosed,storageKey]);
  const [failed,setFailed]=useState<Set<number>>(()=>new Set());
  const [preview,setPreview]=useState<Preview|null>(null);
  const dialog=useRef<HTMLDialogElement>(null);
  const opener=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    if(!preview)return;
    const element=dialog.current;
    element?.showModal();
    return ()=>{element?.close();opener.current?.focus({preventScroll:true});};
  },[preview]);
  if (comicMode && !workspace) {
    return <div className="mokuji-comic-strip" data-p={anchor}>
      {group.items.map((item, i) => {
        const alt = item.alt || `第 ${i + 1} 页`;
        const src = item.asset && imageSource(media?.[item.asset]);
        if (item.missing || !src || failed.has(i)) return <div key={i} className="mokuji-media-missing"><ImageOff size={18}/><span>{alt} · 图片加载失败</span></div>;
        return <img key={i} className="mokuji-comic-page" src={src} alt={alt} decoding="async" loading="lazy" onError={() => setFailed(previous => new Set(previous).add(i))}/>;
      })}
    </div>;
  }
  const label=workspace?'已查看图片':'章节插图';
  return <div className="mokuji-media" data-p={anchor}>
    <button type="button" className="mokuji-media-toggle" aria-expanded={!closed} disabled={busy} onClick={async()=>{
      if(await onFold({chapter,paragraph:group.paragraph},!closed)){
        try{localStorage.removeItem(storageKey);}catch{}
        setLegacyClosed(false);
      }
    }}><Images size={16}/>{label}{group.items.length>1?' · '+group.items.length+' 张':''}{closed?<ChevronRight size={15}/>:<ChevronDown size={15}/>}</button>
    {!closed&&<div className="mokuji-media-grid">{group.items.map((item,i)=>{
      const alt=workspace?'附件 '+(i+1):item.alt||'插图 '+(i+1);
      const src=item.asset&&imageSource(media?.[item.asset]);
      if(item.missing||!src||failed.has(i))return <div key={i} className="mokuji-media-missing"><ImageOff size={18}/><span>{alt} · 图片不可用</span></div>;
      return <button key={i} type="button" className="mokuji-media-thumb" aria-label={'预览'+alt} onClick={event=>{opener.current=event.currentTarget;setPreview({src,label:alt});}}>
        <img src={src} alt={alt} decoding="async" loading="lazy" onError={()=>setFailed(previous=>new Set(previous).add(i))}/></button>;
    })}</div>}
    {preview&&<dialog ref={dialog} className="mokuji-media-preview" aria-label="图片预览" onCancel={e=>{e.preventDefault();setPreview(null);}} onClick={e=>{if(e.target===e.currentTarget)setPreview(null);}}>
      <div><header><span>{preview.label}</span><button type="button" aria-label="关闭图片" onClick={()=>setPreview(null)} autoFocus><X/></button></header><img src={preview.src} alt={preview.label}/></div>
    </dialog>}
  </div>;
}
