import path from 'node:path';
import { createRequire } from 'node:module';
import { assertSafePublicUrl, fetchHtml } from './custom-sources.mjs';

const require = createRequire(import.meta.url);
const { load } = require('./epub-deps.cjs');

const MAX_FILE_BYTES = 60 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const failure = (status, message) => Object.assign(new Error(message), { status });
const brief = (v, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

async function fetchWithSafeRedirects(rawUrl, method = 'GET', timeoutMs = 20000) {
  let current = await assertSafePublicUrl(rawUrl);
  for (let i = 0; i < 4; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(current.toString(), {
        method,
        headers: {
          'user-agent': USER_AGENT,
          referer: current.origin + '/',
          accept: '*/*',
        },
        redirect: 'manual',
        signal: controller.signal,
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw failure(502, '目标地址重定向无效');
        current = await assertSafePublicUrl(new URL(loc, current).toString());
        continue;
      }
      return { res, finalUrl: current.toString() };
    } catch (err) {
      if (err?.status) throw err;
      throw failure(502, '无法连接目标网址：' + (err?.message || '网络超时'));
    } finally {
      clearTimeout(timer);
    }
  }
  throw failure(502, '重定向次数过多');
}

function detectFileType(url, contentType = '', disposition = '') {
  const ct = contentType.toLowerCase();
  const cdMatch = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(disposition);
  const nameFromHeader = cdMatch ? decodeURIComponent(cdMatch[1]).trim() : '';
  const nameFromUrl = path.posix.basename(new URL(url).pathname || '') || 'downloaded';
  const filename = nameFromHeader || nameFromUrl;
  const lower = filename.toLowerCase();

  if (lower.endsWith('.epub') || ct.includes('application/epub+zip')) return { fileType: 'epub', filename };
  if (lower.endsWith('.cbz') || ct.includes('comicbook+zip')) return { fileType: 'cbz', filename };
  if (lower.endsWith('.zip') || ct === 'application/zip' || ct === 'application/x-zip-compressed') return { fileType: 'zip', filename };
  if (lower.endsWith('.txt') || (ct.includes('text/plain') && !ct.includes('html'))) return { fileType: 'txt', filename };
  return null;
}

function guessCategory(title, chapterTitles = [], htmlText = '') {
  const sample = (title + ' ' + chapterTitles.slice(0, 12).join(' ') + ' ' + htmlText.slice(0, 1500)).toLowerCase();
  if (/漫画|comic|manga|第\s*\d+\s*话/.test(sample)) return '漫画';
  if (/轻小说|文库|插图|epilogue|prologue|卷\s*[一二三四五六七八九十\d]+/.test(sample)) return '轻小说';
  return '网文';
}

function detectTocLinks($, pageUrl) {
  const base = new URL(pageUrl);
  const containers = $('#list, .listmain, #chapterlist, .chapter-list, ul.chapters, .catalog-list, .directoryArea, dl, ul, ol, table, #content, main, div');
  let bestLinks = [];
  let bestScore = 0;

  containers.each((_, box) => {
    const anchors = $(box).children('li, dd, p, tr, a').length >= 5 ? $(box).find('a') : $(box).children('a');
    if (anchors.length < 5 || anchors.length > 8000) return;
    // Skip deeply nested whole-page wrappers if a narrower container exists
    const seen = new Set();
    const list = [];
    let chapterPatternHits = 0;
    anchors.each((__, el) => {
      const a = $(el);
      const text = brief(a.text(), 140);
      const href = a.attr('href') || '';
      if (!text || text.length > 80 || !href || href.startsWith('#') || href.startsWith('javascript:')) return;
      if (/^(?:首页|主页|返回|登录|注册|书架|排行|分类|书库|关于|版权|举报|加入书签|下一页|上一页|尾页)$/.test(text)) return;
      let full;
      try { full = new URL(href, pageUrl); } catch { return; }
      if (full.hostname !== base.hostname || full.pathname === base.pathname) return;
      const key = full.toString();
      if (seen.has(key)) return;
      seen.add(key);
      if (/第.{1,10}[章节话卷回集]|chapter|ch\.?\s*\d+|\d+[-_.]/i.test(text)) chapterPatternHits++;
      list.push({ title: text, url: key });
    });
    if (list.length < 5) return;
    const score = list.length + chapterPatternHits * 3 - ($(box).find('nav, header, footer').length * 50);
    if (score > bestScore && chapterPatternHits >= Math.min(3, list.length * 0.25)) {
      bestScore = score;
      bestLinks = list;
    }
  });

  // Fallback: collect all same-origin links matching chapter pattern across the document
  if (bestLinks.length < 5) {
    const seen = new Set();
    const all = [];
    $('a').each((_, el) => {
      const a = $(el);
      const text = brief(a.text(), 140);
      const href = a.attr('href') || '';
      if (!text || text.length > 70 || !href || href.startsWith('javascript:')) return;
      if (!/第.{1,10}[章节话卷回]|chapter\s*\d+/i.test(text)) return;
      try {
        const full = new URL(href, pageUrl).toString();
        if (seen.has(full)) return;
        seen.add(full);
        all.push({ title: text, url: full });
      } catch {}
    });
    if (all.length >= 4) bestLinks = all;
  }

  return bestLinks;
}

export function createWebSniffer({ customSources, epub, importTextBuffer, bindStmt }) {
  async function readBoundedBytes(res, maxBytes) {
    const lenHeader = Number(res.headers.get('content-length'));
    if (Number.isFinite(lenHeader) && lenHeader > maxBytes) {
      throw failure(413, '目标文件超过 60 MiB 上限');
    }
    const reader = res.body?.getReader();
    if (!reader) return Buffer.alloc(0);
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw failure(413, '目标文件超过 60 MiB 上限');
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, total);
  }

  async function sniff({ url, mode = 'preview', title: customTitle, author: customAuthor, category: customCat, workId }) {
    if (typeof url !== 'string' || !url.trim() || url.length > 2048) {
      throw failure(400, '请输入合法的网址（http:// 或 https://）');
    }
    const cleanUrl = url.trim();
    const { res, finalUrl } = await fetchWithSafeRedirects(cleanUrl, 'GET');
    if (!res.ok) throw failure(502, `目标网页返回 HTTP ${res.status}，暂不可读取`);

    const contentType = res.headers.get('content-type') || '';
    const disposition = res.headers.get('content-disposition') || '';
    const detectedFile = detectFileType(finalUrl, contentType, disposition);

    if (detectedFile) {
      if (mode === 'preview') {
        await res.body?.cancel().catch(() => {});
        const len = Number(res.headers.get('content-length')) || 0;
        const baseTitle = detectedFile.filename.replace(/\.(?:te?xt|epub|cbz|zip)$/i, '');
        return {
          kind: 'file',
          fileType: detectedFile.fileType,
          filename: detectedFile.filename,
          title: brief(customTitle || baseTitle, 160),
          category: detectedFile.fileType === 'cbz' || detectedFile.fileType === 'zip' ? '漫画' : '网文',
          byteLength: len,
          url: finalUrl,
        };
      }
      const bytes = await readBoundedBytes(res, MAX_FILE_BYTES);
      let importedId;
      const meta = {
        filename: detectedFile.filename,
        title: customTitle || detectedFile.filename.replace(/\.(?:te?xt|epub|cbz|zip)$/i, ''),
        author: customAuthor || '',
        ...(workId ? { workId } : {}),
      };
      if (detectedFile.fileType === 'epub') importedId = await epub.importEpubBytes(bytes, detectedFile.filename, meta, bindStmt);
      else if (detectedFile.fileType === 'cbz' || detectedFile.fileType === 'zip') importedId = await epub.importComicBytes(bytes, detectedFile.filename, meta, bindStmt);
      else importedId = await importTextBuffer(bytes, meta);
      return { kind: 'imported', importedId, url: finalUrl };
    }

    // HTML sniff mode
    await res.body?.cancel().catch(() => {});
    const page = await fetchHtml(finalUrl);
    const $ = load(page.text);
    const parsedTitle = brief(
      customTitle
        || $('meta[property="og:novel:book_name"]').attr('content')
        || $('meta[name="og:novel:book_name"]').attr('content')
        || $('meta[property="og:title"]').attr('content')
        || $('h1').first().text()
        || $('title').text().split(/[-_|—]/)[0],
      160,
    ) || '网页嗅探作品';
    const parsedAuthor = brief(
      customAuthor
        || $('meta[property="og:novel:author"]').attr('content')
        || $('meta[name="og:novel:author"]').attr('content')
        || $('meta[name="author"]').attr('content')
        || '',
      80,
    );
    const parsedIntro = brief(
      $('meta[property="og:description"], meta[name="description"]').attr('content') || $('#intro, .intro').first().text(),
      280,
    );

    const tocLinks = detectTocLinks($, page.url);
    if (tocLinks.length >= 4) {
      const cat = customCat || guessCategory(parsedTitle, tocLinks.map(c => c.title), page.text);
      if (mode === 'preview') {
        return {
          kind: 'catalog',
          title: parsedTitle,
          author: parsedAuthor,
          intro: parsedIntro,
          category: cat,
          chapterCount: tocLinks.length,
          previewChapters: tocLinks.slice(0, 6).map(c => c.title),
          url: page.url,
        };
      }
      const { book } = customSources.saveSniffedBook({
        detailUrl: page.url,
        title: parsedTitle,
        author: parsedAuthor,
        intro: parsedIntro,
        category: cat,
        chapters: tocLinks.map(c => ({ title: c.title, url: c.url, paragraphs: null })),
      });
      if (workId) bindStmt.run(workId, book.id);
      return { kind: 'book', book };
    }

    const single = customSources.extractGenericHtmlChapter(page.text, page.url);
    if (single.images?.length) {
      if (mode === 'preview') {
        return {
          kind: 'manga',
          title: parsedTitle,
          author: parsedAuthor,
          category: '漫画',
          pageCount: single.images[0]?.items?.length || 0,
          url: page.url,
        };
      }
      const { book } = customSources.saveSniffedBook({
        detailUrl: page.url,
        title: parsedTitle,
        author: parsedAuthor,
        intro: parsedIntro,
        category: customCat || '漫画',
        chapters: [{ title: parsedTitle, url: page.url, paragraphs: [], images: single.images, media: single.media }],
      });
      if (workId) bindStmt.run(workId, book.id);
      return { kind: 'book', book };
    }

    if (mode === 'preview') {
      return {
        kind: 'article',
        title: parsedTitle,
        author: parsedAuthor,
        category: customCat || '文学',
        paragraphCount: single.paragraphs.length,
        previewParagraphs: single.paragraphs.slice(0, 4),
        url: page.url,
      };
    }
    const { book } = customSources.saveSniffedBook({
      detailUrl: page.url,
      title: parsedTitle,
      author: parsedAuthor,
      intro: parsedIntro,
      category: customCat || '文学',
      chapters: [{ title: parsedTitle, url: page.url, paragraphs: single.paragraphs }],
    });
    if (workId) bindStmt.run(workId, book.id);
    return { kind: 'book', book };
  }

  async function proxyImage(rawUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl.trim() || rawUrl.length > 2048) {
      throw failure(400, '图片地址无效');
    }
    const { res } = await fetchWithSafeRedirects(rawUrl.trim(), 'GET', 15000);
    if (!res.ok) throw failure(502, `图片源返回 HTTP ${res.status}`);
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/')) throw failure(415, '目标链接不是图片');
    const bytes = await readBoundedBytes(res, MAX_IMAGE_BYTES);
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': ct.split(';')[0],
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  return { sniff, proxyImage };
}
