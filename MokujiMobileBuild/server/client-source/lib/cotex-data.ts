import { z } from 'zod';

const short = (max: number) => z.string().trim().min(1).max(max);
const counter = z.number().int().min(0).max(100_000_000);
const sourceKey = short(80).regex(/^[a-zA-Z0-9._:-]+$/, '来源标识格式无效');
const sourceId = short(512);
const sourceUrl = z.string().max(2000).url().refine(url => /^https?:\/\//i.test(url), '阅读链接需要使用 HTTP 或 HTTPS');
export const locatorSchema = z.object({
  chapter: counter.min(1),
  chapterTitle: z.string().max(500).optional(),
  chapterId: z.string().max(1000).optional(),
  paragraph: counter.optional(),
  offset: counter.optional(),
  percent: z.number().finite().min(0).max(100).optional(),
});
export const sourceRecordSchema = z.object({
  source: sourceKey,
  sourceId,
  bookId: short(100),
  title: short(200),
  sourceUrl: sourceUrl.optional(),
  locator: locatorSchema,
  version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1),
  updatedAt: z.string().datetime(),
});
export type CotexRecord = z.infer<typeof sourceRecordSchema>;
export const syncSchema = z.object({
  source: sourceKey,
  sourceId,
  bookId: short(100).optional(),
  createNew: z.boolean().optional(),
  title: short(200),
  author: z.string().trim().max(200).optional(),
  sourceUrl: sourceUrl.optional(),
  baseVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
  locator: locatorSchema,
});

export function sameSource(a: Pick<CotexRecord,'source'|'sourceId'>, b: Pick<CotexRecord,'source'|'sourceId'>) {
  return a.source === b.source && a.sourceId === b.sourceId;
}
