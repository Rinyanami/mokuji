'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BookOpen, Link2, Search } from 'lucide-react';
import { bangumiUrl, type BangumiBook } from '@/lib/bangumi';
import type { Book, Entry } from '@/lib/types';
import { catalogAction, getJson, knownAuthor, normalized, SourceLinks, type SharedWork, type SourcePreview } from './catalog-sources';

export type CatalogSelection = { work?: SharedWork; bangumi?: BangumiBook; url?: string };
type Attach = (work: SharedWork, bookId?: string, bangumi?: BangumiBook) => Promise<boolean>;

function authorsDiffer(a: string, b: string) {
  const left = knownAuthor(a), right = knownAuthor(b);
  return !!left && !!right && left !== right;
}

export default function CatalogEditor({ selection, books, entries, busy, onAttach, onClose, onStored }: {
  selection: CatalogSelection; books: Book[]; entries: Entry[]; busy: boolean; onAttach: Attach;
  onClose: () => void; onStored: (work: SharedWork) => void;
}) {
  const [work, setWork] = useState(selection.work);
  const [bangumi, setBangumi] = useState(selection.bangumi);
  const [url, setUrl] = useState(selection.url || '');
  const [preview, setPreview] = useState<SourcePreview>();
  const [title, setTitle] = useState(selection.work?.title || selection.bangumi?.title || '');
  const [author, setAuthor] = useState(selection.work?.author || selection.bangumi?.author || '');
  const [target, setTarget] = useState('');
  const [isPreviewing, setIsPreviewing] = useState(!!selection.url);
  const [matching, setMatching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [choices, setChoices] = useState<BangumiBook[] | null>(null);
  const [error, setError] = useState('');
  const titleRef = useRef<HTMLElement>(null);
  const urlRequest = useRef<AbortController | null>(null);
  const matchRequest = useRef<AbortController | null>(null);
  const savingRef = useRef(false);
  const savedWork = useRef<SharedWork | null>(null);
  const active = useRef(true);
  const locked = busy || saving || isPreviewing || matching;

  function previewUrl(value: string, signal: AbortSignal) {
    return catalogAction<SourcePreview>({ action: 'preview', url: value.trim() }, signal)
      .then(result => {
        if (signal.aborted) return;
        if (selection.work && result.work && selection.work.id !== result.work.id) throw new Error('这个来源已归到另一部共享作品，请先核对那部作品。');
        setPreview(result); setUrl(result.source.url); setWork(selection.work || result.work || undefined);
        setTitle(result.work?.title || result.title || selection.work?.title || selection.bangumi?.title || '');
        setAuthor(result.work?.author || result.author || selection.work?.author || selection.bangumi?.author || '');
        setTarget('');
      })
      .catch(failure => {
        if (!signal.aborted) setError(failure instanceof Error ? failure.message : '未能预览这个链接。');
      })
      .finally(() => { if (!signal.aborted) setIsPreviewing(false); });
  }
  function startPreview(value: string) {
    urlRequest.current?.abort();
    setError(''); setPreview(undefined); setIsPreviewing(true);
    const controller = new AbortController();
    urlRequest.current = controller;
    void previewUrl(value, controller.signal);
  }
  useEffect(() => {
    active.current = true;
    titleRef.current?.scrollIntoView({block: 'nearest'});
    if (selection.url) {
      const controller = new AbortController();
      urlRequest.current = controller;
      void previewUrl(selection.url, controller.signal);
    }
    return () => { active.current = false; urlRequest.current?.abort(); matchRequest.current?.abort(); };
    // The parent replaces this editor for each selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function findBangumi() {
    matchRequest.current?.abort();
    const controller = new AbortController();
    matchRequest.current = controller;
    setMatching(true); setError(''); setChoices(null);
    try {
      const response = await getJson<{books: BangumiBook[]}>(`/api/bangumi?q=${encodeURIComponent(title.trim())}`, {signal:controller.signal});
      if (!controller.signal.aborted) setChoices(response.books);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '暂时无法读取 Bangumi。');
    } finally { if (!controller.signal.aborted) setMatching(false); }
  }

  const sourceWork = work;
  const existingBgm = sourceWork?.sources.find(source => source.provider === 'bangumi');
  const bgmId = bangumi?.id || (existingBgm ? Number(existingBgm.externalId) : undefined);
  const linked = entries.find(entry => (sourceWork && entry.catalogWorkId === sourceWork.id) || (bgmId && entry.bangumiId === bgmId));
  const titles = new Set([title, bangumi?.title, bangumi?.originalTitle].filter((item): item is string => !!item).map(normalized));
  const candidates = books.filter(book => {
    const entry = entries.find(value => value.bookId === book.id);
    return entry && (!entry.catalogWorkId || entry.catalogWorkId === sourceWork?.id) &&
      (!entry.bangumiId || !bgmId || entry.bangumiId === bgmId) &&
      !authorsDiffer(book.author, author) && (titles.has(normalized(book.title)) || (!!book.originalTitle && titles.has(normalized(book.originalTitle))));
  });
  const resolvedTarget = linked?.bookId || target;
  const incompatible = !!preview && !!bangumi && !!(preview.work?.author || preview.author) && authorsDiffer(preview.work?.author || preview.author, bangumi.author);
  const conflictsWithWork = !!selection.work && !!preview && authorsDiffer(selection.work.author, preview.work?.author || preview.author);
  const mismatchId = !!existingBgm && !!bangumi && existingBgm.externalId !== String(bangumi.id);
  const officialTitle = preview?.work?.title || preview?.title || sourceWork?.title;
  const otherTitles = (bangumi ? [bangumi.title, bangumi.originalTitle] : [selection.work?.title]).filter((value): value is string => !!value).map(normalized);
  const differentTitle = !!officialTitle && otherTitles.length > 0 && !otherTitles.includes(normalized(officialTitle));
  const needsAuthor = !!preview && !preview.title && !preview.work;
  const canSave = !differentTitle && (!needsAuthor || !!knownAuthor(author)) && !!title.trim() && !!(sourceWork || bangumi || preview) && (!url.trim() || !!preview) && !incompatible && !mismatchId && !conflictsWithWork;
  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!canSave || locked || savingRef.current) return;
    savingRef.current = true; setSaving(true); setError('');
    try {
      let stored = savedWork.current || sourceWork;
      if (!savedWork.current && (!stored || preview || (bangumi && !existingBgm))) {
        const result = await catalogAction<{work:SharedWork}>({
          action: 'save', workId: sourceWork?.id, url: preview?.source.url, bangumiId: bangumi?.id,
          title: title.trim(), author: author.trim(),
        });
        stored = result.work;
      }
      if (!stored) throw new Error('没有取得作品记录，请重试。');
      if (!active.current) return;
      savedWork.current = stored;
      onStored(stored);
      if (!(await onAttach(stored, resolvedTarget || undefined, bangumi)) && active.current)
        setError('共享作品已保存，加入书架未完成。可核对页面提示后再次提交。');
    } catch (failure) {
      if (active.current) setError(failure instanceof Error ? failure.message : '未能保存，请重试。');
    } finally { savingRef.current = false; if (active.current) setSaving(false); }
  }
  function changeUrl(value: string) {
    savedWork.current = null; setPreview(undefined); setWork(selection.work); setError(''); setTarget(''); setUrl(value);
    setTitle(selection.work?.title || selection.bangumi?.title || ''); setAuthor(selection.work?.author || selection.bangumi?.author || '');
    setBangumi(selection.bangumi); setChoices(null);
  }
  const readonlyMetadata = !!sourceWork || (!!bangumi && !preview);
  return <section ref={titleRef} className="bgm-confirm shared-editor" aria-label="确认作品与来源">
    <h3><BookOpen size={16}/>{title ? `核对《${title}》` : '从官网链接收录作品'}</h3>
    {sourceWork && <SourceLinks sources={sourceWork.sources} />}
    <form onSubmit={confirm}>
      <label className="field-label" htmlFor="catalog-source-url">{bangumi || sourceWork ? '关联起点或番茄作品页（选填）' : '起点或番茄作品页'}</label>
      <div className="bgm-search">
        <input id="catalog-source-url" type="url" maxLength={1800} value={url} disabled={locked} placeholder="粘贴官网作品详情页链接" onChange={event=>changeUrl(event.target.value)} />
        <button type="button" className="button button-outline" disabled={locked || !url.trim()} onClick={()=>startPreview(url)}><Link2 size={14}/>{isPreviewing ? '读取中…' : '预览链接'}</button>
      </div>
      {preview && <div className="preview-source"><SourceLinks sources={[preview.source]} />
        {!preview.title && !preview.work && <p role="status">已识别官网作品链接，请核对并补全书名和作者。</p>}
      </div>}
      {(preview || bangumi || sourceWork) && <>
        <div className="form-row">
          <label className="field-label">书名<input value={title} onChange={event=>{savedWork.current=null;setTitle(event.target.value);setTarget('');}} maxLength={200} readOnly={readonlyMetadata || !!preview?.title} required disabled={locked}/></label>
          <label className="field-label">作者<input value={author} onChange={event=>{savedWork.current=null;setAuthor(event.target.value);setTarget('');}} placeholder="作者姓名" maxLength={200} readOnly={(!needsAuthor && readonlyMetadata) || !!preview?.author} required={needsAuthor} disabled={locked}/></label>
        </div>
        {bangumi && <div className="catalog-match"><a href={bangumiUrl(bangumi.id)} target="_blank" rel="noreferrer">Bangumi · {bangumi.title}</a><small>{[bangumi.author,bangumi.platform,bangumi.year,bangumi.series ? '系列' : ''].filter(Boolean).join(' · ')}</small>
          {!selection.bangumi && <button type="button" className="text-button" disabled={locked} onClick={()=>{savedWork.current=null;setBangumi(undefined);}}>取消关联</button>}
        </div>}
        {!bangumi && !existingBgm && <button type="button" className="text-button" disabled={locked || !title.trim()} onClick={findBangumi}><Search size={13}/>{matching ? '查找中…' : '查找同一作品的 Bangumi 条目'}</button>}
        {!bangumi && choices && (!choices.length ? <p className="field-help">Bangumi 暂无对应条目，可直接保存官网来源。</p> : <ul className="catalog-match-list">{choices.map(choice=><li key={choice.id}>
          <a href={bangumiUrl(choice.id)} target="_blank" rel="noreferrer">{choice.title}</a><small>{[choice.author,choice.category,choice.series ? '系列' : '',choice.year].filter(Boolean).join(' · ')}</small>
          <button type="button" className="text-button" disabled={locked || authorsDiffer(author,choice.author)} onClick={()=>{savedWork.current=null;setBangumi(choice);}}>{authorsDiffer(author,choice.author) ? '作者不同' : '关联此条目'}</button>
        </li>)}</ul>)}
        {!linked && candidates.length>0 && <label className="field-label">书架中的同名记录
          <select value={target} disabled={locked} onChange={event=>setTarget(event.target.value)}>
            <option value="">按来源或书名和作者匹配</option>
            {candidates.map(book=><option key={book.id} value={book.id}>{book.title} · {book.author} · {book.category}</option>)}
          </select></label>}
        {linked && <p className="field-help">这部作品已在书架中，原进度与私人笔记将保留。</p>}
      </>}
      {differentTitle && !incompatible && !conflictsWithWork && <p className="bgm-error" role="alert">
        来源书名《{officialTitle}》与所选条目《{bangumi?.title || selection.work?.title}》不符，请核对原名、分册或更换来源。
      </p>}
      {(incompatible || conflictsWithWork || mismatchId) && <p className="bgm-error" role="alert">{mismatchId ? '该来源已关联其他 Bangumi 条目，请核对版本。' : '两个来源标注了不同作者，请核对作品链接。'}</p>}
      {error && <p className="bgm-error" role="alert">{error}</p>}
      <div className="bgm-confirm-actions"><button className="button button-outline" type="button" disabled={saving || busy} onClick={onClose}>取消</button>
        <button className="button button-sage" type="submit" disabled={locked || !canSave}>{saving || busy ? '保存中…' : linked ? '保存来源并查看作品' : '确认并加入书架'}</button></div>
    </form>
  </section>;
}
