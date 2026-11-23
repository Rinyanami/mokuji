'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';

import type { SharedWork, WorkSource } from '@/lib/catalog-identity';
export type { SharedWork, WorkSource } from '@/lib/catalog-identity';
export { normalized, knownAuthor } from '@/lib/catalog-identity';
export interface SourcePreview { source: WorkSource; title: string; author: string; work?: SharedWork | null }

export function sourceName(provider: string) {
  return ({ qidian: '起点中文网', fanqie: '番茄小说', bangumi: 'Bangumi' } as Record<string, string>)[provider] || provider;
}

export async function getJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : '暂时无法读取，请稍后重试。');
  return body as T;
}

export function catalogAction<T>(payload: Record<string, unknown>, signal?: AbortSignal) {
  return getJson<T>('/api/catalog', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal,
  });
}

export function SourceLinks({ sources }: { sources: WorkSource[] }) {
  return <div className="catalog-sources">{sources.filter(source => /^https:\/\//i.test(source.url)).map(source =>
    <a key={source.provider + ':' + source.externalId} href={source.url} target="_blank" rel="noreferrer">
      {sourceName(source.provider)}<ArrowUpRight size={12} />
    </a>
  )}</div>;
}

export function PlatformButtons({urls}:{urls:string[]}) {
  const items=new Map<string,string>();
  const mobile=!['localhost','127.0.0.1','[::1]'].includes(location.hostname) || window.matchMedia('(pointer:coarse)').matches;
  for(const value of urls){
    try {
      const parsed=new URL(value);
      if(!['https:','http:'].includes(parsed.protocol))continue;
      if(['www.qidian.com','qidian.com','m.qidian.com','book.qidian.com'].includes(parsed.hostname)){
        const match=/^\/(?:book|info)\/(\d+)(?:\/|$)/.exec(parsed.pathname);
        if(match)items.set('起点',mobile?'https://m.qidian.com/book/'+match[1]+'/':'https://www.qidian.com/book/'+match[1]+'/');
      }
      if(['fanqienovel.com','www.fanqienovel.com'].includes(parsed.hostname)){
        const match=/^\/page\/(\d+)(?:\/|$)/.exec(parsed.pathname);
        if(match)items.set('番茄','https://fanqienovel.com/page/'+match[1]);
      }
    }catch{/* A private source may be a local file. */}
  }
  return items.size ? <div className="reader-platform-buttons">{Array.from(items,([name,url])=>
    <a key={name} className="button button-sage" href={url} target="_blank" rel="noreferrer">去{name}读原文<ArrowUpRight size={14}/></a>
  )}</div> : null;
}
export function WorkSources({ id }: { id: string }) {
  const [work, setWork] = useState<SharedWork | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    getJson<{ work: SharedWork }>(`/api/catalog?id=${encodeURIComponent(id)}`, {signal: controller.signal})
      .then(data => { if (!controller.signal.aborted) setWork(data.work); })
      .catch(() => { if (!controller.signal.aborted) setError('暂时无法读取作品来源。'); });
    return () => controller.abort();
  }, [id, retry]);
  return <section className="section detail-section catalog-work-sources">
    <h2>作品来源</h2>
    {work ? <><PlatformButtons urls={work.sources.map(source=>source.url)}/><SourceLinks sources={work.sources}/></> : error
      ? <p role="status">{error} <button type="button" className="text-button" onClick={() => {setError(''); setRetry(value => value + 1);}}>重试</button></p>
      : <p role="status">正在读取来源…</p>}
  </section>;
}
