export interface WorkSource { provider: string; externalId: string; url: string }
export interface SharedWork { id: string; title: string; author: string; sources: WorkSource[] }

export function normalized(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase();
}

export function knownAuthor(value: string) {
  const name = normalized(value);
  return /^(作者未填写|作者待补充|佚名|未知|未知作者|作者未知|匿名|不详|暂无|未填写|unknown|anonymous)$/.test(name) ? '' : name;
}
