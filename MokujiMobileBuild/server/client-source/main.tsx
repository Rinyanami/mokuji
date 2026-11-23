import { installLocalFirstFetch } from './lib/local-first-engine';
import { ConnectionProvider } from './app/connection-mode';
import { createRoot } from 'react-dom/client';

installLocalFirstFetch();
import { useEffect, useState } from 'react';
import ReaderApp from './app/reader-app';
import { readAppearance, readAppTheme, readerModes, saveAppearance, saveAppTheme, saveShellTheme, saveSurface } from './app/reader-appearance';
import { setTabAppearance, workspaceBookId } from './app/work-route';
import type { Snapshot } from './lib/types';
import './app/globals.css';
import './local.css';

function LocalApp() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/library', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('暂时无法读取本地书架。请确认启动窗口仍然开着。');
        const {snapshot} = await response.json();
        if (!snapshot || !Array.isArray(snapshot.books) || !snapshot.user) throw new Error('没有读取到完整的书架数据。');
        if (!controller.signal.aborted) setSnapshot(snapshot);
      })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message || '打开书架失败。'); });
    return () => controller.abort();
  }, [attempt]);
  if (!snapshot) return <main className="startup"><h1>{startupProduct || '目次 Mokuji'}</h1>
    <p role="status">{startupProduct ? (error ? '无法连接工作区，请确认本机服务已启动。' : '正在载入工作区…') : (error || '正在打开书架…')}</p>
    {error && <button className="button button-sage" onClick={()=>{setError('');setAttempt(value=>value+1);}}>重试</button>}
  </main>;
  return <ConnectionProvider><ReaderApp initial={snapshot}/></ConnectionProvider>;
}
// Direct reader links can select the same layout as the library picker.
const entryUrl = new URL(window.location.href);
const readerEntry = /^#\/(?:work|body)\//.test(entryUrl.hash) || entryUrl.hash==='#/workspace';
if(readerEntry && !entryUrl.searchParams.has('skin') && entryUrl.searchParams.has('surface')){
  const surface=entryUrl.searchParams.get('surface');
  if(surface==='desktop'||surface==='web')saveSurface(surface);
  entryUrl.searchParams.delete('surface');
  window.history.replaceState(window.history.state,'',entryUrl);
}
if (readerEntry && entryUrl.searchParams.has('skin')) {
  const mode = readerModes.find(item=>item.value===entryUrl.searchParams.get('skin'));
  if (mode) {
    saveAppearance(mode.value);
    if (mode.value==='normal' && entryUrl.hash.startsWith('#/work/')) {
      const id=workspaceBookId(entryUrl.hash.slice('#/work/'.length));
      if(id) entryUrl.hash='#/body/'+encodeURIComponent(id);
    }
    const surface = entryUrl.searchParams.get('surface');
    if (surface==='web' || surface==='desktop') saveSurface(surface);
    entryUrl.searchParams.delete('skin');
    entryUrl.searchParams.delete('surface');
    window.history.replaceState(window.history.state, '', entryUrl);
  }
} else if ((entryUrl.hash.startsWith('#/work/') || entryUrl.hash==='#/workspace') && readAppearance()==='normal') {
  saveAppearance('codex');
}
saveAppTheme(readAppTheme());
const themeParam = entryUrl.searchParams.get('theme');
if (themeParam === 'light' || themeParam === 'dark') {
  saveShellTheme(themeParam);
  saveAppTheme(themeParam);
  entryUrl.searchParams.delete('theme');
  window.history.replaceState(window.history.state, '', entryUrl);
}
const rawSniff = entryUrl.searchParams.get('sniff') || entryUrl.searchParams.get('url') || entryUrl.searchParams.get('text') || '';
const hashSniffMatch = /[?&](?:sniff|url)=([^&]+)/.exec(entryUrl.hash);
const candidateSniff = rawSniff || (hashSniffMatch ? decodeURIComponent(hashSniffMatch[1]) : '');
const extractedSniffUrl = /https?:\/\/[^\s"'<>]+/i.exec(candidateSniff)?.[0];
if (extractedSniffUrl) {
  try { sessionStorage.setItem('mokuji.pendingSniffUrl', extractedSniffUrl); } catch {}
  entryUrl.searchParams.delete('sniff');
  entryUrl.searchParams.delete('url');
  entryUrl.searchParams.delete('text');
  entryUrl.searchParams.delete('title');
  entryUrl.hash = '#/sources';
  window.history.replaceState(window.history.state, '', entryUrl);
}
if ('serviceWorker' in navigator && window.location.protocol !== 'file:' && window.location.hostname !== 'local.mokuji.app') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
const startupMode = readerEntry ? readAppearance() : 'normal';
const startupProduct = startupMode==='normal' ? undefined : readerModes.find(mode=>mode.value===startupMode)?.label;
setTabAppearance(startupProduct);
createRoot(document.getElementById('root')!).render(<LocalApp/>);
