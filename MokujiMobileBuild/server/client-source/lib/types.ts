import type { CotexRecord } from './cotex-data';
export type BuiltinCategory = '网文' | '轻小说' | '文学' | '非虚构' | '工具书' | '漫画';
export type Category = BuiltinCategory | (string & {});
export type ReadingStatus = '在读' | '想读' | '已读' | '搁置' | '弃读';
export type ProgressUnit = '章' | '话' | '卷' | '页' | '%' | '位置';
export type CategoryDef = { name: string; unit: ProgressUnit };
export type RatingBand = { id: string; label: string; min: number | null; max: number | null };
export type ShelfTaxonomy = {
  categories: CategoryDef[];
  ratingLabels: Record<string, string>;
  ratingBands: RatingBand[];
  pinnedTags: string[];
};
export const defaultTaxonomy: ShelfTaxonomy = {
  categories: [
    { name: '网文', unit: '章' },
    { name: '轻小说', unit: '章' },
    { name: '漫画', unit: '话' },
    { name: '文学', unit: '页' },
    { name: '非虚构', unit: '页' },
    { name: '工具书', unit: '页' },
  ],
  ratingLabels: { '10': '超神作', '9': '神作', '8': '力荐', '7': '推荐', '6': '还行', '5': '不过不失', '4': '较差', '3': '差', '2': '极差', '1': '不忍直视' },
  ratingBands: [
    { id: 'god', label: '9–10 神作', min: 9, max: 10 },
    { id: 'great', label: '8 力荐', min: 8, max: 8 },
    { id: 'good', label: '7 推荐', min: 7, max: 7 },
    { id: 'ok', label: '6 还行', min: 6, max: 6 },
    { id: 'mid', label: '5 不过不失', min: 5, max: 5 },
    { id: 'low', label: '1–4 较差', min: 1, max: 4 },
    { id: 'unrated', label: '暂未评分', min: null, max: null },
  ],
  pinnedTags: [],
};
export interface Book { id: string; title: string; originalTitle?: string; author: string; category: Category; tags: string[]; country: string; language: string; description: string; cover: string; color: string; unit: ProgressUnit; total: number | null; publicationStatus: string; edition?: string; sourceUrl?: string; isCustom?: boolean; }
export interface Entry { bookId: string; catalogWorkId?: string; bangumiId?: number; status: ReadingStatus; position: number | null; volume: number | null; unit: ProgressUnit; locationText: string; note: string; rating: number | null; sourceUrl: string; edition: string; updatedAt: string; startedAt: string; finishedAt: string; }
export interface ReadingEvent { id: string; bookId: string; at: string; kind: string; detail: string; previous: Entry | null; resultUpdatedAt: string; }
export interface Review { id: string; userId: string; displayName: string; bookId: string; bookTitle: string; score: number | null; body: string; spoiler: boolean; progress: string; createdAt: string; }
export interface Post { id: string; userId: string; displayName: string; bookId: string; bookTitle: string; title: string; body: string; spoiler: boolean; createdAt: string; }
export interface Reply { id: string; postId: string; userId: string; displayName: string; body: string; createdAt: string; }
export interface LibraryState { cotexSources?: CotexRecord[]; customBooks: Book[]; entries: Entry[]; events: ReadingEvent[]; }
export interface Snapshot { cotexSources?: CotexRecord[]; user: { id: string; name: string }; revision: number; books: Book[]; entries: Entry[]; events: ReadingEvent[]; reviews: Review[]; posts: Post[]; replies: Reply[]; }
export const categories: Category[] = ['网文','轻小说','文学','非虚构','工具书','漫画'];
export const statuses: ReadingStatus[] = ['在读','想读','已读','搁置','弃读'];
export const units: ProgressUnit[] = ['章','话','卷','页','%','位置'];
export function progressLabel(entry: Pick<Entry,'position'|'unit'|'volume'|'locationText'>): string {
  if(entry.unit === '位置') return entry.locationText || '进度未记录';
  const volume = entry.volume === null ? '' : `第 ${entry.volume} 卷 · `;
  if(entry.position === null) return entry.volume === null ? '进度未记录' : `第 ${entry.volume} 卷`;
  return volume + (entry.unit === '%' ? `${entry.position}%` : `第 ${entry.position} ${entry.unit}`);
}
