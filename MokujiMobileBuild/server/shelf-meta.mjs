import { randomUUID } from 'node:crypto';

const failure = (status, message) => Object.assign(new Error(message), { status });
const text = (v, max = 240) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const BASE_CATEGORIES = new Set(['网文', '轻小说', '文学', '非虚构', '工具书', '漫画']);
const VALID_UNITS = new Set(['章', '话', '卷', '页', '%', '位置']);

export const DEFAULT_CATEGORIES = [
  { name: '网文', unit: '章' },
  { name: '轻小说', unit: '章' },
  { name: '漫画', unit: '话' },
  { name: '文学', unit: '页' },
  { name: '非虚构', unit: '页' },
  { name: '工具书', unit: '页' },
];

export const DEFAULT_RATING_LABELS = {
  '10': '超神作',
  '9': '神作',
  '8': '力荐',
  '7': '推荐',
  '6': '还行',
  '5': '不过不失',
  '4': '较差',
  '3': '差',
  '2': '极差',
  '1': '不忍直视',
};

export const DEFAULT_RATING_BANDS = [
  { id: 'god', label: '9–10 神作', min: 9, max: 10 },
  { id: 'great', label: '8 力荐', min: 8, max: 8 },
  { id: 'good', label: '7 推荐', min: 7, max: 7 },
  { id: 'ok', label: '6 还行', min: 6, max: 6 },
  { id: 'mid', label: '5 不过不失', min: 5, max: 5 },
  { id: 'low', label: '1–4 较差', min: 1, max: 4 },
  { id: 'unrated', label: '暂未评分', min: null, max: null },
];

export const RATING_PRESETS = {
  bangumi: {
    labels: DEFAULT_RATING_LABELS,
    bands: DEFAULT_RATING_BANDS,
  },
  webnovel: {
    labels: {
      '10': '殿堂仙草',
      '9': '仙草',
      '8': '精品粮草',
      '7': '粮草',
      '6': '可口干粮',
      '5': '干草',
      '4': '水草',
      '3': '枯草',
      '2': '毒草',
      '1': '剧毒天雷',
    },
    bands: [
      { id: 'xian', label: '9–10 仙草', min: 9, max: 10 },
      { id: 'liang', label: '7–8 粮草', min: 7, max: 8 },
      { id: 'gan', label: '5–6 干粮', min: 5, max: 6 },
      { id: 'du', label: '1–4 毒草', min: 1, max: 4 },
      { id: 'unrated', label: '暂未评分', min: null, max: null },
    ],
  },
  compact: {
    labels: DEFAULT_RATING_LABELS,
    bands: [
      { id: 'high', label: '8–10 分力荐', min: 8, max: 10 },
      { id: 'mid', label: '5–7 分还行', min: 5, max: 7 },
      { id: 'low', label: '1–4 分较差', min: 1, max: 4 },
      { id: 'unrated', label: '暂未评分', min: null, max: null },
    ],
  },
};

export function createShelfMeta({ db }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS book_collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS book_collection_items (
      collection_id TEXT NOT NULL REFERENCES book_collections(id) ON DELETE CASCADE,
      work_id TEXT NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (collection_id, work_id)
    );
    CREATE TABLE IF NOT EXISTS book_meta_overrides (
      work_id TEXT PRIMARY KEY,
      patch_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shelf_taxonomy (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const listCols = db.prepare('SELECT id, name, description, sort_order AS sortOrder, updated_at AS updatedAt FROM book_collections ORDER BY sort_order ASC, updated_at DESC');
  const listItems = db.prepare('SELECT collection_id AS collectionId, work_id AS workId, added_at AS addedAt FROM book_collection_items');
  const listOverrides = db.prepare('SELECT work_id AS workId, patch_json AS patchJson, updated_at AS updatedAt FROM book_meta_overrides');
  const listTax = db.prepare('SELECT key, value_json AS valueJson, updated_at AS updatedAt FROM shelf_taxonomy');
  const getTax = db.prepare('SELECT value_json AS valueJson FROM shelf_taxonomy WHERE key=?');
  const setTax = db.prepare('INSERT INTO shelf_taxonomy(key, value_json, updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at');
  const insertCol = db.prepare('INSERT INTO book_collections(id, name, description, sort_order, updated_at) VALUES(?,?,?,?,?)');
  const renameCol = db.prepare('UPDATE book_collections SET name=?, description=?, updated_at=? WHERE id=?');
  const deleteCol = db.prepare('DELETE FROM book_collections WHERE id=?');
  const addItem = db.prepare('INSERT OR IGNORE INTO book_collection_items(collection_id, work_id, added_at) VALUES(?,?,?)');
  const removeItem = db.prepare('DELETE FROM book_collection_items WHERE collection_id=? AND work_id=?');
  const upsertOverride = db.prepare('INSERT INTO book_meta_overrides(work_id, patch_json, updated_at) VALUES(?,?,?) ON CONFLICT(work_id) DO UPDATE SET patch_json=excluded.patch_json, updated_at=excluded.updated_at');

  function readTaxJson(key, fallback) {
    try {
      const row = getTax.get(key);
      if (!row?.valueJson) return fallback;
      const parsed = JSON.parse(row.valueJson);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function loadTaxonomy() {
    const rawCats = readTaxJson('categories', DEFAULT_CATEGORIES);
    const categories = Array.isArray(rawCats) && rawCats.length
      ? rawCats.map(c => ({
          name: text(typeof c === 'string' ? c : c?.name, 24),
          unit: VALID_UNITS.has(c?.unit) ? c.unit : '章',
        })).filter(c => c.name)
      : DEFAULT_CATEGORIES;
    const rawLabels = readTaxJson('ratingLabels', DEFAULT_RATING_LABELS);
    const ratingLabels = { ...DEFAULT_RATING_LABELS };
    if (rawLabels && typeof rawLabels === 'object') {
      for (let s = 1; s <= 10; s++) {
        const v = text(rawLabels[String(s)], 24);
        if (v) ratingLabels[String(s)] = v;
      }
    }
    const rawBands = readTaxJson('ratingBands', DEFAULT_RATING_BANDS);
    const ratingBands = Array.isArray(rawBands) && rawBands.length ? rawBands : DEFAULT_RATING_BANDS;
    const rawPinned = readTaxJson('pinnedTags', []);
    const pinnedTags = Array.isArray(rawPinned) ? [...new Set(rawPinned.map(t => text(String(t), 24)).filter(Boolean))].slice(0, 60) : [];
    return { categories, ratingLabels, ratingBands, pinnedTags };
  }

  function snapshot() {
    const collections = listCols.all();
    const rawItems = listItems.all();
    const map = {};
    for (const c of collections) map[c.id] = [];
    for (const item of rawItems) {
      if (!map[item.collectionId]) map[item.collectionId] = [];
      map[item.collectionId].push(item.workId);
    }
    const overrides = {};
    for (const row of listOverrides.all()) {
      try {
        overrides[row.workId] = JSON.parse(row.patchJson);
      } catch {}
    }
    return {
      collections: collections.map(c => ({ ...c, workIds: map[c.id] || [] })),
      overrides,
      taxonomy: loadTaxonomy(),
    };
  }

  function sanitizePatch(raw = {}) {
    const patch = {};
    const title = text(raw.title, 160);
    if (title) patch.title = title;
    if (typeof raw.originalTitle === 'string') patch.originalTitle = text(raw.originalTitle, 160);
    if (typeof raw.author === 'string') patch.author = text(raw.author, 120) || '作者未填写';
    if (typeof raw.category === 'string' && text(raw.category, 40)) patch.category = text(raw.category, 40);
    if (typeof raw.unit === 'string' && text(raw.unit, 20)) patch.unit = text(raw.unit, 20);
    if (typeof raw.country === 'string') patch.country = text(raw.country, 60);
    if (typeof raw.language === 'string') patch.language = text(raw.language, 40);
    if (typeof raw.publicationStatus === 'string') patch.publicationStatus = text(raw.publicationStatus, 40);
    if (typeof raw.edition === 'string') patch.edition = text(raw.edition, 120);
    if (typeof raw.description === 'string') patch.description = text(raw.description, 2000);
    if (typeof raw.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.color.trim())) patch.color = raw.color.trim();
    if (raw.total === null || raw.total === '') {
      patch.total = null;
    } else if (Number.isInteger(Number(raw.total)) && Number(raw.total) > 0 && Number(raw.total) <= 999999) {
      patch.total = Number(raw.total);
    }
    if (Array.isArray(raw.tags)) {
      patch.tags = [...new Set(raw.tags.map(t => text(String(t), 24)).filter(Boolean))].slice(0, 16);
    } else if (typeof raw.tags === 'string') {
      patch.tags = [...new Set(raw.tags.split(/[，,\s]+/).map(t => text(t, 24)).filter(Boolean))].slice(0, 16);
    }
    return patch;
  }

  function editBook(workId, rawPatch) {
    const id = text(workId, 160);
    if (!id) throw failure(400, '缺少作品标识');
    const patch = sanitizePatch(rawPatch);
    if (!Object.keys(patch).length) throw failure(400, '没有需要保存的修改内容');
    const now = new Date().toISOString();

    const isCustomCategory = patch.category && !BASE_CATEGORIES.has(patch.category);
    const libSafePatch = { ...patch };
    if (isCustomCategory) delete libSafePatch.category;

    let updatedCustom = false;
    db.exec('BEGIN IMMEDIATE');
    try {
      const libs = db.prepare('SELECT user_id, revision, state FROM libraries').all();
      const updLib = db.prepare('UPDATE libraries SET state=?, revision=?, updated_at=? WHERE user_id=?');
      for (const lib of libs) {
        const state = JSON.parse(lib.state || '{}');
        if (Array.isArray(state.customBooks)) {
          const idx = state.customBooks.findIndex(b => b.id === id);
          if (idx >= 0) {
            state.customBooks[idx] = { ...state.customBooks[idx], ...libSafePatch };
            updLib.run(JSON.stringify(state), (lib.revision || 0) + 1, now, lib.user_id);
            updatedCustom = true;
          }
        }
      }
      if (!updatedCustom) {
        const prevRow = db.prepare('SELECT patch_json FROM book_meta_overrides WHERE work_id=?').get(id);
        const merged = { ...(prevRow ? JSON.parse(prevRow.patch_json) : {}), ...patch };
        upsertOverride.run(id, JSON.stringify(merged), now);
      } else if (isCustomCategory) {
        const prevRow = db.prepare('SELECT patch_json FROM book_meta_overrides WHERE work_id=?').get(id);
        const merged = { ...(prevRow ? JSON.parse(prevRow.patch_json) : {}), category: patch.category };
        upsertOverride.run(id, JSON.stringify(merged), now);
      } else if (patch.category && BASE_CATEGORIES.has(patch.category)) {
        db.prepare('DELETE FROM book_meta_overrides WHERE work_id=?').run(id);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return snapshot();
  }

  function batchOrganize(payload = {}) {
    const workIds = Array.isArray(payload.workIds) ? [...new Set(payload.workIds.map(id => text(String(id), 160)).filter(Boolean))].slice(0, 500) : [];
    if (!workIds.length) throw failure(400, '请先勾选至少一部作品');
    const nextStatus = ['在读', '想读', '已读', '搁置', '弃读'].includes(payload.status) ? payload.status : '';
    const collectionId = text(payload.collectionId, 80);
    const addTag = text(payload.addTag, 24);
    const nextCategory = text(payload.category, 40);
    if (!nextStatus && !collectionId && !addTag && !nextCategory) {
      throw failure(400, '请选择至少一项要批量修改的整理操作');
    }
    const now = new Date().toISOString();
    const idSet = new Set(workIds);
    const isCustomCat = nextCategory && !BASE_CATEGORIES.has(nextCategory);

    db.exec('BEGIN IMMEDIATE');
    try {
      if (collectionId) {
        for (const wid of workIds) addItem.run(collectionId, wid, now);
      }
      if (nextStatus || addTag || nextCategory) {
        const libs = db.prepare('SELECT user_id, revision, state FROM libraries').all();
        const updLib = db.prepare('UPDATE libraries SET state=?, revision=?, updated_at=? WHERE user_id=?');
        const patchedCustomIds = new Set();
        for (const lib of libs) {
          const state = JSON.parse(lib.state || '{}');
          let changed = false;
          if (nextStatus && Array.isArray(state.entries)) {
            state.entries = state.entries.map(e => {
              if (!idSet.has(e.bookId)) return e;
              changed = true;
              return { ...e, status: nextStatus, updatedAt: now };
            });
          }
          if ((addTag || (nextCategory && !isCustomCat)) && Array.isArray(state.customBooks)) {
            state.customBooks = state.customBooks.map(b => {
              if (!idSet.has(b.id)) return b;
              patchedCustomIds.add(b.id);
              changed = true;
              const tags = addTag ? [...new Set([...(b.tags || []), addTag])].slice(0, 16) : b.tags;
              return { ...b, ...(nextCategory && !isCustomCat ? { category: nextCategory } : {}), ...(tags ? { tags } : {}) };
            });
          }
          if (changed) {
            updLib.run(JSON.stringify(state), (lib.revision || 0) + 1, now, lib.user_id);
          }
        }
        if (addTag || nextCategory) {
          for (const wid of workIds) {
            if (patchedCustomIds.has(wid) && !isCustomCat) continue;
            const prevRow = db.prepare('SELECT patch_json FROM book_meta_overrides WHERE work_id=?').get(wid);
            const merged = prevRow ? JSON.parse(prevRow.patch_json) : {};
            if (nextCategory) merged.category = nextCategory;
            if (addTag && !patchedCustomIds.has(wid)) {
              const baseTags = Array.isArray(merged.tags) ? merged.tags : (Array.isArray(payload.existingTags?.[wid]) ? payload.existingTags[wid] : []);
              merged.tags = [...new Set([...baseTags, addTag])].slice(0, 16);
            }
            upsertOverride.run(wid, JSON.stringify(merged), now);
          }
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return snapshot();
  }

  function mutate(payload = {}) {
    const now = new Date().toISOString();
    const action = payload.action;
    if (action === 'batchOrganize') {
      return batchOrganize(payload);
    }
    if (action === 'createCollection') {
      const name = text(payload.name, 40);
      if (!name) throw failure(400, '请输入书单名称');
      const count = db.prepare('SELECT COUNT(*) AS n FROM book_collections').get()?.n || 0;
      if (count >= 40) throw failure(400, '最多可创建 40 个自定义书单');
      const id = 'col-' + randomUUID().slice(0, 8);
      insertCol.run(id, name, text(payload.description, 160), count, now);
      if (text(payload.workId, 160)) addItem.run(id, text(payload.workId, 160), now);
      return { ...snapshot(), createdId: id };
    }
    if (action === 'renameCollection') {
      const id = text(payload.id, 80);
      const name = text(payload.name, 40);
      if (!id || !name) throw failure(400, '缺少书单标识或名称');
      renameCol.run(name, text(payload.description, 160), now, id);
      return snapshot();
    }
    if (action === 'deleteCollection') {
      const id = text(payload.id, 80);
      if (!id) throw failure(400, '缺少书单标识');
      deleteCol.run(id);
      return snapshot();
    }
    if (action === 'toggleItem') {
      const collectionId = text(payload.collectionId, 80);
      const workId = text(payload.workId, 160);
      if (!collectionId || !workId) throw failure(400, '参数不完整');
      const exists = db.prepare('SELECT 1 FROM book_collection_items WHERE collection_id=? AND work_id=?').get(collectionId, workId);
      const present = typeof payload.present === 'boolean' ? payload.present : !exists;
      if (present) addItem.run(collectionId, workId, now);
      else removeItem.run(collectionId, workId);
      return snapshot();
    }
    if (action === 'editBook') {
      return editBook(payload.workId, payload.patch || payload);
    }

    // Custom Categories Management
    if (action === 'saveCategories') {
      if (payload.reset) {
        setTax.run('categories', JSON.stringify(DEFAULT_CATEGORIES), now);
        return snapshot();
      }
      const list = Array.isArray(payload.categories) ? payload.categories : [];
      const seen = new Set();
      const cleaned = [];
      for (const item of list) {
        const name = text(typeof item === 'string' ? item : item?.name, 24);
        const unit = VALID_UNITS.has(item?.unit) ? item.unit : '章';
        if (!name || name === '全部' || seen.has(name)) continue;
        seen.add(name);
        cleaned.push({ name, unit });
      }
      if (!cleaned.length) throw failure(400, '请至少保留一个作品门类');
      setTax.run('categories', JSON.stringify(cleaned.slice(0, 24)), now);
      return snapshot();
    }
    if (action === 'addCategory') {
      const name = text(payload.name, 24);
      const unit = VALID_UNITS.has(payload.unit) ? payload.unit : '章';
      if (!name || name === '全部') throw failure(400, '请输入有效的门类名称');
      const cur = loadTaxonomy().categories;
      if (cur.some(c => c.name === name)) throw failure(400, `门类「${name}」已存在`);
      if (cur.length >= 24) throw failure(400, '最多可设置 24 个门类');
      setTax.run('categories', JSON.stringify([...cur, { name, unit }]), now);
      return snapshot();
    }
    if (action === 'renameCategory') {
      const oldName = text(payload.oldName, 24);
      const newName = text(payload.newName, 24);
      const unit = VALID_UNITS.has(payload.unit) ? payload.unit : undefined;
      if (!oldName || !newName || newName === '全部') throw failure(400, '请输入新门类名称');
      const cur = loadTaxonomy().categories;
      const next = cur.map(c => (c.name === oldName ? { name: newName, unit: unit || c.unit } : c));
      // Deduplicate if renamed into an existing category
      const seen = new Set();
      const deduped = next.filter(c => (seen.has(c.name) ? false : (seen.add(c.name), true)));
      setTax.run('categories', JSON.stringify(deduped), now);
      // Also update overrides that used oldName
      for (const row of listOverrides.all()) {
        try {
          const ov = JSON.parse(row.patchJson);
          if (ov.category === oldName) {
            ov.category = newName;
            upsertOverride.run(row.workId, JSON.stringify(ov), now);
          }
        } catch {}
      }
      return snapshot();
    }
    if (action === 'deleteCategory') {
      const name = text(payload.name, 24);
      const cur = loadTaxonomy().categories.filter(c => c.name !== name);
      if (!cur.length) throw failure(400, '请至少保留一个门类');
      setTax.run('categories', JSON.stringify(cur), now);
      return snapshot();
    }

    // Rating Labels & Filter Bands Management
    if (action === 'saveRatingConfig') {
      const preset = payload.preset && RATING_PRESETS[payload.preset];
      if (preset) {
        setTax.run('ratingLabels', JSON.stringify(preset.labels), now);
        setTax.run('ratingBands', JSON.stringify(preset.bands), now);
        return snapshot();
      }
      if (payload.ratingLabels && typeof payload.ratingLabels === 'object') {
        const nextLabels = { ...DEFAULT_RATING_LABELS };
        for (let s = 1; s <= 10; s++) {
          const v = text(payload.ratingLabels[String(s)], 24);
          if (v) nextLabels[String(s)] = v;
        }
        setTax.run('ratingLabels', JSON.stringify(nextLabels), now);
      }
      if (Array.isArray(payload.ratingBands)) {
        const nextBands = payload.ratingBands
          .map((b, idx) => {
            const label = text(b?.label, 30);
            if (!label) return null;
            const isUnrated = b?.min === null || b?.max === null || b?.id === 'unrated';
            if (isUnrated) return { id: 'unrated', label, min: null, max: null };
            const min = Math.max(1, Math.min(10, Math.round(Number(b?.min) || 1)));
            const max = Math.max(min, Math.min(10, Math.round(Number(b?.max) || 10)));
            return { id: text(b?.id, 24) || `band-${idx}`, label, min, max };
          })
          .filter(Boolean)
          .slice(0, 12);
        if (nextBands.length) setTax.run('ratingBands', JSON.stringify(nextBands), now);
      }
      return snapshot();
    }

    // Tag Management (pin, rename, delete across library)
    if (action === 'manageTag') {
      const op = payload.op;
      const curPinned = loadTaxonomy().pinnedTags;
      if (op === 'pin') {
        const raw = typeof payload.tag === 'string' ? payload.tag : '';
        const newTags = raw.split(/[，,\s]+/).map(t => text(t, 24)).filter(Boolean);
        if (!newTags.length) throw failure(400, '请输入要添加的标签');
        const nextPinned = [...new Set([...curPinned, ...newTags])].slice(0, 60);
        setTax.run('pinnedTags', JSON.stringify(nextPinned), now);
        return snapshot();
      }
      if (op === 'rename' || op === 'delete') {
        const oldTag = text(payload.oldTag || payload.tag, 24);
        const newTag = op === 'rename' ? text(payload.newTag, 24) : '';
        if (!oldTag) throw failure(400, '缺少原标签名');
        if (op === 'rename' && !newTag) throw failure(400, '请输入新标签名');
        const nextPinned = [...new Set(curPinned.map(t => (t === oldTag ? newTag : t)).filter(Boolean))];
        setTax.run('pinnedTags', JSON.stringify(nextPinned), now);

        db.exec('BEGIN IMMEDIATE');
        try {
          const libs = db.prepare('SELECT user_id, revision, state FROM libraries').all();
          const updLib = db.prepare('UPDATE libraries SET state=?, revision=?, updated_at=? WHERE user_id=?');
          const customIds = new Set();
          for (const lib of libs) {
            const state = JSON.parse(lib.state || '{}');
            let changed = false;
            if (Array.isArray(state.customBooks)) {
              state.customBooks = state.customBooks.map(b => {
                customIds.add(b.id);
                if (!Array.isArray(b.tags) || !b.tags.includes(oldTag)) return b;
                changed = true;
                const nextTags = [...new Set(b.tags.map(t => (t === oldTag ? newTag : t)).filter(Boolean))];
                return { ...b, tags: nextTags };
              });
            }
            if (changed) updLib.run(JSON.stringify(state), (lib.revision || 0) + 1, now, lib.user_id);
          }

          // Update existing overrides + any built-in catalog books passed in payload.existingTags
          const existingMap = payload.existingTags && typeof payload.existingTags === 'object' ? payload.existingTags : {};
          const allWorkIds = new Set([...listOverrides.all().map(r => r.workId), ...Object.keys(existingMap)]);
          for (const wid of allWorkIds) {
            if (customIds.has(wid)) continue;
            const prevRow = db.prepare('SELECT patch_json FROM book_meta_overrides WHERE work_id=?').get(wid);
            const merged = prevRow ? JSON.parse(prevRow.patch_json) : {};
            const baseTags = Array.isArray(merged.tags) ? merged.tags : (Array.isArray(existingMap[wid]) ? existingMap[wid] : null);
            if (Array.isArray(baseTags) && baseTags.includes(oldTag)) {
              merged.tags = [...new Set(baseTags.map(t => (t === oldTag ? newTag : t)).filter(Boolean))];
              upsertOverride.run(wid, JSON.stringify(merged), now);
            }
          }
          db.exec('COMMIT');
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
        return snapshot();
      }
    }

    throw failure(400, '不支持的书架整理操作');
  }

  function exportAll() {
    return {
      collections: listCols.all(),
      items: listItems.all(),
      overrides: listOverrides.all(),
      taxonomy: listTax.all(),
    };
  }

  function importAll(data) {
    if (!data || typeof data !== 'object') return;
    db.exec('BEGIN IMMEDIATE');
    try {
      const mergeCol = db.prepare('INSERT INTO book_collections(id, name, description, sort_order, updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=CASE WHEN excluded.updated_at>=book_collections.updated_at THEN excluded.name ELSE book_collections.name END, description=CASE WHEN excluded.updated_at>=book_collections.updated_at THEN excluded.description ELSE book_collections.description END, updated_at=MAX(excluded.updated_at, book_collections.updated_at)');
      for (const c of data.collections || []) {
        if (c?.id && c?.name) mergeCol.run(c.id, c.name, c.description || '', c.sortOrder || 0, c.updatedAt || new Date().toISOString());
      }
      for (const item of data.items || []) {
        if (item?.collectionId && item?.workId) addItem.run(item.collectionId, item.workId, item.addedAt || new Date().toISOString());
      }
      const mergeOv = db.prepare('INSERT INTO book_meta_overrides(work_id, patch_json, updated_at) VALUES(?,?,?) ON CONFLICT(work_id) DO UPDATE SET patch_json=CASE WHEN excluded.updated_at>=book_meta_overrides.updated_at THEN excluded.patch_json ELSE book_meta_overrides.patch_json END, updated_at=MAX(excluded.updated_at, book_meta_overrides.updated_at)');
      for (const ov of data.overrides || []) {
        if (ov?.workId && ov?.patchJson) mergeOv.run(ov.workId, ov.patchJson, ov.updatedAt || new Date().toISOString());
      }
      const mergeTax = db.prepare('INSERT INTO shelf_taxonomy(key, value_json, updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=CASE WHEN excluded.updated_at>=shelf_taxonomy.updated_at THEN excluded.value_json ELSE shelf_taxonomy.value_json END, updated_at=MAX(excluded.updated_at, shelf_taxonomy.updated_at)');
      for (const tx of data.taxonomy || []) {
        if (tx?.key && tx?.valueJson) mergeTax.run(tx.key, tx.valueJson, tx.updatedAt || new Date().toISOString());
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  return {
    snapshot,
    mutate,
    exportAll,
    importAll,
  };
}
