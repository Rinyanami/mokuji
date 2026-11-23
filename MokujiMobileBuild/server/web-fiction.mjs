import { listWebFictionBooks } from './online-catalog.mjs';
import { listJinjiangBooks } from './jinjiang-fiction.mjs';
import { listMainstreamFiction } from './mainstream-fiction.mjs';
import { listZonghengBooks } from './zongheng-fiction.mjs';
import { listAwardFiction } from './awards-fiction.mjs';

const aliases = new Map(Object.entries({
  起点中文网: '起点', 番茄小说: '番茄', 晋江文学城: '晋江', 纵横中文网: '纵横', '17K小说网': '17K',
}));
const promoted = ['十日终焉','事关生者死者与凶手','诡秘之主','天官赐福','剑来','双车错','听河','一品布衣','凡人修仙传','我在精神病院学斩神','进入门径的漫长旅程'];
const canon = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]+/gu, '');
const pageSize = 24;

function prepare() {
  const books = [];
  const byUrl = new Map();
  const byCredit = new Map();
  function record(raw) {
    const platform = aliases.get(raw.platform) || raw.platform;
    const url = raw.sourceUrl || raw.officialUrl || raw.url;
    if (!raw.id || !raw.title || !platform || !url || new URL(url).protocol !== 'https:') throw new Error('Invalid web fiction entry: ' + raw.id);
    const linkKind = raw.linkKind === 'search' ? 'search' : 'detail';
    const key = [platform, canon(raw.title), canon(raw.author)].join('\t');
    const existing = byUrl.get(url) || (raw.awards || linkKind === 'search' ? byCredit.get(key) : undefined);
    if (existing) {
      if (raw.awards) {
        existing.awards = raw.awards;
        existing.crossType = raw.crossType;
      }
      if (existing.linkKind === 'search' && linkKind === 'detail') {
        existing.sourceUrl = url;
        existing.linkKind = 'detail';
        byUrl.set(url,existing);
      }
      return;
    }
    const book = {
      id:raw.id, title:raw.title, author:raw.author, platform, sourceUrl:url,
      genre:raw.genre || '', status:raw.status || '', linkKind, canReadHere:Boolean(raw.readerId),
    };
    for (const k of ['readerId','chapterCount','awards','crossType','evidenceUrl','metadataSourceUrl','statusAsOf']) if (raw[k]) book[k] = raw[k];
    books.push(book);
    if(linkKind === 'detail') byUrl.set(url,book);
    byCredit.set(key,book);
  }

  for (const b of listWebFictionBooks()) record({
    ...b, readerId:b.id, platform:b.source, genre:b.edition || '中文原创',
  });
  for (const b of listMainstreamFiction()) record(b);
  for (const b of listJinjiangBooks()) record(b);
  for (const b of listZonghengBooks()) record(b);
  for (const b of listAwardFiction()) record(b);

  const groups = new Map();
  for (const b of books) {
    if (!groups.has(b.platform)) groups.set(b.platform, []);
    groups.get(b.platform).push(b);
  }
  const seen = new Set();
  const ordered = [];
  function append(b) {
    if (b && !seen.has(b.id)) {seen.add(b.id);ordered.push(b);}
  }
  for (const title of promoted) append(books.find(b => b.title === title));
  const lists = Array.from(groups.values());
  const longest = Math.max(...lists.map(group => group.length));
  for (let i=0;i<longest;i++) for(const group of lists) append(group[i]);
  if (ordered.length !== books.length) throw new Error('Conflicting web fiction IDs');
  const searchable = ordered.map(book => ({
    book,title:canon(book.title),author:canon(book.author),
    context:canon([book.platform,book.genre,book.status,book.crossType,...(book.awards || []).map(a=>a.originalTitle)].filter(Boolean).join(' ')),
  }));
  return {searchable,platforms:Array.from(groups.keys())};
}
const {searchable,platforms} = prepare();

export function webFictionPage(params) {
  const rawQuery = (params.get('q') || '').slice(0,160).trim();
  const words = rawQuery.split(/\s+/u).map(canon).filter(Boolean);
  const query = words.join('');
  const access = params.get('access');
  const platform = params.get('platform');
  const matches = [];
  for (const row of searchable) {
    const {book,title,author,context} = row;
    if (platform && book.platform !== platform) continue;
    if (access === 'inside' && !book.canReadHere) continue;
    if (access === 'official' && (book.canReadHere || book.linkKind !== 'detail')) continue;
    if (!words.every(w => title.includes(w) || author.includes(w) || context.includes(w))) continue;
    const rank = !query ? 0 : title === query ? 0 : author === query ? 1 : title.startsWith(query) ? 2 : title.includes(query) ? 3 : 4;
    matches.push({book,rank});
  }
  if (query) matches.sort((a,b) => a.rank-b.rank);
  const total = matches.length;
  const requested = Number(params.get('page'));
  const page = Math.min(Math.max(1, Math.ceil(total/pageSize)), Number.isSafeInteger(requested) && requested>0 ? requested : 1);
  const start = (page-1)*pageSize;
  const totalReadable = matches.reduce((n,{book}) => n + Number(book.canReadHere), 0);
  const totalOfficial = matches.reduce((n,{book}) => n + Number(!book.canReadHere && book.linkKind==='detail'), 0);
  return {results:matches.slice(start,start+pageSize).map(m => m.book), total, totalReadable,totalOfficial,
    catalogTotal:searchable.length,page,pageSize,hasMore:start+pageSize<total,platforms};
}
