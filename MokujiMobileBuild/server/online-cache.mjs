// Cache only chapters from the registered online catalogs. Source attribution and revision
// links travel with each stored response. Imported TXT and reading marks use separate tables.
export function createOnlineCache(db, fetchChapter) {
  db.exec(`CREATE TABLE IF NOT EXISTS reader_online_cache (
    book_id TEXT NOT NULL, edition TEXT NOT NULL, n INTEGER NOT NULL, body TEXT NOT NULL,
    size INTEGER NOT NULL, fetched_at INTEGER NOT NULL, used_at INTEGER NOT NULL,
    PRIMARY KEY (book_id, edition, n)
  )`);
  const get = db.prepare('SELECT rowid,body,fetched_at FROM reader_online_cache WHERE book_id=? AND edition=? AND n=?');
  const touch = db.prepare('UPDATE reader_online_cache SET used_at=? WHERE rowid=?');
  const forget = db.prepare('DELETE FROM reader_online_cache WHERE rowid=?');
  const put = db.prepare(`INSERT INTO reader_online_cache(book_id,edition,n,body,size,fetched_at,used_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(book_id,edition,n) DO UPDATE SET body=excluded.body,size=excluded.size,fetched_at=excluded.fetched_at,used_at=excluded.used_at`);
  const prune = db.prepare(`DELETE FROM reader_online_cache WHERE rowid IN (
    SELECT entry_id FROM (
      SELECT rowid AS entry_id, ROW_NUMBER() OVER (ORDER BY used_at DESC,rowid DESC) AS entry_rank,
             SUM(size) OVER (ORDER BY used_at DESC,rowid DESC ROWS UNBOUNDED PRECEDING) AS total_size
        FROM reader_online_cache
    ) WHERE entry_rank>512 OR total_size>33554432
  )`);
  const pending = new Map();
  const week = 7 * 24 * 60 * 60 * 1000;

  function valid(chapter, id, n) {
    return chapter?.id === id && chapter.n === n && Array.isArray(chapter.paragraphs) &&
      chapter.paragraphs.length > 0 && chapter.paragraphs.every(text => typeof text === 'string') &&
      chapter.paragraphs.some(text => text.trim());
  }

  async function read(book, number) {
    const edition = book.edition || '';
    const now = Date.now();
    const row = get.get(book.id, edition, number);
    let cached;
    if (row) {
      try { cached = JSON.parse(row.body); } catch { /* A damaged entry can be refreshed. */ }
      if (valid(cached, book.id, number)) {
        touch.run(now, row.rowid);
        if (now - row.fetched_at < week) return cached;
      } else {
        forget.run(row.rowid);
        cached = undefined;
      }
    }
    const key = JSON.stringify([book.id, edition, number]);
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      try {
        const chapter = await fetchChapter(book.id, number);
        if (!valid(chapter, book.id, number)) return cached || null;
        const body = JSON.stringify(chapter);
        const bytes = Buffer.byteLength(body);
        if (bytes <= 2 * 1024 * 1024) {
          db.exec('BEGIN IMMEDIATE');
          try {
            put.run(book.id, edition, number, body, bytes, now, now);
            prune.run();
            db.exec('COMMIT');
          } catch (error) {
            db.exec('ROLLBACK');
            // A full cache must not hide a successfully downloaded chapter.
            if (!String(error.code || '').startsWith('ERR_SQLITE')) throw error;
          }
        }
        return chapter;
      } catch (error) {
        if (cached) return cached;
        throw error;
      }
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
  }
  return { read };
}
