import {useEffect,useMemo,useRef,useState} from 'react';
import {Bookmark,Download,FileSearch,Highlighter,PenLine,Search,X} from 'lucide-react';
import {readerRequest,type ChapterInfo,type ChapterText} from './reading-client';
import type {BookPoint,SavedPoint} from './reader-bookmarks';
import type {TextHighlight} from './reader-highlights';
import {taskAlias} from './reader-work-context';
import './reader-interaction.css';

const normalize=(t:string)=>t.normalize('NFKC').toLowerCase().replace(/\s/g,'');
function ordinal(text:string){
  if(/^\d+$/.test(text))return Number(text);
  const digits='零一二三四五六七八九';
  const units:Record<string,number>={'十':10,'百':100,'千':1000};
  const value=text.replaceAll('〇','零').replaceAll('两','二');
  if(!/^[零一二三四五六七八九十百千万]+$/.test(value))return null;
  if(!/[十百千万]/.test(value))return Number([...value].map(c=>digits.indexOf(c)).join(''));
  let total=0,group=0,digit=0;
  for(const c of value){if(c==='万'){total+=(group+digit||1)*10000;group=0;digit=0;}else if(units[c]){group+=(digit||1)*units[c];digit=0;}else digit=digits.indexOf(c);}
  return total+group+digit;
}
const numbered=/^第([\d零〇一二两三四五六七八九十百千万]+)[章回节話话篇集]/;
export function findReaderChapters(chapters:readonly ChapterInfo[],query:string){
  const q=normalize(query);if(!q)return chapters;
  const specific=numbered.exec(q);
  const number=ordinal(specific&&specific[0]===q?specific[1]:q);
  if(number!==null){
    if(specific){const exact=chapters.filter(c=>{const suffix=numbered.exec(normalize(c.title));return suffix&&ordinal(suffix[1])===number;});if(exact.length)return exact;}
    return chapters.filter(c=>c.n===number-1);
  }
  return chapters.filter(c=>normalize(c.title).includes(q)||normalize(c.realTitle||'').includes(q)||normalize(taskAlias(c.n)).includes(q)||normalize('工作记录'+String(c.n+1).padStart(3,'0')).includes(q));
}

type TextMatch={chapter:number;chapterTitle:string;paragraph:number;snippet:string};

export function ReaderRecordIndex({bookId,bookTitle,chapters,marks,highlights=[],current,workspace,busy,loading,tab,initialQuery,onClose,onGo,onRemove,onMark,onSaveNote,onUpdateHighlightNote,onRemoveHighlight}:{
  bookId?:string;bookTitle?:string;chapters:readonly ChapterInfo[];marks:SavedPoint[];highlights?:TextHighlight[];current:BookPoint;workspace:boolean;busy:boolean;loading:boolean;
  tab:'search'|'marks'|'highlights';initialQuery:string;onClose:()=>void;onGo:(p:BookPoint)=>void;onRemove:(p:BookPoint)=>void;onMark:()=>void;onSaveNote?:(p:BookPoint,note:string)=>void;onUpdateHighlightNote?:(id:string,note:string)=>void;onRemoveHighlight?:(id:string)=>void;
}){
  const [view,setView]=useState<'search'|'fulltext'|'marks'|'highlights'>(tab),[query,setQuery]=useState(initialQuery),[limit,setLimit]=useState(100);
  const [fullQuery,setFullQuery]=useState('');
  const [fullHits,setFullHits]=useState<TextMatch[]>([]);
  const [fullSearching,setFullSearching]=useState(false);
  const [fullNote,setFullNote]=useState('');
  const [exportNotice,setExportNotice]=useState('');
  const [editingNoteKey,setEditingNoteKey]=useState('');
  const [noteDraft,setNoteDraft]=useState('');
  const [editingHlId,setEditingHlId]=useState('');
  const [hlNoteDraft,setHlNoteDraft]=useState('');
  const dialog=useRef<HTMLDialogElement>(null), field=useRef<HTMLInputElement>(null);
  useEffect(()=>{const el=dialog.current,prior=document.activeElement as HTMLElement|null;el?.showModal();if(tab==='search')field.current?.focus();
    return ()=>{el?.close();if(prior?.isConnected)prior.focus({preventScroll:true});};},[tab]);
  const hits=useMemo(()=>findReaderChapters(chapters,query),[chapters,query]);
  const title=(c:ChapterInfo)=>workspace?taskAlias(c.n):c.title;
  const marked=marks.some(m=>m.chapter===current.chapter&&m.paragraph===current.paragraph);

  function exportNotesMarkdown(){
    const name=(bookTitle||'阅读笔记').trim();
    const lines:string[]=[`# 《${name}》阅读笔记与书签`,`> 导出时间：${new Date().toLocaleString('zh-CN')}`,''];
    if(highlights.length){
      lines.push(`## 划线与笔记 (${highlights.length})`,'');
      for(const h of highlights){
        const c=chapters.find(x=>x.n===h.chapter);
        const chName=c?(c.realTitle||c.title):`第 ${h.chapter+1} 章`;
        lines.push(`### ${chName} · 第 ${h.paragraph+1} 段`,'',`> ${h.quote}`,'');
        if(h.note) lines.push(`- **笔记**：${h.note}`,'');
      }
    }
    if(marks.length){
      lines.push(`## 书签与批注 (${marks.length})`,'');
      for(const m of marks){
        const c=chapters.find(x=>x.n===m.chapter);
        const chName=c?(c.realTitle||c.title):`第 ${m.chapter+1} 章`;
        lines.push(`- **${chName} · 第 ${m.paragraph+1} 段**${m.note?`：${m.note}`:''}`);
      }
      lines.push('');
    }
    const md=lines.join('\n');
    try{
      const blob=new Blob([md],{type:'text/markdown;charset=utf-8'});
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url;a.download=`${name.replace(/[\\/:*?"<>|]/g,'_')}-笔记.md`;
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch{}
    void navigator.clipboard?.writeText(md).catch(()=>{});
    setExportNotice('已导出 Markdown 并复制到剪贴板');
    setTimeout(()=>setExportNotice(''),2500);
  }

  async function runFullTextSearch(){
    const q=fullQuery.trim();
    if(!q||!bookId)return;
    setFullSearching(true);setFullHits([]);setFullNote('');
    const qLower=q.toLowerCase();
    const candidates=chapters.filter(c=>c.available||c.cached).slice(0,60);
    const out:TextMatch[]=[];
    try{
      for(let i=0;i<candidates.length;i+=4){
        const batch=candidates.slice(i,i+4);
        const settled=await Promise.allSettled(batch.map(c=>readerRequest<ChapterText>(`chapter?id=${encodeURIComponent(bookId)}&n=${c.n}`)));
        for(let j=0;j<settled.length;j++){
          const res=settled[j];
          if(res.status!=='fulfilled')continue;
          const ch=res.value;
          const cTitle=title(batch[j])||ch.title;
          for(let p=0;p<ch.paragraphs.length;p++){
            const para=ch.paragraphs[p];
            const idx=para.toLowerCase().indexOf(qLower);
            if(idx>=0){
              const start=Math.max(0,idx-16);
              const snippet=(start>0?'…':'')+para.slice(start,start+56)+(start+56<para.length?'…':'');
              out.push({chapter:ch.n,chapterTitle:cTitle,paragraph:p,snippet});
              if(out.length>=40)break;
            }
          }
          if(out.length>=40)break;
        }
        if(out.length>=40)break;
      }
      setFullHits(out);
      if(!out.length)setFullNote(`在已扫描的 ${candidates.length} 章正文中未找到「${q}」`);
      else if(chapters.length>60)setFullNote(`已检索前 60 个可读章节，共找到 ${out.length} 处匹配`);
    }catch{
      setFullNote('全文检索失败，请稍后重试');
    }finally{
      setFullSearching(false);
    }
  }

  return <dialog ref={dialog} className="mokuji-record-index" aria-label={workspace?'工作记录检索':'搜索章节、正文与书签'} onCancel={e=>{e.preventDefault();onClose();}}>
    <header><strong>{workspace?'工作区索引':'阅读索引'}</strong><button type="button" aria-label="关闭索引" onClick={onClose}><X size={18}/></button></header>
    <section className="mokuji-index-tabs"><button type="button" aria-pressed={view==='search'} onClick={()=>{setView('search');requestAnimationFrame(()=>field.current?.focus());}}><Search size={14}/>{workspace?'搜目录':'搜章节'}</button>
      {bookId&&<button type="button" aria-pressed={view==='fulltext'} onClick={()=>setView('fulltext')}><FileSearch size={14}/>搜全书正文</button>}
      <button type="button" aria-pressed={view==='marks'} onClick={()=>setView('marks')}><Bookmark size={14}/>{workspace?'已标记':'书签/批注'} ({marks.length})</button>
      <button type="button" aria-pressed={view==='highlights'} onClick={()=>setView('highlights')}><Highlighter size={14}/>划线笔记 ({highlights.length})</button></section>
    {view==='search'&&<>
      <input ref={field} type="search" value={query} aria-label={workspace?'搜索工作记录':'按章节名或序号搜索'} placeholder={workspace?'输入名称或编号':'输入章名、中文章号或序号'} onChange={e=>{setQuery(e.target.value);setLimit(100);}} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing&&hits.length===1&&!loading)onGo({chapter:hits[0].n,paragraph:0});}}/>
      <div className="mokuji-index-list">{hits.slice(0,limit).map(c=><button type="button" key={c.n} disabled={loading} aria-current={c.n===current.chapter?'page':undefined} onClick={()=>onGo({chapter:c.n,paragraph:0})}><span>{c.n+1}</span>{title(c)}</button>)}
        {!hits.length&&<p>没有匹配的记录</p>}{hits.length>limit&&<button className="mokuji-more-records" onClick={()=>setLimit(n=>n+100)}>显示更多（共 {hits.length} 项）</button>}</div>
    </>}
    {view==='fulltext'&&<>
      <form style={{display:'flex',gap:8}} onSubmit={e=>{e.preventDefault();void runFullTextSearch();}}>
        <input type="search" value={fullQuery} onChange={e=>setFullQuery(e.target.value)} placeholder="输入人名、台词或关键词搜正文…" aria-label="搜全书正文关键词"/>
        <button type="submit" style={{flex:'none',background:'#5e6ad2',color:'#fff',padding:'0 12px',borderRadius:8,fontWeight:600}} disabled={fullSearching||!fullQuery.trim()}>{fullSearching?'检索中…':'搜索'}</button>
      </form>
      {fullNote&&<p style={{fontSize:12,color:'#6b7280',margin:'8px 0 4px'}}>{fullNote}</p>}
      <div className="mokuji-index-list">{fullHits.map((m,idx)=><button type="button" key={`${m.chapter}:${m.paragraph}:${idx}`} style={{flexDirection:'column',alignItems:'flex-start',gap:2,padding:'8px 9px',borderBottom:'1px solid #f1f5f9'}} onClick={()=>onGo({chapter:m.chapter,paragraph:m.paragraph})}>
        <strong style={{fontSize:12.5,color:'#4b56bf'}}>{m.chapterTitle} · 第 {m.paragraph+1} 段</strong>
        <small style={{fontSize:12,color:'#374151',lineHeight:1.45}}>{m.snippet}</small>
      </button>)}</div>
    </>}
    {view==='marks'&&<>
      <div style={{display:'flex',gap:8,alignItems:'center'}}>
        <button type="button" className="mokuji-mark-location" style={{flex:1}} onClick={onMark} disabled={busy||loading}>{marked?'取消当前位置标记':'标记当前位置'}</button>
        {(marks.length>0||highlights.length>0)&&<button type="button" className="mokuji-mark-location" style={{width:'auto',padding:'0 12px',display:'inline-flex',alignItems:'center',gap:5}} onClick={exportNotesMarkdown}><Download size={14}/>导出 MD</button>}
      </div>
      {exportNotice&&<p style={{fontSize:12,color:'#10b981',margin:'4px 0'}}>{exportNotice}</p>}
      <div className="mokuji-index-list">{marks.map(m=>{const c=chapters.find(c=>c.n===m.chapter);if(!c)return null;
        const mKey=m.chapter+':'+m.paragraph;const isEditing=editingNoteKey===mKey;
        return <div key={mKey} style={{borderBottom:'1px solid #f1f5f9',padding:'4px 0'}}>
          <div className="mokuji-mark-row">
            <button type="button" disabled={loading} onClick={()=>onGo(m)}>{title(c)} · {workspace?'条目':'第'} {m.paragraph+1}{workspace?'':' 段'}</button>
            {onSaveNote&&<button type="button" aria-label="添加批注" onClick={()=>{setEditingNoteKey(isEditing?'':mKey);setNoteDraft(m.note||'');}}><PenLine size={14}/></button>}
            <button type="button" aria-label={'移除标记 '+(c.n+1)+'-'+(m.paragraph+1)} disabled={busy} onClick={()=>onRemove(m)}><X size={15}/></button>
          </div>
          {m.note&&!isEditing&&<p style={{margin:'2px 9px 6px',fontSize:12,color:'#4b56bf',background:'#f4f5f8',padding:'5px 8px',borderRadius:6}}>📝 {m.note}</p>}
          {isEditing&&<form style={{display:'flex',gap:6,margin:'4px 8px 8px'}} onSubmit={e=>{e.preventDefault();onSaveNote?.(m,noteDraft);setEditingNoteKey('');}}>
            <input value={noteDraft} onChange={e=>setNoteDraft(e.target.value)} placeholder="写下一句批注或想法…" autoFocus/>
            <button type="submit" style={{flex:'none',background:'#5e6ad2',color:'#fff',padding:'0 10px',borderRadius:7}}>保存</button>
          </form>}
        </div>;})}
        {!marks.length&&<p>还没有标记，在阅读时点书签即可添加与批注。</p>}</div></>}
    {view==='highlights'&&<>
      {(marks.length>0||highlights.length>0)&&<div style={{display:'flex',justifyContent:'flex-end',marginBottom:6}}>
        <button type="button" className="mokuji-mark-location" style={{width:'auto',padding:'0 12px',display:'inline-flex',alignItems:'center',gap:5}} onClick={exportNotesMarkdown}><Download size={14}/>导出 Markdown 笔记</button>
      </div>}
      {exportNotice&&<p style={{fontSize:12,color:'#10b981',margin:'4px 0'}}>{exportNotice}</p>}
      <div className="mokuji-index-list">
      {highlights.map(h=>{const c=chapters.find(x=>x.n===h.chapter);const chLabel=c?title(c):`第 ${h.chapter+1} 章`;const isEd=editingHlId===h.id;
        return <div key={h.id} style={{borderBottom:'1px solid #f1f5f9',padding:'8px 4px'}}>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <button type="button" style={{flex:1,textAlign:'left',justifyContent:'flex-start',gap:6}} onClick={()=>onGo({chapter:h.chapter,paragraph:h.paragraph})}>
              <span style={{width:8,height:8,borderRadius:99,background:h.color==='purple'?'#8b5cf6':h.color==='green'?'#10b981':'#eab308',flex:'none'}}/>
              <small style={{color:'#4b56bf',fontWeight:600}}>{chLabel} · 第 {h.paragraph+1} 段</small>
            </button>
            {onUpdateHighlightNote&&<button type="button" aria-label="编辑划线笔记" onClick={()=>{setEditingHlId(isEd?'':h.id);setHlNoteDraft(h.note);}}><PenLine size={14}/></button>}
            {onRemoveHighlight&&<button type="button" aria-label="删除划线" onClick={()=>onRemoveHighlight(h.id)}><X size={15}/></button>}
          </div>
          <p style={{margin:'4px 6px',fontSize:12.5,color:'#1f2937',borderLeft:'3px solid #eab308',paddingLeft:8,lineHeight:1.5}}>「{h.quote}」</p>
          {h.note&&!isEd&&<p style={{margin:'4px 6px',fontSize:12,color:'#4b56bf',background:'#f4f5f8',padding:'5px 8px',borderRadius:6}}>📝 {h.note}</p>}
          {isEd&&<form style={{display:'flex',gap:6,margin:'6px'}} onSubmit={e=>{e.preventDefault();onUpdateHighlightNote?.(h.id,hlNoteDraft);setEditingHlId('');}}>
            <input value={hlNoteDraft} onChange={e=>setHlNoteDraft(e.target.value)} placeholder="写下这条划线的感悟或笔记…" autoFocus/>
            <button type="submit" style={{flex:'none',background:'#5e6ad2',color:'#fff',padding:'0 10px',borderRadius:7}}>保存</button>
          </form>}
        </div>;})}
      {!highlights.length&&<p>还没有划线笔记，在正文中选中文字即可高亮并记录想法。</p>}
    </div></>}
  </dialog>;
}
