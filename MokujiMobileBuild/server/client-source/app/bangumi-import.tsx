'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, ChevronDown, Import } from 'lucide-react';
import { bangumiUrl, type BangumiCollection } from '@/lib/bangumi';
import type { Book, Entry } from '@/lib/types';

type Props = {
  books: Book[]; entries: Entry[]; busy: boolean;
  onSave: (payload: Record<string, unknown>) => Promise<unknown>;
};
type Page = { name: string; items: BangumiCollection[]; total: number; nextOffset: number | null; offset: number };
const normalize = (title: string) => title.normalize('NFKC').trim().toLowerCase();
function username(input: string) {
  const value = input.trim();
  try {
    const url = new URL(value);
    const user = /^\/user\/([^/]+)\/?$/.exec(url.pathname);
    if (['bgm.tv', 'bangumi.tv', 'chii.in'].includes(url.hostname) && user) return decodeURIComponent(user[1]);
  } catch { /* A plain username is accepted below. */ }
  return value;
}

export default function BangumiImport({ books, entries, busy, onSave }: Props) {
  const [input, setInput] = useState('');
  const [page, setPage] = useState<Page | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [targets, setTargets] = useState<Record<number, string>>({});
  const [includeStatus, setIncludeStatus] = useState(true);
  const [includeRating, setIncludeRating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function load(name: string, offset: number) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setError(''); setNotice(''); setLoading(true);
    try {
      const response = await fetch(`/api/bangumi?username=${encodeURIComponent(name)}&offset=${offset}`, {signal: controller.signal});
      const data = await response.json() as Page & { error?: string };
      if (!response.ok || !Array.isArray(data.items)) throw new Error(data.error || '未能读取公开收藏。');
      if (!controller.signal.aborted) {
        setPage({ ...data, name, offset });
        setSelected([]); setTargets({});
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '未能读取公开收藏。');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  function preview(event: FormEvent) {
    event.preventDefault();
    const name = username(input);
    if (!/^[\p{L}\p{N}_.-]{1,80}$/u.test(name)) { setError('请填写个人主页地址中的用户名或数字 ID。'); return; }
    void load(name, 0);
  }
  const linked = new Set(entries.flatMap(e => e.bangumiId ? [e.bangumiId] : []));
  const unavailableTargets = new Set(entries.filter(e => e.bangumiId).map(e => e.bookId));
  const rows = (page?.items || []).map(item => {
    const source = item.book;
    const titles = new Set([source.title, source.originalTitle].filter(Boolean).map(normalize));
    const matches = books.filter(b => !unavailableTargets.has(b.id) && (!b.id.startsWith('custom-bgm-') || b.id === `custom-bgm-${source.id}`) &&
      (titles.has(normalize(b.title)) || (b.originalTitle && titles.has(normalize(b.originalTitle)))));
    const target = targets[source.id] ?? (matches.some(b => b.id === `custom-bgm-${source.id}`) ? `custom-bgm-${source.id}` : matches.length ? 'undecided' : '');
    return { item, matches, target };
  });
  const picked = rows.filter(({item}) => selected.includes(item.book.id) && !linked.has(item.book.id));
  const eligible = rows.filter(({item}) => !linked.has(item.book.id)).map(({item}) => item.book.id);
  const destinations = picked.map(r => r.target).filter(Boolean);
  const duplicateTargets = new Set(destinations).size !== destinations.length;
  const unresolved = picked.some(r => r.target === 'undecided');

  async function save() {
    if (!picked.length || unresolved || duplicateTargets || busy) return;
    const result = await onSave({ collectionItems: picked.map(({item, target}) => ({
      bangumiId: item.book.id, ...(target ? { targetId: target } : { book: {
        title: item.book.title, originalTitle: item.book.originalTitle, category: item.book.category,
        author: item.book.author, description: item.book.summary, tags: item.book.tags,
      } }), collection: {
        ...(includeStatus ? {status:item.status} : {}), ...(includeRating && item.rating ? {rating:item.rating} : {}),
      }
    })) });
    if (result) { setNotice(`已保存本页选中的 ${picked.length} 部作品。`); setSelected([]); }
    else { setError('本页未导入。请核对页面提示后重试，勾选仍然保留。'); }
  }

  return <details className="bgm-catalog bgm-import">
    <summary><Import size={16}/><strong>导入 Bangumi 公开书籍收藏</strong><ChevronDown size={15}/></summary>
    <div className="bgm-catalog-body">
      <form onSubmit={preview} className="bgm-search"><input aria-label="Bangumi 用户名或主页链接" value={input} maxLength={200}
        onChange={e=>setInput(e.target.value)} placeholder="Bangumi 用户名、数字 ID 或个人主页链接" required />
        <button className="button button-outline" disabled={busy || loading || !input.trim()}>{loading ? '读取中…' : '预览收藏'}</button></form>
      {error && <p role="alert" className="bgm-error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {page && <>
        <div className="bgm-page-info"><strong>{page.name} 的公开书籍</strong><span>{page.total ? `第 ${Math.floor(page.offset / 20) + 1} / ${Math.ceil(page.total / 20)} 页` : '0 部'}</span></div>
        {rows.length > 0 && <>
          <div className="bgm-import-settings">
            <label><input type="checkbox" checked={includeStatus} disabled={busy} onChange={e=>setIncludeStatus(e.target.checked)}/>新书采用收藏状态</label>
            <label><input type="checkbox" checked={includeRating} disabled={busy} onChange={e=>setIncludeRating(e.target.checked)}/>新书采用公开评分</label>
          </div>
          <p className="bgm-import-note">未采用收藏状态的新书会加入「想读」。已有书架记录保留原进度、评分和笔记。</p>
          <button className="text-button" type="button" disabled={busy || !eligible.length} onClick={()=>setSelected(picked.length === eligible.length ? [] : eligible)}>
            {eligible.length && picked.length === eligible.length ? '取消全选' : '选择本页可导入的作品'}</button>
          <ul className="bgm-import-list">{rows.map(({item,matches,target}) => {
            const id = item.book.id; const used = linked.has(id); const checked = !used && selected.includes(id);
            return <li key={id}><div className="bgm-import-row"><label><input type="checkbox" checked={checked} disabled={used || busy || loading} onChange={e=>{
              setError(''); setSelected(current => e.target.checked ? [...new Set([...current,id])] : current.filter(n=>n!==id));
            }}/><span>{item.book.title}</span></label><a href={bangumiUrl(id)} target="_blank" rel="noreferrer" aria-label={`查看${item.book.title}的 Bangumi 条目`}><ArrowUpRight size={13}/></a>
              <small>{used ? '已关联' : [item.status, item.rating ? `${item.rating} 分` : ''].filter(Boolean).join(' · ')}</small></div>
              {checked && matches.length > 0 && <select aria-label={`${item.book.title}的保存位置`} value={target} disabled={busy} onChange={e=>setTargets({...targets,[id]:e.target.value})}>
                <option value="undecided" disabled>有同名作品，请核对版本</option><option value="">作为独立作品加入</option>
                {matches.map(b=><option key={b.id} value={b.id}>关联《{b.title}》 · {b.author} · {b.category}</option>)}
              </select>}</li>;
          })}</ul>
        </>}
        {!rows.length && <p>{page.total ? '本页没有可导入的公开书籍。' : '这个账号还没有公开的书籍收藏。'}</p>}
        {duplicateTargets && !unresolved && <p className="bgm-error" role="alert">两部已选作品指向同一本书，请分别核对。</p>}
        <div className="bgm-import-footer"><div><button type="button" className="button button-outline" disabled={busy || loading || picked.length>0 || page.offset===0} onClick={()=>load(page.name,Math.max(0,page.offset-20))}>上一页</button>
          <button type="button" className="button button-outline" disabled={busy || loading || picked.length>0 || page.nextOffset===null} onClick={()=>{if(page.nextOffset!==null)void load(page.name,page.nextOffset);}}>下一页</button></div>
          <button type="button" className="button button-sage" disabled={loading || busy || !picked.length || unresolved || duplicateTargets} onClick={save}>
            {busy ? '保存中…' : `导入所选（${picked.length}）`}</button></div>
      </>}
    </div>
  </details>;
}
