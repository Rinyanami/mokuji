'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, BookOpen, Bookmark, Link2, Search } from 'lucide-react';
import { bangumiUrl, type BangumiBook } from '@/lib/bangumi';
import type { Book, Entry } from '@/lib/types';
import BangumiImport from './bangumi-import';
import CatalogEditor, { type CatalogSelection } from './catalog-editor';
import { getJson, SourceLinks, type SharedWork } from './catalog-sources';
import './bangumi-catalog.css';

interface Props {
  initialQuery: string;
  books: Book[];
  entries: Entry[];
  busy: boolean;
  onQuery: (query: string) => void;
  onSave: (payload: Record<string, unknown>) => Promise<unknown>;
  onAttach: (work: SharedWork, bookId?: string, bangumi?: BangumiBook) => Promise<boolean>;
  onOpen: (id: string) => void;
}
type Results<T> = { items: T[]; loading: boolean; error: string };
const empty = <T,>(): Results<T> => ({ items: [], loading: false, error: '' });

export default function BangumiCatalog({ initialQuery, books, entries, busy, onQuery, onSave, onAttach, onOpen }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const term = initialQuery;
  const urlTerm = /^https?:\/\//i.test(term);
  const [retry, setRetry] = useState(0);
  const [local, setLocal] = useState<Results<SharedWork>>(() => ({...empty<SharedWork>(), loading:!urlTerm}));
  const [remote, setRemote] = useState<Results<BangumiBook>>(() => ({...empty<BangumiBook>(), loading:!!term && !urlTerm}));
  const [selection, setSelection] = useState<CatalogSelection | null>(()=>urlTerm ? {url:term} : null);
  const [selectionKey, setSelectionKey] = useState(0);
  const officialEntry = useRef<HTMLButtonElement>(null);

  function choose(value: CatalogSelection | null) {
    setSelectionKey(key => key + 1); setSelection(value);
  }
  useEffect(() => {
    const controller = new AbortController();
    if (urlTerm) return () => controller.abort();
    const options = { signal: controller.signal };
    const encoded = encodeURIComponent(term);
    getJson<{works:SharedWork[]}>(`/api/catalog?q=${encoded}`, options)
      .then(({works})=>{ if (!controller.signal.aborted) setLocal({items:works,loading:false,error:''}); })
      .catch(failure=>{ if (!controller.signal.aborted) setLocal({items:[],loading:false,error:failure.message || '目次 Mokuji书库暂时无法查询。'}); });
    if (term) {
      getJson<{books:BangumiBook[]}>(`/api/bangumi?q=${encoded}`, options)
        .then(({books})=>{ if (!controller.signal.aborted) setRemote({items:books,loading:false,error:''}); })
        .catch(failure=>{ if (!controller.signal.aborted) setRemote({items:[],loading:false,error:failure.message || '暂时无法查询 Bangumi。'}); });
    }
    return () => controller.abort();
  }, [term, retry, urlTerm]);

  function refresh() {
    if (urlTerm) { choose({ url:term }); return; }
    choose(null);
    setLocal({...empty<SharedWork>(),loading:true});
    setRemote({...empty<BangumiBook>(),loading:!!term});
    setRetry(count=>count+1);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (value === term) refresh();
    else onQuery(value);
  }
  function storeWork(work: SharedWork) {
    setLocal(current => ({...current, items:[work,...current.items.filter(item=>item.id!==work.id)]}));
  }
  return <>
    <section className="catalog-discovery" aria-label="查找与收录作品">
      <form className="catalog-unified-search" onSubmit={submit}>
        <Search size={17}/><input value={query} onChange={event=>setQuery(event.target.value)} type="search" maxLength={1800}
          aria-label="搜索共享书库和 Bangumi" placeholder="输入书名、作者，或粘贴起点、番茄作品链接" />
        <button className="button button-sage" type="submit">搜索</button>
      </form>
      <button ref={officialEntry} className="text-button catalog-link-entry" type="button" onClick={()=>choose({})}><Link2 size={14}/>从官网链接收录</button>

      {selection && <CatalogEditor key={selectionKey} selection={selection} books={books} entries={entries} busy={busy}
        onStored={storeWork} onAttach={onAttach} onClose={()=>{choose(null); officialEntry.current?.focus();}}/>}
      {!urlTerm && <div className="catalog-search-group"><h3><Bookmark size={15}/>目次 Mokuji书库</h3>
        {local.loading && <p role="status">正在读取共享作品…</p>}
        {local.error && <p role="alert" className="bgm-error">{local.error} <button className="text-button" type="button" onClick={refresh}>重试</button></p>}
        {!local.loading && !local.error && !local.items.length && <p>{term ? '目次 Mokuji书库中还没有匹配作品。' : '共享书库还没有作品，可以从官网链接收录第一本。'}</p>}
        {local.items.length>0 && <ul className="shared-results">{local.items.map(work=>{
          const bgm=work.sources.find(source=>source.provider==='bangumi');
          const entry=entries.find(item=>item.catalogWorkId===work.id || (bgm && item.bangumiId===Number(bgm.externalId)));
          return <li key={work.id}><div><strong>{work.title}</strong><small>{work.author || '作者待补充'}</small><SourceLinks sources={work.sources}/></div>
            <div className="catalog-row-actions">{entry && <button className="text-button" type="button" onClick={()=>onOpen(entry.bookId)}>查看书架</button>}
              <button className="button button-outline" type="button" disabled={busy} onClick={()=>choose({work})}>{entry ? '关联来源' : '加入书架'}</button>
            </div></li>;
        })}</ul>}
      </div>}
      {!!term && !urlTerm && <div className="catalog-search-group"><h3><BookOpen size={16}/>Bangumi 书籍</h3>
        {remote.loading && <p role="status">正在查询 Bangumi…</p>}
        {remote.error && <p role="alert" className="bgm-error">{remote.error}</p>}
        {!remote.loading && !remote.error && !remote.items.length && <p>Bangumi 暂无匹配书籍。</p>}
        {remote.items.length>0 && <ul className="bgm-results">{remote.items.map(book=>{
          const entry=entries.find(item=>item.bangumiId===book.id || item.bookId===`custom-bgm-${book.id}`);
          const known=local.items.find(work=>work.sources.some(source=>source.provider==='bangumi' && source.externalId===String(book.id)));
          return <li key={book.id}><img src={book.cover} alt="" loading="lazy" referrerPolicy="no-referrer" />
            <div><strong>{book.title}</strong><small>{[book.author,book.year,book.platform,book.series?'系列':'',book.score?`${book.score} 分 · ${book.ratingCount} 人评分`:''].filter(Boolean).join(' · ')}</small>
              <a href={bangumiUrl(book.id)} target="_blank" rel="noreferrer">Bangumi 原条目<ArrowUpRight size={12}/></a></div>
            <button className="button button-outline" type="button" disabled={busy} onClick={()=>choose({bangumi:book,work:known})}>{entry ? '关联来源' : '选用条目'}</button></li>;
        })}</ul>}
        <a className="bgm-original" href={`https://bgm.tv/subject_search/${encodeURIComponent(term)}?cat=1`} target="_blank" rel="noreferrer">在 Bangumi 查看全部结果<ArrowUpRight size={13}/></a>
      </div>}
    </section>
    <BangumiImport books={books} entries={entries} busy={busy} onSave={onSave}/>
  </>;
}
