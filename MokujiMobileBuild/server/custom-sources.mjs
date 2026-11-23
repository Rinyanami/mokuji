import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { load } = require('./epub-deps.cjs');

const REQUEST_TIMEOUT_MS = 12000;
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const failure = (status, message, extra = {}) => Object.assign(new Error(message), { status, extra });
const brief = (v, max = 240) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const hashId = value => createHash('sha256').update(String(value)).digest('hex').slice(0, 20);

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip === '::1' || ip === '::' || /^fe80:/i.test(ip) || /^fc/i.test(ip) || /^fd/i.test(ip)) return true;
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (isIP(v4) !== 4) return isIP(ip) !== 6;
  const [a, b] = v4.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

export async function assertSafePublicUrl(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { throw failure(400, '书源或章节网址格式无效'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw failure(400, '仅支持 http 或 https 书源地址');
  if (url.username || url.password) throw failure(400, '书源地址不能包含内嵌账号密码');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw failure(400, '安全限制：在线书源不允许访问本机或内网地址');
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw failure(400, '安全限制：在线书源不允许访问内网 IP');
    return url;
  }
  try {
    const resolved = await lookup(host, { all: true });
    if (!resolved.length || resolved.some(item => isPrivateIp(item.address))) {
      throw failure(400, '安全限制：目标域名解析到了内网地址');
    }
  } catch (error) {
    if (error?.status) throw error;
    throw failure(502, '无法解析书源域名：' + host);
  }
  return url;
}

let gb18030Table;
function getGb18030Table() {
  if (gb18030Table) return gb18030Table;
  const decoder = new TextDecoder('gb18030');
  const count = 126 * 190;
  const bytes = new Uint8Array(count * 3);
  for (let index = 0; index < count; index++) {
    bytes[index * 3] = 0x81 + Math.floor(index / 190);
    const trail = index % 190;
    bytes[index * 3 + 1] = trail + (trail < 63 ? 0x40 : 0x41);
  }
  const chars = decoder.decode(bytes).split('\0');
  gb18030Table = new Map();
  for (let index = 0; index < count; index++) {
    const ch = chars[index];
    if (ch.length === 1 && ch !== '\uFFFD' && !gb18030Table.has(ch)) {
      gb18030Table.set(ch, [bytes[index * 3], bytes[index * 3 + 1]]);
    }
  }
  return gb18030Table;
}

function encodeGb18030(term) {
  const table = getGb18030Table();
  const out = [];
  for (const ch of String(term || '')) {
    const code = ch.codePointAt(0);
    if (code < 0x80) {
      out.push(encodeURIComponent(ch));
      continue;
    }
    const pair = table.get(ch);
    if (pair) {
      out.push('%' + pair[0].toString(16).toUpperCase().padStart(2, '0'));
      out.push('%' + pair[1].toString(16).toUpperCase().padStart(2, '0'));
    } else {
      out.push(encodeURIComponent(ch));
    }
  }
  return out.join('');
}

function encodeSearchTerm(keyword, charset = '') {
  return /gb/i.test(charset) ? encodeGb18030(keyword) : encodeURIComponent(keyword);
}

function decodeHtmlBytes(bytes, contentType = '', hintCharset = '') {
  const ctMatch = /charset=([a-z0-9_-]+)/i.exec(contentType);
  let charset = (hintCharset || ctMatch?.[1] || '').toLowerCase();
  if (!charset) {
    const probe = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 2048))).toString('latin1');
    const metaMatch = /<meta[^>]+charset=["']?\s*([a-z0-9_-]+)/i.exec(probe);
    charset = (metaMatch?.[1] || 'utf-8').toLowerCase();
  }
  if (charset === 'gb2312' || charset === 'gbk') charset = 'gb18030';
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export async function fetchHtml(rawUrl, { charset = '', method = 'GET', body, referer, customHeaders = {} } = {}) {
  let current = await assertSafePublicUrl(rawUrl);
  for (let redirects = 0; redirects < 4; redirects++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers = {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      };
      for (const [k, v] of Object.entries(customHeaders || {})) {
        const lower = k.toLowerCase();
        if (['user-agent', 'cookie', 'referer', 'accept', 'x-requested-with'].includes(lower) && typeof v === 'string' && v.length < 2048) {
          headers[lower] = v;
        }
      }
      if (referer && !headers.referer) headers.referer = referer;
      if (body !== undefined) headers['content-type'] = 'application/x-www-form-urlencoded';
      const response = await fetch(current.toString(), {
        method,
        headers,
        body,
        redirect: 'manual',
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw failure(502, '书源跳转缺少目标地址');
        current = await assertSafePublicUrl(new URL(location, current).toString());
        continue;
      }
      if (!response.ok) throw failure(502, `书源请求失败（HTTP ${response.status}）`);
      const buf = Buffer.from(await response.arrayBuffer());
      if (buf.byteLength > MAX_HTML_BYTES) throw failure(502, '书源返回页面过大');
      return {
        url: current.toString(),
        text: decodeHtmlBytes(buf, response.headers.get('content-type') || '', charset),
      };
    } catch (error) {
      if (error?.status) throw error;
      if (controller.signal.aborted) throw failure(504, '书源连接超时，请稍后重试');
      throw failure(502, '无法连接书源：' + (error?.message || '网络错误'));
    } finally {
      clearTimeout(timer);
    }
  }
  throw failure(502, '书源重定向次数过多');
}

export function cleanParagraphsFromHtml(html) {
  const cleaned = String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|dd|dt|h[1-6]|tr)>/gi, '\n');
  const $ = load(`<div>${cleaned}</div>`);
  $('script,style,iframe,noscript,ins').remove();
  return $('div')
    .text()
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line && !/^(?:请记住本书首发域名|手机站|天才一秒记住|最新章节|顶点小说|笔趣阁|加入书签|投推荐票|上一章|下一章|返回目录)/.test(line));
}

function splitRegexRule(raw) {
  const parts = String(raw || '').split('##');
  const selector = parts[0].trim();
  const pattern = parts[1];
  const replacement = parts[2] ?? '';
  return { selector, pattern, replacement };
}

function applyRegexCleanup(value, pattern, replacement = '') {
  if (!value || !pattern) return value;
  try {
    return value.replace(new RegExp(pattern, 'g'), replacement).trim();
  } catch {
    return value;
  }
}

function resolveLegadoToken($, root, token) {
  let current = root;
  const segments = token.split('@').filter(s => s !== undefined);
  let attrName = '';
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i].trim();
    if (!seg) continue;
    if (i === segments.length - 1 && /^(text|html|textNodes|href|src|content|value|title|data-[a-z0-9_-]+)$/i.test(seg) && i > 0) {
      attrName = seg;
      break;
    }
    if (i === 0 && segments.length === 1 && /^(href|src|content)$/i.test(seg)) {
      attrName = seg;
      break;
    }
    const cls = /^class\.([^.]+)(?:\.(-?\d+))?$/i.exec(seg);
    const idm = /^id\.([^.]+)(?:\.(-?\d+))?$/i.exec(seg);
    const tag = /^tag\.([^.]+)(?:\.(-?\d+))?$/i.exec(seg);
    let css = seg;
    let idx = null;
    if (cls) { css = '.' + cls[1].trim().replace(/\s+/g, '.'); idx = cls[2] !== undefined ? Number(cls[2]) : null; }
    else if (idm) { css = '#' + idm[1]; idx = idm[2] !== undefined ? Number(idm[2]) : null; }
    else if (tag) { css = tag[1]; idx = tag[2] !== undefined ? Number(tag[2]) : null; }
    else {
      const bareIdx = /^(.*)\.(-?\d+)$/.exec(seg);
      if (bareIdx && !/:\S+$/.test(bareIdx[1])) {
        css = bareIdx[1].trim();
        idx = Number(bareIdx[2]);
      }
    }
    const found = css ? current.find(css) : current;
    if (!found.length) return { nodes: $(), attrName };
    current = idx !== null ? found.eq(idx) : found;
  }
  return { nodes: current, attrName };
}

function selectElements($, root, expr) {
  if (!expr) return $();
  for (const branch of String(expr).split('||')) {
    const { selector } = splitRegexRule(branch);
    if (!selector) continue;
    const { nodes } = resolveLegadoToken($, root, selector);
    if (nodes.length) return nodes;
  }
  return $();
}

function selectText($, root, expr) {
  if (!expr) return '';
  for (const branch of String(expr).split('||')) {
    const { selector, pattern, replacement } = splitRegexRule(branch);
    if (!selector) continue;
    const isAttr = /^(.*)@([a-zA-Z0-9_-]+)$/.exec(selector);
    let raw = '';
    if (selector.includes('.') && /^(class|id|tag)\./.test(selector) || (isAttr && isAttr[2] === 'textNodes')) {
      const { nodes, attrName } = resolveLegadoToken($, root, selector);
      const first = nodes.first();
      if (first.length) {
        if (attrName === 'html') raw = first.html() || '';
        else if (attrName === 'textNodes') raw = first.contents().filter((_, n) => n.type === 'text').text();
        else if (attrName && attrName !== 'text') raw = first.attr(attrName) || '';
        else raw = first.text();
      }
    } else {
      const el = isAttr ? (isAttr[1].trim() ? root.find(isAttr[1].trim()).first() : root) : root.find(selector).first();
      if (el.length) raw = isAttr ? (isAttr[2] === 'text' ? el.text() : isAttr[2] === 'html' ? (el.html() || '') : el.attr(isAttr[2])) : el.text();
    }
    const out = brief(applyRegexCleanup(raw, pattern, replacement), 500);
    if (out) return out;
  }
  return '';
}

function selectHref($, root, expr, baseUrl) {
  if (!expr) return '';
  for (const branch of String(expr).split('||')) {
    const { selector, pattern, replacement } = splitRegexRule(branch);
    if (!selector) continue;
    let raw = '';
    if (/^(class|id|tag)\./.test(selector)) {
      const { nodes, attrName } = resolveLegadoToken($, root, selector);
      const first = nodes.first();
      if (first.length) raw = first.attr(attrName || 'href') || first.attr('href') || '';
    } else {
      const isAttr = /^(.*?)@([a-zA-Z0-9_-]+)$/.exec(selector);
      const sel = isAttr ? isAttr[1].trim() : selector;
      const attr = isAttr ? isAttr[2] : 'href';
      const el = sel ? root.find(sel).first() : root;
      raw = el.attr(attr) || el.attr('href') || '';
    }
    raw = applyRegexCleanup(raw, pattern, replacement);
    if (raw && !raw.startsWith('javascript:')) {
      try { return new URL(raw, baseUrl).toString(); } catch {}
    }
  }
  return '';
}

function parseHeadersField(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return {};
}

function normalizeRule(input) {
  if (!input || typeof input !== 'object') throw failure(400, '书源规则必须是 JSON 对象');
  // Support both Mokuji native fields and Legado-compatible field names.
  const searchRule = input.ruleSearch || {};
  const tocRule = input.ruleToc || {};
  const contentRule = input.ruleContent || {};
  const infoRule = input.ruleBookInfo || {};

  const name = brief(input.name || input.bookSourceName, 80);
  const baseUrl = String(input.baseUrl || input.bookSourceUrl || '').trim().replace(/\/+$/, '');
  if (!name) throw failure(400, '请填写书源名称');
  if (!/^https?:\/\//i.test(baseUrl)) throw failure(400, '书源站网址必须以 http:// 或 https:// 开头');

  const rawSearchUrl = String(input.searchUrl || '').trim();
  const headerObj = parseHeadersField(input.headers || input.header);
  const rule = {
    searchUrl: rawSearchUrl,
    method: String(input.method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET',
    charset: String(input.charset || '').toLowerCase(),
    headers: headerObj,
    searchList: String(input.searchList || searchRule.bookList || '').trim(),
    searchTitle: String(input.searchTitle || searchRule.name || 'a').trim(),
    searchAuthor: String(input.searchAuthor || searchRule.author || '').trim(),
    searchBookUrl: String(input.searchBookUrl || searchRule.bookUrl || 'a@href').trim(),
    searchIntro: String(input.searchIntro || searchRule.intro || '').trim(),
    bookTitle: String(input.bookTitle || infoRule.name || 'h1||meta[property="og:novel:book_name"]@content').trim(),
    bookAuthor: String(input.bookAuthor || infoRule.author || 'meta[property="og:novel:author"]@content').trim(),
    bookIntro: String(input.bookIntro || infoRule.intro || '#intro||.intro||meta[property="og:description"]@content').trim(),
    tocUrlSelector: String(input.tocUrlSelector || infoRule.tocUrl || '').trim(),
    catalogList: String(input.catalogList || tocRule.chapterList || '#list dd a, .listmain dd a, ul.chapter li a').trim(),
    catalogTitle: String(input.catalogTitle || tocRule.chapterName || '').trim(),
    catalogUrl: String(input.catalogUrl || tocRule.chapterUrl || '@href').trim(),
    contentSelector: String(input.contentSelector || contentRule.content || '#content||.content||#chaptercontent').trim(),
    contentExclude: String(input.contentExclude || '.ads, .ad, script, style, .bottem, .bottem2, .readinline').trim(),
    nextPageSelector: String(input.nextPageSelector || contentRule.nextContentUrl || '').trim(),
  };
  if (!rule.searchUrl) throw failure(400, '请填写搜索地址模板（包含 {{key}}）');
  if (!rule.searchList || !rule.catalogList || !rule.contentSelector) {
    throw failure(400, '请填写搜索列表、目录列表和正文选择器');
  }
  const id = brief(input.id, 64).replace(/[^a-zA-Z0-9_-]/g, '') || ('rule_' + hashId(baseUrl + ':' + name));
  return { id, name, baseUrl, enabled: input.enabled !== false, kind: 'rule', rule };
}

const BUILTIN_SOURCES = [
  {
    id: 'jjwxc',
    name: '晋江文学城（公开章节）',
    baseUrl: 'https://www.jjwxc.net',
    kind: 'builtin',
    category: '网文',
    enabled: true,
    description: '言情、纯爱、悬疑、仙侠原创文学库，自动 GB18030 搜索与免费章节拉取',
  },
  {
    id: 'sfacg',
    name: 'SF 轻小说（公开章节）',
    baseUrl: 'https://book.sfacg.com',
    kind: 'builtin',
    category: '轻小说',
    unit: '章',
    enabled: true,
    description: '国内轻小说、幻想、二次元题材作品库，公开免费章节即点即读',
  },
  {
    id: 'esjzone',
    name: 'ESJ Zone 轻小说（中日译制）',
    baseUrl: 'https://www.esjzone.cc',
    kind: 'builtin',
    category: '轻小说',
    unit: '章',
    enabled: true,
    description: '热门日系与原创轻小说中文译制社区，支持标签/书名检索与免费章节直读',
  },
  {
    id: 'syosetu',
    name: '成为小说家吧（日轻原站直连）',
    baseUrl: 'https://ncode.syosetu.com',
    kind: 'builtin',
    category: '轻小说',
    unit: '章',
    enabled: true,
    description: '日本最大轻小说连载原站（小説家になろう）官方 API 直连，支持中日关键词检索与全本连载阅读',
  },
  {
    id: 'mangadex',
    name: 'MangaDex（开源中文漫画）',
    baseUrl: 'https://mangadex.org',
    kind: 'builtin',
    category: '漫画',
    unit: '话',
    enabled: true,
    description: '开放漫画社区与中文译制话库，自动拉取话数目录与漫画页预览',
  },
  {
    id: 'zongheng',
    name: '纵横中文网（公开章节）',
    baseUrl: 'https://www.zongheng.com',
    kind: 'builtin',
    category: '网文',
    enabled: true,
    description: '原创男频女频网文，搜索直达目录，公开章节即时缓存',
  },
  {
    id: '17k',
    name: '17K 小说网（公开章节）',
    baseUrl: 'https://www.17k.com',
    kind: 'builtin',
    category: '网文',
    enabled: true,
    description: '原创玄幻、都市、仙侠小说，公开免费章节可直接阅读与缓存',
  },
  {
    id: 'wikisource',
    name: '中文维基文库（整本目录）',
    baseUrl: 'https://zh.wikisource.org',
    kind: 'builtin',
    category: '文学',
    enabled: true,
    description: '全球公有领域古典名著、历史典籍与文学全集，自动解析全本章节',
  },
];

export const RULE_TEMPLATES = [
  {
    label: '笔趣阁经典桌面模板（#list dd a / #content）',
    rule: {
      name: '示例笔趣阁站（请替换域名）',
      baseUrl: 'https://www.example-biquge.com',
      searchUrl: 'https://www.example-biquge.com/search.php?q={{key}}',
      charset: 'utf-8',
      searchList: '.result-list .result-item||table.grid tr:not(:first-child)||#nr',
      searchTitle: '.result-game-item-title-link||td:first-child a||a',
      searchAuthor: '.result-game-item-info-tag:first-child span:last-child||td:nth-child(3)',
      searchBookUrl: '.result-game-item-title-link@href||td:first-child a@href||a@href',
      catalogList: '#list dd a||.listmain dd a',
      contentSelector: '#content||#chaptercontent',
      contentExclude: 'script, style, .readinline, .bottem, .ads',
    },
  },
  {
    label: '手机端小说站 GBK 模板（.bookbox / #chaptercontent）',
    rule: {
      name: '移动端小说站（请替换域名）',
      baseUrl: 'https://m.example-novel.com',
      searchUrl: 'https://m.example-novel.com/s.php?q={{key}}',
      charset: 'gbk',
      searchList: '.bookbox||.hot_sale',
      searchTitle: '.bookname a||.title',
      searchAuthor: '.author##作者：##',
      searchBookUrl: 'a@href',
      catalogList: '.directoryArea p a||#chapterlist p a',
      contentSelector: '#chaptercontent||#nr1',
      contentExclude: 'script, style, .chapter_err, p:contains("记住域名")',
    },
  },
  {
    label: '杰奇 JQ 文学站 POST 搜索模板',
    rule: {
      name: '通用 JQ 站点（请替换域名）',
      baseUrl: 'https://www.example-jq.com',
      method: 'POST',
      searchUrl: 'https://www.example-jq.com/modules/article/search.php,searchkey={{key}}',
      charset: 'gbk',
      searchList: 'table.grid tr:not(:first-child)',
      searchTitle: 'td:nth-child(1) a',
      searchAuthor: 'td:nth-child(3)',
      searchBookUrl: 'td:nth-child(1) a@href',
      catalogList: '#list dd a||.chapterlist dd a',
      contentSelector: '#content||.content',
      contentExclude: 'script, style, .ads',
    },
  },
  {
    label: '独立目录页双跳模板（详情页带「全部章节」）',
    rule: {
      name: '双跳目录站点（请替换域名）',
      baseUrl: 'https://www.example-toc.com',
      searchUrl: 'https://www.example-toc.com/search?keyword={{key}}',
      charset: 'utf-8',
      searchList: '.search-list li',
      searchTitle: 'h3 a',
      searchAuthor: '.author',
      searchBookUrl: 'h3 a@href',
      tocUrlSelector: 'a:contains("全部章节")@href||a:contains("目录")@href',
      catalogList: 'ul.chapter-list li a',
      contentSelector: '.chapter-content||#content',
      contentExclude: 'script, style, .author-say',
    },
  },
  {
    label: '哔哩轻小说 / 铅笔轻小说通用模板（轻小说双跳目录）',
    rule: {
      name: '示例轻小说站（请替换域名）',
      baseUrl: 'https://www.example-linovel.com',
      searchUrl: 'https://www.example-linovel.com/search.html?searchkey={{key}}',
      charset: 'utf-8',
      searchList: '.book-ol .book-li||.search-result-list .book-item||ul.list li',
      searchTitle: '.book-title||h4 a||.bookname a',
      searchAuthor: '.book-author||.author',
      searchBookUrl: 'a.book-layout@href||h4 a@href||a@href',
      tocUrlSelector: 'a:contains("小说目录")@href||a:contains("开始阅读")@href||a:contains("章节目录")@href',
      catalogList: '#volumes .chapter-li a||.chapter-list li a||ul.catalog-list li a',
      contentSelector: '#acontent||#TextContent||.read-content||#content',
      contentExclude: 'script, style, .ads, .google-auto-placed',
    },
  },
  {
    label: '轻小说文库 Wenku8 规则模板（GBK 轻小说站）',
    rule: {
      name: '示例文库轻小说站（请替换域名）',
      baseUrl: 'https://www.example-wenku.net',
      searchUrl: 'https://www.example-wenku.net/modules/article/search.php?searchtype=articlename&searchkey={{key}}',
      charset: 'gbk',
      searchList: 'table.grid tr:not(:first-child)||#content table td div',
      searchTitle: 'b a||td:first-child a',
      searchAuthor: 'p:contains("作者")||td:nth-child(3)',
      searchBookUrl: 'b a@href||td:first-child a@href',
      tocUrlSelector: 'a:contains("小说目录")@href',
      catalogList: 'table.css td.ccss a||#list dd a',
      contentSelector: '#content||#contentmain',
      contentExclude: 'script, style, #contentdp, ul#contentdp',
    },
  },
];

export function createCustomSources({ db }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reader_custom_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      kind TEXT NOT NULL DEFAULT 'rule',
      rule_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reader_custom_books (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      remote_id TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      intro TEXT NOT NULL DEFAULT '',
      detail_url TEXT NOT NULL,
      chapter_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reader_custom_chapters (
      book_id TEXT NOT NULL REFERENCES reader_custom_books(id) ON DELETE CASCADE,
      n INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      paragraphs TEXT,
      images_json TEXT,
      locked INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (book_id, n)
    );
  `);
  if (!db.prepare('PRAGMA table_info(reader_custom_chapters)').all().some(c => c.name === 'images_json')) {
    db.exec('ALTER TABLE reader_custom_chapters ADD COLUMN images_json TEXT');
  }
  if (!db.prepare('PRAGMA table_info(reader_custom_books)').all().some(c => c.name === 'category')) {
    db.exec("ALTER TABLE reader_custom_books ADD COLUMN category TEXT NOT NULL DEFAULT '网文'");
  }

  const listRuleRows = db.prepare('SELECT id, name, base_url AS baseUrl, enabled, kind, rule_json AS ruleJson, created_at AS createdAt FROM reader_custom_sources ORDER BY created_at DESC');
  const getRuleRow = db.prepare('SELECT id, name, base_url AS baseUrl, enabled, kind, rule_json AS ruleJson FROM reader_custom_sources WHERE id=?');
  const upsertRule = db.prepare('INSERT INTO reader_custom_sources(id, name, base_url, enabled, kind, rule_json, created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, base_url=excluded.base_url, enabled=excluded.enabled, rule_json=excluded.rule_json');
  const deleteRuleStmt = db.prepare('DELETE FROM reader_custom_sources WHERE id=?');

  const upsertBook = db.prepare("INSERT INTO reader_custom_books(id, source_id, remote_id, title, author, intro, detail_url, chapter_count, updated_at, category) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, author=excluded.author, intro=excluded.intro, detail_url=excluded.detail_url, chapter_count=excluded.chapter_count, updated_at=excluded.updated_at, category=excluded.category");
  const listBookRows = db.prepare('SELECT b.*, (SELECT COUNT(*) FROM reader_custom_chapters c WHERE c.book_id=b.id AND (c.paragraphs IS NOT NULL OR c.images_json IS NOT NULL)) AS cachedChapterCount FROM reader_custom_books b ORDER BY b.updated_at DESC');
  const getBookRow = db.prepare('SELECT b.*, (SELECT COUNT(*) FROM reader_custom_chapters c WHERE c.book_id=b.id AND (c.paragraphs IS NOT NULL OR c.images_json IS NOT NULL)) AS cachedChapterCount FROM reader_custom_books b WHERE b.id=?');
  const deleteBookStmt = db.prepare('DELETE FROM reader_custom_books WHERE id=?');
  const listChaptersStmt = db.prepare('SELECT n, title, url, locked, (paragraphs IS NOT NULL OR images_json IS NOT NULL) AS cached FROM reader_custom_chapters WHERE book_id=? ORDER BY n');
  const getChapterStmt = db.prepare('SELECT n, title, url, paragraphs, images_json AS imagesJson, locked FROM reader_custom_chapters WHERE book_id=? AND n=?');
  const insertChapterStmt = db.prepare('INSERT OR REPLACE INTO reader_custom_chapters(book_id, n, title, url, paragraphs, images_json, locked) VALUES(?,?,?,?,?,?,?)');
  const updateChapterBodyStmt = db.prepare('UPDATE reader_custom_chapters SET paragraphs=?, images_json=? WHERE book_id=? AND n=?');

  function getDisabledBuiltins() {
    try {
      const row = db.prepare("SELECT rule_json FROM reader_custom_sources WHERE id='__builtin_prefs__'").get();
      return new Set(JSON.parse(row?.rule_json || '[]'));
    } catch { return new Set(); }
  }

  function setBuiltinEnabled(id, enabled) {
    const disabled = getDisabledBuiltins();
    if (enabled) disabled.delete(id);
    else disabled.add(id);
    upsertRule.run('__builtin_prefs__', '__builtin_prefs__', '', 1, 'prefs', JSON.stringify([...disabled]), new Date().toISOString());
  }

  function listSources() {
    const disabled = getDisabledBuiltins();
    const builtins = BUILTIN_SOURCES.map(item => ({ ...item, enabled: !disabled.has(item.id) }));
    const custom = listRuleRows.all()
      .filter(r => r.kind === 'rule')
      .map(r => ({
        id: r.id,
        name: r.name,
        baseUrl: r.baseUrl,
        enabled: !!r.enabled,
        kind: 'rule',
        description: '自定义规则书源',
        rule: JSON.parse(r.ruleJson),
      }));
    return { sources: [...builtins, ...custom], templates: RULE_TEMPLATES };
  }

  function saveSource(input) {
    if (input?.builtinId && BUILTIN_SOURCES.some(b => b.id === input.builtinId)) {
      setBuiltinEnabled(input.builtinId, !!input.enabled);
      return listSources();
    }
    const normalized = normalizeRule(input);
    upsertRule.run(normalized.id, normalized.name, normalized.baseUrl, normalized.enabled ? 1 : 0, 'rule', JSON.stringify(normalized.rule), new Date().toISOString());
    return { source: normalized, ...listSources() };
  }

  function deleteSource(id) {
    deleteRuleStmt.run(String(id || ''));
    return listSources();
  }

  async function searchBuiltin(sourceId, q) {
    const keyword = brief(q, 120);
    if (!keyword) return [];
    if (sourceId === '17k') {
      const { text } = await fetchHtml('https://search.17k.com/search.xhtml?c.st=0&c.q=' + encodeURIComponent(keyword) + '&page=1');
      const $ = load(text);
      const items = [];
      $('dl dt a[href*="/book/"]').each((_, el) => {
        const a = $(el);
        const remoteId = a.attr('href')?.match(/\/book\/(\d+)\.html/)?.[1];
        if (!remoteId) return;
        const row = a.closest('dl');
        items.push({
          sourceId: '17k',
          sourceName: '17K 小说网',
          remoteId,
          title: brief(a.text(), 120),
          author: brief(row.find('dd .bq .ls a').first().text(), 80),
          intro: brief(row.find('dd li p a[href*="/list/"]').first().text(), 160),
          detailUrl: 'https://www.17k.com/book/' + remoteId + '.html',
        });
      });
      return items.slice(0, 20);
    }
    if (sourceId === 'mangadex') {
      const api = 'https://api.mangadex.org/manga?' + new URLSearchParams({
        title: keyword,
        limit: '20',
        'availableTranslatedLanguage[]': 'zh',
        'includes[]': 'author',
      });
      // Request both zh and zh-hk
      const url = api + '&availableTranslatedLanguage[]=zh-hk';
      const { text } = await fetchHtml(url, { customHeaders: { 'user-agent': 'MokujiReader/1.0', accept: 'application/json' } });
      const res = JSON.parse(text);
      return (res?.data || []).map(m => {
        const attr = m.attributes || {};
        const titles = attr.title || {};
        const alts = Array.isArray(attr.altTitles) ? attr.altTitles : [];
        const zhAlt = alts.find(a => a?.zh)?.zh || alts.find(a => a?.['zh-hk'])?.['zh-hk'];
        const title = titles['zh'] || titles['zh-hk'] || zhAlt || titles['en'] || Object.values(titles)[0] || '未命名漫画';
        const authorRel = (m.relationships || []).find(r => r.type === 'author');
        const desc = attr.description?.['zh'] || attr.description?.['zh-hk'] || attr.description?.['en'] || '';
        return {
          sourceId: 'mangadex',
          sourceName: 'MangaDex 漫画',
          category: '漫画',
          remoteId: m.id,
          title: brief(title, 120),
          author: brief(authorRel?.attributes?.name || '', 80),
          intro: brief(desc, 160),
          detailUrl: `https://mangadex.org/title/${m.id}`,
        };
      });
    }
    if (sourceId === 'zongheng') {
      const url = 'https://search.zongheng.com/search/book?keyword=' + encodeURIComponent(keyword) + '&pageNo=1&pageNum=20&isFromHuayu=0';
      const { text } = await fetchHtml(url);
      const res = JSON.parse(text);
      const list = res?.data?.datas?.list || [];
      return list.filter(b => b.bookId).slice(0, 20).map(b => ({
        sourceId: 'zongheng',
        sourceName: '纵横中文网',
        remoteId: String(b.bookId),
        title: brief(String(b.name || b.bookName || '').replace(/<[^>]+>/g, ''), 120),
        author: brief(b.authorName, 80),
        intro: brief(String(b.description || b.bookIntro || '').replace(/<[^>]+>/g, ''), 160),
        detailUrl: 'https://www.zongheng.com/detail/' + b.bookId,
      }));
    }
    if (sourceId === 'jjwxc') {
      const url = 'https://www.jjwxc.net/search.php?kw=' + encodeGb18030(keyword) + '&t=1';
      const { text } = await fetchHtml(url, { charset: 'gb18030', referer: 'https://www.jjwxc.net/' });
      const $ = load(text);
      const seen = new Set();
      const items = [];
      $('#search_result a[href*="onebook.php?novelid="]').each((_, el) => {
        const a = $(el);
        const remoteId = a.attr('href')?.match(/novelid=(\d+)/)?.[1];
        const title = brief(a.text(), 120);
        if (!remoteId || !title || seen.has(remoteId)) return;
        seen.add(remoteId);
        const box = a.closest('div, tr, li');
        const author = brief(box.find('a[href*="oneauthor.php"]').first().text(), 80);
        const intro = brief(box.find('.intro, span').text(), 160);
        items.push({
          sourceId: 'jjwxc',
          sourceName: '晋江文学城',
          category: '网文',
          remoteId,
          title,
          author,
          intro,
          detailUrl: 'https://www.jjwxc.net/onebook.php?novelid=' + remoteId,
        });
      });
      return items.slice(0, 20);
    }
    if (sourceId === 'mangadex') {
      const api = 'https://api.mangadex.org/manga?' + new URLSearchParams({
        title: keyword,
        limit: '20',
        'availableTranslatedLanguage[]': 'zh',
        'includes[]': 'author',
      });
      // Request both zh and zh-hk
      const url = api + '&availableTranslatedLanguage[]=zh-hk';
      const { text } = await fetchHtml(url, { customHeaders: { 'user-agent': 'MokujiReader/1.0', accept: 'application/json' } });
      const res = JSON.parse(text);
      return (res?.data || []).map(m => {
        const attr = m.attributes || {};
        const titles = attr.title || {};
        const alts = Array.isArray(attr.altTitles) ? attr.altTitles : [];
        const zhAlt = alts.find(a => a?.zh)?.zh || alts.find(a => a?.['zh-hk'])?.['zh-hk'];
        const title = titles['zh'] || titles['zh-hk'] || zhAlt || titles['en'] || Object.values(titles)[0] || '未命名漫画';
        const authorRel = (m.relationships || []).find(r => r.type === 'author');
        const desc = attr.description?.['zh'] || attr.description?.['zh-hk'] || attr.description?.['en'] || '';
        return {
          sourceId: 'mangadex',
          sourceName: 'MangaDex 漫画',
          category: '漫画',
          remoteId: m.id,
          title: brief(title, 120),
          author: brief(authorRel?.attributes?.name || '', 80),
          intro: brief(desc, 160),
          detailUrl: `https://mangadex.org/title/${m.id}`,
        };
      });
    }
    if (sourceId === 'sfacg') {
      const url = 'https://s.sfacg.com/?Key=' + encodeURIComponent(keyword) + '&S=1&SS=0';
      const { text } = await fetchHtml(url, { referer: 'https://book.sfacg.com/' });
      const $ = load(text);
      const seen = new Set();
      const items = [];
      $('a[href*="/Novel/"]').each((_, el) => {
        const a = $(el);
        const remoteId = a.attr('href')?.match(/\/Novel\/(\d+)\/?/i)?.[1];
        const title = brief(a.text(), 120);
        if (!remoteId || !title || seen.has(remoteId) || title === '立即阅读' || title === '点击阅读') return;
        seen.add(remoteId);
        const row = a.closest('ul, div, tr');
        items.push({
          sourceId: 'sfacg',
          sourceName: 'SF 轻小说',
          category: '轻小说',
          remoteId,
          title,
          author: brief(row.find('a[href*="AuthorInfo"], li:nth-child(2)').first().text(), 80),
          intro: brief(row.find('.font_gray, li:last-child').first().text(), 160),
          detailUrl: `https://book.sfacg.com/Novel/${remoteId}/`,
        });
      });
      return items.slice(0, 20);
    }
    if (sourceId === 'esjzone') {
      const url = `https://www.esjzone.cc/tags/${encodeURIComponent(keyword)}/`;
      const { text } = await fetchHtml(url, { referer: 'https://www.esjzone.cc/' });
      const $ = load(text);
      const seen = new Set();
      const items = [];
      $('.card-title a[href*="/detail/"], a[href*="/detail/"]').each((_, el) => {
        const a = $(el);
        const href = a.attr('href') || '';
        const remoteId = href.match(/\/detail\/(\d+)\.html/i)?.[1];
        const title = brief(a.text(), 120);
        if (!remoteId || !title || seen.has(remoteId)) return;
        seen.add(remoteId);
        const card = a.closest('.card, .col-lg-3, .col-md-4, div');
        items.push({
          sourceId: 'esjzone',
          sourceName: 'ESJ 轻小说',
          category: '轻小说',
          remoteId,
          title,
          author: brief(card.find('.card-author, a[href*="/tags/"]').not(a).first().text(), 80),
          intro: brief(card.find('.card-ep, .card-text').first().text(), 160),
          detailUrl: `https://www.esjzone.cc/detail/${remoteId}.html`,
        });
      });
      return items.slice(0, 20);
    }
    if (sourceId === 'syosetu') {
      const api = 'https://api.syosetu.com/novelapi/api/?' + new URLSearchParams({
        out: 'json',
        lim: '20',
        word: keyword,
      });
      const { text } = await fetchHtml(api, { customHeaders: { 'user-agent': 'MokujiReader/1.0', accept: 'application/json' } });
      const arr = JSON.parse(text);
      if (!Array.isArray(arr)) return [];
      return arr.slice(1).filter(row => row?.ncode).map(row => {
        const ncode = String(row.ncode).toLowerCase();
        return {
          sourceId: 'syosetu',
          sourceName: '成为小说家吧',
          category: '轻小说',
          remoteId: ncode,
          title: brief(row.title || ncode, 120),
          author: brief(row.writer || '', 80),
          intro: brief(row.story || '', 160),
          detailUrl: `https://ncode.syosetu.com/${ncode}/`,
        };
      });
    }
    if (sourceId === 'mangadex') {
      const api = 'https://api.mangadex.org/manga?' + new URLSearchParams({
        title: keyword,
        limit: '20',
        'availableTranslatedLanguage[]': 'zh',
        'includes[]': 'author',
      });
      // Request both zh and zh-hk
      const url = api + '&availableTranslatedLanguage[]=zh-hk';
      const { text } = await fetchHtml(url, { customHeaders: { 'user-agent': 'MokujiReader/1.0', accept: 'application/json' } });
      const res = JSON.parse(text);
      return (res?.data || []).map(m => {
        const attr = m.attributes || {};
        const titles = attr.title || {};
        const alts = Array.isArray(attr.altTitles) ? attr.altTitles : [];
        const zhAlt = alts.find(a => a?.zh)?.zh || alts.find(a => a?.['zh-hk'])?.['zh-hk'];
        const title = titles['zh'] || titles['zh-hk'] || zhAlt || titles['en'] || Object.values(titles)[0] || '未命名漫画';
        const authorRel = (m.relationships || []).find(r => r.type === 'author');
        const desc = attr.description?.['zh'] || attr.description?.['zh-hk'] || attr.description?.['en'] || '';
        return {
          sourceId: 'mangadex',
          sourceName: 'MangaDex 漫画',
          category: '漫画',
          remoteId: m.id,
          title: brief(title, 120),
          author: brief(authorRel?.attributes?.name || '', 80),
          intro: brief(desc, 160),
          detailUrl: `https://mangadex.org/title/${m.id}`,
        };
      });
    }
    if (sourceId === 'wikisource') {
      const url = 'https://zh.wikisource.org/w/api.php?' + new URLSearchParams({
        action: 'query', format: 'json', formatversion: '2', list: 'search', srsearch: keyword, srnamespace: '0', srlimit: '20',
      });
      const { text } = await fetchHtml(url);
      const res = JSON.parse(text);
      const seen = new Set();
      const out = [];
      for (const item of res?.query?.search || []) {
        const title = String(item.title || '').split('/')[0];
        if (!title || seen.has(title)) continue;
        seen.add(title);
        out.push({
          sourceId: 'wikisource',
          sourceName: '中文维基文库',
          category: '文学',
          remoteId: title,
          title,
          author: '',
          intro: brief(String(item.snippet || '').replace(/<[^>]+>/g, ''), 160),
          detailUrl: 'https://zh.wikisource.org/wiki/' + encodeURIComponent(title).replace(/%2F/g, '/'),
        });
      }
      return out;
    }
    return [];
  }

  async function searchWithRule(source, q) {
    const keyword = brief(q, 120);
    if (!keyword) return [];
    const rule = source.rule;
    const encoded = encodeSearchTerm(keyword, rule.charset);
    let url = rule.searchUrl.replaceAll('{{key}}', encoded);
    let body;
    if (rule.method === 'POST' && rule.searchUrl.includes(',')) {
      const idx = rule.searchUrl.indexOf(',');
      url = rule.searchUrl.slice(0, idx).trim();
      body = rule.searchUrl.slice(idx + 1).trim().replaceAll('{{key}}', encoded);
    }
    const page = await fetchHtml(url, { charset: rule.charset, method: rule.method, body, referer: source.baseUrl, customHeaders: rule.headers });
    const $ = load(page.text);
    const items = [];
    selectElements($, $.root(), rule.searchList).each((_, el) => {
      const node = $(el);
      const title = selectText($, node, rule.searchTitle);
      const detailUrl = selectHref($, node, rule.searchBookUrl, page.url);
      if (!title || !detailUrl) return;
      items.push({
        sourceId: source.id,
        sourceName: source.name,
        category: '网文',
        remoteId: detailUrl,
        title,
        author: selectText($, node, rule.searchAuthor),
        intro: selectText($, node, rule.searchIntro),
        detailUrl,
      });
    });
    return items.slice(0, 24);
  }

  async function search(query, sourceId = '') {
    const { sources } = listSources();
    const targets = sourceId
      ? sources.filter(s => s.id === sourceId)
      : sources.filter(s => s.enabled);
    const results = [];
    const errors = [];
    await Promise.all(targets.map(async src => {
      try {
        const hits = src.kind === 'builtin' ? await searchBuiltin(src.id, query) : await searchWithRule(src, query);
        results.push(...hits);
      } catch (err) {
        errors.push({ sourceId: src.id, sourceName: src.name, error: err?.message || '搜索失败' });
      }
    }));
    return { results, errors };
  }

  async function fetchCatalogBuiltin(sourceId, remoteId) {
    if (sourceId === '17k') {
      const detailUrl = `https://www.17k.com/book/${remoteId}.html`;
      const [bookPage, listPage] = await Promise.all([
        fetchHtml(detailUrl),
        fetchHtml(`https://www.17k.com/list/${remoteId}.html`),
      ]);
      const $b = load(bookPage.text);
      const og = $b('meta[property="og:title"]').attr('content') || '';
      const match = /^《(.+?)》(.+?)著-/.exec(og);
      const title = brief(match?.[1] || $b('h1').first().text(), 140) || '17K 作品';
      const author = brief(match?.[2] || '', 80);
      const intro = brief($b('meta[property="og:description"]').attr('content') || '', 300);
      const $l = load(listPage.text);
      const seen = new Set();
      const chapters = [];
      $l('a[href*="/chapter/"]').each((_, el) => {
        const a = $l(el);
        const m = (a.attr('href') || '').match(new RegExp(`^(?:https?:)?(?://www\\.17k\\.com)?/chapter/${remoteId}/(\\d+)\\.html$`));
        if (!m || seen.has(m[1])) return;
        seen.add(m[1]);
        const locked = a.find('.vip').length > 0 || a.hasClass('vip');
        chapters.push({
          title: brief(a.find('.ellipsis').text() || a.text(), 200) || `第 ${chapters.length + 1} 章`,
          url: `https://www.17k.com/chapter/${remoteId}/${m[1]}.html`,
          locked,
          paragraphs: null,
        });
      });
      return { title, author, intro, detailUrl, chapters };
    }

    if (sourceId === 'zongheng') {
      const detailUrl = `https://www.zongheng.com/detail/${remoteId}`;
      const [bookPage, listPage] = await Promise.all([
        fetchHtml(detailUrl),
        fetchHtml(`https://book.zongheng.com/showchapter/${remoteId}.html`),
      ]);
      const $b = load(bookPage.text);
      const title = brief($b('meta[name="og:novel:book_name"], meta[property="og:novel:book_name"]').attr('content') || $b('h1').first().text(), 140) || '纵横作品';
      const author = brief($b('meta[name="og:novel:author"], meta[property="og:novel:author"]').attr('content') || '', 80);
      const intro = brief($b('meta[name="og:description"], meta[property="og:description"]').attr('content') || '', 300);
      const $l = load(listPage.text);
      const seen = new Set();
      const chapters = [];
      $l('a[href*="/chapter/"]').each((_, el) => {
        const a = $l(el);
        const m = (a.attr('href') || '').match(new RegExp(`^(?:https?:)?(?://(?:book|read)\\.zongheng\\.com)?/chapter/${remoteId}/(\\d+)\\.html$`));
        if (!m || seen.has(m[1])) return;
        seen.add(m[1]);
        const locked = a.closest('li').hasClass('vip') || a.hasClass('vip');
        chapters.push({
          title: brief(a.text(), 200) || `第 ${chapters.length + 1} 章`,
          url: `https://read.zongheng.com/chapter/${remoteId}/${m[1]}.html`,
          locked,
          paragraphs: null,
        });
      });
      return { title, author, intro, detailUrl, chapters };
    }

    if (sourceId === 'mangadex') {
      const detailUrl = `https://mangadex.org/title/${remoteId}`;
      const [infoRes, feedRes] = await Promise.all([
        fetchHtml(`https://api.mangadex.org/manga/${remoteId}?includes[]=author`, { customHeaders: { 'user-agent': 'MokujiReader/1.0', accept: 'application/json' } }),
        fetchHtml(`https://api.mangadex.org/manga/${remoteId}/feed?translatedLanguage[]=zh&translatedLanguage[]=zh-hk&order[volume]=asc&order[chapter]=asc&limit=200`, { customHeaders: { 'user-agent': 'MokujiReader/1.0', accept: 'application/json' } }),
      ]);
      const info = JSON.parse(infoRes.text)?.data;
      const titles = info?.attributes?.title || {};
      const alts = Array.isArray(info?.attributes?.altTitles) ? info.attributes.altTitles : [];
      const zhAlt = alts.find(a => a?.zh)?.zh || alts.find(a => a?.['zh-hk'])?.['zh-hk'];
      const title = brief(titles['zh'] || titles['zh-hk'] || zhAlt || titles['en'] || Object.values(titles)[0] || 'MangaDex 漫画', 140);
      const authorRel = (info?.relationships || []).find(r => r.type === 'author');
      const author = brief(authorRel?.attributes?.name || '', 80);
      const intro = brief(info?.attributes?.description?.['zh'] || info?.attributes?.description?.['zh-hk'] || info?.attributes?.description?.['en'] || '', 300);
      const seen = new Set();
      const chapters = [];
      for (const ch of JSON.parse(feedRes.text)?.data || []) {
        const key = `${ch.attributes?.volume || ''}:${ch.attributes?.chapter || ch.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const chNum = ch.attributes?.chapter ? `第 ${ch.attributes.chapter} 话` : '';
        const volNum = ch.attributes?.volume ? `第 ${ch.attributes.volume} 卷 ` : '';
        const chTitle = brief(`${volNum}${chNum}${ch.attributes?.title ? ' · ' + ch.attributes.title : ''}`, 200) || `第 ${chapters.length + 1} 话`;
        chapters.push({
          title: chTitle,
          url: `https://api.mangadex.org/at-home/server/${ch.id}`,
          locked: false,
          paragraphs: null,
        });
      }
      if (!chapters.length) throw failure(502, '该漫画暂无可用的简/繁中章节');
      return { title, author, intro, detailUrl, chapters };
    }

    if (sourceId === 'jjwxc') {
      const detailUrl = `https://www.jjwxc.net/onebook.php?novelid=${remoteId}`;
      const { text } = await fetchHtml(detailUrl, { charset: 'gb18030', referer: 'https://www.jjwxc.net/' });
      const $ = load(text);
      const title = brief($('h1 span[itemprop="articleSection"]').first().text() || $('h1').first().text(), 140) || '晋江作品';
      const author = brief($('h2 a span[itemprop="author"], a[href*="oneauthor.php"]').first().text(), 80);
      const intro = brief($('#novelintro').text(), 300);
      const seen = new Set();
      const chapters = [];
      $('#oneboolt a[itemprop="url"], #oneboolt a[href*="chapterid="]').each((_, el) => {
        const a = $(el);
        const href = a.attr('href') || '';
        const chId = href.match(/chapterid=(\d+)/)?.[1];
        if (!chId || seen.has(chId)) return;
        seen.add(chId);
        const row = a.closest('tr');
        const locked = row.text().includes('[VIP]') || /vip/i.test(href) || a.attr('rel') === 'nofollow';
        chapters.push({
          title: brief(a.text(), 200) || `第 ${chapters.length + 1} 章`,
          url: `https://www.jjwxc.net/onebook.php?novelid=${remoteId}&chapterid=${chId}`,
          locked,
          paragraphs: null,
        });
      });
      return { title, author, intro, detailUrl, chapters };
    }

    if (sourceId === 'sfacg') {
      const detailUrl = `https://book.sfacg.com/Novel/${remoteId}/`;
      const tocUrl = `https://book.sfacg.com/Novel/${remoteId}/MainIndex/`;
      const [bookPage, tocPage] = await Promise.all([
        fetchHtml(detailUrl, { referer: 'https://book.sfacg.com/' }),
        fetchHtml(tocUrl, { referer: detailUrl }),
      ]);
      const $b = load(bookPage.text);
      const title = brief($b('h1.title, h1').first().text(), 140) || 'SF轻小说作品';
      const author = brief($b('.author-name span, .author-name a').first().text(), 80);
      const intro = brief($b('.introduce').first().text(), 300);
      const $t = load(tocPage.text);
      const seen = new Set();
      const chapters = [];
      $t(`a[href*="/Novel/${remoteId}/"], .catalog-list a`).each((_, el) => {
        const a = $t(el);
        const href = a.attr('href') || '';
        const locked = /\/vip\//i.test(href) || a.find('.icon-lock, .vip').length > 0;
        const m = new RegExp(`/Novel/${remoteId}/(\\d+)/(\\d+)/?`, 'i').exec(href);
        if (!m && !locked) return;
        const fullUrl = new URL(href, 'https://book.sfacg.com').toString();
        if (seen.has(fullUrl)) return;
        seen.add(fullUrl);
        chapters.push({
          title: brief(a.attr('title') || a.text(), 200) || `第 ${chapters.length + 1} 章`,
          url: fullUrl,
          locked,
          paragraphs: null,
        });
      });
      return { title, author, intro, detailUrl, chapters };
    }

    if (sourceId === 'esjzone') {
      const detailUrl = `https://www.esjzone.cc/detail/${remoteId}.html`;
      const { text } = await fetchHtml(detailUrl, { referer: 'https://www.esjzone.cc/' });
      const $ = load(text);
      const title = brief($('h2').first().text() || $('title').text().replace(/\s*-\s*ESJ.*$/i, ''), 140) || 'ESJ 轻小说作品';
      const author = brief($('.book-detail a[href*="/tags/"]').first().text(), 80);
      const intro = brief($('.description').first().text(), 300);
      const seen = new Set();
      const chapters = [];
      $('#chapterList a[href*="/forum/"][href$=".html"], a[href*="/forum/"][href$=".html"]').each((_, el) => {
        const a = $(el);
        const href = a.attr('href') || '';
        if (!/\/forum\/\d+\/\d+\.html/i.test(href)) return;
        const fullUrl = new URL(href, detailUrl).toString();
        if (seen.has(fullUrl)) return;
        seen.add(fullUrl);
        chapters.push({
          title: brief(a.text(), 200) || `第 ${chapters.length + 1} 章`,
          url: fullUrl,
          locked: false,
          paragraphs: null,
        });
      });
      if (!chapters.length) throw failure(502, '该 ESJ 轻小说暂未公开章节列表');
      return { title, author, intro, detailUrl, chapters };
    }

    if (sourceId === 'syosetu') {
      const ncode = String(remoteId || '').toLowerCase();
      const detailUrl = `https://ncode.syosetu.com/${ncode}/`;
      const { text } = await fetchHtml(detailUrl, { customHeaders: { 'user-agent': 'MokujiReader/1.0' } });
      const $ = load(text);
      const title = brief($('.p-novel__title, .novel_title, h1').first().text(), 140) || ncode;
      const author = brief($('.p-novel__author a, .novel_writername a, .p-novel__author').first().text().replace(/^作者[：:]\s*/, ''), 80);
      const intro = brief($('#novel_ex, .p-novel__summary').first().text(), 300);
      const seen = new Set();
      const chapters = [];
      $(`a[href^="/${ncode}/"]`).each((_, el) => {
        const a = $(el);
        const href = a.attr('href') || '';
        if (!new RegExp(`^/${ncode}/\\d+/?$`, 'i').test(href)) return;
        const fullUrl = new URL(href, 'https://ncode.syosetu.com').toString();
        if (seen.has(fullUrl)) return;
        seen.add(fullUrl);
        chapters.push({
          title: brief(a.text(), 200) || `第 ${chapters.length + 1} 话`,
          url: fullUrl,
          locked: false,
          paragraphs: null,
        });
      });
      if (!chapters.length) {
        const body = $('.p-novel__body, #novel_honbun').first();
        const ps = cleanParagraphsFromHtml(body.html() || '');
        if (ps.length) {
          chapters.push({ title, url: detailUrl, locked: false, paragraphs: ps });
        }
      }
      if (!chapters.length) throw failure(502, '成为小说家吧未返回章节列表');
      return { title, author, intro, detailUrl, chapters };
    }

    if (sourceId === 'wikisource') {
      const apiUrl = 'https://zh.wikisource.org/w/api.php?' + new URLSearchParams({
        action: 'parse', format: 'json', formatversion: '2', page: remoteId, redirects: '1', prop: 'text|displaytitle',
      });
      const { text } = await fetchHtml(apiUrl);
      const parsed = JSON.parse(text)?.parse;
      if (!parsed?.text) throw failure(502, '维基文库未返回目录');
      const title = parsed.title || remoteId;
      const detailUrl = 'https://zh.wikisource.org/wiki/' + encodeURIComponent(title).replace(/%2F/g, '/');
      const $ = load(parsed.text);
      const author = brief($('a[href^="/wiki/Author:"]').first().text(), 80);
      const seen = new Set();
      const chapters = [];
      $('.mw-parser-output a').each((_, el) => {
        const a = $(el);
        const href = a.attr('href') || '';
        if (!href.startsWith('/wiki/') || a.hasClass('new') || a.closest('.ws-header,.ws-footer,.navbox').length) return;
        const child = decodeURIComponent(href.slice(6)).replace(/_/g, ' ');
        if (!child.startsWith(title + '/') || seen.has(child)) return;
        seen.add(child);
        chapters.push({
          title: brief(a.text(), 200) || child.slice(title.length + 1),
          url: 'https://zh.wikisource.org/wiki/' + encodeURIComponent(child).replace(/%2F/g, '/'),
          locked: false,
          paragraphs: null,
        });
      });
      if (!chapters.length) {
        const body = $('.mw-parser-output').first();
        body.find('script,style,iframe,#headerContainer,.ws-header,.ws-footer,.ws-noexport,.noprint,.navbox,.licenseContainer,.mw-editsection,.catlinks,#toc').remove();
        const ps = cleanParagraphsFromHtml(body.html() || '');
        if (!ps.length) throw failure(502, '该页面没有可读取的正文');
        chapters.push({ title, url: detailUrl, locked: false, paragraphs: ps });
      }
      return { title, author, intro: '维基文库公开版本', detailUrl, chapters };
    }
    throw failure(404, '未找到对应书源');
  }

  async function fetchCatalogWithRule(source, detailUrl) {
    const rule = source.rule;
    const page = await fetchHtml(detailUrl, { charset: rule.charset, referer: source.baseUrl, customHeaders: rule.headers });
    const $ = load(page.text);
    const title = selectText($, $.root(), rule.bookTitle) || brief($('title').text(), 120) || '未命名作品';
    const author = selectText($, $.root(), rule.bookAuthor);
    const intro = selectText($, $.root(), rule.bookIntro);

    let $toc = $;
    let tocBase = page.url;
    if (rule.tocUrlSelector) {
      const tocUrl = selectHref($, $.root(), rule.tocUrlSelector, page.url);
      if (tocUrl && tocUrl !== page.url) {
        const tocPage = await fetchHtml(tocUrl, { charset: rule.charset, referer: page.url, customHeaders: rule.headers });
        $toc = load(tocPage.text);
        tocBase = tocPage.url;
      }
    }
    const seen = new Set();
    const chapters = [];
    selectElements($toc, $toc.root(), rule.catalogList).each((_, el) => {
      const node = $toc(el);
      const chapterTitle = (rule.catalogTitle ? selectText($toc, node, rule.catalogTitle) : brief(node.text(), 200)) || `第 ${chapters.length + 1} 章`;
      const chapterUrl = selectHref($toc, node, rule.catalogUrl || '@href', tocBase);
      if (!chapterUrl || seen.has(chapterUrl)) return;
      seen.add(chapterUrl);
      chapters.push({ title: chapterTitle, url: chapterUrl, locked: false, paragraphs: null });
    });
    if (!chapters.length) throw failure(502, '未从目录页解析到章节，请检查目录选择器');
    return { title, author, intro, detailUrl: page.url, chapters };
  }

  function extractGenericHtmlChapter(html, pageUrl) {
    const $ = load(html);
    $('script,style,iframe,noscript,nav,header,footer,aside,.nav,.header,.footer,.sidebar,.comment,.comments,.ads,.advertisement,[class*="recommend"],[class*="toolbar"]').remove();
    const candidates = ['#ChapterBody', '#chaptercontent', '#content', '.read-content', '.noveltext', 'article', 'main', '.content', '.post-content', '.entry-content', '.article-content', 'body'];
    let bestParagraphs = [];
    for (const sel of candidates) {
      const node = $(sel).first();
      if (!node.length) continue;
      const ps = cleanParagraphsFromHtml(node.html() || '');
      const len = ps.join('').length;
      if (len > bestParagraphs.join('').length) bestParagraphs = ps;
      if (len > 400) break;
    }
    // Check for manga / comic strip page when text paragraphs are scarce
    const imgs = [];
    const seenImg = new Set();
    const imgContainer = $('article, main, #content, .comic-list, .chapter-content, .rd-article-wr, .reader-comic, body').first();
    imgContainer.find('img').each((_, el) => {
      const raw = $(el).attr('data-original') || $(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('src') || '';
      if (!raw || raw.startsWith('data:image/gif')) return;
      try {
        const full = new URL(raw, pageUrl).toString();
        if (!/^https?:\/\//i.test(full) || /(?:logo|avatar|icon|qr|banner|ad|loading|placeholder)\./i.test(full) || seenImg.has(full)) return;
        seenImg.add(full);
        imgs.push(full);
      } catch {}
    });
    if (bestParagraphs.join('').length < 220 && imgs.length >= 3) {
      const media = {};
      const items = imgs.slice(0, 120).map((u, idx) => {
        const asset = 'm' + hashId(u).slice(0, 16);
        media[asset] = `/api/reader/img?url=${encodeURIComponent(u)}`;
        return { asset, alt: `第 ${idx + 1} 页` };
      });
      return { paragraphs: [], images: [{ paragraph: 0, items }], media };
    }
    if (!bestParagraphs.length) throw failure(502, '未能从此页面提取到可读正文或漫画图片');
    return { paragraphs: bestParagraphs };
  }

  async function fetchChapterText(sourceKind, sourceObj, chapterUrl) {
    if (sourceKind === 'sniff') {
      const { text, url } = await fetchHtml(chapterUrl);
      return extractGenericHtmlChapter(text, url);
    }
    if (sourceKind === 'builtin') {
      if (sourceObj.id === 'mangadex') {
        const { text } = await fetchHtml(chapterUrl, { customHeaders: { 'user-agent': 'MokujiReader/1.0', accept: 'application/json' } });
        const info = JSON.parse(text);
        const baseUrl = info?.baseUrl;
        const hash = info?.chapter?.hash;
        const files = info?.chapter?.dataSaver?.length ? info.chapter.dataSaver : (info?.chapter?.data || []);
        const quality = info?.chapter?.dataSaver?.length ? 'data-saver' : 'data';
        if (!baseUrl || !hash || !files.length) throw failure(422, '该漫画章节暂未开放图源读取', { sourceUrl: chapterUrl });
        const media = {};
        const items = files.map((file, idx) => {
          const imgUrl = `${baseUrl}/${quality}/${hash}/${file}`;
          const asset = 'md' + hashId(imgUrl).slice(0, 16);
          media[asset] = `/api/reader/img?url=${encodeURIComponent(imgUrl)}`;
          return { asset, alt: `第 ${idx + 1} 页` };
        });
        return { paragraphs: [], images: [{ paragraph: 0, items }], media };
      }
      if (sourceObj.id === 'wikisource') {
        const m = /\/wiki\/(.+)$/.exec(chapterUrl);
        if (!m) throw failure(400, '维基文库章节地址无效');
        const pageTitle = decodeURIComponent(m[1]).replace(/_/g, ' ');
        const apiUrl = 'https://zh.wikisource.org/w/api.php?' + new URLSearchParams({
          action: 'parse', format: 'json', formatversion: '2', page: pageTitle, redirects: '1', prop: 'text',
        });
        const { text } = await fetchHtml(apiUrl);
        const html = JSON.parse(text)?.parse?.text || '';
        const $ = load(html);
        const body = $('.mw-parser-output').first();
        body.find('script,style,iframe,#headerContainer,.ws-header,.ws-footer,.ws-noexport,.noprint,.navbox,.licenseContainer,.mw-editsection,.catlinks,#toc').remove();
        return { paragraphs: cleanParagraphsFromHtml(body.html() || '') };
      }
      if (sourceObj.id === 'jjwxc') {
        const { text } = await fetchHtml(chapterUrl, { charset: 'gb18030', referer: 'https://www.jjwxc.net/' });
        const $ = load(text);
        const body = $('.novelbody .noveltext').first();
        body.find('script,style,iframe,div[align="right"],div[align="center"],.readsmall,[id^="yrt"],#report_box,[class*="favorite"],#favoriteshow_3').remove();
        const ps = cleanParagraphsFromHtml(body.html() || '').filter(line => !/^\[(?:添加书签|推荐给朋友|投诉)\]/.test(line) && !/^(?:查看收藏列表|定制收藏类别|新增|取消)$/.test(line));
        if (!ps.length) throw failure(422, '本章为晋江 VIP 章节或未返回正文，请前往原站阅读', { sourceUrl: chapterUrl });
        return { paragraphs: ps };
      }
      if (sourceObj.id === 'sfacg') {
        const { text } = await fetchHtml(chapterUrl, { referer: 'https://book.sfacg.com/' });
        const $ = load(text);
        const body = $('#ChapterBody, .yuedu_zhengwen').first();
        body.find('script,style,iframe,.ads').remove();
        const ps = cleanParagraphsFromHtml(body.html() || '');
        if (!ps.length) throw failure(422, '本章为 SF 轻小说 VIP 章节，请前往原站阅读', { sourceUrl: chapterUrl });
        return { paragraphs: ps };
      }
      if (sourceObj.id === 'esjzone') {
        const { text } = await fetchHtml(chapterUrl, { referer: 'https://www.esjzone.cc/' });
        const $ = load(text);
        const body = $('.forum-content').first();
        body.find('script,style,iframe,.ads').remove();
        const ps = cleanParagraphsFromHtml(body.html() || '');
        if (!ps.length) throw failure(422, '本章在 ESJ Zone 需要登录或未开放正文，请前往原站阅读', { sourceUrl: chapterUrl });
        return { paragraphs: ps };
      }
      if (sourceObj.id === 'syosetu') {
        const { text } = await fetchHtml(chapterUrl, { customHeaders: { 'user-agent': 'MokujiReader/1.0' } });
        const $ = load(text);
        const body = $('.p-novel__body, #novel_honbun').first();
        body.find('script,style,iframe').remove();
        const ps = cleanParagraphsFromHtml(body.html() || '');
        if (!ps.length) throw failure(422, '未从成为小说家吧提取到章节正文', { sourceUrl: chapterUrl });
        return { paragraphs: ps };
      }
      const { text } = await fetchHtml(chapterUrl);
      const $ = load(text);
      const body = $(sourceObj.id === '17k' ? '.readAreaBox > .p' : '.reader-content .content');
      body.find('script,style,iframe,.copy,.author-say,.qrcode,.chapter_text_ad,[id^="banner"],.ads,.advertisement').remove();
      const ps = cleanParagraphsFromHtml(body.html() || '');
      if (!ps.length) throw failure(422, '本章为原站 VIP 或需要登录验证，请前往原站阅读', { sourceUrl: chapterUrl });
      return { paragraphs: ps };
    }

    const rule = sourceObj.rule;
    const collected = [];
    let nextUrl = chapterUrl;
    for (let pageCount = 0; pageCount < 5 && nextUrl; pageCount++) {
      const page = await fetchHtml(nextUrl, { charset: rule.charset, referer: sourceObj.baseUrl, customHeaders: rule.headers });
      const $ = load(page.text);
      const content = selectElements($, $.root(), rule.contentSelector).first();
      if (rule.contentExclude) content.find(rule.contentExclude).remove();
      collected.push(...cleanParagraphsFromHtml(content.html() || ''));
      if (rule.nextPageSelector) {
        const candidate = selectHref($, $.root(), rule.nextPageSelector, page.url);
        nextUrl = candidate && candidate !== page.url && /_\d+\.|page=/.test(candidate) ? candidate : '';
      } else {
        nextUrl = '';
      }
    }
    if (!collected.length) throw failure(502, '未能解析出本章正文，请检查正文选择器');
    return { paragraphs: collected };
  }

  function resolveSourceObj(sourceId) {
    if (sourceId === 'sniff') {
      return { kind: 'sniff', obj: { id: 'sniff', name: '网页智能嗅探', category: '网文', unit: '章' } };
    }
    const builtin = BUILTIN_SOURCES.find(b => b.id === sourceId);
    if (builtin) return { kind: 'builtin', obj: builtin };
    const row = getRuleRow.get(sourceId);
    if (!row || row.kind !== 'rule') return null;
    return { kind: 'rule', obj: { id: row.id, name: row.name, baseUrl: row.baseUrl, category: '网文', unit: '章', rule: JSON.parse(row.ruleJson) } };
  }

  async function addBook(sourceId, remoteIdOrUrl) {
    const resolved = resolveSourceObj(sourceId);
    if (!resolved) throw failure(404, '未找到指定的书源');
    const fetched = resolved.kind === 'builtin'
      ? await fetchCatalogBuiltin(sourceId, String(remoteIdOrUrl))
      : await fetchCatalogWithRule(resolved.obj, String(remoteIdOrUrl));
    const bookId = `src:${sourceId}:${hashId(remoteIdOrUrl)}`;
    const now = new Date().toISOString();
    const category = resolved.obj.category || '网文';
    db.exec('BEGIN IMMEDIATE');
    try {
      upsertBook.run(bookId, sourceId, String(remoteIdOrUrl), fetched.title, fetched.author, fetched.intro, fetched.detailUrl, fetched.chapters.length, now, category);
      fetched.chapters.forEach((c, idx) => {
        insertChapterStmt.run(bookId, idx, c.title, c.url, c.paragraphs ? JSON.stringify(c.paragraphs) : null, null, c.locked ? 1 : 0);
      });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return { book: getBook(bookId) };
  }

  async function refreshBook(bookId) {
    const row = getBookRow.get(bookId);
    if (!row) throw failure(404, '没有找到这本书');
    const resolved = resolveSourceObj(row.source_id);
    if (!resolved || resolved.kind === 'sniff') throw failure(400, '该书源暂不支持在线刷新目录');
    const fetched = resolved.kind === 'builtin'
      ? await fetchCatalogBuiltin(row.source_id, row.remote_id)
      : await fetchCatalogWithRule(resolved.obj, row.detail_url);
    const existing = new Map(listChaptersStmt.all(bookId).map(c => [c.url, c]));
    db.exec('BEGIN IMMEDIATE');
    try {
      upsertBook.run(bookId, row.source_id, row.remote_id, fetched.title, fetched.author, fetched.intro, fetched.detailUrl, fetched.chapters.length, new Date().toISOString(), row.category || resolved.obj.category || '网文');
      fetched.chapters.forEach((c, idx) => {
        const old = existing.get(c.url);
        const oldRow = old?.cached ? getChapterStmt.get(bookId, old.n) : null;
        insertChapterStmt.run(bookId, idx, c.title, c.url, oldRow?.paragraphs ?? (c.paragraphs ? JSON.stringify(c.paragraphs) : null), oldRow?.imagesJson ?? null, c.locked ? 1 : 0);
      });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return { book: getBook(bookId), chapterCount: fetched.chapters.length };
  }

  async function testSource(input, keyword = '诡秘') {
    const normalized = normalizeRule(input);
    const hits = await searchWithRule(normalized, keyword);
    if (!hits.length) return { ok: false, hits: [], message: '搜索列表为空（请检查搜索地址或搜索列表选择器）' };
    const first = hits[0];
    let catalog = null;
    let preview = [];
    let note = '';
    try {
      catalog = await fetchCatalogWithRule(normalized, first.detailUrl);
      if (catalog.chapters.length) {
        const res = await fetchChapterText('rule', normalized, catalog.chapters[0].url);
        preview = res.paragraphs || [];
      }
    } catch (err) {
      note = err?.message || '目录或正文解析失败';
    }
    return {
      ok: !!catalog && preview.length > 0,
      hits: hits.slice(0, 5),
      chapterCount: catalog?.chapters.length || 0,
      firstChapterTitle: catalog?.chapters[0]?.title || '',
      preview: preview.slice(0, 4),
      note,
    };
  }

  function saveSniffedBook({ detailUrl, title, author = '', intro = '', category = '网文', chapters }) {
    const bookId = `src:sniff:${hashId(detailUrl)}`;
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      upsertBook.run(bookId, 'sniff', detailUrl, brief(title, 160) || '网页嗅探书籍', brief(author, 100), brief(intro, 300), detailUrl, chapters.length, now, category);
      chapters.forEach((c, idx) => {
        const imagesJson = c.images ? JSON.stringify({ images: c.images, media: c.media || {} }) : null;
        insertChapterStmt.run(bookId, idx, brief(c.title, 200) || `第 ${idx + 1} 章`, c.url || detailUrl, c.paragraphs ? JSON.stringify(c.paragraphs) : null, imagesJson, 0);
      });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return { book: getBook(bookId) };
  }

  function mapBookRow(row) {
    const src = resolveSourceObj(row.source_id);
    return {
      id: row.id,
      title: row.title,
      author: row.author,
      intro: row.intro,
      category: row.category || src?.obj.category || '网文',
      unit: (row.category === '漫画' || src?.obj.unit === '话') ? '话' : '章',
      source: src?.obj.name || row.source_id,
      sourceType: 'custom',
      sourceUrl: row.detail_url,
      chapterCount: row.chapter_count,
      cachedChapterCount: row.cachedChapterCount || 0,
      available: true,
      progress: { chapter: 0, paragraph: 0, revision: 0, updatedAt: null },
    };
  }

  async function importFromUrl(url) {
    const { text } = await fetchHtml(String(url || '').trim(), { charset: 'utf-8' });
    let parsed;
    try {
      parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch {
      throw failure(422, '订阅地址返回的不是有效的 JSON 书源格式');
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    let imported = 0;
    let skipped = 0;
    for (const raw of items.slice(0, 120)) {
      try {
        saveSource(raw);
        imported++;
      } catch {
        skipped++;
      }
    }
    return { imported, skipped, ...listSources() };
  }

  function listBooks() {
    return listBookRows.all().map(mapBookRow);
  }

  function getBook(id) {
    const row = getBookRow.get(id);
    return row ? mapBookRow(row) : null;
  }

  function getDetails(book) {
    const rows = listChaptersStmt.all(book.id);
    return {
      book,
      chapters: rows.map(c => ({
        n: c.n,
        title: c.title,
        available: !c.locked,
        cached: !!c.cached,
        sourceUrl: c.url,
        access: c.locked ? 'locked' : c.cached ? 'cached' : 'uncached',
      })),
    };
  }

  async function getChapter(book, n) {
    const row = getChapterStmt.get(book.id, n);
    if (!row) throw failure(404, '没有找到这一章');
    if (row.locked) throw failure(422, '原站标记为 VIP 章节，请前往原站阅读', { sourceUrl: row.url });
    if (row.paragraphs !== null || row.imagesJson) {
      const picData = row.imagesJson ? JSON.parse(row.imagesJson) : {};
      return {
        id: book.id,
        n,
        title: row.title,
        paragraphs: row.paragraphs ? JSON.parse(row.paragraphs) : [],
        ...(picData.images?.length ? { images: picData.images, media: picData.media || {} } : {}),
        chapterCount: book.chapterCount,
        source: book.source,
        sourceUrl: row.url,
      };
    }
    const rawBook = getBookRow.get(book.id);
    const resolved = resolveSourceObj(rawBook.source_id);
    if (!resolved) throw failure(404, '对应书源已被删除，无法在线拉取未缓存章节');
    const fetched = await fetchChapterText(resolved.kind, resolved.obj, row.url);
    const paragraphs = fetched.paragraphs || [];
    const imagesJson = fetched.images?.length ? JSON.stringify({ images: fetched.images, media: fetched.media || {} }) : null;
    updateChapterBodyStmt.run(JSON.stringify(paragraphs), imagesJson, book.id, n);
    return {
      id: book.id,
      n,
      title: row.title,
      paragraphs,
      ...(fetched.images?.length ? { images: fetched.images, media: fetched.media || {} } : {}),
      chapterCount: book.chapterCount,
      source: book.source,
      sourceUrl: row.url,
    };
  }

  async function cacheChapters(bookId, start = 0, count = 20) {
    const book = getBook(bookId);
    if (!book) throw failure(404, '没有找到这本书');
    const rows = listChaptersStmt.all(bookId).filter(c => c.n >= start && !c.locked && !c.cached).slice(0, Math.min(100, Math.max(1, count)));
    let cached = 0;
    let errors = 0;
    for (const item of rows) {
      try {
        await getChapter(book, item.n);
        cached++;
      } catch {
        errors++;
      }
    }
    return { cached, errors, book: getBook(bookId) };
  }

  function deleteBook(bookId) {
    deleteBookStmt.run(bookId);
  }

  return {
    listSources,
    saveSource,
    deleteSource,
    testSource,
    search,
    addBook,
    refreshBook,
    listBooks,
    getBook,
    getDetails,
    getChapter,
    cacheChapters,
    deleteBook,
    importFromUrl,
    saveSniffedBook,
    extractGenericHtmlChapter,
  };
}
