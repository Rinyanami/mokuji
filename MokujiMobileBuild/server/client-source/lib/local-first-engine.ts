import { defaultTaxonomy, type Book, type CategoryDef, type Entry, type RatingBand, type ReadingEvent, type ShelfTaxonomy, type Snapshot } from './types';
import type { BookDetail, BookSourceItem, ChapterImageGroup, ChapterInfo, ChapterText, ReaderBook, ReadingMark, SourceSearchHit } from '../app/reading-client';
import { createClientCloudAdapter, crossPlatformHttp, defaultStoredSyncConfig, sha256HexText, type StoredSyncConfig } from './local-cloud-sync';

const DB_NAME = 'mokuji.localfirst.v1';
const STORE_NAME = 'kv';
const PEER_CONFIG_KEY = 'mokuji.peer.sync.v1';
const FORCE_OFFLINE_KEY = 'mokuji.forceLocalMode';

export type PeerSyncConfig = {
  url: string;
  lastSyncAt: string | null;
  lastSummary: string | null;
};

type StoredChapter = { title: string; paragraphs: string[]; images?: ChapterImageGroup[]; media?: Record<string, string>; sourceUrl?: string };
type BookmarkItem = { id: string; bookId: string; chapter: number; paragraph: number; excerpt: string; createdAt: string };
async function resolveCloudSyncCfg(): Promise<StoredSyncConfig> {
  const saved = await kvGet<StoredSyncConfig>('cloudSyncCfg');
  if (saved && (saved.provider !== 'none' || saved.kodo?.accessKey || saved.webdav?.url)) return saved;
  return defaultStoredSyncConfig();
}
let autoSyncTimer: number | null = null;
function scheduleAutoSync() {
  if (typeof window === 'undefined') return;
  if (autoSyncTimer) window.clearTimeout(autoSyncTimer);
  autoSyncTimer = window.setTimeout(() => {
    autoSyncTimer = null;
    void (async () => {
      try {
        const cfg = await resolveCloudSyncCfg();
        if (cfg && cfg.provider !== 'none') {
          await handleLocalApi('/api/sync/push', { method: 'POST' });
          return;
        }
        const peer = getPeerSyncConfig();
        if (peer.url) await syncWithRemotePeer(peer.url, 'push');
      } catch {}
    })();
  }, 6000);
}
type ShelfMetaPayload = {
  collections: Array<{ id: string; name: string; description: string; workIds: string[]; updatedAt: string }>;
  overrides: Record<string, Partial<Book>>;
  taxonomy: ShelfTaxonomy;
};

const memFallback = new Map<string, unknown>();
let dbPromise: Promise<IDBDatabase | null> | null = null;
let nativeFetchRef: typeof window.fetch | null = null;
let runtimeMode: 'server' | 'local-offline' = typeof window !== 'undefined' && window.location.protocol === 'file:' ? 'local-offline' : 'server';
const modeListeners = new Set<(mode: 'server' | 'local-offline') => void>();

function notifyMode(next: 'server' | 'local-offline') {
  if (runtimeMode === next) return;
  runtimeMode = next;
  modeListeners.forEach(fn => {
    try { fn(next); } catch {}
  });
}

export function getLocalEngineMode() {
  return runtimeMode;
}

export function subscribeLocalEngineMode(listener: (mode: 'server' | 'local-offline') => void) {
  modeListeners.add(listener);
  return () => { modeListeners.delete(listener); };
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function kvGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) {
    if (memFallback.has(key)) return memFallback.get(key) as T;
    try {
      const raw = localStorage.getItem('mk_kv_' + key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }
  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function kvSet<T>(key: string, value: T): Promise<void> {
  memFallback.set(key, value);
  const db = await openDb();
  if (!db) {
    try { localStorage.setItem('mk_kv_' + key, JSON.stringify(value)); } catch {}
    return;
  }
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export function getPeerSyncConfig(): PeerSyncConfig {
  try {
    const raw = localStorage.getItem(PEER_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PeerSyncConfig>;
      return {
        url: typeof parsed.url === 'string' ? parsed.url : '',
        lastSyncAt: typeof parsed.lastSyncAt === 'string' ? parsed.lastSyncAt : null,
        lastSummary: typeof parsed.lastSummary === 'string' ? parsed.lastSummary : null,
      };
    }
  } catch {}
  return { url: '', lastSyncAt: null, lastSummary: null };
}

export function setPeerSyncConfig(patch: Partial<PeerSyncConfig>): PeerSyncConfig {
  const next = { ...getPeerSyncConfig(), ...patch };
  try { localStorage.setItem(PEER_CONFIG_KEY, JSON.stringify(next)); } catch {}
  return next;
}

export function normalizePeerUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const u = new URL(withProto);
  return u.origin;
}

function starterSnapshot(): Snapshot {
  const now = new Date().toISOString();
  const sampleBookId = 'local-guide-01';
  return {
    user: { id: 'local-reader', name: '本机书友' },
    revision: 1,
    books: [
      {
        id: sampleBookId,
        title: '目次离线使用指南',
        author: 'Mokuji',
        category: '工具书',
        tags: ['离线指南', '上手必看'],
        country: '中国',
        language: 'zh-CN',
        description: '本设备已启用本地优先引擎，无需连接电脑或服务器即可直接整理书架、导入本地 TXT/EPUB 与使用工作区伪装壳；需要多端同步时再前往「个人主页」选填同步链接或七牛云。',
        cover: '',
        color: '#4e6c5e',
        unit: '章',
        total: 2,
        publicationStatus: '已完成',
      },
    ],
    entries: [
      {
        bookId: sampleBookId,
        status: '在读',
        position: 1,
        volume: null,
        unit: '章',
        locationText: '',
        note: '支持单机本地导入、Bangumi 自定义分类评分与摸鱼伪装阅读。',
        rating: 9,
        sourceUrl: '',
        edition: '本机离线版',
        updatedAt: now,
        startedAt: now,
        finishedAt: '',
      },
    ],
    events: [],
    reviews: [],
    posts: [],
    replies: [],
  };
}

function starterMeta(): ShelfMetaPayload {
  return {
    collections: [],
    overrides: {},
    taxonomy: structuredClone(defaultTaxonomy),
  };
}

async function ensureSnapshot(): Promise<Snapshot> {
  const existing = await kvGet<Snapshot>('library');
  if (existing && Array.isArray(existing.books)) return existing;
  const seed = starterSnapshot();
  await kvSet('library', seed);
  return seed;
}

async function ensureMeta(): Promise<ShelfMetaPayload> {
  const existing = await kvGet<ShelfMetaPayload>('shelfMeta');
  if (existing && existing.taxonomy) return existing;
  const seed = starterMeta();
  await kvSet('shelfMeta', seed);
  return seed;
}

async function ensureReaderBooks(): Promise<{ books: ReaderBook[]; bindings: Record<string, string> }> {
  const existing = await kvGet<{ books: ReaderBook[]; bindings: Record<string, string> }>('readerBooks');
  if (existing && Array.isArray(existing.books)) return existing;
  const now = new Date().toISOString();
  const guideBook: ReaderBook = {
    id: 'local-guide-01',
    title: '目次离线使用指南',
    author: 'Mokuji',
    source: 'local',
    category: '工具书',
    unit: '章',
    sourceType: 'upload',
    chapterCount: 2,
    available: true,
    progress: { chapter: 0, paragraph: 0, revision: 1, updatedAt: now },
  };
  await kvSet('chap:local-guide-01:0', {
    title: '第 1 章 零依赖本地运行说明',
    paragraphs: [
      '欢迎使用目次（Mokuji）本地优先引擎！你当前正在本机独立运行完整书架、自定义分类/评分/标签系统与 6 套伪装阅读壳。',
      '无需连接电脑主机、无需注册登录、也不需要提前配置服务器地址，所有阅读记录与书库文件均直接安全地保存在本机 IndexedDB 本地数据库中。',
      '你可以点击「阅读 -> 导入 TXT / EPUB / CBZ」随时将手机或电脑中的小说直接切分章导入离线阅读。',
    ],
  } satisfies StoredChapter);
  await kvSet('chap:local-guide-01:1', {
    title: '第 2 章 需要多端同步时再连电脑或七牛',
    paragraphs: [
      '当你需要把手机上的书单、进度和本地小说同步到家里的电脑（Mokuji.exe）、NAS 或其他设备时，只需前往「个人主页 -> 多端同步与可选主机连接」。',
      '在那里你可以选填：1）电脑端「手机连接」局域网网址或自建 HTTPS 服务器；2）七牛云 Kodo 私有存储；3）NAS WebDAV。随时双向拉取或推送对齐。',
      '提示：进入工作区后，悬停标签/章节名可 0ms 瞬显真名，触摸屏或手机端可点右上角「眼睛图标」一键切换全显真名。',
    ],
  } satisfies StoredChapter);
  const init = { books: [guideBook], bindings: { 'local-guide-01': 'local-guide-01' } };
  await kvSet('readerBooks', init);
  return init;
}

function decodeTextBuffer(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('gb18030').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}

function splitTxtIntoChapters(rawText: string, fallbackTitle: string): StoredChapter[] {
  const normalized = rawText.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const headingRe = /^\s*(?:第[零〇一二两三四五六七八九十百千万0-9]+[章回节卷部篇集](?:\s+.*)?|Chapter\s+\d+(?:[:.\s].*)?|[序楔]章.*|尾声.*|番外.*)$/i;
  const chapters: StoredChapter[] = [];
  let curTitle = '第 1 章 ' + fallbackTitle;
  let curParagraphs: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.length <= 60 && headingRe.test(trimmed)) {
      if (curParagraphs.length > 0) {
        chapters.push({ title: curTitle, paragraphs: curParagraphs });
        curParagraphs = [];
      }
      curTitle = trimmed;
    } else {
      curParagraphs.push(trimmed);
      if (curParagraphs.length >= 160 && !chapters.some(c => headingRe.test(c.title))) {
        chapters.push({ title: `第 ${chapters.length + 1} 节`, paragraphs: curParagraphs });
        curParagraphs = [];
        curTitle = `第 ${chapters.length + 1} 节`;
      }
    }
  }
  if (curParagraphs.length > 0) chapters.push({ title: curTitle, paragraphs: curParagraphs });
  if (!chapters.length) chapters.push({ title: '正文', paragraphs: ['（文件为空或未能识别文本段落）'] });
  return chapters;
}

async function unpackZipEntries(buffer: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = Math.max(0, bytes.length - 65558); i <= bytes.length - 22; i++) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
    }
  }
  if (eocd < 0) throw new Error('无法识别的 ZIP / EPUB 结构');
  const total = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  const td = new TextDecoder('utf-8');

  for (let i = 0; i < total; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeaderOff = view.getUint32(offset + 42, true);
    const name = td.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    offset += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;
    const lhNameLen = view.getUint16(localHeaderOff + 26, true);
    const lhExtraLen = view.getUint16(localHeaderOff + 28, true);
    const dataStart = localHeaderOff + 30 + lhNameLen + lhExtraLen;
    const compressed = bytes.subarray(dataStart, dataStart + compSize);

    if (method === 0) {
      out.set(name, compressed);
    } else if (method === 8 && typeof DecompressionStream !== 'undefined') {
      try {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        const plain = new Uint8Array(compressed.byteLength);
        plain.set(compressed);
        void writer.write(plain).then(() => writer.close());
        const ab = await new Response(ds.readable).arrayBuffer();
        out.set(name, new Uint8Array(ab));
      } catch {
        // Skip entries that fail browser deflate
      }
    }
  }
  return out;
}

function htmlToParagraphs(html: string): { title: string; paragraphs: string[]; imageRefs: string[] } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style').forEach(el => el.remove());
  const h = doc.querySelector('h1, h2, h3, title')?.textContent?.trim() || '';
  const paragraphs: string[] = [];
  const imageRefs: string[] = [];
  doc.querySelectorAll('img, image').forEach(img => {
    const src = img.getAttribute('src') || img.getAttribute('xlink:href') || img.getAttribute('href') || '';
    if (src && !imageRefs.includes(src)) imageRefs.push(src);
  });
  doc.querySelectorAll('p, div, li, blockquote, h1, h2, h3').forEach(node => {
    if (node.querySelector('p, div')) return;
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) paragraphs.push(text);
  });
  if (!paragraphs.length && !imageRefs.length) {
    const fallback = (doc.body?.textContent || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
    paragraphs.push(...fallback);
  }
  return { title: h, paragraphs, imageRefs };
}

function bytesToDataUrl(bytes: Uint8Array, name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || 'png';
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png';
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

async function parseUploadedFileLocally(file: File, customTitle?: string, customAuthor?: string): Promise<{ book: ReaderBook; chapters: StoredChapter[] }> {
  const cleanName = file.name.replace(/\.(?:txt|text|epub|cbz|zip)$/i, '');
  const title = customTitle?.trim() || cleanName || '未命名本地作品';
  const author = customAuthor?.trim() || '本地导入';
  const isCbz = /\.(?:cbz|zip)$/i.test(file.name);
  const isEpub = /\.epub$/i.test(file.name);
  const id = (isCbz ? 'cbz:' : isEpub ? 'epub:' : 'local-') + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const now = new Date().toISOString();

  let chapters: StoredChapter[];
  let detectedTitle = title;
  let detectedAuthor = author;

  if (isCbz) {
    const entries = await unpackZipEntries(await file.arrayBuffer());
    const imgNames = Array.from(entries.keys())
      .filter(k => /\.(?:png|jpe?g|webp|gif)$/i.test(k) && !k.startsWith('__MACOSX/'))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const byFolder = new Map<string, string[]>();
    for (const key of imgNames) {
      const slash = key.lastIndexOf('/');
      const folder = slash > 0 ? key.slice(0, slash) : '第 1 话';
      const list = byFolder.get(folder) || [];
      list.push(key);
      byFolder.set(folder, list);
    }
    const groups: Array<[string, string[]]> = byFolder.size > 1
      ? Array.from(byFolder.entries())
      : Array.from({ length: Math.max(1, Math.ceil(imgNames.length / 20)) }, (_, idx) => [`第 ${idx + 1} 话`, imgNames.slice(idx * 20, (idx + 1) * 20)]);

    chapters = groups.map(([chTitle, keys]) => {
      const media: Record<string, string> = {};
      const items = keys.map((k, idx) => {
        const asset = `img_${idx}`;
        media[asset] = bytesToDataUrl(entries.get(k)!, k);
        return { asset, alt: `${chTitle} 第 ${idx + 1} 页` };
      });
      return { title: chTitle, paragraphs: [], images: items.length ? [{ paragraph: 0, items }] : [], media };
    });
  } else if (isEpub) {
    const entries = await unpackZipEntries(await file.arrayBuffer());
    const htmlNames = Array.from(entries.keys())
      .filter(k => /\.(?:x?html?|htm)$/i.test(k) && !/(?:nav|toc)\./i.test(k))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const opfKey = Array.from(entries.keys()).find(k => /\.opf$/i.test(k));
    if (opfKey) {
      const opfText = decodeTextBuffer(entries.get(opfKey)!);
      const tMatch = /<dc:title[^>]*>([^<]+)<\/dc:title>/i.exec(opfText);
      const aMatch = /<dc:creator[^>]*>([^<]+)<\/dc:creator>/i.exec(opfText);
      if (tMatch?.[1] && !customTitle) detectedTitle = tMatch[1].trim();
      if (aMatch?.[1] && !customAuthor) detectedAuthor = aMatch[1].trim();
    }
    const allEntryKeys = Array.from(entries.keys());
    chapters = [];
    for (const key of htmlNames) {
      const parsed = htmlToParagraphs(decodeTextBuffer(entries.get(key)!));
      const media: Record<string, string> = {};
      const imgItems: Array<{ asset: string; alt: string }> = [];
      const baseDir = key.includes('/') ? key.slice(0, key.lastIndexOf('/') + 1) : '';
      for (const ref of parsed.imageRefs) {
        const cleanRef = ref.replace(/^\.\//, '').replace(/#.*$/, '');
        const matchKey = entries.has(baseDir + cleanRef)
          ? baseDir + cleanRef
          : allEntryKeys.find(k => k.toLowerCase().endsWith('/' + cleanRef.split('/').pop()?.toLowerCase()) || k.toLowerCase() === cleanRef.toLowerCase());
        if (matchKey && /\.(?:png|jpe?g|webp|gif)$/i.test(matchKey)) {
          const asset = `epub_img_${imgItems.length}`;
          media[asset] = bytesToDataUrl(entries.get(matchKey)!, matchKey);
          imgItems.push({ asset, alt: `${parsed.title || '插图'} ${imgItems.length + 1}` });
        }
      }
      if (parsed.paragraphs.length > 0 || imgItems.length > 0) {
        chapters.push({
          title: parsed.title || `第 ${chapters.length + 1} 章`,
          paragraphs: parsed.paragraphs,
          ...(imgItems.length ? { images: [{ paragraph: parsed.paragraphs.length, items: imgItems }], media } : {}),
        });
      }
    }
    if (!chapters.length) chapters = [{ title: '第 1 章', paragraphs: ['（未能从 EPUB 中提取到可读文本章节，若为加密 DRM 书请先解密后再导入）'] }];
  } else {
    const raw = decodeTextBuffer(new Uint8Array(await file.arrayBuffer()));
    chapters = splitTxtIntoChapters(raw, title);
  }

  const book: ReaderBook = {
    id,
    title: detectedTitle,
    author: detectedAuthor,
    source: isCbz ? 'cbz' : isEpub ? 'epub' : 'txt',
    category: isCbz ? '漫画' : '文学',
    unit: isCbz ? '话' : '章',
    sourceType: 'upload',
    chapterCount: chapters.length,
    available: true,
    progress: { chapter: 0, paragraph: 0, revision: 1, updatedAt: now },
  };
  return { book, chapters };
}

function applyShelfMetaToBooks(books: Book[], meta: ShelfMetaPayload): Book[] {
  return books.map(b => {
    const ov = meta.overrides?.[b.id];
    return ov ? { ...b, ...ov, id: b.id } : b;
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function handleLocalLibraryPost(body: Record<string, unknown>): Promise<Response> {
  const snap = await ensureSnapshot();
  const action = String(body.action || '');
  const now = new Date().toISOString();
  snap.revision = (snap.revision || 0) + 1;

  if (action === 'addBook') {
    const raw = (body.book || {}) as Partial<Book>;
    const id = raw.id || 'book-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    const created: Book = {
      id,
      title: String(raw.title || '未命名作品'),
      originalTitle: raw.originalTitle || '',
      author: String(raw.author || '佚名'),
      category: raw.category || '文学',
      tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
      country: raw.country || '',
      language: raw.language || 'zh-CN',
      description: raw.description || '',
      cover: raw.cover || '',
      color: raw.color || '#52688f',
      unit: raw.unit || '章',
      total: typeof raw.total === 'number' ? raw.total : null,
      publicationStatus: raw.publicationStatus || '连载中',
      edition: raw.edition || '',
      sourceUrl: raw.sourceUrl || '',
      isCustom: true,
    };
    snap.books.unshift(created);
    snap.entries.unshift({
      bookId: id,
      status: '想读',
      position: null,
      volume: null,
      unit: created.unit,
      locationText: '',
      note: '',
      rating: null,
      sourceUrl: created.sourceUrl || '',
      edition: created.edition || '',
      updatedAt: now,
      startedAt: '',
      finishedAt: '',
    });
  } else if (action === 'saveEntry') {
    const entry = body.entry as Entry;
    if (entry?.bookId) {
      const idx = snap.entries.findIndex(e => e.bookId === entry.bookId);
      const next = { ...entry, updatedAt: now };
      if (idx >= 0) snap.entries[idx] = next;
      else snap.entries.unshift(next);
    }
  } else if (action === 'removeEntry') {
    const bookId = String(body.bookId || '');
    snap.entries = snap.entries.filter(e => e.bookId !== bookId);
  } else if (action === 'review') {
    const bookId = String(body.bookId || '');
    const book = snap.books.find(b => b.id === bookId);
    const existingIdx = snap.reviews.findIndex(r => r.bookId === bookId && r.userId === snap.user.id);
    const review = {
      id: existingIdx >= 0 ? snap.reviews[existingIdx].id : 'rev-' + Date.now().toString(36),
      userId: snap.user.id,
      displayName: snap.user.name,
      bookId,
      bookTitle: book?.title || '',
      score: typeof body.score === 'number' ? body.score : null,
      body: String(body.body || ''),
      spoiler: Boolean(body.spoiler),
      progress: String(body.progress || ''),
      createdAt: now,
    };
    if (existingIdx >= 0) snap.reviews[existingIdx] = review;
    else snap.reviews.unshift(review);
  } else if (action === 'post') {
    const bookId = String(body.bookId || '');
    const book = snap.books.find(b => b.id === bookId);
    snap.posts.unshift({
      id: 'post-' + Date.now().toString(36),
      userId: snap.user.id,
      displayName: snap.user.name,
      bookId,
      bookTitle: book?.title || '',
      title: String(body.title || ''),
      body: String(body.body || ''),
      spoiler: Boolean(body.spoiler),
      createdAt: now,
    });
  } else if (action === 'reply') {
    snap.replies.push({
      id: 'rep-' + Date.now().toString(36),
      postId: String(body.postId || ''),
      userId: snap.user.id,
      displayName: snap.user.name,
      body: String(body.body || ''),
      createdAt: now,
    });
  } else if (action === 'import' && body.backup && typeof body.backup === 'object') {
    const backup = body.backup as Partial<Snapshot>;
    const knownIds = new Set(snap.books.map(b => b.id));
    for (const b of backup.books || []) {
      if (b?.id && !knownIds.has(b.id)) {
        snap.books.push(b);
        knownIds.add(b.id);
      }
    }
    for (const e of backup.entries || []) {
      if (!e?.bookId) continue;
      const idx = snap.entries.findIndex(x => x.bookId === e.bookId);
      if (idx >= 0) snap.entries[idx] = e;
      else snap.entries.push(e);
    }
  }

  await kvSet('library', snap);
  scheduleAutoSync();
  const meta = await ensureMeta();
  return jsonResponse({ snapshot: { ...snap, books: applyShelfMetaToBooks(snap.books, meta) } });
}

async function handleLocalShelfMetaPost(body: Record<string, unknown>): Promise<Response> {
  const meta = await ensureMeta();
  const action = String(body.action || '');
  const now = new Date().toISOString();

  if (action === 'createCollection') {
    const id = 'col-' + Date.now().toString(36);
    meta.collections.unshift({
      id,
      name: String(body.name || '新书单').trim() || '新书单',
      description: String(body.description || ''),
      workIds: body.workId ? [String(body.workId)] : [],
      updatedAt: now,
    });
  } else if (action === 'renameCollection') {
    const c = meta.collections.find(x => x.id === body.id);
    if (c) {
      if (typeof body.name === 'string') c.name = body.name;
      if (typeof body.description === 'string') c.description = body.description;
      c.updatedAt = now;
    }
  } else if (action === 'deleteCollection') {
    meta.collections = meta.collections.filter(x => x.id !== body.id);
  } else if (action === 'toggleCollectionWork') {
    const c = meta.collections.find(x => x.id === body.id);
    const workId = String(body.workId || '');
    if (c && workId) {
      c.workIds = c.workIds.includes(workId) ? c.workIds.filter(w => w !== workId) : [...c.workIds, workId];
      c.updatedAt = now;
    }
  } else if (action === 'editBook') {
    const workId = String(body.workId || '');
    const patch = (body.patch || {}) as Partial<Book>;
    if (workId) meta.overrides[workId] = { ...(meta.overrides[workId] || {}), ...patch };
  } else if (action === 'saveCategories') {
    if (body.reset) meta.taxonomy.categories = structuredClone(defaultTaxonomy.categories);
    else meta.taxonomy.categories = (Array.isArray(body.categories) ? body.categories : defaultTaxonomy.categories) as CategoryDef[];
  } else if (action === 'saveRatingConfig' || action === 'saveRatings') {
    if (body.preset === 'bangumi') {
      meta.taxonomy.ratingLabels = structuredClone(defaultTaxonomy.ratingLabels);
      meta.taxonomy.ratingBands = structuredClone(defaultTaxonomy.ratingBands);
    } else if (body.preset === 'webnovel') {
      meta.taxonomy.ratingLabels = { '10': '封神之作', '9': '顶级仙草', '8': '干货仙草', '7': '粮草', '6': '干粮', '5': '打发时间', '4': '略显干涩', '3': '毒点较多', '2': '剧毒', '1': '直接劝退' };
      meta.taxonomy.ratingBands = [
        { id: 'legend', label: '9–10 仙草/封神', min: 9, max: 10 },
        { id: 'good', label: '7–8 优质粮草', min: 7, max: 8 },
        { id: 'pass', label: '5–6 干粮消遣', min: 5, max: 6 },
        { id: 'toxic', label: '1–4 毒草劝退', min: 1, max: 4 },
        { id: 'unrated', label: '暂未评分', min: null, max: null },
      ];
    } else if (body.preset === 'compact') {
      meta.taxonomy.ratingBands = [
        { id: 'high', label: '8–10 分力荐', min: 8, max: 10 },
        { id: 'mid', label: '5–7 分还行', min: 5, max: 7 },
        { id: 'low', label: '1–4 分较差', min: 1, max: 4 },
        { id: 'unrated', label: '暂未评分', min: null, max: null },
      ];
    } else {
      if (body.ratingLabels && typeof body.ratingLabels === 'object') meta.taxonomy.ratingLabels = body.ratingLabels as Record<string, string>;
      if (Array.isArray(body.ratingBands)) meta.taxonomy.ratingBands = body.ratingBands as RatingBand[];
    }
  } else if (action === 'manageTag') {
    const op = String(body.op || '');
    const existingTags = (body.existingTags || {}) as Record<string, string[]>;
    if (op === 'pin' && typeof body.tag === 'string') {
      const incoming = body.tag.split(/[，,\s]+/).map(s => s.trim()).filter(Boolean);
      meta.taxonomy.pinnedTags = Array.from(new Set([...(meta.taxonomy.pinnedTags || []), ...incoming]));
    } else if (op === 'rename' && typeof body.oldTag === 'string' && typeof body.newTag === 'string') {
      const oldTag = body.oldTag.trim();
      const newTag = body.newTag.trim();
      meta.taxonomy.pinnedTags = (meta.taxonomy.pinnedTags || []).map(t => (t === oldTag ? newTag : t));
      const snap = await ensureSnapshot();
      for (const b of snap.books) {
        const cur = meta.overrides[b.id]?.tags ?? existingTags[b.id] ?? b.tags ?? [];
        if (cur.includes(oldTag)) {
          meta.overrides[b.id] = { ...(meta.overrides[b.id] || {}), tags: Array.from(new Set(cur.map(t => (t === oldTag ? newTag : t)))) };
        }
      }
    } else if (op === 'delete' && typeof body.tag === 'string') {
      const target = body.tag.trim();
      meta.taxonomy.pinnedTags = (meta.taxonomy.pinnedTags || []).filter(t => t !== target);
      const snap = await ensureSnapshot();
      for (const b of snap.books) {
        const cur = meta.overrides[b.id]?.tags ?? existingTags[b.id] ?? b.tags ?? [];
        if (cur.includes(target)) {
          meta.overrides[b.id] = { ...(meta.overrides[b.id] || {}), tags: cur.filter(t => t !== target) };
        }
      }
    }
  } else if (action === 'saveTags') {
    if (Array.isArray(body.pinnedTags)) meta.taxonomy.pinnedTags = body.pinnedTags.map(String);
  } else if (action === 'resetTaxonomy') {
    meta.taxonomy = structuredClone(defaultTaxonomy);
  } else if (action === 'batchUpdate') {
    const ids = Array.isArray(body.workIds) ? body.workIds.map(String) : [];
    const snap = await ensureSnapshot();
    for (const wid of ids) {
      if (typeof body.category === 'string' && body.category) {
        meta.overrides[wid] = { ...(meta.overrides[wid] || {}), category: body.category };
      }
      if (typeof body.addTag === 'string' && body.addTag.trim()) {
        const b = snap.books.find(x => x.id === wid);
        const cur = meta.overrides[wid]?.tags ?? b?.tags ?? [];
        if (!cur.includes(body.addTag.trim())) {
          meta.overrides[wid] = { ...(meta.overrides[wid] || {}), tags: [...cur, body.addTag.trim()] };
        }
      }
      if (typeof body.status === 'string' && body.status) {
        const e = snap.entries.find(x => x.bookId === wid);
        if (e) e.status = body.status as Entry['status'];
      }
    }
    if (typeof body.collectionId === 'string' && body.collectionId) {
      const col = meta.collections.find(c => c.id === body.collectionId);
      if (col) col.workIds = Array.from(new Set([...col.workIds, ...ids]));
    }
    await kvSet('library', snap);
  }

  await kvSet('shelfMeta', meta);
  scheduleAutoSync();
  return jsonResponse(meta);
}

async function handleLocalApi(urlStr: string, init?: RequestInit): Promise<Response> {
  const url = new URL(urlStr, window.location.href);
  const path = url.pathname;
  const method = (init?.method || 'GET').toUpperCase();

  if (path === '/api/connection-mode') {
    return jsonResponse({ mode: 'mobile', txtStorage: 'sqlite', offlineLocal: true });
  }
  if (path === '/api/bangumi-sync/status' || path === '/api/bangumi-sync/config') {
    const saved = (await kvGet<{ token?: string; username?: string; nickname?: string; userId?: number; autoPush?: boolean; privateDefault?: boolean; lastSyncAt?: string | null; lastSummary?: string }>('bgmSync')) || {};
    if (path === '/api/bangumi-sync/config' && method === 'DELETE') {
      await kvSet('bgmSync', {});
      return jsonResponse({ hasToken: false, username: '', nickname: '', userId: null, avatar: '', autoPush: true, privateDefault: false, lastSyncAt: null, lastSummary: '已断开 Bangumi 连接' });
    }
    if (path === '/api/bangumi-sync/config' && method === 'POST') {
      const b = typeof init?.body === 'string' ? JSON.parse(init.body) as { accessToken?: string; autoPush?: boolean; privateDefault?: boolean } : {};
      const tok = b.accessToken?.trim() || saved.token || '';
      if (!tok) return jsonResponse({ error: '请输入 Bangumi Access Token' }, 400);
      const res = await crossPlatformHttp('https://api.bgm.tv/v0/me', 'GET', { Authorization: `Bearer ${tok}`, Accept: 'application/json' }, '', nativeFetchRef || undefined);
      if (!res.ok) return jsonResponse({ error: res.error || `验证 Bangumi Token 失败（HTTP ${res.status}）` }, 401);
      const u = JSON.parse(res.body) as { username?: string; nickname?: string; id?: number };
      const next = { token: tok, username: u.username || '', nickname: u.nickname || '', userId: u.id || null, autoPush: b.autoPush !== false, privateDefault: Boolean(b.privateDefault), lastSyncAt: new Date().toISOString(), lastSummary: `已绑定 @${u.nickname || u.username}` };
      await kvSet('bgmSync', next);
      return jsonResponse({ hasToken: true, ...next, avatar: '' });
    }
    return jsonResponse({ hasToken: Boolean(saved.token), username: saved.username || '', nickname: saved.nickname || '', userId: saved.userId || null, avatar: '', autoPush: saved.autoPush !== false, privateDefault: Boolean(saved.privateDefault), lastSyncAt: saved.lastSyncAt || null, lastSummary: saved.lastSummary || '本机直连 Bangumi（离线填好即可用）' });
  }
  if (path.startsWith('/api/sync/')) {
    const curCfg = await resolveCloudSyncCfg();
    const toPublic = (c: StoredSyncConfig) => ({
      provider: c.provider,
      kodo: { accessKey: c.kodo.accessKey, hasSecretKey: Boolean(c.kodo.secretKey), bucket: c.kodo.bucket, region: c.kodo.region, prefix: c.kodo.prefix, endpoint: c.kodo.endpoint },
      webdav: { url: c.webdav.url, username: c.webdav.username, hasPassword: Boolean(c.webdav.password), prefix: c.webdav.prefix },
      lastSyncAt: c.lastSyncAt,
      lastDirection: c.lastDirection,
      lastSummary: c.lastSummary || '本机直连云端模式（七牛 / WebDAV 与电脑端互通同一快照）',
    });
    if (path === '/api/sync/status') return jsonResponse(toPublic(curCfg));
    if (path === '/api/sync/config' && method === 'POST') {
      const raw = typeof init?.body === 'string' ? JSON.parse(init.body) as Partial<StoredSyncConfig> : {};
      const next: StoredSyncConfig = {
        ...curCfg,
        provider: raw.provider || curCfg.provider,
        kodo: {
          accessKey: raw.kodo?.accessKey?.trim() ?? curCfg.kodo.accessKey,
          secretKey: raw.kodo?.secretKey?.trim() ? raw.kodo.secretKey.trim() : curCfg.kodo.secretKey,
          bucket: raw.kodo?.bucket?.trim() ?? curCfg.kodo.bucket,
          region: raw.kodo?.region?.trim() || curCfg.kodo.region || 'cn-east-1',
          prefix: (raw.kodo?.prefix ?? curCfg.kodo.prefix ?? 'mokuji-sync').replace(/^\/+|\/+$/g, ''),
          endpoint: (raw.kodo?.endpoint ?? curCfg.kodo.endpoint ?? '').trim().replace(/\/+$/, ''),
        },
        webdav: {
          url: (raw.webdav?.url ?? curCfg.webdav.url ?? '').trim().replace(/\/+$/, ''),
          username: raw.webdav?.username?.trim() ?? curCfg.webdav.username,
          password: raw.webdav?.password ? raw.webdav.password : curCfg.webdav.password,
          prefix: (raw.webdav?.prefix ?? curCfg.webdav.prefix ?? 'mokuji-sync').replace(/^\/+|\/+$/g, ''),
        },
      };
      await kvSet('cloudSyncCfg', next);
      return jsonResponse({ status: toPublic(next) });
    }
    try {
      const adapter = createClientCloudAdapter(curCfg, nativeFetchRef || undefined);
      if (path === '/api/sync/test') {
        return jsonResponse(await adapter.test());
      }
      if (path === '/api/sync/push') {
        const [snap, meta, idx] = await Promise.all([ensureSnapshot(), ensureMeta(), ensureReaderBooks()]);
        const bookIndex: Array<{ id: string; key: string; hash: string }> = [];
        let uploadedBooks = 0;
        for (const rb of idx.books) {
          const chaps: Array<{ n: number; title: string; paragraphs: string }> = [];
          for (let i = 0; i < rb.chapterCount; i++) {
            const c = await kvGet<StoredChapter>(`chap:${rb.id}:${i}`);
            if (c) chaps.push({ n: i, title: c.title, paragraphs: JSON.stringify(c.paragraphs) });
          }
          const payload = { id: rb.id, type: rb.source === 'epub' ? 'epub' : 'txt', title: rb.title, author: rb.author, chapterCount: rb.chapterCount, chapters: chaps };
          const key = `books/${await sha256HexText(rb.id)}.json`;
          const hash = await sha256HexText(JSON.stringify(payload));
          await adapter.putJson(key, payload);
          bookIndex.push({ id: rb.id, key, hash });
          uploadedBooks++;
        }
        const remoteSnap = {
          version: 1,
          exportedAt: new Date().toISOString(),
          duji: {
            libraries: [{ user_id: snap.user.id, revision: snap.revision, state: JSON.stringify({ customBooks: snap.books, entries: snap.entries, events: snap.events }), updated_at: new Date().toISOString() }],
            reviews: snap.reviews,
            posts: snap.posts,
            replies: snap.replies,
            shelfMeta: meta,
          },
          reader: { bindings: Object.entries(idx.bindings).map(([work_id, book_id]) => ({ work_id, book_id })), progress: idx.books.map(b => ({ book_id: b.id, ...b.progress })) },
          bookIndex,
        };
        await adapter.putJson('snapshot.json', remoteSnap);
        curCfg.lastSyncAt = new Date().toISOString();
        curCfg.lastDirection = 'push';
        curCfg.lastSummary = `本机已上传快照与 ${uploadedBooks} 本离线书籍到云端`;
        await kvSet('cloudSyncCfg', curCfg);
        return jsonResponse({ ok: true, summary: curCfg.lastSummary, status: toPublic(curCfg) });
      }
      if (path === '/api/sync/pull') {
        const remote = await adapter.getJson('snapshot.json') as {
          duji?: { libraries?: Array<{ state?: string }>; shelfMeta?: ShelfMetaPayload };
          reader?: { bindings?: Array<{ work_id: string; book_id: string }>; progress?: Array<{ book_id: string; chapter: number; paragraph: number; revision: number; updatedAt?: string }> };
          bookIndex?: Array<{ id: string; key: string }>;
        } | null;
        if (!remote?.duji) return jsonResponse({ error: '云端还没有目次快照，请先在已有设备执行一次「立即上传同步」' }, 404);
        const snap = await ensureSnapshot();
        for (const lib of remote.duji.libraries || []) {
          const parsed = JSON.parse(lib.state || '{}') as { customBooks?: Book[]; entries?: Entry[]; events?: ReadingEvent[] };
          const bMap = new Map(snap.books.map(b => [b.id, b]));
          for (const b of parsed.customBooks || []) if (b?.id) bMap.set(b.id, b);
          snap.books = Array.from(bMap.values());
          const eMap = new Map(snap.entries.map(e => [e.bookId, e]));
          for (const e of parsed.entries || []) {
            if (!e?.bookId) continue;
            const cur = eMap.get(e.bookId);
            if (!cur || String(e.updatedAt || '') >= String(cur.updatedAt || '')) eMap.set(e.bookId, e);
          }
          snap.entries = Array.from(eMap.values());
        }
        snap.revision++;
        await kvSet('library', snap);
        if (remote.duji.shelfMeta?.taxonomy) await kvSet('shelfMeta', remote.duji.shelfMeta);
        const idx = await ensureReaderBooks();
        let pulled = 0;
        for (const item of (remote.bookIndex || []).slice(0, 25)) {
          if (idx.books.some(b => b.id === item.id)) continue;
          const bData = await adapter.getJson(item.key) as { id?: string; type?: string; title?: string; author?: string; chapterCount?: number; chapters?: Array<{ n: number; title: string; paragraphs: string | string[] }> } | null;
          if (!bData?.id || !Array.isArray(bData.chapters)) continue;
          for (const ch of bData.chapters) {
            const p = typeof ch.paragraphs === 'string' ? JSON.parse(ch.paragraphs) as string[] : ch.paragraphs;
            await kvSet(`chap:${bData.id}:${ch.n}`, { title: ch.title || `第 ${ch.n + 1} 章`, paragraphs: p || [] });
          }
          idx.books.unshift({ id: bData.id, title: bData.title || '云端书籍', author: bData.author || '', source: bData.type || 'txt', category: '文学', unit: '章', sourceType: 'upload', chapterCount: bData.chapterCount || bData.chapters.length, available: true, progress: { chapter: 0, paragraph: 0, revision: 1, updatedAt: new Date().toISOString() } });
          pulled++;
        }
        for (const bind of remote.reader?.bindings || []) idx.bindings[bind.work_id] = bind.book_id;
        await kvSet('readerBooks', idx);
        curCfg.lastSyncAt = new Date().toISOString();
        curCfg.lastDirection = 'pull';
        curCfg.lastSummary = `已从云端合并 ${snap.books.length} 部书架作品与 ${pulled} 本新书正文到本机`;
        await kvSet('cloudSyncCfg', curCfg);
        return jsonResponse({ ok: true, summary: curCfg.lastSummary, status: toPublic(curCfg) });
      }
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : '云同步请求失败' }, 400);
    }
  }
  if (path === '/api/mobile') {
    return jsonResponse({ enabled: false, localFirst: true, peer: getPeerSyncConfig() });
  }

  if (path === '/api/library') {
    if (method === 'GET') {
      const [snap, meta] = await Promise.all([ensureSnapshot(), ensureMeta()]);
      return jsonResponse({ snapshot: { ...snap, books: applyShelfMetaToBooks(snap.books, meta) } });
    }
    const rawBody = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
    return handleLocalLibraryPost(rawBody);
  }

  if (path === '/api/shelf-meta') {
    if (method === 'GET') return jsonResponse(await ensureMeta());
    const rawBody = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
    return handleLocalShelfMetaPost(rawBody);
  }

  if (path === '/api/reader/books') {
    const idx = await ensureReaderBooks();
    return jsonResponse(idx);
  }

  if (path === '/api/reader/book') {
    const id = url.searchParams.get('id') || '';
    const idx = await ensureReaderBooks();
    const book = idx.books.find(b => b.id === id);
    if (!book) return jsonResponse({ error: '未找到本机书籍缓存' }, 404);
    const chapters: ChapterInfo[] = [];
    for (let i = 0; i < book.chapterCount; i++) {
      const ch = await kvGet<StoredChapter>(`chap:${book.id}:${i}`);
      chapters.push({ n: i, title: ch?.title || `第 ${i + 1} 章`, realTitle: ch?.title || `第 ${i + 1} 章`, available: Boolean(ch), cached: Boolean(ch), access: ch ? 'cached' : 'uncached' });
    }
    return jsonResponse({ book, chapters } satisfies BookDetail);
  }

  async function hydrateStoredChapter(ch: StoredChapter): Promise<StoredChapter> {
    if (!ch.sourceUrl) return ch;
    if (ch.sourceUrl.startsWith('mangadex-ch://')) {
      if (ch.images?.length) return ch;
      const chId = ch.sourceUrl.slice('mangadex-ch://'.length);
      const res = await crossPlatformHttp(`https://api.mangadex.org/at-home/server/${encodeURIComponent(chId)}`, 'GET', {}, '', nativeFetchRef || undefined);
      if (res.ok && res.body) {
        try {
          const j = JSON.parse(res.body) as { baseUrl?: string; chapter?: { hash?: string; data?: string[]; dataSaver?: string[] } };
          const files = j.chapter?.data?.length ? j.chapter.data : (j.chapter?.dataSaver || []);
          const mode = j.chapter?.data?.length ? 'data' : 'data-saver';
          if (j.baseUrl && j.chapter?.hash && files.length) {
            const media: Record<string, string> = {};
            const items = files.map((file, idx) => {
              const asset = `md_${idx}`;
              media[asset] = `${j.baseUrl}/${mode}/${j.chapter!.hash}/${file}`;
              return { asset, alt: `第 ${idx + 1} 页` };
            });
            return { ...ch, paragraphs: [], images: [{ paragraph: 0, items }], media };
          }
        } catch {}
      }
      return ch;
    }
    if ((!ch.paragraphs || ch.paragraphs.length === 0) && !ch.images?.length) {
      const res = await crossPlatformHttp(ch.sourceUrl, 'GET', {}, '', nativeFetchRef || undefined);
      if (res.ok && res.body) {
        const parsed = htmlToParagraphs(res.body);
        if (parsed.paragraphs.length > 0) return { ...ch, paragraphs: parsed.paragraphs };
      }
    }
    return ch;
  }

  if (path === '/api/reader/chapter') {
    const id = url.searchParams.get('id') || '';
    const n = Number(url.searchParams.get('n') || '0');
    const idx = await ensureReaderBooks();
    const book = idx.books.find(b => b.id === id);
    let ch = await kvGet<StoredChapter>(`chap:${id}:${n}`);
    if (book && ch) {
      const updated = await hydrateStoredChapter(ch);
      if (updated !== ch) {
        ch = updated;
        await kvSet(`chap:${id}:${n}`, ch);
      }
    }
    if (!book || !ch) return jsonResponse({ error: '该章节尚未离线缓存，请联网嗅探或重新导入本地文件。' }, 404);
    const payload: ChapterText = {
      id: book.id,
      n,
      title: ch.title,
      paragraphs: ch.paragraphs,
      chapterCount: book.chapterCount,
      source: book.source,
      sourceUrl: ch.sourceUrl || book.sourceUrl,
      ...(ch.images ? { images: ch.images } : {}),
      ...(ch.media ? { media: ch.media } : {}),
    };
    return jsonResponse(payload);
  }

  if (path === '/api/reader/progress' && method === 'POST') {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { id?: string; chapter?: number; paragraph?: number } : {};
    const idx = await ensureReaderBooks();
    const book = idx.books.find(b => b.id === body.id);
    if (book) {
      const mark: ReadingMark = {
        chapter: Number(body.chapter ?? 0),
        paragraph: Number(body.paragraph ?? 0),
        revision: (book.progress?.revision || 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      book.progress = mark;
      await kvSet('readerBooks', idx);
      scheduleAutoSync();
      return jsonResponse({ progress: mark });
    }
    return jsonResponse({ error: '未找到书籍' }, 404);
  }

  if (path === '/api/reader/bind' && method === 'POST') {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { workId?: string; bookId?: string | null } : {};
    const idx = await ensureReaderBooks();
    if (body.workId) {
      if (body.bookId) idx.bindings[body.workId] = body.bookId;
      else delete idx.bindings[body.workId];
      await kvSet('readerBooks', idx);
    }
    return jsonResponse(idx);
  }

  if (path === '/api/reader/cotex-state') {
    const body = method === 'POST' && typeof init?.body === 'string'
      ? JSON.parse(init.body) as { id?: string; bookmark?: { chapter?: number; paragraph?: number; action?: 'add' | 'remove' }; imageFold?: { chapter?: number; paragraph?: number; closed?: boolean } }
      : {};
    const bookId = (method === 'POST' ? body.id : url.searchParams.get('id')) || '';
    const key = `cotexState:${bookId}`;
    const st = (await kvGet<{ version: string; bookmarks: Array<{ chapter: number; paragraph: number; createdAt: number }>; collapsedImages: string[] }>(key))
      || { version: 'v1', bookmarks: [], collapsedImages: [] };
    if (method === 'POST') {
      if (body.bookmark) {
        const ch = Number(body.bookmark.chapter ?? 0);
        const p = Number(body.bookmark.paragraph ?? 0);
        if (body.bookmark.action === 'remove') {
          st.bookmarks = st.bookmarks.filter(b => !(b.chapter === ch && b.paragraph === p));
        } else if (!st.bookmarks.some(b => b.chapter === ch && b.paragraph === p)) {
          st.bookmarks.unshift({ chapter: ch, paragraph: p, createdAt: Date.now() });
        }
      }
      if (body.imageFold) {
        const gk = `${Number(body.imageFold.chapter ?? 0)}:${Number(body.imageFold.paragraph ?? 0)}`;
        const set = new Set(st.collapsedImages || []);
        if (body.imageFold.closed) set.add(gk);
        else set.delete(gk);
        st.collapsedImages = Array.from(set);
      }
      st.version = 'v' + Date.now().toString(36);
      await kvSet(key, st);
      scheduleAutoSync();
    }
    return jsonResponse({ state: st });
  }

  if (path === '/api/reader/bookmarks') {
    const id = url.searchParams.get('id') || '';
    const list = (await kvGet<BookmarkItem[]>(`bookmarks:${id}`)) || [];
    return jsonResponse({ bookmarks: list });
  }

  if (path === '/api/reader/bookmark' && method === 'POST') {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { id?: string; bookId?: string; chapter?: number; paragraph?: number; excerpt?: string; action?: string; bookmarkId?: string } : {};
    const bookId = body.id || body.bookId || '';
    let list = (await kvGet<BookmarkItem[]>(`bookmarks:${bookId}`)) || [];
    if (body.action === 'remove' && body.bookmarkId) {
      list = list.filter(b => b.id !== body.bookmarkId);
    } else {
      const chapter = Number(body.chapter ?? 0);
      const paragraph = Number(body.paragraph ?? 0);
      const dup = list.find(b => b.chapter === chapter && b.paragraph === paragraph);
      if (dup) list = list.filter(b => b.id !== dup.id);
      else list.unshift({ id: 'bm-' + Date.now().toString(36), bookId, chapter, paragraph, excerpt: body.excerpt || '', createdAt: new Date().toISOString() });
    }
    await kvSet(`bookmarks:${bookId}`, list);
    return jsonResponse({ bookmarks: list });
  }

  if (path === '/api/reader/import' && method === 'POST' && init?.body instanceof FormData) {
    const file = init.body.get('file');
    if (!(file instanceof File)) return jsonResponse({ error: '请选择要导入的本地文件。' }, 400);
    const customTitle = String(init.body.get('title') || '');
    const customAuthor = String(init.body.get('author') || '');
    const workId = String(init.body.get('workId') || '');
    try {
      const { book, chapters } = await parseUploadedFileLocally(file, customTitle, customAuthor);
      for (let i = 0; i < chapters.length; i++) {
        await kvSet(`chap:${book.id}:${i}`, chapters[i]);
      }
      const idx = await ensureReaderBooks();
      idx.books.unshift(book);
      const targetWorkId = workId || book.id;
      idx.bindings[targetWorkId] = book.id;
      await kvSet('readerBooks', idx);

      if (!workId) {
        await handleLocalLibraryPost({
          action: 'addBook',
          book: { id: book.id, title: book.title, author: book.author, category: book.category || '文学', unit: book.unit || '章', total: chapters.length, edition: '本机导入' },
        });
      }
      scheduleAutoSync();
      return jsonResponse({ book });
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : '本机解析文件失败。' }, 400);
    }
  }

  if (path === '/api/reader/sniff' && method === 'POST') {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { url?: string; mode?: 'preview' | 'save'; title?: string; author?: string; category?: '网文' | '轻小说' | '文学' | '漫画'; workId?: string } : {};
    const targetUrl = (body.url || '').trim();
    if (!targetUrl) return jsonResponse({ error: '请输入要嗅探的网页链接' }, 400);
    const res = await crossPlatformHttp(targetUrl, 'GET', {}, '', nativeFetchRef || undefined);
    if (!res.ok || !res.body) return jsonResponse({ error: res.error || `无法抓取目标页面（HTTP ${res.status}），请检查网络或链接` }, 502);

    const parser = new DOMParser();
    const doc = parser.parseFromString(res.body, 'text/html');
    const pageTitle = (doc.querySelector('h1')?.textContent || doc.title || '').replace(/[-_|].*$/, '').trim() || '网页嗅探作品';
    const links: Array<{ title: string; href: string }> = [];
    const seen = new Set<string>();
    doc.querySelectorAll('a[href]').forEach(a => {
      const txt = (a.textContent || '').trim();
      const rawHref = a.getAttribute('href') || '';
      if (!txt || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return;
      try {
        const abs = new URL(rawHref, targetUrl).href;
        if (!seen.has(abs) && (/(?:第[零〇一二两三四五六七八九十百千万0-9]+[章回节卷话]|chapter\s*\d+)/i.test(txt) || abs.startsWith(targetUrl.replace(/[^/]*$/, '')) && txt.length >= 3 && txt.length <= 48)) {
          seen.add(abs);
          links.push({ title: txt, href: abs });
        }
      } catch {}
    });

    if (body.mode !== 'save') {
      const parsed = htmlToParagraphs(res.body);
      const isCatalog = links.length >= 5;
      return jsonResponse({
        kind: isCatalog ? 'catalog' : 'article',
        title: body.title || pageTitle,
        author: body.author || '',
        category: body.category || '网文',
        chapterCount: isCatalog ? links.length : 1,
        paragraphCount: parsed.paragraphs.length,
        previewChapters: links.slice(0, 6).map(l => l.title),
        previewParagraphs: parsed.paragraphs.slice(0, 3),
        url: targetUrl,
      });
    }

    const finalTitle = body.title?.trim() || pageTitle;
    const bookId = 'sniff:' + Date.now().toString(36);
    const chapters: StoredChapter[] = [];
    if (links.length >= 5) {
      for (let i = 0; i < links.length; i++) {
        chapters.push({ title: links[i].title, paragraphs: [], sourceUrl: links[i].href });
      }
      for (let i = 0; i < Math.min(3, chapters.length); i++) {
        const cr = await crossPlatformHttp(chapters[i].sourceUrl!, 'GET', {}, '', nativeFetchRef || undefined);
        if (cr.ok && cr.body) chapters[i].paragraphs = htmlToParagraphs(cr.body).paragraphs;
      }
    } else {
      const parsed = htmlToParagraphs(res.body);
      chapters.push({ title: finalTitle, paragraphs: parsed.paragraphs.length ? parsed.paragraphs : ['（未能从页面提取到正文）'], sourceUrl: targetUrl });
    }
    for (let i = 0; i < chapters.length; i++) await kvSet(`chap:${bookId}:${i}`, chapters[i]);
    const rb: ReaderBook = {
      id: bookId, title: finalTitle, author: body.author || '网页嗅探', source: 'sniff', category: body.category || '网文',
      unit: body.category === '漫画' ? '话' : '章', sourceType: 'online', sourceUrl: targetUrl, chapterCount: chapters.length,
      available: true, progress: { chapter: 0, paragraph: 0, revision: 1, updatedAt: new Date().toISOString() },
    };
    const idx = await ensureReaderBooks();
    idx.books.unshift(rb);
    idx.bindings[body.workId || bookId] = bookId;
    await kvSet('readerBooks', idx);
    scheduleAutoSync();
    return jsonResponse({ kind: links.length >= 5 ? 'catalog' : 'article', book: rb });
  }

  if (path === '/api/reader/sources' || path.startsWith('/api/reader/sources/')) {
    const custom = (await kvGet<BookSourceItem[]>('customSources')) || [];
    const builtins: BookSourceItem[] = [
      { id: 'syosetu', name: '成为小说家吧 (Syosetu)', baseUrl: 'https://ncode.syosetu.com', enabled: true, kind: 'builtin', category: '轻小说', unit: '章', description: '日轻公开连载直连 API（手机端免电脑直搜）' },
      { id: 'mangadex', name: 'MangaDex 漫画', baseUrl: 'https://mangadex.org', enabled: true, kind: 'builtin', category: '漫画', unit: '话', description: '公开国际漫画目录与连载接口' },
      { id: 'wikisource', name: '中文维基文库', baseUrl: 'https://zh.wikisource.org', enabled: true, kind: 'builtin', category: '文学', unit: '章', description: '公有领域经典文学名著' },
    ];
    if (path === '/api/reader/sources') return jsonResponse({ sources: [...builtins, ...custom], templates: [] });
    if (path === '/api/reader/sources/save' && method === 'POST') {
      const rule = typeof init?.body === 'string' ? JSON.parse(init.body) as Partial<BookSourceItem> & { id?: string; name?: string; baseUrl?: string } : {};
      if (rule.name && rule.baseUrl) {
        const next: BookSourceItem = { id: rule.id || 'rule-' + Date.now().toString(36), name: rule.name, baseUrl: rule.baseUrl, enabled: true, kind: 'rule', rule: rule as unknown as BookSourceItem['rule'] };
        const filtered = [next, ...custom.filter(c => c.id !== next.id)];
        await kvSet('customSources', filtered);
        return jsonResponse({ sources: [...builtins, ...filtered], templates: [] });
      }
      return jsonResponse({ sources: [...builtins, ...custom], templates: [] });
    }
    if (path === '/api/reader/sources/search' && method === 'POST') {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { query?: string; sourceId?: string } : {};
      const q = (body.query || '').trim();
      const results: SourceSearchHit[] = [];
      const errors: Array<{ sourceId: string; sourceName: string; error: string }> = [];
      if (q && (!body.sourceId || body.sourceId === 'syosetu')) {
        const res = await crossPlatformHttp(`https://api.syosetu.com/novelapi/api/?out=json&lim=8&word=${encodeURIComponent(q)}`, 'GET', {}, '', nativeFetchRef || undefined);
        if (res.ok && res.body) {
          try {
            const arr = JSON.parse(res.body) as Array<{ ncode?: string; title?: string; writer?: string; story?: string }>;
            for (const row of arr.slice(1)) {
              if (!row.ncode || !row.title) continue;
              results.push({ sourceId: 'syosetu', sourceName: '成为小说家吧', category: '轻小说', remoteId: row.ncode.toLowerCase(), title: row.title, author: row.writer || '', intro: row.story || '', detailUrl: `https://ncode.syosetu.com/${row.ncode.toLowerCase()}/` });
            }
          } catch {}
        } else if (res.error) errors.push({ sourceId: 'syosetu', sourceName: '成为小说家吧', error: res.error });
      }
      if (q && (!body.sourceId || body.sourceId === 'mangadex')) {
        const res = await crossPlatformHttp(`https://api.mangadex.org/manga?limit=8&title=${encodeURIComponent(q)}`, 'GET', {}, '', nativeFetchRef || undefined);
        if (res.ok && res.body) {
          try {
            const j = JSON.parse(res.body) as { data?: Array<{ id: string; attributes?: { title?: Record<string, string>; description?: Record<string, string> } }> };
            for (const m of j.data || []) {
              const titles = m.attributes?.title || {};
              const t = titles['zh-hk'] || titles.zh || titles.ja || titles.en || Object.values(titles)[0] || 'Manga';
              results.push({ sourceId: 'mangadex', sourceName: 'MangaDex', category: '漫画', remoteId: m.id, title: t, author: 'MangaDex', intro: (m.attributes?.description?.en || '').slice(0, 140), detailUrl: `https://mangadex.org/title/${m.id}` });
            }
          } catch {}
        } else if (res.error) errors.push({ sourceId: 'mangadex', sourceName: 'MangaDex', error: res.error });
      }
      return jsonResponse({ results, errors });
    }
    if (path === '/api/reader/sources/add' && method === 'POST') {
      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as { sourceId?: string; remoteId?: string; workId?: string; title?: string; author?: string; detailUrl?: string; category?: '网文' | '轻小说' | '文学' | '漫画' }
        : {};
      const sourceId = (body.sourceId || '').trim();
      const remoteId = (body.remoteId || '').trim();
      const idx = await ensureReaderBooks();
      let bookId = `${sourceId || 'custom'}:${remoteId || Date.now().toString(36)}`;
      let finalTitle = (body.title || '').trim() || '在线连载作品';
      let finalAuthor = (body.author || '').trim() || sourceId;
      let category: '网文' | '轻小说' | '文学' | '漫画' = body.category || (sourceId === 'mangadex' ? '漫画' : '轻小说');
      const chapters: StoredChapter[] = [];
      let sourceUrl = body.detailUrl || '';

      if (sourceId === 'syosetu' && remoteId) {
        sourceUrl = `https://ncode.syosetu.com/${remoteId}/`;
        const res = await crossPlatformHttp(sourceUrl, 'GET', {}, '', nativeFetchRef || undefined);
        if (!res.ok || !res.body) return jsonResponse({ error: res.error || `无法拉取目录（HTTP ${res.status}）` }, 502);
        const doc = new DOMParser().parseFromString(res.body, 'text/html');
        const h1 = doc.querySelector('.novel_title, .p-novel__title, h1')?.textContent?.trim();
        if (h1 && !body.title) finalTitle = h1;
        doc.querySelectorAll('a[href]').forEach(a => {
          const href = a.getAttribute('href') || '';
          const txt = (a.textContent || '').trim();
          if (new RegExp(`^/${remoteId}/\\d+/?$`, 'i').test(href) && txt) {
            chapters.push({ title: txt, paragraphs: [], sourceUrl: `https://ncode.syosetu.com${href}` });
          }
        });
        if (!chapters.length) return jsonResponse({ error: '未解析到 Syosetu 章节目录（可能是短篇单章，请用智能嗅探抓取）' }, 404);
        chapters[0] = await hydrateStoredChapter(chapters[0]);
      } else if (sourceId === 'mangadex' && remoteId) {
        category = '漫画';
        sourceUrl = `https://mangadex.org/title/${remoteId}`;
        const feedUrl = `https://api.mangadex.org/manga/${encodeURIComponent(remoteId)}/feed?limit=100&order[chapter]=asc&translatedLanguage[]=zh&translatedLanguage[]=zh-hk&translatedLanguage[]=en`;
        let res = await crossPlatformHttp(feedUrl, 'GET', {}, '', nativeFetchRef || undefined);
        let items: Array<{ id: string; attributes?: { chapter?: string; title?: string } }> = [];
        if (res.ok && res.body) {
          try { items = (JSON.parse(res.body) as { data?: typeof items }).data || []; } catch {}
        }
        if (!items.length) {
          res = await crossPlatformHttp(`https://api.mangadex.org/manga/${encodeURIComponent(remoteId)}/feed?limit=100&order[chapter]=asc`, 'GET', {}, '', nativeFetchRef || undefined);
          if (res.ok && res.body) {
            try { items = (JSON.parse(res.body) as { data?: typeof items }).data || []; } catch {}
          }
        }
        if (!items.length) return jsonResponse({ error: '该 MangaDex 作品暂无可读章节或被屏蔽' }, 404);
        for (let i = 0; i < items.length; i++) {
          const attr = items[i].attributes || {};
          const label = [attr.chapter ? `第 ${attr.chapter} 话` : `第 ${i + 1} 话`, attr.title || ''].filter(Boolean).join(' · ');
          chapters.push({ title: label, paragraphs: [], sourceUrl: `mangadex-ch://${items[i].id}` });
        }
        chapters[0] = await hydrateStoredChapter(chapters[0]);
      } else if (body.detailUrl) {
        return handleLocalApi('/api/reader/sniff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: body.detailUrl, mode: 'save', title: finalTitle, author: finalAuthor, category, workId: body.workId }),
        });
      } else {
        return jsonResponse({ error: '缺少有效的书源或作品链接' }, 400);
      }

      for (let i = 0; i < chapters.length; i++) await kvSet(`chap:${bookId}:${i}`, chapters[i]);
      const rb: ReaderBook = {
        id: bookId,
        title: finalTitle,
        author: finalAuthor,
        source: sourceId || 'online',
        category,
        unit: category === '漫画' ? '话' : '章',
        sourceType: 'online',
        sourceUrl,
        chapterCount: chapters.length,
        available: true,
        progress: { chapter: 0, paragraph: 0, revision: 1, updatedAt: new Date().toISOString() },
      };
      idx.books = [rb, ...idx.books.filter(b => b.id !== bookId)];
      idx.bindings[body.workId || bookId] = bookId;
      await kvSet('readerBooks', idx);
      scheduleAutoSync();
      return jsonResponse({ book: rb });
    }
    if (path === '/api/reader/sources/cache' && method === 'POST') {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { id?: string; start?: number; count?: number } : {};
      const id = body.id || '';
      const idx = await ensureReaderBooks();
      const book = idx.books.find(b => b.id === id);
      if (!book) return jsonResponse({ error: '未找到书籍' }, 404);
      const start = Math.max(0, Number(body.start ?? 0));
      const count = Math.min(30, Math.max(1, Number(body.count ?? 20)));
      let cached = 0;
      let errors = 0;
      for (let i = start; i < Math.min(book.chapterCount, start + count); i++) {
        const cur = await kvGet<StoredChapter>(`chap:${id}:${i}`);
        if (!cur) continue;
        if ((cur.paragraphs && cur.paragraphs.length > 0) || cur.images?.length) continue;
        const next = await hydrateStoredChapter(cur);
        if ((next.paragraphs && next.paragraphs.length > 0) || next.images?.length) {
          await kvSet(`chap:${id}:${i}`, next);
          cached++;
        } else errors++;
      }
      scheduleAutoSync();
      return jsonResponse({ ok: true, cached, errors });
    }
    if (path === '/api/reader/sources/refresh' && method === 'POST') {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { id?: string } : {};
      const idx = await ensureReaderBooks();
      const book = idx.books.find(b => b.id === (body.id || ''));
      return jsonResponse({ chapterCount: book?.chapterCount || 0 });
    }
    return jsonResponse({ sources: [...builtins, ...custom], templates: [] });
  }

  if (path === '/api/catalog') {
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const snap = await ensureSnapshot();
    const works = snap.books
      .filter(b => !q || b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q))
      .map(b => ({
        id: b.id,
        title: b.title,
        originalTitle: b.originalTitle || '',
        author: b.author,
        category: b.category,
        tags: b.tags,
        description: b.description,
        sources: b.id.startsWith('custom-bgm-')
          ? [{ provider: 'bangumi', externalId: b.id.replace('custom-bgm-', ''), url: `https://bgm.tv/subject/${b.id.replace('custom-bgm-', '')}` }]
          : [],
      }));
    return jsonResponse({ works });
  }

  if (path === '/api/bangumi') {
    const q = (url.searchParams.get('q') || '').trim();
    if (!q) return jsonResponse({ books: [] });
    const res = await crossPlatformHttp(`https://api.bgm.tv/search/subject/${encodeURIComponent(q)}?type=1&responseGroup=large`, 'GET', { Accept: 'application/json' }, '', nativeFetchRef || undefined);
    if (!res.ok || !res.body) return jsonResponse({ books: [] });
    try {
      const data = JSON.parse(res.body) as { list?: Array<{ id: number; name?: string; name_cn?: string; summary?: string; images?: { large?: string; common?: string; small?: string }; rating?: { score?: number; total?: number } }> };
      const books = (data.list || []).map(item => ({
        id: Number(item.id),
        title: item.name_cn || item.name || '',
        originalTitle: item.name || '',
        author: '',
        category: '轻小说',
        tags: [],
        summary: item.summary || '',
        year: '',
        series: false,
        platform: '',
        score: item.rating?.score ?? null,
        ratingCount: item.rating?.total ?? 0,
        cover: item.images?.common || item.images?.large || item.images?.small || '',
      }));
      return jsonResponse({ books });
    } catch {
      return jsonResponse({ books: [] });
    }
  }

  return jsonResponse({ error: '当前处于本机纯离线模式，请到「个人主页」选填电脑/服务器同步链接后再使用联机功能。' }, 503);
}

async function mirrorOnlineResponse(urlStr: string, method: string, res: Response) {
  if (!res.ok || method !== 'GET') return;
  try {
    const u = new URL(urlStr, window.location.href);
    const data = await res.clone().json();
    if (u.pathname === '/api/library' && data?.snapshot) {
      await kvSet('library', data.snapshot);
    } else if (u.pathname === '/api/shelf-meta' && data?.taxonomy) {
      await kvSet('shelfMeta', data);
    } else if (u.pathname === '/api/reader/books' && Array.isArray(data?.books)) {
      await kvSet('readerBooks', data);
    } else if (u.pathname === '/api/reader/chapter' && data?.id && Array.isArray(data?.paragraphs)) {
      const n = Number(u.searchParams.get('n') ?? data.n ?? 0);
      await kvSet(`chap:${data.id}:${n}`, { title: data.title || `第 ${n + 1} 章`, paragraphs: data.paragraphs });
    }
  } catch {}
}

export async function syncWithRemotePeer(rawUrl: string, direction: 'pull' | 'push'): Promise<{ ok: boolean; message: string }> {
  const fetcher = nativeFetchRef || window.fetch.bind(window);
  let peerOrigin = '';
  try {
    peerOrigin = normalizePeerUrl(rawUrl);
  } catch {
    return { ok: false, message: '请输入正确的电脑局域网地址或服务器 HTTPS 网址。' };
  }
  if (!peerOrigin) {
    setPeerSyncConfig({ url: '', lastSyncAt: new Date().toISOString(), lastSummary: '已切换为纯本机独立运行模式' });
    return { ok: true, message: '已断开外部主机，当前完全在本机离线运行。' };
  }
  setPeerSyncConfig({ url: peerOrigin });

  if (direction === 'pull') {
    const [libRes, metaRes, rBooksRes] = await Promise.all([
      fetcher(`${peerOrigin}/api/library`, { credentials: 'include', cache: 'no-store' }),
      fetcher(`${peerOrigin}/api/shelf-meta`, { credentials: 'include', cache: 'no-store' }),
      fetcher(`${peerOrigin}/api/reader/books`, { credentials: 'include', cache: 'no-store' }),
    ]);
    if (!libRes.ok) {
      return { ok: false, message: `连接目标主机失败（HTTP ${libRes.status}）。请先确认电脑或服务器保持开启、同一局域网并已完成配对。` };
    }
    const libJson = (await libRes.json()) as { snapshot?: Snapshot };
    if (libJson.snapshot) await kvSet('library', libJson.snapshot);
    if (metaRes.ok) await kvSet('shelfMeta', await metaRes.json());
    let cachedChapters = 0;
    if (rBooksRes.ok) {
      const idx = (await rBooksRes.json()) as { books: ReaderBook[]; bindings: Record<string, string> };
      await kvSet('readerBooks', idx);
      for (const b of (idx.books || []).slice(0, 6)) {
        const startChap = Math.max(0, b.progress?.chapter || 0);
        for (let c = startChap; c < Math.min(b.chapterCount, startChap + 3); c++) {
          try {
            const cr = await fetcher(`${peerOrigin}/api/reader/chapter?id=${encodeURIComponent(b.id)}&n=${c}`, { credentials: 'include' });
            if (cr.ok) {
              const cd = (await cr.json()) as ChapterText;
              await kvSet(`chap:${b.id}:${c}`, { title: cd.title, paragraphs: cd.paragraphs });
              cachedChapters++;
            }
          } catch {}
        }
      }
    }
    const count = libJson.snapshot?.books?.length ?? 0;
    const summary = `已从 ${peerOrigin} 同步 ${count} 部作品与 ${cachedChapters} 个离线章节到本机`;
    setPeerSyncConfig({ url: peerOrigin, lastSyncAt: new Date().toISOString(), lastSummary: summary });
    return { ok: true, message: summary };
  }

  const snap = await ensureSnapshot();
  const pushRes = await fetcher(`${peerOrigin}/api/library`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'import', revision: 999999, backup: { books: snap.books, entries: snap.entries } }),
  });
  if (!pushRes.ok) {
    return { ok: false, message: `推送到 ${peerOrigin} 失败（HTTP ${pushRes.status}）。` };
  }
  const summary = `已把本机 ${snap.books.length} 本书与进度推送合并到 ${peerOrigin}`;
  setPeerSyncConfig({ url: peerOrigin, lastSyncAt: new Date().toISOString(), lastSummary: summary });
  return { ok: true, message: summary };
}

export function installLocalFirstFetch() {
  if (typeof window === 'undefined' || nativeFetchRef) return;
  const origFetch = window.fetch.bind(window);
  nativeFetchRef = origFetch;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    let parsed: URL;
    try {
      parsed = new URL(rawUrl, window.location.href);
    } catch {
      return origFetch(input, init);
    }
    const isApiCall = parsed.pathname.startsWith('/api/');
    if (!isApiCall) return origFetch(input, init);

    const forceLocal = (() => {
      try {
        return localStorage.getItem(FORCE_OFFLINE_KEY) === '1';
      } catch {
        return false;
      }
    })();

    const isFileProto = window.location.protocol === 'file:' || window.location.hostname === 'local.mokuji.app';
    if (forceLocal || isFileProto) {
      notifyMode('local-offline');
      return handleLocalApi(rawUrl, init);
    }

    try {
      const response = await origFetch(input, init);
      if (response.status === 404 || response.status === 502 || response.status === 503) {
        notifyMode('local-offline');
        return handleLocalApi(rawUrl, init);
      }
      notifyMode('server');
      void mirrorOnlineResponse(rawUrl, (init?.method || 'GET').toUpperCase(), response);
      return response;
    } catch {
      notifyMode('local-offline');
      return handleLocalApi(rawUrl, init);
    }
  };
}
