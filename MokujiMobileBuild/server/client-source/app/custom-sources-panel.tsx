"use client";
import { useEffect, useState, type FormEvent } from 'react';
import { BookOpen, CheckCircle2, Code2, Compass, Download, ExternalLink, FlaskConical, Globe, Plus, Search, Settings2, Sparkles, Trash2, AlertCircle } from 'lucide-react';
import {
  externalUrl,
  readerPost,
  readerRequest,
  type BookSourceItem,
  type BookSourceRule,
  type ReaderBook,
  type ShelfInput,
  type SourceSearchHit,
} from './reading-client';

interface Props {
  workId?: string;
  initialQuery?: string;
  onAddShelf: (book: ShelfInput & { initialStatus?: '在读' | '想读' }) => Promise<string | undefined>;
  onRead: (bookId: string) => void;
  onReloadLibrary: () => void;
}

type SniffPreview = {
  kind: 'file' | 'catalog' | 'manga' | 'article';
  fileType?: string;
  filename?: string;
  title: string;
  author?: string;
  intro?: string;
  category: '网文' | '轻小说' | '文学' | '漫画';
  byteLength?: number;
  chapterCount?: number;
  pageCount?: number;
  paragraphCount?: number;
  previewChapters?: string[];
  previewParagraphs?: string[];
  url: string;
};

type RuleTemplate = { label: string; rule: BookSourceRule };
type TestResult = {
  ok: boolean;
  hits: SourceSearchHit[];
  chapterCount: number;
  firstChapterTitle: string;
  preview: string[];
  note: string;
  message?: string;
};

const emptyRule = (): BookSourceRule => ({
  name: '',
  baseUrl: '',
  searchUrl: '',
  method: 'GET',
  charset: 'utf-8',
  searchList: '',
  searchTitle: '',
  searchAuthor: '',
  searchIntro: '',
  searchBookUrl: 'a@href',
  tocUrlSelector: '',
  catalogList: '',
  catalogTitle: '',
  catalogUrl: '@href',
  bookTitle: 'h1',
  bookAuthor: '',
  bookIntro: '',
  contentSelector: '#content, #chaptercontent',
  contentExclude: 'script, style, ins',
  nextPageSelector: '',
});

export default function CustomSourcesPanel({ workId, initialQuery = '', onAddShelf, onRead, onReloadLibrary }: Props) {
  const [sources, setSources] = useState<BookSourceItem[]>([]);
  const [templates, setTemplates] = useState<RuleTemplate[]>([]);
  const [query, setQuery] = useState(initialQuery);
  const [channel, setChannel] = useState<'全部' | '网文' | '轻小说' | '文学' | '漫画' | '自定义'>('全部');
  const [sourceFilter, setSourceFilter] = useState('');
  const [hits, setHits] = useState<SourceSearchHit[]>([]);
  const [searchErrors, setSearchErrors] = useState<Array<{ sourceId: string; sourceName: string; error: string }>>([]);
  const [searching, setSearching] = useState(false);
  const [searchedOnce, setSearchedOnce] = useState(false);
  const [addingKey, setAddingKey] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const [sniffUrl, setSniffUrl] = useState('');
  const [sniffing, setSniffing] = useState(false);
  const [sniffPreview, setSniffPreview] = useState<SniffPreview | null>(null);
  const [sniffTitle, setSniffTitle] = useState('');
  const [sniffCat, setSniffCat] = useState<'网文' | '轻小说' | '文学' | '漫画'>('网文');
  const [sniffSaving, setSniffSaving] = useState(false);

  const [manageOpen, setManageOpen] = useState(false);
  const [editing, setEditing] = useState<BookSourceRule>(emptyRule);
  const [jsonImportText, setJsonImportText] = useState('');
  const [subUrl, setSubUrl] = useState('');
  const [importingUrl, setImportingUrl] = useState(false);
  const [showJsonBox, setShowJsonBox] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [savingRule, setSavingRule] = useState(false);

  async function loadSources() {
    try {
      const data = await readerRequest<{ sources: BookSourceItem[]; templates: RuleTemplate[] }>('sources');
      setSources(data.sources || []);
      setTemplates(data.templates || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法加载书源列表');
    }
  }

  useEffect(() => {
    void loadSources();
    try {
      const pending = sessionStorage.getItem('mokuji.pendingSniffUrl');
      if (pending) {
        sessionStorage.removeItem('mokuji.pendingSniffUrl');
        setSniffUrl(pending);
        void sniffByUrl(pending);
      }
    } catch {}
  }, []);

  async function runSearch(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError('');
    setNotice('');
    try {
      const data = await readerPost<{ results: SourceSearchHit[]; errors: Array<{ sourceId: string; sourceName: string; error: string }> }>(
        'sources/search',
        { query: q, sourceId: sourceFilter },
      );
      setHits(data.results || []);
      setSearchErrors(data.errors || []);
      setSearchedOnce(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜书失败');
    } finally {
      setSearching(false);
    }
  }

  async function addHit(hit: SourceSearchHit, openImmediately: boolean) {
    const key = `${hit.sourceId}:${hit.remoteId}`;
    setAddingKey(key);
    setError('');
    setNotice('');
    try {
      const { book } = await readerPost<{ book: ReaderBook }>('sources/add', {
        sourceId: hit.sourceId,
        remoteId: hit.remoteId,
        detailUrl: hit.detailUrl,
        ...(workId ? { workId } : {}),
      });
      if (!workId && openImmediately) {
        const shelfId = await onAddShelf({
          title: book.title || hit.title,
          author: book.author || hit.author,
          sourceUrl: hit.detailUrl,
          category: hit.category || '网文',
          initialStatus: '在读',
        }).catch(() => undefined);
        if (shelfId) {
          await readerPost('bind', { workId: shelfId, bookId: book.id }).catch(() => undefined);
        }
      }
      onReloadLibrary();
      if (openImmediately) {
        onRead(book.id);
      } else {
        setNotice(`已收录《${book.title}》（共 ${book.chapterCount} 章），可在「正文书库」离线缓存或阅读。`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加入书库失败');
    } finally {
      setAddingKey('');
    }
  }

  async function toggleBuiltin(item: BookSourceItem) {
    try {
      const data = await readerPost<{ sources: BookSourceItem[]; templates: RuleTemplate[] }>('sources/save', {
        builtinId: item.id,
        enabled: !item.enabled,
      });
      setSources(data.sources || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新书源状态失败');
    }
  }

  async function saveRule(e: FormEvent) {
    e.preventDefault();
    setSavingRule(true);
    setError('');
    setNotice('');
    try {
      const data = await readerPost<{ sources: BookSourceItem[]; templates: RuleTemplate[] }>('sources/save', editing);
      setSources(data.sources || []);
      setEditing(emptyRule());
      setTestResult(null);
      setNotice('书源规则已保存并启用');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存书源规则失败');
    } finally {
      setSavingRule(false);
    }
  }

  async function testRule() {
    setTesting(true);
    setError('');
    setTestResult(null);
    try {
      const res = await readerPost<TestResult>('sources/test', { rule: editing, keyword: '诡秘' });
      setTestResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : '测试书源失败');
    } finally {
      setTesting(false);
    }
  }

  async function removeRule(id: string) {
    if (!window.confirm('删除这条自定义书源规则？已收录书籍的本地章节仍会保留。')) return;
    try {
      const data = await readerPost<{ sources: BookSourceItem[] }>('sources/delete', { id });
      setSources(data.sources || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除规则失败');
    }
  }

  async function importJsonRules() {
    setError('');
    setNotice('');
    try {
      const parsed = JSON.parse(jsonImportText);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      if (!list.length) throw new Error('JSON 规则为空');
      if (list.length === 1) {
        const one = list[0];
        setEditing({
          ...emptyRule(),
          name: one.bookSourceName || one.name || '',
          baseUrl: one.bookSourceUrl || one.baseUrl || '',
          searchUrl: one.searchUrl || '',
          charset: one.charset || 'utf-8',
          searchList: one.ruleSearch?.bookList || one.searchList || '',
          searchTitle: one.ruleSearch?.name || one.searchTitle || '',
          searchAuthor: one.ruleSearch?.author || one.searchAuthor || '',
          searchIntro: one.ruleSearch?.intro || one.searchIntro || '',
          searchBookUrl: one.ruleSearch?.bookUrl || one.searchBookUrl || 'a@href',
          tocUrlSelector: one.ruleBookInfo?.tocUrl || one.tocUrlSelector || '',
          catalogList: one.ruleToc?.chapterList || one.catalogList || '',
          catalogTitle: one.ruleToc?.chapterName || one.catalogTitle || '',
          catalogUrl: one.ruleToc?.chapterUrl || one.catalogUrl || '@href',
          bookTitle: one.ruleBookInfo?.name || one.bookTitle || 'h1',
          bookAuthor: one.ruleBookInfo?.author || one.bookAuthor || '',
          bookIntro: one.ruleBookInfo?.intro || one.bookIntro || '',
          contentSelector: one.ruleContent?.content || one.contentSelector || '#content',
          contentExclude: one.contentExclude || 'script, style, ins',
          nextPageSelector: one.ruleContent?.nextContentUrl || one.nextPageSelector || '',
        });
        setShowJsonBox(false);
        setJsonImportText('');
        setNotice('已填入编辑表单，请检查并保存或先点测试');
        return;
      }
      let imported = 0;
      for (const item of list) {
        try {
          await readerPost('sources/save', item);
          imported++;
        } catch {}
      }
      await loadSources();
      setShowJsonBox(false);
      setJsonImportText('');
      setNotice(`已批量导入 ${imported} 条书源规则`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '书源 JSON 格式无法识别');
    }
  }

  async function importSubscriptionUrl() {
    const url = subUrl.trim();
    if (!url) return;
    setImportingUrl(true);
    setError('');
    setNotice('');
    try {
      const res = await readerPost<{ imported: number; skipped: number; sources: BookSourceItem[] }>('sources/import-url', { url });
      setSources(res.sources || []);
      setSubUrl('');
      setShowJsonBox(false);
      setNotice(`订阅导入完成：新增 ${res.imported} 条书源${res.skipped ? `（跳过 ${res.skipped} 条不兼容规则）` : ''}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '从订阅地址导入失败');
    } finally {
      setImportingUrl(false);
    }
  }

  function exportAllRules() {
    const rules = sources.filter(s => s.kind === 'rule' && s.rule).map(s => ({ ...s.rule, id: s.id, name: s.name, baseUrl: s.baseUrl }));
    const blob = new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mokuji-book-sources-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setNotice(`已导出 ${rules.length} 条自定义书源规则`);
  }

  async function sniffByUrl(rawUrl: string) {
    const u = rawUrl.trim();
    if (!u) return;
    setSniffing(true);
    setError('');
    setNotice('');
    setSniffPreview(null);
    try {
      const res = await readerPost<SniffPreview>('sniff', { url: u, mode: 'preview' });
      setSniffPreview(res);
      setSniffTitle(res.title || '');
      setSniffCat(res.category || '网文');
    } catch (err) {
      setError(err instanceof Error ? err.message : '嗅探网页或文件失败');
    } finally {
      setSniffing(false);
    }
  }

  async function runSniffPreview(e: FormEvent) {
    e.preventDefault();
    await sniffByUrl(sniffUrl);
  }

  async function saveSniffed() {
    if (!sniffPreview) return;
    setSniffSaving(true);
    setError('');
    try {
      const res = await readerPost<{ kind: string; book: ReaderBook }>('sniff', {
        url: sniffPreview.url,
        mode: 'save',
        title: sniffTitle.trim() || sniffPreview.title,
        author: sniffPreview.author || '',
        category: sniffCat,
        ...(workId ? { workId } : {}),
      });
      if (!workId) {
        const shelfId = await onAddShelf({
          title: res.book.title,
          author: res.book.author || '',
          sourceUrl: res.book.sourceUrl || sniffPreview.url,
          category: sniffCat,
          initialStatus: '在读',
        }).catch(() => undefined);
        if (shelfId) {
          await readerPost('bind', { workId: shelfId, bookId: res.book.id }).catch(() => undefined);
        }
      }
      onReloadLibrary();
      onRead(res.book.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存嗅探结果失败');
    } finally {
      setSniffSaving(false);
    }
  }

  const visibleHits = hits.filter(h => {
    if (channel === '全部') return true;
    if (channel === '自定义') return !sources.find(s => s.id === h.sourceId && s.kind === 'builtin');
    return (h.category || '网文') === channel;
  });

  return (
    <section className="custom-sources-panel">
      <div className="sources-head">
        <div>
          <h2>全网搜书 · 漫画 · 轻小说 · 万能嗅探</h2>
          <p>覆盖网文（晋江/纵横/17K）、轻小说（SF）、漫画（MangaDex/CBZ）与名著（维基文库）；找不到时可直接粘贴网页或文件链接智能嗅探。</p>
        </div>
        <button type="button" className="button button-outline" onClick={() => setManageOpen(v => !v)}>
          <Settings2 size={14} />
          {manageOpen ? '收起书源管理' : `管理与新增书源 (${sources.length})`}
        </button>
      </div>

      <div className="sniffer-box">
        <div className="sniffer-head">
          <strong><Compass size={15} /> 无书源也能读：网页目录 / 正文 / TXT · EPUB · CBZ 链接智能嗅探</strong>
          <span>贴上任意书籍目录页、文章页或直链文件网址，自动下载或抽取章节加入书架</span>
        </div>
        <form className="sniffer-form" onSubmit={runSniffPreview}>
          <input
            type="url"
            value={sniffUrl}
            onChange={e => setSniffUrl(e.target.value)}
            placeholder="粘贴书籍网页目录、漫画章节网址，或 .txt / .epub / .cbz 下载链接…"
            aria-label="嗅探网址"
          />
          <button type="submit" className="button button-sage" disabled={sniffing || !sniffUrl.trim()}>
            <Sparkles size={14} />{sniffing ? '正在嗅探解析…' : '智能嗅探'}
          </button>
        </form>
        {sniffPreview && (
          <div className="sniffer-preview">
            <div className="sniffer-preview-meta">
              <span className="source-badge">{sniffPreview.kind === 'file' ? `文件直链 (${sniffPreview.fileType?.toUpperCase()})` : sniffPreview.kind === 'catalog' ? `目录网页 (${sniffPreview.chapterCount} 章)` : sniffPreview.kind === 'manga' ? `漫画图集 (${sniffPreview.pageCount} 页)` : `单篇长文 (${sniffPreview.paragraphCount} 段)`}</span>
              <div className="form-row" style={{ marginTop: 8 }}>
                <label className="field-label">收录书名<input value={sniffTitle} onChange={e => setSniffTitle(e.target.value)} /></label>
                <label className="field-label">门类
                  <select value={sniffCat} onChange={e => setSniffCat(e.target.value as typeof sniffCat)}>
                    <option value="网文">网文</option>
                    <option value="轻小说">轻小说</option>
                    <option value="漫画">漫画</option>
                    <option value="文学">文学</option>
                  </select>
                </label>
              </div>
              {!!sniffPreview.previewChapters?.length && (
                <p className="sniffer-chapters-preview">识别章节：{sniffPreview.previewChapters.join(' · ')} …</p>
              )}
              {!!sniffPreview.previewParagraphs?.length && (
                <blockquote>{sniffPreview.previewParagraphs[0]}</blockquote>
              )}
            </div>
            <div className="sniffer-preview-actions">
              <button type="button" className="button button-sage" disabled={sniffSaving} onClick={saveSniffed}>
                {sniffSaving ? '正在收录导入…' : '确认收录并开始阅读'}
              </button>
              <button type="button" className="button button-outline" onClick={() => setSniffPreview(null)}>取消</button>
            </div>
          </div>
        )}
      </div>

      <div className="channel-pills" role="group" aria-label="按阅读门类筛选">
        {(['全部', '网文', '轻小说', '漫画', '文学', '自定义'] as const).map(c => (
          <button
            key={c}
            type="button"
            className={channel === c ? 'selected' : ''}
            onClick={() => setChannel(c)}
          >
            {c === '全部' ? '全部分类' : c}
          </button>
        ))}
      </div>

      <div className="source-chips-bar" aria-label="书源开关状态">
        {sources.filter(src => {
          if (channel === '全部') return true;
          if (channel === '自定义') return src.kind === 'rule';
          return (src.category || '网文') === channel;
        }).map(src => (
          <button
            key={src.id}
            type="button"
            className={`source-chip ${src.enabled ? 'enabled' : 'disabled'}`}
            onClick={() => (src.kind === 'builtin' ? toggleBuiltin(src) : setEditing(src.rule || emptyRule()), src.kind === 'rule' && setManageOpen(true))}
            title={src.kind === 'builtin' ? '点击切换启用/停用' : '点击编辑此规则'}
          >
            <Globe size={12} />
            <span>{src.name}</span>
            <em>{src.enabled ? '已启用' : '已停用'}</em>
          </button>
        ))}
      </div>

      <form className="sources-search-bar" onSubmit={runSearch}>
        <label className="reader-source-filter">
          <Search size={15} />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="输入书名或作者（如：诡秘之主、红楼梦、斗破苍穹）…"
            aria-label="书源搜索关键词"
          />
        </label>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} aria-label="限定书源">
          <option value="">全部已启用书源</option>
          {sources.filter(s => s.enabled).map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <button type="submit" className="button button-sage" disabled={searching || !query.trim()}>
          {searching ? '搜索中…' : '全网搜书'}
        </button>
      </form>

      {error && (
        <div className="form-error" role="alert">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="reader-hub-note" role="status">
          <CheckCircle2 size={15} />
          <span>{notice}</span>
        </div>
      )}
      {!!searchErrors.length && (
        <p className="sources-warn">
          部分书源未返回结果：{searchErrors.map(e => `${e.sourceName}（${e.error}）`).join('；')}
        </p>
      )}

      {manageOpen && (
        <div className="sources-manager">
          <div className="sources-manager-top">
            <h3>新增 / 编辑自定义书源（支持笔趣阁 & CSS 选择器规则）</h3>
            <div className="sources-template-actions">
              {templates.map(t => (
                <button
                  key={t.label}
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setEditing({ ...emptyRule(), ...t.rule });
                    setTestResult(null);
                  }}
                >
                  <Plus size={12} />
                  套用：{t.label.split('（')[0]}
                </button>
              ))}
              <button type="button" className="text-button" onClick={() => setShowJsonBox(v => !v)}>
                <Code2 size={13} />
                导入 JSON / Legado 规则
              </button>
            </div>
          </div>

          {showJsonBox && (
            <div className="sources-json-box">
              <div className="form-row">
                <label className="field-label" style={{ flex: 1 }}>
                  从远程 JSON 订阅链接导入（支持阅读/Legado 合集）
                  <input type="url" value={subUrl} onChange={e => setSubUrl(e.target.value)} placeholder="https://example.com/sources.json" />
                </label>
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button type="button" className="button button-sage" disabled={importingUrl || !subUrl.trim()} onClick={importSubscriptionUrl}>
                    {importingUrl ? '拉取中…' : '订阅导入'}
                  </button>
                </div>
              </div>
              <textarea
                rows={5}
                value={jsonImportText}
                onChange={e => setJsonImportText(e.target.value)}
                placeholder="或者在此粘贴单条 / 多条 JSON 数组书源（支持 Legado ruleSearch / ruleToc / ruleContent、|| 兜底与 ## 正则净化）…"
              />
              <div className="sources-json-actions">
                <button type="button" className="button button-sage" onClick={importJsonRules}>解析并导入 JSON</button>
                <label className="button button-outline" style={{ cursor: 'pointer' }}>
                  从本地 .json 导入
                  <input type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={async e => {
                    const f = e.target.files?.[0];
                    if (f) setJsonImportText(await f.text());
                  }} />
                </label>
                {sources.some(s => s.kind === 'rule') && (
                  <button type="button" className="button button-outline" onClick={exportAllRules}>导出已有规则</button>
                )}
                <button type="button" className="button button-outline" onClick={() => setShowJsonBox(false)}>收起</button>
              </div>
            </div>
          )}

          <form className="sources-rule-form" onSubmit={saveRule}>
            <div className="form-row">
              <label className="field-label">书源名称 *<input required value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="例如：XX 笔趣阁" /></label>
              <label className="field-label">站点根地址 *<input required type="url" value={editing.baseUrl} onChange={e => setEditing({ ...editing, baseUrl: e.target.value })} placeholder="https://www.example.com" /></label>
              <label className="field-label">页面编码<select value={editing.charset || 'utf-8'} onChange={e => setEditing({ ...editing, charset: e.target.value })}><option value="utf-8">UTF-8</option><option value="gbk">GBK / GB2312</option></select></label>
            </div>
            <label className="field-label">
              搜索地址模板 *（用 <code>{'{{key}}'}</code> 占位关键词）
              <input required value={editing.searchUrl} onChange={e => setEditing({ ...editing, searchUrl: e.target.value })} placeholder="https://www.example.com/search.php?q={{key}}" />
            </label>
            <div className="form-row">
              <label className="field-label">搜索列表选择器 *<input required value={editing.searchList} onChange={e => setEditing({ ...editing, searchList: e.target.value })} placeholder=".grid tr, .result-list .item" /></label>
              <label className="field-label">书名选择器 *<input required value={editing.searchTitle} onChange={e => setEditing({ ...editing, searchTitle: e.target.value })} placeholder="td:first-child a" /></label>
              <label className="field-label">详情链接选择器 *<input required value={editing.searchBookUrl} onChange={e => setEditing({ ...editing, searchBookUrl: e.target.value })} placeholder="a@href" /></label>
            </div>
            <div className="form-row">
              <label className="field-label">作者选择器<input value={editing.searchAuthor || ''} onChange={e => setEditing({ ...editing, searchAuthor: e.target.value })} placeholder=".author" /></label>
              <label className="field-label">目录列表选择器 *<input required value={editing.catalogList} onChange={e => setEditing({ ...editing, catalogList: e.target.value })} placeholder="#list dd a" /></label>
              <label className="field-label">正文容器选择器 *<input required value={editing.contentSelector} onChange={e => setEditing({ ...editing, contentSelector: e.target.value })} placeholder="#content, #chaptercontent" /></label>
            </div>
            <div className="form-row">
              <label className="field-label">广告排除选择器<input value={editing.contentExclude || ''} onChange={e => setEditing({ ...editing, contentExclude: e.target.value })} placeholder="script, style, .ads" /></label>
              <label className="field-label">目录独立页选择器（可选）<input value={editing.tocUrlSelector || ''} onChange={e => setEditing({ ...editing, tocUrlSelector: e.target.value })} placeholder="a:contains('全部章节')@href" /></label>
            </div>
            <div className="sources-form-actions">
              <button type="button" className="button button-outline" disabled={testing || !editing.searchUrl} onClick={testRule}>
                <FlaskConical size={14} />
                {testing ? '正在测试解析…' : '测试规则（试搜+试读第1章）'}
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                {editing.id && (
                  <button type="button" className="button button-outline" onClick={() => { setEditing(emptyRule()); setTestResult(null); }}>
                    重置新建
                  </button>
                )}
                <button type="submit" className="button button-sage" disabled={savingRule}>
                  {savingRule ? '保存中…' : editing.id ? '更新书源规则' : '保存并启用'}
                </button>
              </div>
            </div>
          </form>

          {testResult && (
            <div className={`sources-test-report ${testResult.ok ? 'ok' : 'warn'}`}>
              <strong>{testResult.ok ? '测试通过' : '解析不完整'}：</strong>
              {testResult.message || `搜到 ${testResult.hits.length} 本，首本书共 ${testResult.chapterCount} 章（${testResult.firstChapterTitle || '无章节标题'}）`}
              {testResult.note && <p>{testResult.note}</p>}
              {!!testResult.preview?.length && (
                <blockquote>{testResult.preview[0]}</blockquote>
              )}
            </div>
          )}

          {sources.some(s => s.kind === 'rule') && (
            <div className="sources-saved-list">
              <h4>已保存的自定义规则</h4>
              <ul>
                {sources.filter(s => s.kind === 'rule').map(s => (
                  <li key={s.id}>
                    <div>
                      <strong>{s.name}</strong>
                      <span>{s.baseUrl}</span>
                    </div>
                    <div>
                      <button type="button" className="text-button" onClick={() => s.rule && setEditing(s.rule)}>编辑</button>
                      <button type="button" className="text-button danger" onClick={() => removeRule(s.id)}><Trash2 size={13} />删除</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {!!visibleHits.length && (
        <div className="sources-results">
          {visibleHits.map(hit => {
            const key = `${hit.sourceId}:${hit.remoteId}`;
            const busyHere = addingKey === key;
            return (
              <article key={key} className="reader-source-row">
                <div className="reader-book-icon" aria-hidden="true"><BookOpen size={19} /></div>
                <div className="reader-source-data">
                  <strong>{hit.title}</strong>
                  <span className="source-badge">{hit.sourceName}</span>
                  <p>{hit.author || '作者待补充'}</p>
                  {hit.intro && <small>{hit.intro}</small>}
                </div>
                <div className="reader-row-actions">
                  <button type="button" className="button button-sage" disabled={!!addingKey} onClick={() => addHit(hit, true)}>
                    {busyHere ? '拉取目录中…' : '加入书架并阅读'}
                  </button>
                  <button type="button" className="text-button" disabled={!!addingKey} onClick={() => addHit(hit, false)}>
                    <Download size={12} />仅拉取目录
                  </button>
                  {externalUrl(hit.detailUrl) && (
                    <a href={hit.detailUrl} target="_blank" rel="noreferrer">
                      原站<ExternalLink size={11} />
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {searchedOnce && !visibleHits.length && !searching && (
        <p className="sources-empty">当前门类下暂无内置书源命中。你可以使用下方的全网线索搜索找到页面或下载直链后，粘贴到上方「智能嗅探」框一键导入。</p>
      )}
      {query.trim() && (
        <div className="fallback-web-search">
          <span>在内置书源没找全？去搜索引擎找网页目录 / TXT / EPUB / CBZ，把链接贴进上方智能嗅探：</span>
          <div>
            <a className="button button-outline" href={`https://cn.bing.com/search?q=${encodeURIComponent(query.trim() + ' (epub OR txt OR 轻小说 OR 漫画)')}`} target="_blank" rel="noreferrer">
              必应搜文件/目录 <ExternalLink size={12} />
            </a>
            <a className="button button-outline" href={`https://www.baidu.com/s?wd=${encodeURIComponent(query.trim() + ' 全文阅读 txt')}`} target="_blank" rel="noreferrer">
              百度搜全网正文 <ExternalLink size={12} />
            </a>
            <a className="button button-outline" href={`https://zh.wikisource.org/w/index.php?search=${encodeURIComponent(query.trim())}`} target="_blank" rel="noreferrer">
              维基文库搜古籍名著 <ExternalLink size={12} />
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
