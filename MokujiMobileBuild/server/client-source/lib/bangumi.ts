import type { Category, ProgressUnit, ReadingStatus } from './types';

export interface BangumiBook {
  id: number;
  title: string;
  originalTitle: string;
  author: string;
  summary: string;
  tags: string[];
  category: Category;
  year: string;
  series: boolean;
  platform: string;
  score: number | null;
  ratingCount: number;
  cover: string;
}

export function bangumiUrl(id: number) {
  return `https://bgm.tv/subject/${id}`;
}

export function bangumiCover(id: number) {
  return `https://api.bgm.tv/v0/subjects/${id}/image?type=medium`;
}

export function bangumiUnit(category: Category): ProgressUnit {
  if (category === '漫画') return '话';
  return category === '轻小说' || category === '网文' ? '章' : '页';
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value.trim()].filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => typeof item?.v === 'string' ? [item.v.trim()] : []).filter(Boolean);
}

// Both the search and single-subject endpoints return this public subject shape.
export function parseBangumiBook(raw: unknown): BangumiBook | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (row.type !== 1 || row.nsfw || !Number.isSafeInteger(row.id) || Number(row.id) <= 0) return null;
  const id = Number(row.id);
  const originalTitle = strings(row.name)[0] || '';
  const title = strings(row.name_cn)[0] || originalTitle;
  if (!title) return null;
  const info = Array.isArray(row.infobox) ? row.infobox : [];
  const author = strings(info.find(field => field?.key === '作者' || field?.key === '原作')?.value).join('、');
  const rawTags = Array.isArray(row.tags) ? row.tags.map(tag => typeof tag?.name === 'string' ? tag.name : '') : [];
  const metaTags = Array.isArray(row.meta_tags) ? row.meta_tags.filter(tag => typeof tag === 'string') : [];
  const tags = [...new Set([...metaTags, ...rawTags])].filter(Boolean).slice(0, 10).map(tag => tag.slice(0, 40));
  const platform = strings(row.platform)[0] || '';
  const topics = [platform, ...metaTags, ...rawTags];
  const category: Category = topics.some(t => /漫画|漫畫/.test(t)) ? '漫画'
    : topics.some(t => /网文|网络小说|網路小說|网络文学/.test(t)) ? '网文'
    : topics.some(t => /轻小说|輕小說|ライトノベル/.test(t)) ? '轻小说' : '文学';
  const images = row.images as { small?: unknown; common?: unknown } | undefined;
  const image = images?.common || images?.small;
  const rating = row.rating as { total?: unknown; score?: unknown } | undefined;
  const ratingCount = typeof rating?.total === 'number' ? rating.total : 0;
  return {
    id, title: title.slice(0, 200), originalTitle: originalTitle.slice(0, 300),
    author: author.slice(0, 200), summary: String(row.summary || '').trim().slice(0, 1200), tags, category,
    year: /^\d{4}/.exec(String(row.date || ''))?.[0] || '', series: row.series === true,
    platform: platform.slice(0, 40), score: ratingCount && typeof rating?.score === 'number' ? rating.score : null,
    ratingCount, cover: typeof image === 'string' && /^https:\/\/lain\.bgm\.tv\//.test(image) ? image : bangumiCover(id),
  };
}

export interface BangumiCollection {
  book: BangumiBook;
  status: ReadingStatus;
  rating: number | null;
}

const collectionStatuses: Record<number, ReadingStatus> = { 1: '想读', 2: '已读', 3: '在读', 4: '搁置', 5: '弃读' };

export function parseBangumiCollection(raw: unknown): BangumiCollection | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (row.private !== false || row.subject_type !== 1 || !row.subject || typeof row.subject !== 'object') return null;
  const subject = row.subject as Record<string, unknown>;
  const book = parseBangumiBook({ ...subject, summary: subject.short_summary || '' });
  const status = typeof row.type === 'number' ? collectionStatuses[row.type] : undefined;
  if (!book || !status || book.id !== row.subject_id) return null;
  const rating = typeof row.rate === 'number' && Number.isInteger(row.rate) && row.rate >= 1 && row.rate <= 10 ? row.rate : null;
  return { book, status, rating };
}
