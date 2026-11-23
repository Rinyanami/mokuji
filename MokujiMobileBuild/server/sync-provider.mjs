import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { signS3Headers } from './kodo-storage.mjs';

const failure = (status, message) => Object.assign(new Error(message), { status });
const sha256Hex = data => createHash('sha256').update(data).digest('hex');
const text = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const DEFAULT_CONFIG = {
  provider: 'none', // 'none' | 'kodo' | 'webdav'
  kodo: {
    accessKey: '',
    secretKey: '',
    bucket: '',
    region: 'cn-east-1',
    prefix: 'mokuji-sync',
    endpoint: '',
  },
  webdav: {
    url: '',
    username: '',
    password: '',
    prefix: 'mokuji-sync',
  },
  lastSyncAt: null,
  lastDirection: null,
  lastSummary: null,
  pushedHashes: {},
};

function sanitizeConfig(raw = {}, prev = DEFAULT_CONFIG) {
  const provider = ['none', 'kodo', 'webdav'].includes(raw.provider) ? raw.provider : prev.provider;
  const kodo = raw.kodo || {};
  const webdav = raw.webdav || {};
  return {
    provider,
    kodo: {
      accessKey: typeof kodo.accessKey === 'string' ? kodo.accessKey.trim() : prev.kodo.accessKey,
      secretKey: typeof kodo.secretKey === 'string' && kodo.secretKey.trim() ? kodo.secretKey.trim() : prev.kodo.secretKey,
      bucket: typeof kodo.bucket === 'string' ? kodo.bucket.trim() : prev.kodo.bucket,
      region: typeof kodo.region === 'string' && kodo.region.trim() ? kodo.region.trim() : (prev.kodo.region || 'cn-east-1'),
      prefix: typeof kodo.prefix === 'string' ? kodo.prefix.trim().replace(/^\/+|\/+$/g, '') : (prev.kodo.prefix || 'mokuji-sync'),
      endpoint: typeof kodo.endpoint === 'string' ? kodo.endpoint.trim().replace(/\/+$/, '') : (prev.kodo.endpoint || ''),
    },
    webdav: {
      url: typeof webdav.url === 'string' ? webdav.url.trim().replace(/\/+$/, '') : prev.webdav.url,
      username: typeof webdav.username === 'string' ? webdav.username.trim() : prev.webdav.username,
      password: typeof webdav.password === 'string' && webdav.password !== '' ? webdav.password : prev.webdav.password,
      prefix: typeof webdav.prefix === 'string' ? webdav.prefix.trim().replace(/^\/+|\/+$/g, '') : (prev.webdav.prefix || 'mokuji-sync'),
    },
    lastSyncAt: prev.lastSyncAt || null,
    lastDirection: prev.lastDirection || null,
    lastSummary: prev.lastSummary || null,
    pushedHashes: prev.pushedHashes || {},
  };
}

function publicStatus(cfg) {
  return {
    provider: cfg.provider,
    kodo: {
      accessKey: cfg.kodo.accessKey,
      hasSecretKey: Boolean(cfg.kodo.secretKey),
      bucket: cfg.kodo.bucket,
      region: cfg.kodo.region,
      prefix: cfg.kodo.prefix,
      endpoint: cfg.kodo.endpoint,
    },
    webdav: {
      url: cfg.webdav.url,
      username: cfg.webdav.username,
      hasPassword: Boolean(cfg.webdav.password),
      prefix: cfg.webdav.prefix,
    },
    lastSyncAt: cfg.lastSyncAt,
    lastDirection: cfg.lastDirection,
    lastSummary: cfg.lastSummary,
  };
}

function backendFingerprint(cfg) {
  if (cfg.provider === 'kodo') return `kodo:${cfg.kodo.region}:${cfg.kodo.bucket}:${cfg.kodo.prefix}:${cfg.kodo.endpoint}`;
  if (cfg.provider === 'webdav') return `webdav:${cfg.webdav.url}:${cfg.webdav.prefix}`;
  return 'none';
}

function createKodoAdapter(kodoCfg, fetchImpl) {
  if (!kodoCfg.accessKey || !kodoCfg.secretKey || !kodoCfg.bucket || !kodoCfg.region) {
    throw failure(400, '请先填写完整的七牛云 AccessKey、SecretKey、存储空间名和区域');
  }
  const region = kodoCfg.region;
  const bucket = kodoCfg.bucket;
  const prefix = kodoCfg.prefix ? kodoCfg.prefix + '/' : '';
  let protocol = 'https:';
  let host;
  let pathStyle;
  if (kodoCfg.endpoint) {
    const parsed = new URL(kodoCfg.endpoint);
    protocol = parsed.protocol;
    host = parsed.host;
    pathStyle = true;
  } else {
    const baseHost = `s3.${region}.qiniucs.com`;
    pathStyle = bucket.includes('.');
    host = pathStyle ? baseHost : `${bucket}.${baseHost}`;
  }

  function objectTarget(relKey) {
    const fullKey = (prefix + relKey).split('/').filter(Boolean).map(s => encodeURIComponent(s)).join('/');
    const pathname = pathStyle ? `/${encodeURIComponent(bucket)}/${fullKey}` : `/${fullKey}`;
    return { pathname, url: `${protocol}//${host}${pathname}` };
  }

  async function request(method, relKey, bodyBuf = Buffer.alloc(0), contentType = 'application/json; charset=utf-8') {
    const { pathname, url } = objectTarget(relKey);
    const payloadHash = sha256Hex(bodyBuf);
    const extraHeaders = method === 'PUT' ? { 'content-type': contentType } : {};
    const headers = signS3Headers({
      method,
      host,
      pathname,
      region,
      accessKey: kodoCfg.accessKey,
      secretKey: kodoCfg.secretKey,
      payloadHash,
      date: new Date(),
      extraHeaders,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      return await fetchImpl(url, {
        method,
        headers,
        body: method === 'PUT' ? bodyBuf : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      throw failure(502, '无法连接七牛云存储：' + (err?.message || '网络超时'));
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async test() {
      const marker = Buffer.from(JSON.stringify({ ok: true, at: new Date().toISOString() }), 'utf8');
      const res = await request('PUT', '.mokuji-health.json', marker);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) throw failure(401, '七牛云鉴权失败，请检查 AccessKey / SecretKey 和权限');
        if (res.status === 404) throw failure(404, '未找到指定的七牛存储空间（Bucket），请核对名称与区域');
        throw failure(502, `七牛云返回错误（HTTP ${res.status}）`);
      }
      const check = await request('GET', '.mokuji-health.json');
      if (!check.ok) throw failure(502, `七牛云读取验证失败（HTTP ${check.status}）`);
      return { ok: true, message: `已连接七牛云存储空间「${bucket}」（${region}）` };
    },
    async putJson(relKey, value) {
      const buf = Buffer.from(JSON.stringify(value), 'utf8');
      const res = await request('PUT', relKey, buf);
      if (!res.ok) throw failure(502, `七牛上传 ${relKey} 失败（HTTP ${res.status}）`);
    },
    async getJson(relKey) {
      const res = await request('GET', relKey);
      if (res.status === 404) return null;
      if (!res.ok) throw failure(502, `七牛下载 ${relKey} 失败（HTTP ${res.status}）`);
      return JSON.parse(await res.text());
    },
  };
}

function createWebDavAdapter(davCfg, fetchImpl) {
  let base;
  try {
    base = new URL(davCfg.url);
  } catch {
    throw failure(400, '请输入合法的 NAS WebDAV 地址（例如 http://192.168.1.10:5005）');
  }
  if (!['http:', 'https:'].includes(base.protocol)) {
    throw failure(400, 'WebDAV 地址仅支持 http 或 https');
  }
  const authHeader = davCfg.username || davCfg.password
    ? 'Basic ' + Buffer.from(`${davCfg.username || ''}:${davCfg.password || ''}`).toString('base64')
    : null;
  const basePath = base.pathname.replace(/\/+$/, '');
  const prefixParts = (davCfg.prefix || 'mokuji-sync').split('/').filter(Boolean);

  function buildUrl(parts) {
    const encoded = parts.map(p => encodeURIComponent(p)).join('/');
    return `${base.origin}${basePath}/${encoded}`;
  }

  async function req(method, url, body = undefined, extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (authHeader) headers.authorization = authHeader;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      return await fetchImpl(url, { method, headers, body, signal: controller.signal });
    } catch (err) {
      throw failure(502, '无法连接 NAS WebDAV：' + (err?.message || '网络不可达'));
    } finally {
      clearTimeout(timer);
    }
  }

  async function ensureDir(extraSegments = []) {
    const acc = [];
    for (const seg of [...prefixParts, ...extraSegments]) {
      acc.push(seg);
      const res = await req('MKCOL', buildUrl(acc));
      if (res.status === 401 || res.status === 403) throw failure(401, 'NAS WebDAV 用户名或密码错误（无写入权限）');
      // 201 created, 405 already exists, 301/302/409 tolerance on some NAS servers
      if (![200, 201, 204, 301, 302, 405].includes(res.status) && res.status >= 400 && res.status !== 409) {
        throw failure(502, `WebDAV 创建目录失败（HTTP ${res.status}）`);
      }
    }
  }

  return {
    async test() {
      await ensureDir(['books']);
      const url = buildUrl([...prefixParts, '.mokuji-health.json']);
      const payload = JSON.stringify({ ok: true, at: new Date().toISOString() });
      const putRes = await req('PUT', url, payload, { 'content-type': 'application/json; charset=utf-8' });
      if (putRes.status === 401 || putRes.status === 403) throw failure(401, 'NAS WebDAV 鉴权失败，请检查账号密码与共享文件夹权限');
      if (!putRes.ok) throw failure(502, `NAS WebDAV 写入测试失败（HTTP ${putRes.status}）`);
      const getRes = await req('GET', url);
      if (!getRes.ok) throw failure(502, `NAS WebDAV 读取测试失败（HTTP ${getRes.status}）`);
      return { ok: true, message: `已连接 NAS WebDAV（${base.origin}${basePath}/${prefixParts.join('/')}）` };
    },
    async putJson(relKey, value) {
      const parts = relKey.split('/').filter(Boolean);
      if (parts.length > 1) await ensureDir(parts.slice(0, -1));
      else await ensureDir([]);
      const res = await req('PUT', buildUrl([...prefixParts, ...parts]), JSON.stringify(value), { 'content-type': 'application/json; charset=utf-8' });
      if (!res.ok) throw failure(502, `NAS 上传 ${relKey} 失败（HTTP ${res.status}）`);
    },
    async getJson(relKey) {
      const parts = relKey.split('/').filter(Boolean);
      const res = await req('GET', buildUrl([...prefixParts, ...parts]));
      if (res.status === 404) return null;
      if (res.status === 401 || res.status === 403) throw failure(401, 'NAS WebDAV 鉴权失败');
      if (!res.ok) throw failure(502, `NAS 下载 ${relKey} 失败（HTTP ${res.status}）`);
      return JSON.parse(await res.text());
    },
  };
}

export function createSyncProvider({ dataDir, dujiDb, reader, shelfMeta, fetchImpl = globalThis.fetch }) {
  const configFile = path.join(dataDir, 'sync-config.json');

  async function loadConfig() {
    if (!existsSync(configFile)) {
      const envInit = process.env.DUJI_KODO_BUCKET && process.env.DUJI_KODO_ACCESS_KEY && process.env.DUJI_KODO_SECRET_KEY
        ? {
            ...DEFAULT_CONFIG,
            provider: 'kodo',
            kodo: {
              ...DEFAULT_CONFIG.kodo,
              accessKey: process.env.DUJI_KODO_ACCESS_KEY,
              secretKey: process.env.DUJI_KODO_SECRET_KEY,
              bucket: process.env.DUJI_KODO_BUCKET,
              region: process.env.DUJI_KODO_REGION || 'cn-east-1',
            },
          }
        : DEFAULT_CONFIG;
      return envInit;
    }
    try {
      const parsed = JSON.parse(await readFile(configFile, 'utf8'));
      return sanitizeConfig(parsed, DEFAULT_CONFIG);
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  async function writeConfig(cfg) {
    await writeFile(configFile, JSON.stringify(cfg, null, 2), 'utf8');
    return cfg;
  }

  function makeAdapter(cfg) {
    if (cfg.provider === 'kodo') return createKodoAdapter(cfg.kodo, fetchImpl);
    if (cfg.provider === 'webdav') return createWebDavAdapter(cfg.webdav, fetchImpl);
    throw failure(400, '尚未启用云同步或 NAS 存储，请先选择七牛云或 WebDAV 并保存配置');
  }

  function buildLocalSnapshot() {
    const rdb = reader.db;
    const libraries = dujiDb.prepare('SELECT user_id, revision, state, updated_at FROM libraries').all();
    const reviews = dujiDb.prepare('SELECT * FROM reviews').all();
    const posts = dujiDb.prepare('SELECT * FROM posts').all();
    const replies = dujiDb.prepare('SELECT * FROM replies').all();

    const uploadBooks = rdb.prepare('SELECT id, title, author, chapter_count FROM reader_uploads').all().map(u => {
      const chapters = rdb.prepare('SELECT n, title, paragraphs FROM reader_chapters WHERE book_id=? ORDER BY n').all(u.id);
      const hasPictures = u.id.startsWith('epub:') || u.id.startsWith('cbz:');
      const epubImages = hasPictures ? rdb.prepare('SELECT book_id, n, groups_json FROM reader_epub_images WHERE book_id=?').all(u.id) : [];
      const epubMedia = hasPictures ? rdb.prepare('SELECT book_id, asset, data_url FROM reader_epub_media WHERE book_id=?').all(u.id) : [];
      const kodoRow = rdb.prepare('SELECT digest, format FROM reader_kodo_text WHERE book_id=?').get(u.id) || null;
      const payload = { id: u.id, type: u.id.startsWith('cbz:') ? 'cbz' : u.id.startsWith('epub:') ? 'epub' : 'txt', title: u.title, author: u.author, chapterCount: u.chapter_count, chapters, epubImages, epubMedia, kodoRow };
      return { id: u.id, key: `books/${sha256Hex(u.id)}.json`, hash: sha256Hex(JSON.stringify(payload)), payload };
    });

    const customBooks = rdb.prepare('SELECT * FROM reader_custom_books').all().map(b => {
      const chapters = rdb.prepare('SELECT n, title, url, paragraphs, images_json, locked FROM reader_custom_chapters WHERE book_id=? ORDER BY n').all(b.id);
      const payload = { id: b.id, type: 'custom', book: b, chapters };
      return { id: b.id, key: `books/${sha256Hex(b.id)}.json`, hash: sha256Hex(JSON.stringify(payload)), payload };
    });

    const snapshot = {
      version: 1,
      exportedAt: new Date().toISOString(),
      duji: {
        libraries,
        reviews,
        posts,
        replies,
        shelfMeta: shelfMeta.exportAll(),
      },
      reader: {
        bindings: rdb.prepare('SELECT work_id, book_id FROM reader_bindings').all(),
        progress: rdb.prepare('SELECT book_id, chapter, paragraph, revision, updated_at FROM reader_progress').all(),
        itemMeta: rdb.prepare('SELECT book_id, alias, bookmarks, collapsed_images FROM reader_item_meta').all(),
        cotexProgress: rdb.prepare('SELECT book_id, old_chapter, old_paragraph, chapter, paragraph, revision, updated_at FROM reader_cotex_progress').all(),
        cotexRecent: rdb.prepare('SELECT book_id, opened_at FROM reader_cotex_recent').all(),
        customSources: rdb.prepare('SELECT id, name, base_url, enabled, kind, rule_json, created_at FROM reader_custom_sources').all(),
        wikiPages: rdb.prepare('SELECT * FROM reader_wiki_pages').all(),
      },
      bookIndex: [...uploadBooks, ...customBooks].map(b => ({ id: b.id, key: b.key, hash: b.hash })),
      bookPayloads: [...uploadBooks, ...customBooks],
    };
    return snapshot;
  }

  function mergeLibraryStates(localState, remoteState) {
    const customMap = new Map();
    for (const b of localState.customBooks || []) if (b?.id) customMap.set(b.id, b);
    for (const b of remoteState.customBooks || []) if (b?.id) customMap.set(b.id, { ...(customMap.get(b.id) || {}), ...b });

    const entryMap = new Map();
    for (const e of localState.entries || []) if (e?.bookId) entryMap.set(e.bookId, e);
    for (const e of remoteState.entries || []) {
      if (!e?.bookId) continue;
      const cur = entryMap.get(e.bookId);
      if (!cur || String(e.updatedAt || '') >= String(cur.updatedAt || '')) entryMap.set(e.bookId, e);
    }

    const evMap = new Map();
    for (const ev of [...(remoteState.events || []), ...(localState.events || [])]) {
      if (ev?.id && !evMap.has(ev.id)) evMap.set(ev.id, ev);
    }
    const events = [...evMap.values()].sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, 120);

    const cotexSources = [...new Set([...(localState.cotexSources || []), ...(remoteState.cotexSources || [])])];
    return {
      customBooks: [...customMap.values()],
      entries: [...entryMap.values()],
      events,
      cotexSources,
    };
  }

  async function pushAll(options = {}) {
    const cfg = await loadConfig();
    const adapter = makeAdapter(cfg);
    const { bookPayloads, ...snapshotOnly } = buildLocalSnapshot();
    const fp = backendFingerprint(cfg);
    const cache = (!options.forceFull && cfg.pushedHashes?.[fp]) ? { ...cfg.pushedHashes[fp] } : {};

    let uploadedBooks = 0;
    let skippedBooks = 0;
    for (const item of bookPayloads) {
      if (cache[item.id] === item.hash) {
        skippedBooks++;
        continue;
      }
      await adapter.putJson(item.key, item.payload);
      cache[item.id] = item.hash;
      uploadedBooks++;
    }
    await adapter.putJson('snapshot.json', snapshotOnly);

    const now = new Date().toISOString();
    const summary = `已上传快照与 ${uploadedBooks} 本新增/变更书档（跳过 ${skippedBooks} 本未变更）`;
    const nextCfg = {
      ...cfg,
      lastSyncAt: now,
      lastDirection: 'push',
      lastSummary: summary,
      pushedHashes: { ...(cfg.pushedHashes || {}), [fp]: cache },
    };
    await writeConfig(nextCfg);
    return { ok: true, summary, uploadedBooks, skippedBooks, status: publicStatus(nextCfg) };
  }

  async function pullAll() {
    const cfg = await loadConfig();
    const adapter = makeAdapter(cfg);
    const remote = await adapter.getJson('snapshot.json');
    if (!remote || !remote.duji || !remote.reader) {
      throw failure(404, '云端或 NAS 上还没有目次同步快照，请先在已有设备执行一次「上传同步」');
    }

    // 1. Merge dujiDb
    dujiDb.exec('BEGIN IMMEDIATE');
    try {
      const selLib = dujiDb.prepare('SELECT user_id, revision, state, updated_at FROM libraries WHERE user_id=?');
      const insLib = dujiDb.prepare('INSERT INTO libraries(user_id, revision, state, updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET state=excluded.state, revision=libraries.revision+1, updated_at=excluded.updated_at');
      for (const lib of remote.duji.libraries || []) {
        const local = selLib.get(lib.user_id);
        const mergedState = local
          ? mergeLibraryStates(JSON.parse(local.state || '{}'), JSON.parse(lib.state || '{}'))
          : JSON.parse(lib.state || '{}');
        const newerStamp = local && String(local.updated_at || '') > String(lib.updated_at || '') ? local.updated_at : lib.updated_at;
        insLib.run(lib.user_id, local ? (local.revision || 0) + 1 : (lib.revision || 0), JSON.stringify(mergedState), newerStamp || new Date().toISOString());
      }
      const insReview = dujiDb.prepare('INSERT OR IGNORE INTO reviews(id, user_id, display_name, book_id, book_title, score, body, spoiler, progress, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
      for (const r of remote.duji.reviews || []) {
        insReview.run(r.id, r.user_id, r.display_name, r.book_id, r.book_title, r.score, r.body, r.spoiler ? 1 : 0, r.progress || '', r.created_at);
      }
      const insPost = dujiDb.prepare('INSERT OR IGNORE INTO posts(id, user_id, display_name, book_id, book_title, title, body, spoiler, created_at) VALUES(?,?,?,?,?,?,?,?,?)');
      for (const p of remote.duji.posts || []) {
        insPost.run(p.id, p.user_id, p.display_name, p.book_id || '', p.book_title || '', p.title, p.body, p.spoiler ? 1 : 0, p.created_at);
      }
      const insReply = dujiDb.prepare('INSERT OR IGNORE INTO replies(id, post_id, user_id, display_name, body, created_at) VALUES(?,?,?,?,?,?)');
      for (const rp of remote.duji.replies || []) {
        insReply.run(rp.id, rp.post_id, rp.user_id, rp.display_name, rp.body, rp.created_at);
      }
      dujiDb.exec('COMMIT');
    } catch (err) {
      dujiDb.exec('ROLLBACK');
      throw err;
    }

    if (remote.duji.shelfMeta) {
      shelfMeta.importAll(remote.duji.shelfMeta);
    }

    // 2. Download missing or new books first so foreign keys in reader.sqlite stay happy
    const rdb = reader.db;
    let pulledBooks = 0;
    const bookIndex = Array.isArray(remote.bookIndex) ? remote.bookIndex : [];
    for (const entry of bookIndex) {
      const existsUpload = rdb.prepare('SELECT 1 FROM reader_uploads WHERE id=?').get(entry.id);
      const existsCustom = rdb.prepare('SELECT 1 FROM reader_custom_books WHERE id=?').get(entry.id);
      if (existsUpload || existsCustom) continue;
      const payload = await adapter.getJson(entry.key);
      if (!payload) continue;
      rdb.exec('BEGIN IMMEDIATE');
      try {
        if (payload.type === 'txt' || payload.type === 'epub' || payload.type === 'cbz') {
          rdb.prepare('INSERT OR IGNORE INTO reader_uploads(id, title, author, chapter_count) VALUES(?,?,?,?)').run(payload.id, payload.title, payload.author || '', payload.chapterCount || payload.chapters?.length || 0);
          const insCh = rdb.prepare('INSERT OR IGNORE INTO reader_chapters(book_id, n, title, paragraphs) VALUES(?,?,?,?)');
          for (const ch of payload.chapters || []) {
            insCh.run(payload.id, ch.n, ch.title, ch.paragraphs);
          }
          const insImg = rdb.prepare('INSERT OR IGNORE INTO reader_epub_images(book_id, n, groups_json) VALUES(?,?,?)');
          for (const img of payload.epubImages || []) insImg.run(payload.id, img.n, img.groups_json);
          const insMedia = rdb.prepare('INSERT OR IGNORE INTO reader_epub_media(book_id, asset, data_url) VALUES(?,?,?)');
          for (const m of payload.epubMedia || []) insMedia.run(payload.id, m.asset, m.data_url);
          if (payload.kodoRow) {
            rdb.prepare('INSERT OR IGNORE INTO reader_kodo_text(book_id, digest, format) VALUES(?,?,?)').run(payload.id, payload.kodoRow.digest, payload.kodoRow.format || 1);
          }
          pulledBooks++;
        } else if (payload.type === 'custom' && payload.book) {
          const b = payload.book;
          rdb.prepare("INSERT INTO reader_custom_books(id, source_id, remote_id, title, author, intro, detail_url, chapter_count, updated_at, category) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, author=excluded.author, intro=excluded.intro, detail_url=excluded.detail_url, chapter_count=MAX(excluded.chapter_count, reader_custom_books.chapter_count), updated_at=MAX(excluded.updated_at, reader_custom_books.updated_at), category=excluded.category")
            .run(b.id, b.source_id, b.remote_id, b.title, b.author || '', b.intro || '', b.detail_url, b.chapter_count || 0, b.updated_at || new Date().toISOString(), b.category || '网文');
          const insCh = rdb.prepare('INSERT INTO reader_custom_chapters(book_id, n, title, url, paragraphs, images_json, locked) VALUES(?,?,?,?,?,?,?) ON CONFLICT(book_id, n) DO UPDATE SET paragraphs=COALESCE(reader_custom_chapters.paragraphs, excluded.paragraphs), images_json=COALESCE(reader_custom_chapters.images_json, excluded.images_json)');
          for (const ch of payload.chapters || []) {
            insCh.run(b.id, ch.n, ch.title, ch.url, ch.paragraphs ?? null, ch.images_json ?? null, ch.locked ? 1 : 0);
          }
          if (!existsCustom) pulledBooks++;
        }
        rdb.exec('COMMIT');
      } catch (err) {
        rdb.exec('ROLLBACK');
        throw err;
      }
    }

    // 3. Merge reader metadata, custom sources, wiki pages, progress & bindings
    rdb.exec('BEGIN IMMEDIATE');
    try {
      const insSrc = rdb.prepare('INSERT INTO reader_custom_sources(id, name, base_url, enabled, kind, rule_json, created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, base_url=excluded.base_url, enabled=excluded.enabled, rule_json=excluded.rule_json');
      for (const s of remote.reader.customSources || []) {
        insSrc.run(s.id, s.name, s.base_url, s.enabled ? 1 : 0, s.kind || 'rule', s.rule_json, s.created_at || new Date().toISOString());
      }
      const insWiki = rdb.prepare('INSERT OR IGNORE INTO reader_wiki_pages(id, title, author, source, sourceUrl, revisionUrl, credits, license, licenseUrl, paragraphs) VALUES(?,?,?,?,?,?,?,?,?,?)');
      for (const w of remote.reader.wikiPages || []) {
        insWiki.run(w.id, w.title, w.author || '', w.source, w.sourceUrl, w.revisionUrl, w.credits, w.license, w.licenseUrl, w.paragraphs);
      }
      const insBind = rdb.prepare('INSERT INTO reader_bindings(work_id, book_id) VALUES(?,?) ON CONFLICT(work_id) DO UPDATE SET book_id=excluded.book_id');
      for (const bd of remote.reader.bindings || []) {
        insBind.run(bd.work_id, bd.book_id);
      }
      const mergeProg = rdb.prepare(`
        INSERT INTO reader_progress(book_id, chapter, paragraph, revision, updated_at) VALUES(?,?,?,?,?)
        ON CONFLICT(book_id) DO UPDATE SET
          chapter=CASE WHEN excluded.updated_at>reader_progress.updated_at OR (excluded.updated_at=reader_progress.updated_at AND excluded.revision>reader_progress.revision) THEN excluded.chapter ELSE reader_progress.chapter END,
          paragraph=CASE WHEN excluded.updated_at>reader_progress.updated_at OR (excluded.updated_at=reader_progress.updated_at AND excluded.revision>reader_progress.revision) THEN excluded.paragraph ELSE reader_progress.paragraph END,
          revision=MAX(reader_progress.revision, excluded.revision),
          updated_at=MAX(reader_progress.updated_at, excluded.updated_at)
      `);
      for (const pr of remote.reader.progress || []) {
        mergeProg.run(pr.book_id, pr.chapter, pr.paragraph, pr.revision, pr.updated_at);
      }
      const mergeCotexProg = rdb.prepare(`
        INSERT INTO reader_cotex_progress(book_id, old_chapter, old_paragraph, chapter, paragraph, revision, updated_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(book_id) DO UPDATE SET
          old_chapter=CASE WHEN excluded.updated_at>reader_cotex_progress.updated_at THEN excluded.old_chapter ELSE reader_cotex_progress.old_chapter END,
          old_paragraph=CASE WHEN excluded.updated_at>reader_cotex_progress.updated_at THEN excluded.old_paragraph ELSE reader_cotex_progress.old_paragraph END,
          chapter=CASE WHEN excluded.updated_at>reader_cotex_progress.updated_at THEN excluded.chapter ELSE reader_cotex_progress.chapter END,
          paragraph=CASE WHEN excluded.updated_at>reader_cotex_progress.updated_at THEN excluded.paragraph ELSE reader_cotex_progress.paragraph END,
          revision=MAX(reader_cotex_progress.revision, excluded.revision),
          updated_at=MAX(reader_cotex_progress.updated_at, excluded.updated_at)
      `);
      for (const cp of remote.reader.cotexProgress || []) {
        mergeCotexProg.run(cp.book_id, cp.old_chapter ?? 0, cp.old_paragraph ?? 0, cp.chapter ?? 0, cp.paragraph ?? 0, cp.revision ?? 0, cp.updated_at || '');
      }
      const mergeMeta = rdb.prepare('INSERT INTO reader_item_meta(book_id, alias, bookmarks, collapsed_images) VALUES(?,?,?,?) ON CONFLICT(book_id) DO UPDATE SET alias=COALESCE(NULLIF(reader_item_meta.alias, \'\'), excluded.alias)');
      for (const m of remote.reader.itemMeta || []) {
        mergeMeta.run(m.book_id, m.alias || null, m.bookmarks || '[]', m.collapsed_images || '[]');
      }
      const mergeRecent = rdb.prepare('INSERT INTO reader_cotex_recent(book_id, opened_at) VALUES(?,?) ON CONFLICT(book_id) DO UPDATE SET opened_at=MAX(reader_cotex_recent.opened_at, excluded.opened_at)');
      for (const rc of remote.reader.cotexRecent || []) {
        mergeRecent.run(rc.book_id, rc.opened_at || 0);
      }
      rdb.exec('COMMIT');
    } catch (err) {
      rdb.exec('ROLLBACK');
      throw err;
    }

    const now = new Date().toISOString();
    const summary = `已从云端合并书架、进度、书单及 ${pulledBooks} 本新书档`;
    const nextCfg = { ...cfg, lastSyncAt: now, lastDirection: 'pull', lastSummary: summary };
    await writeConfig(nextCfg);
    return { ok: true, summary, pulledBooks, status: publicStatus(nextCfg) };
  }

  async function handle(request) {
    const url = new URL(request.url);
    const route = url.pathname.slice('/api/sync'.length).replace(/\/$/, '');
    try {
      if (request.method === 'GET' && route === '/status') {
        return Response.json(publicStatus(await loadConfig()));
      }
      if (request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        if (route === '/config') {
          const prev = await loadConfig();
          const next = sanitizeConfig(body, prev);
          await writeConfig(next);
          return Response.json({ ok: true, status: publicStatus(next) });
        }
        if (route === '/test') {
          const prev = await loadConfig();
          const candidate = body?.provider ? sanitizeConfig(body, prev) : prev;
          const adapter = makeAdapter(candidate);
          return Response.json(await adapter.test());
        }
        if (route === '/push') return Response.json(await pushAll({ forceFull: Boolean(body?.forceFull) }));
        if (route === '/pull') return Response.json(await pullAll());
      }
      return Response.json({ error: '同步接口不存在' }, { status: 404 });
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      return Response.json({ error: status === 500 ? '同步操作失败，请检查配置后重试' : error.message }, { status });
    }
  }

  return {
    handle,
    loadConfig,
    pushAll,
    pullAll,
  };
}
