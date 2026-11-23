import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { JSZip } = require('./epub-deps.cjs');

const failure = (status, message) => Object.assign(new Error(message), { status });

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeFileBase(title) {
  const cleaned = String(title || 'mokuji-book').replace(/[\\/:*?"<>|\r\n]+/g, '_').trim();
  return cleaned || 'mokuji-book';
}

function opdsResponse(xml) {
  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function einkShell(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)} - 目次墨水屏版</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff; color: #000000; font-family: "Noto Serif SC", "Songti SC", Georgia, serif; }
  body { max-width: 760px; margin: 0 auto; padding: 14px 16px 36px; line-height: 1.75; }
  a { color: #000000; text-decoration: none; }
  header { border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 14px; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 8px; }
  .brand { font-size: 20px; font-weight: 700; font-family: system-ui, -apple-system, sans-serif; }
  .nav-links { display: flex; flex-wrap: wrap; gap: 8px; font-family: system-ui, -apple-system, sans-serif; font-size: 14px; }
  .btn, button { display: inline-block; padding: 7px 13px; border: 1.5px solid #000; background: #fff; color: #000; font-size: 14px; font-family: system-ui, -apple-system, sans-serif; font-weight: 600; cursor: pointer; text-align: center; }
  .btn-solid { background: #000; color: #fff; }
  .search-bar { display: flex; gap: 8px; margin-bottom: 14px; }
  .search-bar input { flex: 1; border: 1.5px solid #000; padding: 8px 10px; font-size: 15px; background: #fff; color: #000; }
  .book-item { border: 1.5px solid #000; padding: 12px 14px; margin-bottom: 10px; }
  .book-title { font-size: 18px; font-weight: 700; margin: 0 0 4px; }
  .book-meta { font-size: 13px; font-family: system-ui, sans-serif; margin-bottom: 8px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .ch-list { list-style: none; padding: 0; margin: 0; }
  .ch-list li { border-bottom: 1px solid #000; }
  .ch-list a { display: flex; justify-content: space-between; padding: 10px 4px; font-size: 15px; }
  .reader-toolbar { border-top: 1.5px solid #000; border-bottom: 1.5px solid #000; padding: 10px 0; margin: 12px 0 18px; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; font-family: system-ui, sans-serif; }
  .chapter-h1 { font-size: 22px; font-weight: 700; margin: 12px 0 16px; line-height: 1.35; }
  .chapter-body p { margin: 0 0 0.9em; text-indent: 2em; text-align: justify; }
  .chapter-img { display: block; max-width: 100%; height: auto; margin: 14px auto; border: 1px solid #000; }
  .notice { border: 1.5px solid #000; padding: 12px; margin: 12px 0; font-family: system-ui, sans-serif; font-size: 14px; }
  .pager { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; align-items: center; font-family: system-ui, sans-serif; font-size: 14px; }
</style>
</head>
<body>
<header>
  <div class="brand"><a href="/eink">目次 Mokuji · 墨水屏版</a></div>
  <div class="nav-links">
    <a class="btn" href="/eink">书库首页</a>
    <a class="btn" href="/opds">OPDS 订阅地址</a>
    <a class="btn" href="/">桌面端</a>
  </div>
</header>
${bodyHtml}
</body>
</html>`;
}

export function createOpdsEink({ reader }) {
  async function collectChaptersForExport(book) {
    const details = await reader.getDetails(book);
    const chapters = [];
    for (const ch of details.chapters) {
      if (!ch.available) continue;
      try {
        const body = await reader.getChapter(book, ch.n);
        if (body?.paragraphs?.length) {
          chapters.push({ n: ch.n, title: body.title || ch.title || `第 ${ch.n + 1} 章`, paragraphs: body.paragraphs });
        }
      } catch {
        // Skip locked/unfetchable chapters gracefully during export
      }
    }
    return chapters;
  }

  async function buildTxtBuffer(book) {
    const chapters = await collectChaptersForExport(book);
    if (!chapters.length) throw failure(422, '这本书暂无可导出的离线正文（请先缓存章节）');
    const lines = [book.title, book.author ? `作者：${book.author}` : '', ''].filter(Boolean);
    for (const c of chapters) {
      lines.push('', c.title, '');
      for (const p of c.paragraphs) lines.push(p);
    }
    return Buffer.from('\uFEFF' + lines.join('\n'), 'utf8');
  }

  async function buildEpubBuffer(book) {
    const chapters = await collectChaptersForExport(book);
    if (!chapters.length) throw failure(422, '这本书暂无可导出的离线正文（请先缓存章节）');
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.folder('META-INF').file(
      'container.xml',
      `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
    );

    const oebps = zip.folder('OEBPS');
    const manifestItems = [];
    const spineItems = [];
    const navPoints = [];

    chapters.forEach((ch, idx) => {
      const fname = `ch${String(idx + 1).padStart(4, '0')}.xhtml`;
      const id = `ch${idx + 1}`;
      manifestItems.push(`<item id="${id}" href="${fname}" media-type="application/xhtml+xml"/>`);
      spineItems.push(`<itemref idref="${id}"/>`);
      navPoints.push(`<navPoint id="nav-${idx + 1}" playOrder="${idx + 1}"><navLabel><text>${esc(ch.title)}</text></navLabel><content src="${fname}"/></navPoint>`);
      const bodyPs = ch.paragraphs.map(p => `<p>${esc(p)}</p>`).join('\n');
      oebps.file(
        fname,
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN">
<head><title>${esc(ch.title)}</title></head>
<body>
<h2>${esc(ch.title)}</h2>
${bodyPs}
</body>
</html>`,
      );
    });

    const bookUid = `urn:mokuji:${esc(book.id)}`;
    oebps.file(
      'toc.ncx',
      `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${bookUid}"/>
    <meta name="dtb:depth" content="1"/>
  </head>
  <docTitle><text>${esc(book.title)}</text></docTitle>
  <navMap>${navPoints.join('\n')}</navMap>
</ncx>`,
    );

    oebps.file(
      'content.opf',
      `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${esc(book.title)}</dc:title>
    <dc:creator>${esc(book.author || '未知作者')}</dc:creator>
    <dc:language>zh-CN</dc:language>
    <dc:identifier id="BookId">${bookUid}</dc:identifier>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-clickable-ncx"/>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine toc="ncx">
    ${spineItems.join('\n    ')}
  </spine>
</package>`.replace('application/x-clickable-ncx', 'application/x-dtbncx+xml'),
    );

    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  async function renderOpdsFeed(url) {
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const all = await reader.books();
    const filtered = all.filter(b => b.available !== false && (!q || b.title.toLowerCase().includes(q) || (b.author || '').toLowerCase().includes(q)));
    const updated = new Date().toISOString();
    const origin = url.origin;
    const entries = filtered.map(b => {
      const encodedId = encodeURIComponent(b.id);
      const summary = `${b.source || b.sourceType} · ${b.chapterCount || 1} 章${b.progress?.chapter ? ` · 已读至第 ${b.progress.chapter + 1} 章` : ''}`;
      return `  <entry>
    <id>urn:mokuji:book:${esc(b.id)}</id>
    <title>${esc(b.title)}</title>
    <author><name>${esc(b.author || '未署名')}</name></author>
    <updated>${esc(b.progress?.updatedAt || updated)}</updated>
    <summary>${esc(summary)}</summary>
    <link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="${esc(origin)}/opds/download/${encodedId}.epub" title="下载 EPUB（电纸书推荐）"/>
    <link rel="http://opds-spec.org/acquisition" type="text/plain; charset=utf-8" href="${esc(origin)}/opds/download/${encodedId}.txt" title="下载纯文本 TXT"/>
    <link rel="alternate" type="text/html" href="${esc(origin)}/eink/book?id=${encodedId}" title="在墨水屏浏览器中阅读"/>
  </entry>`;
    }).join('\n');

    return opdsResponse(`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>urn:mokuji:opds:root</id>
  <title>目次 Mokuji 个人书库</title>
  <updated>${esc(updated)}</updated>
  <author><name>Mokuji</name></author>
  <link rel="self" type="application/atom+xml;profile=opds-catalog;kind=acquisition" href="${esc(origin)}/opds"/>
  <link rel="start" type="application/atom+xml;profile=opds-catalog;kind=acquisition" href="${esc(origin)}/opds"/>
  <link rel="search" type="application/atom+xml" href="${esc(origin)}/opds?q={searchTerms}"/>
${entries}
</feed>`);
  }

  async function renderEinkHome(url) {
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const books = (await reader.books()).filter(b => b.available !== false && (!q || b.title.toLowerCase().includes(q) || (b.author || '').toLowerCase().includes(q)));
    const itemsHtml = books.length
      ? books.map(b => {
          const eid = encodeURIComponent(b.id);
          const chNum = (b.progress?.chapter || 0) + 1;
          return `<div class="book-item">
            <div class="book-title">${esc(b.title)}</div>
            <div class="book-meta">${esc(b.author || '未署名')} · ${esc(b.source || b.sourceType)} · 共 ${b.chapterCount || 1} 章 · 当前进度：第 ${chNum} 章</div>
            <div class="actions">
              <a class="btn btn-solid" href="/eink/read?id=${eid}&amp;n=${b.progress?.chapter || 0}">继续阅读（第 ${chNum} 章）</a>
              <a class="btn" href="/eink/book?id=${eid}">目录与详情</a>
              <a class="btn" href="/opds/download/${eid}.epub">下载 EPUB</a>
            </div>
          </div>`;
        }).join('\n')
      : '<div class="notice">没有找到匹配的书籍。请先在桌面端导入 TXT / EPUB 或从书源加书。</div>';

    return htmlResponse(einkShell('书库首页', `
      <form class="search-bar" method="GET" action="/eink">
        <input type="text" name="q" value="${esc(url.searchParams.get('q') || '')}" placeholder="搜索书名或作者..." />
        <button type="submit" class="btn-solid">搜索</button>
      </form>
      <div class="notice"><strong>电纸书接入提示：</strong>KOReader / 多看 / 静读天下可在 OPDS 网络书库中填入本机局域网地址 <code>${esc(url.origin)}/opds</code>，即可直接无线推书并下载 EPUB / TXT；Kindle 等可直接收藏本页阅读。</div>
      ${itemsHtml}
    `));
  }

  async function renderEinkBook(url) {
    const id = url.searchParams.get('id') || '';
    const page = Math.max(0, Number(url.searchParams.get('page')) || 0);
    const book = await reader.getBook(id);
    const details = await reader.getDetails(book);
    const pageSize = 80;
    const totalPages = Math.max(1, Math.ceil(details.chapters.length / pageSize));
    const safePage = Math.min(page, totalPages - 1);
    const slice = details.chapters.slice(safePage * pageSize, (safePage + 1) * pageSize);
    const eid = encodeURIComponent(book.id);

    const listHtml = slice.map(ch => {
      const label = ch.n === book.progress?.chapter ? '【当前进度】' : ch.available ? '' : '（未缓存/原站）';
      return `<li><a href="/eink/read?id=${eid}&amp;n=${ch.n}"><span>${esc(ch.title)}</span><span>${label}</span></a></li>`;
    }).join('\n');

    const pagerHtml = totalPages > 1 ? `<div class="pager">
      ${safePage > 0 ? `<a class="btn" href="/eink/book?id=${eid}&amp;page=${safePage - 1}">上一页目录</a>` : ''}
      <span>目录第 ${safePage + 1} / ${totalPages} 页</span>
      ${safePage + 1 < totalPages ? `<a class="btn" href="/eink/book?id=${eid}&amp;page=${safePage + 1}">下一页目录</a>` : ''}
    </div>` : '';

    return htmlResponse(einkShell(book.title, `
      <div class="book-item">
        <div class="book-title">${esc(book.title)}</div>
        <div class="book-meta">${esc(book.author || '未署名')} · ${esc(book.source || book.sourceType)} · 共 ${details.chapters.length} 章 · 上次读到第 ${(book.progress?.chapter || 0) + 1} 章</div>
        <div class="actions">
          <a class="btn btn-solid" href="/eink/read?id=${eid}&amp;n=${book.progress?.chapter || 0}">继续阅读</a>
          <a class="btn" href="/opds/download/${eid}.epub">导出 EPUB</a>
          <a class="btn" href="/opds/download/${eid}.txt">导出 TXT</a>
        </div>
      </div>
      ${pagerHtml}
      <ul class="ch-list">${listHtml}</ul>
      ${pagerHtml}
    `));
  }

  async function renderEinkChapter(url) {
    const id = url.searchParams.get('id') || '';
    const n = Math.max(0, Number(url.searchParams.get('n')) || 0);
    const fs = Math.min(28, Math.max(14, Number(url.searchParams.get('fs')) || 19));
    const savedNotice = url.searchParams.get('saved') === '1';
    const book = await reader.getBook(id);
    const chapter = await reader.getChapter(book, n);
    const total = chapter.chapterCount || book.chapterCount || 1;
    const eid = encodeURIComponent(book.id);

    const imgByPara = new Map();
    for (const grp of chapter.images || []) imgByPara.set(grp.paragraph, grp.items || []);

    const renderImages = pIdx => {
      const items = imgByPara.get(pIdx);
      if (!items?.length) return '';
      return items.map(it => {
        const src = it.asset && chapter.media?.[it.asset];
        return src ? `<img class="chapter-img" src="${src}" alt="${esc(it.alt || '插图')}"/>` : `<div class="notice">[插图：${esc(it.alt || '暂不可用')}]</div>`;
      }).join('\n');
    };

    let contentHtml = renderImages(0);
    chapter.paragraphs.forEach((p, idx) => {
      contentHtml += `<p>${esc(p)}</p>\n` + renderImages(idx + 1);
    });

    const toolbar = `<div class="reader-toolbar">
      <div class="actions">
        ${n > 0 ? `<a class="btn" href="/eink/read?id=${eid}&amp;n=${n - 1}&amp;fs=${fs}">上一章</a>` : '<span class="btn">已是第一章</span>'}
        <a class="btn" href="/eink/book?id=${eid}">目录</a>
        ${n + 1 < total ? `<a class="btn btn-solid" href="/eink/read?id=${eid}&amp;n=${n + 1}&amp;fs=${fs}">下一章</a>` : '<span class="btn">已至末章</span>'}
      </div>
      <div class="actions">
        <form method="POST" action="/eink/progress" style="display:inline">
          <input type="hidden" name="id" value="${esc(book.id)}" />
          <input type="hidden" name="chapter" value="${n}" />
          <input type="hidden" name="fs" value="${fs}" />
          <button type="submit" class="btn">记录本章为进度</button>
        </form>
        <a class="btn" href="/eink/read?id=${eid}&amp;n=${n}&amp;fs=${Math.max(14, fs - 2)}">A-</a>
        <a class="btn" href="/eink/read?id=${eid}&amp;n=${n}&amp;fs=${Math.min(28, fs + 2)}">A+</a>
      </div>
    </div>`;

    return htmlResponse(einkShell(`${chapter.title} - ${book.title}`, `
      ${savedNotice ? '<div class="notice"><strong>已保存阅读进度：</strong>已同步到本机与移动端书架（第 ' + (n + 1) + ' 章）。</div>' : ''}
      ${toolbar}
      <div class="book-meta">${esc(book.title)} · 第 ${n + 1} / ${total} 章</div>
      <h1 class="chapter-h1">${esc(chapter.title)}</h1>
      <div class="chapter-body" style="font-size:${fs}px">${contentHtml}</div>
      ${toolbar}
    `));
  }

  async function handle(request) {
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/opds') {
        return await renderOpdsFeed(url);
      }
      if (request.method === 'GET' && url.pathname.startsWith('/opds/download/')) {
        const tail = url.pathname.slice('/opds/download/'.length);
        const match = /^(.+)\.(epub|txt)$/i.exec(tail);
        if (!match) throw failure(404, '不支持的下载格式');
        const bookId = decodeURIComponent(match[1]);
        const ext = match[2].toLowerCase();
        const book = await reader.getBook(bookId);
        const buf = ext === 'epub' ? await buildEpubBuffer(book) : await buildTxtBuffer(book);
        const asciiFallback = `${safeFileBase(book.title).replace(/[^\x20-\x7e]+/g, 'book')}.${ext}`;
        const utf8Name = encodeURIComponent(`${safeFileBase(book.title)}.${ext}`);
        return new Response(buf, {
          status: 200,
          headers: {
            'Content-Type': ext === 'epub' ? 'application/epub+zip' : 'text/plain; charset=utf-8',
            'Content-Disposition': `attachment; filename="${asciiFallback}"; filename*=UTF-8''${utf8Name}`,
            'Content-Length': String(buf.length),
            'Cache-Control': 'no-store',
          },
        });
      }
      if (request.method === 'GET' && (url.pathname === '/eink' || url.pathname === '/eink/')) {
        return await renderEinkHome(url);
      }
      if (request.method === 'GET' && url.pathname === '/eink/book') {
        return await renderEinkBook(url);
      }
      if (request.method === 'GET' && url.pathname === '/eink/read') {
        return await renderEinkChapter(url);
      }
      if (request.method === 'POST' && url.pathname === '/eink/progress') {
        const raw = await request.text();
        const form = new URLSearchParams(raw);
        const id = form.get('id') || '';
        const chapter = Number(form.get('chapter')) || 0;
        const fs = Number(form.get('fs')) || 19;
        const book = await reader.getBook(id);
        await reader.saveProgress({ id: book.id, chapter, paragraph: 0, revision: book.progress.revision });
        return new Response(null, {
          status: 303,
          headers: { Location: `/eink/read?id=${encodeURIComponent(book.id)}&n=${chapter}&fs=${fs}&saved=1` },
        });
      }
      return null;
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      return htmlResponse(einkShell('提示', `<div class="notice"><strong>操作未完成：</strong>${esc(error?.message || '请稍后重试')}</div><a class="btn" href="/eink">返回书库首页</a>`), status);
    }
  }

  return { handle };
}
