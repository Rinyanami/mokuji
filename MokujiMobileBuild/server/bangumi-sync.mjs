import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const STATUS_TO_BGM = {
  '想读': 1,
  '已读': 2,
  '在读': 3,
  '搁置': 4,
  '弃读': 5,
};

const BGM_TO_STATUS = {
  1: '想读',
  2: '已读',
  3: '在读',
  4: '搁置',
  5: '弃读',
};

const PALETTE = ['#4c6ef5', '#0ca678', '#f59f00', '#e64980', '#7950f2', '#15aabf'];

function failure(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function text(val, max = 300) {
  return typeof val === 'string' ? val.trim().slice(0, max) : '';
}

function extractSubjectId(bookId, entry) {
  if (Number.isSafeInteger(entry?.bangumiId) && entry.bangumiId > 0) return Number(entry.bangumiId);
  const m = /^custom-bgm-(\d+)$/.exec(String(bookId || entry?.bookId || ''));
  return m ? Number(m[1]) : 0;
}

function inferCategory(subject = {}, tags = []) {
  const platform = text(subject.platform, 40);
  const pool = [platform, ...tags].join(' ');
  if (/漫画|漫畫|Comic|Manga/i.test(pool)) return '漫画';
  if (/轻小说|輕小說|ライトノベル|文库|文庫/i.test(pool)) return '轻小说';
  if (/网文|网络小说|網路小說|网络文学/i.test(pool)) return '网文';
  return '文学';
}

function unitForCategory(cat) {
  if (cat === '漫画') return '话';
  if (cat === '轻小说' || cat === '网文') return '章';
  return '页';
}

export function createBangumiSync({ dataDir, dujiDb, fetchImpl = globalThis.fetch }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const configPath = path.join(dataDir, 'bangumi-config.json');
  const ownsDb = typeof dujiDb === 'string';
  const db = ownsDb ? new DatabaseSync(dujiDb) : dujiDb;

  function loadConfig() {
    try {
      if (!fs.existsSync(configPath)) return {};
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      return {};
    }
  }

  function saveConfigFile(next) {
    fs.writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf8');
    return next;
  }

  function getStatus() {
    const cfg = loadConfig();
    return {
      hasToken: Boolean(cfg.accessToken),
      username: cfg.username || '',
      nickname: cfg.nickname || '',
      userId: cfg.userId || null,
      avatar: cfg.avatar || '',
      autoPush: cfg.autoPush !== false,
      privateDefault: Boolean(cfg.privateDefault),
      apiBase: cfg.apiBase || 'https://api.bgm.tv',
      lastSyncAt: cfg.lastSyncAt || null,
      lastSummary: cfg.lastSummary || '',
    };
  }

  async function bgmFetch(cfg, endpoint, options = {}) {
    const base = String(cfg.apiBase || 'https://api.bgm.tv').replace(/\/+$/, '');
    const url = `${base}${endpoint}`;
    const headers = {
      'User-Agent': 'MokujiReader/2.0 (https://github.com/mokuji/reader)',
      Accept: 'application/json',
      ...(cfg.accessToken ? { Authorization: `Bearer ${cfg.accessToken}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    };
    const res = await fetchImpl(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (res.status === 204 || res.status === 202) return null;
    const raw = await res.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = { description: raw };
    }
    if (!res.ok) {
      const detail = data?.description || data?.title || data?.error || `HTTP ${res.status}`;
      throw failure(res.status === 401 ? 401 : 502, `Bangumi 接口返回错误：${detail}`);
    }
    return data;
  }

  async function updateConfig(payload = {}) {
    const prev = loadConfig();
    const tokenInput = typeof payload.accessToken === 'string' ? payload.accessToken.trim() : '';
    const accessToken = tokenInput && !tokenInput.startsWith('***') ? tokenInput : (prev.accessToken || '');
    const apiBase = text(payload.apiBase || prev.apiBase || 'https://api.bgm.tv', 200).replace(/\/+$/, '');
    const autoPush = payload.autoPush !== undefined ? Boolean(payload.autoPush) : (prev.autoPush !== false);
    const privateDefault = payload.privateDefault !== undefined ? Boolean(payload.privateDefault) : Boolean(prev.privateDefault);

    if (payload.clearToken) {
      saveConfigFile({
        accessToken: '',
        username: '',
        nickname: '',
        userId: null,
        avatar: '',
        autoPush,
        privateDefault,
        apiBase: 'https://api.bgm.tv',
        lastSyncAt: prev.lastSyncAt || null,
        lastSummary: '已断开 Bangumi 账号绑定',
      });
      return getStatus();
    }

    if (!accessToken) {
      throw failure(400, '请填写 Bangumi Personal Access Token（可在 next.bgm.tv/demo/access-token 生成）');
    }

    const tempCfg = { ...prev, accessToken, apiBase, autoPush, privateDefault };
    const me = await bgmFetch(tempCfg, '/v0/me');
    const username = text(String(me?.username || me?.id || ''), 80);
    const nickname = text(String(me?.nickname || username), 80);
    const userId = Number.isSafeInteger(me?.id) ? me.id : null;
    const avatar = text(me?.avatar?.medium || me?.avatar?.small || '', 300);

    saveConfigFile({
      ...tempCfg,
      username,
      nickname,
      userId,
      avatar,
      lastSyncAt: new Date().toISOString(),
      lastSummary: `已连接 Bangumi 账号 @${nickname || username}`,
    });
    return getStatus();
  }

  function bindSubject({ bookId, bangumiId }) {
    const wid = text(bookId, 160);
    const sid = Number(bangumiId);
    if (!wid) throw failure(400, '缺少本地作品 ID');
    if (!Number.isSafeInteger(sid) || sid <= 0) throw failure(400, '请输入有效的 Bangumi 条目数字 ID（例如 294207）');
    const now = new Date().toISOString();

    db.exec('BEGIN IMMEDIATE');
    try {
      const libs = db.prepare('SELECT user_id, revision, state FROM libraries').all();
      const updLib = db.prepare('UPDATE libraries SET state=?, revision=?, updated_at=? WHERE user_id=?');
      for (const lib of libs) {
        const state = JSON.parse(lib.state || '{}');
        state.entries = Array.isArray(state.entries) ? state.entries : [];
        // Unbind if another entry already bound to this sid
        state.entries = state.entries.map(e => (e.bangumiId === sid && e.bookId !== wid ? { ...e, bangumiId: undefined } : e));
        const idx = state.entries.findIndex(e => e.bookId === wid);
        if (idx >= 0) {
          state.entries[idx] = {
            ...state.entries[idx],
            bangumiId: sid,
            sourceUrl: state.entries[idx].sourceUrl || `https://bgm.tv/subject/${sid}`,
            updatedAt: now,
          };
        } else {
          state.entries.unshift({
            bookId: wid,
            bangumiId: sid,
            status: '在读',
            position: null,
            volume: null,
            unit: '章',
            locationText: '',
            note: '',
            rating: null,
            sourceUrl: `https://bgm.tv/subject/${sid}`,
            edition: '',
            updatedAt: now,
            startedAt: now.slice(0, 10),
            finishedAt: '',
          });
        }
        updLib.run(JSON.stringify(state), (lib.revision || 0) + 1, now, lib.user_id);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return { ok: true, bookId: wid, bangumiId: sid };
  }

  async function pushSingleEntry(cfg, entry, book, overrideSubjectId = 0) {
    const subjectId = overrideSubjectId || extractSubjectId(entry?.bookId, entry);
    if (!subjectId) {
      throw failure(400, '该作品尚未绑定 Bangumi 条目 ID，请先绑定条目编号');
    }
    const type = STATUS_TO_BGM[entry?.status] || 3;
    const rate = Number.isInteger(entry?.rating) && entry.rating >= 1 && entry.rating <= 10 ? entry.rating : 0;
    const comment = text(entry?.note || '', 380);
    const tags = Array.isArray(book?.tags) ? book.tags.map(t => text(t, 30)).filter(Boolean).slice(0, 10) : [];

    await bgmFetch(cfg, `/v0/users/-/collections/${subjectId}`, {
      method: 'POST',
      body: {
        type,
        rate,
        comment,
        tags,
        private: Boolean(cfg.privateDefault),
      },
    });

    const epStatus = Number.isInteger(entry?.position) && entry.position >= 0 ? entry.position : undefined;
    const volStatus = Number.isInteger(entry?.volume) && entry.volume >= 0 ? entry.volume : undefined;
    if (epStatus !== undefined || volStatus !== undefined) {
      try {
        await bgmFetch(cfg, `/v0/users/-/collections/${subjectId}`, {
          method: 'PATCH',
          body: {
            ...(epStatus !== undefined ? { ep_status: epStatus } : {}),
            ...(volStatus !== undefined ? { vol_status: volStatus } : {}),
          },
        });
      } catch {
        // Some Bangumi book subjects have locked ep/vol fields; collection status/rating/comment still succeeded.
      }
    }
    return { subjectId, status: entry?.status || '在读', rating: rate || null, epStatus: epStatus ?? null, volStatus: volStatus ?? null };
  }

  async function pushOne(payload = {}) {
    if (payload.action === 'bindSubject') {
      return bindSubject(payload);
    }
    const cfg = loadConfig();
    if (!cfg.accessToken) throw failure(400, '请先在个人主页配置 Bangumi Access Token');

    const bookId = text(payload.bookId, 160);
    const explicitSubjectId = Number(payload.bangumiId) || 0;
    if (!bookId && !explicitSubjectId) throw failure(400, '缺少 bookId 或 bangumiId');

    if (bookId && explicitSubjectId) {
      bindSubject({ bookId, bangumiId: explicitSubjectId });
    }

    const libs = db.prepare('SELECT state FROM libraries').all();
    let foundEntry = null;
    let foundBook = null;
    for (const lib of libs) {
      const state = JSON.parse(lib.state || '{}');
      const entries = Array.isArray(state.entries) ? state.entries : [];
      const books = Array.isArray(state.customBooks) ? state.customBooks : [];
      foundEntry = entries.find(e => (bookId && e.bookId === bookId) || (explicitSubjectId && extractSubjectId(e.bookId, e) === explicitSubjectId));
      if (foundEntry) {
        foundBook = books.find(b => b.id === foundEntry.bookId) || null;
        break;
      }
    }

    if (!foundEntry && payload.entry) {
      foundEntry = payload.entry;
    }
    if (!foundEntry) {
      foundEntry = {
        bookId: bookId || `custom-bgm-${explicitSubjectId}`,
        bangumiId: explicitSubjectId || extractSubjectId(bookId, null),
        status: payload.status || '在读',
        rating: payload.rating ?? null,
        position: payload.position ?? null,
        volume: payload.volume ?? null,
        note: payload.note || '',
      };
    }

    const result = await pushSingleEntry(cfg, foundEntry, foundBook, explicitSubjectId);
    const now = new Date().toISOString();
    saveConfigFile({
      ...cfg,
      lastSyncAt: now,
      lastSummary: `已推送《${foundBook?.title || bookId || ('#' + result.subjectId)}》至 Bangumi（${result.status}）`,
    });
    return { ok: true, ...result, statusInfo: getStatus() };
  }

  async function pushAll() {
    const cfg = loadConfig();
    if (!cfg.accessToken) throw failure(400, '请先在个人主页配置 Bangumi Access Token');

    const libs = db.prepare('SELECT state FROM libraries').all();
    const tasks = [];
    const seenSubjects = new Set();
    for (const lib of libs) {
      const state = JSON.parse(lib.state || '{}');
      const entries = Array.isArray(state.entries) ? state.entries : [];
      const books = Array.isArray(state.customBooks) ? state.customBooks : [];
      for (const entry of entries) {
        const sid = extractSubjectId(entry.bookId, entry);
        if (!sid || seenSubjects.has(sid)) continue;
        seenSubjects.add(sid);
        const book = books.find(b => b.id === entry.bookId) || null;
        tasks.push({ entry, book, sid });
      }
    }

    let pushed = 0;
    const errors = [];
    for (const item of tasks) {
      try {
        await pushSingleEntry(cfg, item.entry, item.book, item.sid);
        pushed++;
      } catch (err) {
        errors.push({ subjectId: item.sid, bookId: item.entry.bookId, error: err?.message || '推送失败' });
      }
    }
    const now = new Date().toISOString();
    saveConfigFile({
      ...cfg,
      lastSyncAt: now,
      lastSummary: `已批量推送 ${pushed}/${tasks.length} 部关联作品到 Bangumi`,
    });
    return { ok: true, pushed, total: tasks.length, errors, statusInfo: getStatus() };
  }

  async function pullCollections(payload = {}) {
    const cfg = loadConfig();
    if (!cfg.accessToken) throw failure(400, '请先在个人主页配置 Bangumi Access Token');
    const username = text(payload.username || cfg.username || String(cfg.userId || ''), 80);
    if (!username) throw failure(400, '未获取到 Bangumi 用户名，请重新验证 Token');

    const limit = Math.min(Math.max(Number(payload.limit) || 50, 1), 100);
    const data = await bgmFetch(cfg, `/v0/users/${encodeURIComponent(username)}/collections?subject_type=1&limit=${limit}&offset=0`);
    const rows = Array.isArray(data?.data) ? data.data : [];
    const now = new Date().toISOString();
    let importedBooks = 0;
    let updatedEntries = 0;

    db.exec('BEGIN IMMEDIATE');
    try {
      let libs = db.prepare('SELECT user_id, revision, state FROM libraries').all();
      if (!libs.length) {
        db.prepare('INSERT INTO libraries (user_id, revision, state, updated_at) VALUES (?, ?, ?, ?)').run(
          'default',
          1,
          JSON.stringify({ customBooks: [], entries: [], events: [] }),
          now,
        );
        libs = db.prepare('SELECT user_id, revision, state FROM libraries').all();
      }
      const updLib = db.prepare('UPDATE libraries SET state=?, revision=?, updated_at=? WHERE user_id=?');

      for (const lib of libs) {
        const state = JSON.parse(lib.state || '{}');
        state.customBooks = Array.isArray(state.customBooks) ? state.customBooks : [];
        state.entries = Array.isArray(state.entries) ? state.entries : [];

        for (const row of rows) {
          const subjectId = Number(row?.subject_id || row?.subject?.id);
          if (!Number.isSafeInteger(subjectId) || subjectId <= 0) continue;
          const subject = row.subject || {};
          const title = text(subject.name_cn || subject.name || `Bangumi #${subjectId}`, 200);
          const originalTitle = text(subject.name || title, 200);
          const rawTags = [
            ...(Array.isArray(row.tags) ? row.tags : []),
            ...(Array.isArray(subject.tags) ? subject.tags.map(t => t?.name || t) : []),
          ].map(t => text(String(t || ''), 30)).filter(Boolean);
          const tags = [...new Set(rawTags)].slice(0, 10);
          const category = inferCategory(subject, tags);
          const unit = unitForCategory(category);
          const customId = `custom-bgm-${subjectId}`;
          const cover = text(subject.images?.common || subject.images?.medium || `https://api.bgm.tv/v0/subjects/${subjectId}/image?type=medium`, 300);

          let targetBookId = customId;
          const existingEntryIdx = state.entries.findIndex(e => extractSubjectId(e.bookId, e) === subjectId);
          if (existingEntryIdx >= 0) {
            targetBookId = state.entries[existingEntryIdx].bookId;
          }

          if (targetBookId === customId && !state.customBooks.some(b => b.id === customId)) {
            state.customBooks.unshift({
              id: customId,
              title,
              originalTitle,
              author: text(subject.eps ? `${subject.eps} 话/章` : '', 100),
              category,
              tags,
              country: '日本/中文',
              language: '中文',
              description: text(subject.short_summary || subject.summary || '', 800),
              cover,
              color: PALETTE[subjectId % PALETTE.length],
              unit,
              total: Number.isInteger(subject.eps) && subject.eps > 0 ? subject.eps : null,
              publicationStatus: 'Bangumi 同步',
              sourceUrl: `https://bgm.tv/subject/${subjectId}`,
              isCustom: true,
            });
            importedBooks++;
          }

          const status = BGM_TO_STATUS[row.type] || '在读';
          const rating = Number.isInteger(row.rate) && row.rate >= 1 && row.rate <= 10 ? row.rate : null;
          const position = Number.isInteger(row.ep_status) && row.ep_status > 0 ? row.ep_status : null;
          const volume = Number.isInteger(row.vol_status) && row.vol_status > 0 ? row.vol_status : null;
          const note = text(row.comment || '', 400);

          if (existingEntryIdx >= 0) {
            const prev = state.entries[existingEntryIdx];
            state.entries[existingEntryIdx] = {
              ...prev,
              bangumiId: subjectId,
              status,
              rating: rating ?? prev.rating,
              position: position ?? prev.position,
              volume: volume ?? prev.volume,
              note: note || prev.note,
              sourceUrl: prev.sourceUrl || `https://bgm.tv/subject/${subjectId}`,
              updatedAt: text(row.updated_at, 40) || now,
            };
            updatedEntries++;
          } else {
            state.entries.unshift({
              bookId: targetBookId,
              bangumiId: subjectId,
              status,
              position,
              volume,
              unit,
              locationText: '',
              note,
              rating,
              sourceUrl: `https://bgm.tv/subject/${subjectId}`,
              edition: '',
              updatedAt: text(row.updated_at, 40) || now,
              startedAt: (text(row.updated_at, 10) || now.slice(0, 10)),
              finishedAt: status === '已读' ? (text(row.updated_at, 10) || now.slice(0, 10)) : '',
            });
            updatedEntries++;
          }
        }
        updLib.run(JSON.stringify(state), (lib.revision || 0) + 1, now, lib.user_id);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    saveConfigFile({
      ...cfg,
      lastSyncAt: now,
      lastSummary: `已从 Bangumi 拉取 ${rows.length} 条书籍收藏（新增 ${importedBooks} 部，更新 ${updatedEntries} 条记录）`,
    });
    return {
      ok: true,
      totalFetched: rows.length,
      importedBooks,
      updatedEntries,
      statusInfo: getStatus(),
    };
  }

  function close() {
    if (ownsDb) {
      try { db.close(); } catch {}
    }
  }

  return {
    getStatus,
    updateConfig,
    pushOne,
    pushAll,
    pullCollections,
    close,
  };
}
