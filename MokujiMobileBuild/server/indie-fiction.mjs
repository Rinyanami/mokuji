import { createHash } from 'node:crypto';
import html from './wikisource-html.cjs';
import catalog from './indie-catalog.mjs';

const source = '后室中文维基';
const origin = 'https://backrooms-wiki-cn.wikidot.com/';
const maxPageBytes = 1536 * 1024;
const entries = new Map(catalog.map(book => ['open:indie-backrooms-' + book.key, book]));
const ignoredElements = [
  'script', 'style', 'noscript', 'iframe', 'img', 'svg', 'pre', '.licensebox', '.code', '.code-block',
  '.hljs', '.page-rate-widget-box', '.rate-box-with-credit-button', '.creditRate', '.credit-back',
  '.modalbox', '.footnotes-footer', '.yui-nav', '.tab-title', '.authorbox', '.info-container',
  '.poi-banner', '.ganges-series-title', '.ei', '.creditButton', '.foldable-block-link', '.collapsible-block-link'
].join(',');
const paragraphElements = 'p,h1,h2,h3,h4,h5,h6,li,td,dt,dd';

function credit(book) {
  return {
    license: 'CC BY-SA ' + book.version,
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/' + book.version + '/',
    credits: book.author + ' 著 · 后室中文维基 · 目次按原作段落转为文字选读，省略配图、配乐和页面导航。'
  };
}

function publicBook(id, book) {
  return {
    id, title: book.title, originalTitle: book.title, author: book.author, edition: book.kind + ' · 后室',
    language: 'zh', source, sourceType: 'online', sourceUrl: origin + book.sections[0].slug,
    chapterCount: book.sections.length, available: true, ...credit(book),
    progress: { chapter: 0, paragraph: 0, revision: 0, updatedAt: null }
  };
}

export function listBooks() {
  return Array.from(entries, ([id, book]) => publicBook(id, book));
}

export function getBook(id) {
  const book = entries.get(id);
  if (!book) return null;
  return {
    book: publicBook(id, book),
    chapters: book.sections.map((part, i) => ({ n: i + 1, title: part.title, available: true }))
  };
}

async function readPage(url) {
  const response = await fetch(url, {
    redirect: 'error', signal: AbortSignal.timeout(12000),
    headers: { Accept: 'text/html', 'User-Agent': 'MokujiReader/1.0 (open literature reader)' }
  });
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > maxPageBytes) {
    await response.body?.cancel();
    throw new Error('Source page unavailable');
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const reader = response.body.getReader();
  let htmlText = '', bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxPageBytes) {
        await reader.cancel();
        throw new Error('Article exceeds size limit');
      }
      htmlText += decoder.decode(value, { stream: true });
    }
    return html.parse(htmlText + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

function verifyAttribution(doc, content, book, part) {
  const tags = doc.querySelectorAll('.page-tags a').map(e => e.text.trim());
  if (!tags.includes('原创') || !tags.includes('故事')) return false;
  const statement = content.querySelector('.licensebox blockquote')?.text.replace(/\s+/g, ' ');
  if (statement) {
    return statement.includes('作者 ' + book.author) && statement.includes('/' + part.slug)
      && statement.includes('CC BY-SA ' + book.version);
  }
  const license = doc.querySelectorAll('#license-area a').some(anchor =>
    anchor.getAttribute('href')?.replace(/^http:/, 'https:') === credit(book).licenseUrl);
  return book.key === 'operations' && license &&
    content.structuredText.split('\n').some(line => line.trim() === '作者：' + book.author);
}

function fingerprint(text) {
  return createHash('sha256').update(text).digest('hex').slice(0,20);
}

function narrative(content, part) {
  for (const element of content.querySelectorAll(ignoredElements)) element.remove();
  const paragraphs = content.querySelectorAll(paragraphElements)
    .filter(element => !element.querySelector(paragraphElements))
    .map(element => element.structuredText.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const marks = paragraphs.map(fingerprint);
  const from = marks.indexOf(part.start);
  const to = marks.indexOf(part.end, from);
  if (from < 0 || to < from) throw new Error('Article boundaries changed');
  return paragraphs.slice(from, to + 1);
}

export async function getChapter(id, n) {
  const book = entries.get(id);
  if (!book || !Number.isInteger(n) || n < 1 || n > book.sections.length) return null;
  const part = book.sections[n - 1], sourceUrl = origin + part.slug;
  try {
    const doc = await readPage(sourceUrl);
    const content = doc.querySelector('#page-content');
    if (!content || !verifyAttribution(doc, content, book, part)) throw new Error('Unverified article');
    const paragraphs = narrative(content, part);
    return {
      id, n, title: part.title, chapterCount: book.sections.length, paragraphs,
      source, sourceType: 'online', language: 'zh', sourceUrl, ...credit(book)
    };
  } catch (cause) {
    throw Object.assign(new Error('暂时无法核实或读取后室中文维基的这篇故事，可以稍后重试或打开原文。', { cause }),
      { status: 503, sourceUrl });
  }
}