import { useMemo, useRef, useState, type MouseEvent, type TouchEvent } from 'react';
import {
  ArrowLeft,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  EyeOff,
  FileText,
  FolderOpen,
  List,
  Search,
  Settings2,
  Share2,
  Sparkles,
  Type,
  X,
} from 'lucide-react';
import type { ReaderPaperTheme } from './reader-appearance';
import { ReaderLedeContext, ReaderTailContext } from './reader-shell-lede';
import { PeekText, RevealToggle } from './reader-shell-peek';
import { ModelSwitcherPopover } from './reader-shell-popovers';
import type { ReaderShellProps } from './reader-shell-types';
import './reader-shell-mobile-docs.css';

const paperOptions: readonly { value: ReaderPaperTheme; label: string }[] = [
  { value: 'default', label: '默认' },
  { value: 'sepia', label: '暖纸' },
  { value: 'green', label: '护眼绿' },
  { value: 'dark', label: '暗夜' },
];

const lineHeightOptions: readonly { value: number; label: string }[] = [
  { value: 1.6, label: '紧凑' },
  { value: 1.85, label: '舒适' },
  { value: 2.15, label: '宽松' },
];

export default function MobileDocsShell(p: ReaderShellProps) {
  const isFeishu = p.product === 'feishu';
  const theme = p.shellTheme ?? 'light';
  const paper: ReaderPaperTheme = p.paperTheme ?? (theme === 'dark' ? 'dark' : 'default');
  const lineHeight = p.lineHeight ?? 1.85;
  const fontSize = p.fontSize ?? 16;

  const [tocOpen, setTocOpen] = useState(false);
  const [skinPop, setSkinPop] = useState(false);
  const [typoPop, setTypoPop] = useState(false);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tocQuery, setTocQuery] = useState('');
  const touchStart = useRef<{ x: number; y: number; time: number } | null>(null);

  const at = useMemo(() => p.chapters.findIndex(c => c.n === p.chapter), [p.chapters, p.chapter]);
  const prev = at > 0 ? p.chapters[at - 1] : undefined;
  const next = at >= 0 ? p.chapters[at + 1] : undefined;
  const norm = tocQuery.trim().toLowerCase();
  const filteredChapters = useMemo(
    () =>
      norm
        ? p.chapters.filter(
            c =>
              c.title.toLowerCase().includes(norm) ||
              (c.realTitle || '').toLowerCase().includes(norm) ||
              String(c.n + 1) === norm,
          )
        : p.chapters,
    [p.chapters, norm],
  );

  const maskDocTitle = isFeishu ? '项目评审会议纪要 · V2' : '待办与工作随记';
  const maskSection = isFeishu ? p.chapterTitle || `议题 ${p.chapter + 1}` : `备忘条目 #${p.chapter + 1}`;
  const todayLabel = useMemo(
    () => new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    [],
  );

  function handleBodyClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('button, a, input, select, textarea, mark, .mk-mdocs-typo-pop, .mk-model-popover')) return;
    const sel = window.getSelection?.()?.toString()?.trim();
    if (sel) return;
    if (skinPop || typoPop) {
      setSkinPop(false);
      setTypoPop(false);
      return;
    }
    setChromeHidden(v => !v);
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 1) return;
    touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY, time: Date.now() };
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || event.changedTouches.length !== 1 || p.disabled || p.summaryOpen) return;
    const sel = window.getSelection?.()?.toString()?.trim();
    if (sel) return;
    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    const dt = Date.now() - start.time;
    if (dt < 550 && Math.abs(dx) > 72 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      if (dx < 0 && next?.available) p.onChapter(next.n);
      else if (dx > 0 && prev?.available) p.onChapter(prev.n);
    }
  }

  function copyChapter() {
    p.onCopyChapter?.();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  const lede = (
    <div className="mk-mdocs-lede">
      {isFeishu ? (
        <div className="mk-mdocs-feishu-tag">
          <Sparkles size={12} />
          <span>飞书云文档 · 仅自己可见</span>
        </div>
      ) : (
        <div className="mk-mdocs-date">{todayLabel} · 已同步备忘录</div>
      )}
      <h1 className="mk-mdocs-title">
        <PeekText mask={maskSection} real={p.realChapterTitle || maskSection} />
      </h1>
      <div className="mk-mdocs-subrow">
        <span>
          <PeekText mask={maskDocTitle} real={p.realBookTitle || maskDocTitle} /> · 第 {p.chapter + 1} / {p.chapters.length} 节
        </span>
        {p.onToggleSummary && (
          <button type="button" className="mk-mdocs-summary-btn" onClick={p.onToggleSummary}>
            {p.summaryOpen ? '回到正文' : '老板键·切工作纪要'}
          </button>
        )}
      </div>
    </div>
  );

  const tail = (
    <div className="mk-mdocs-tail">
      <div className="mk-mdocs-tail-actions">
        <button
          type="button"
          className="mk-mdocs-tail-btn"
          disabled={p.disabled || !prev?.available}
          onClick={() => prev && p.onChapter(prev.n)}
        >
          <ChevronLeft size={15} />
          <span>上一节</span>
        </button>
        <button
          type="button"
          className={'mk-mdocs-tail-btn' + (p.bookmarked ? ' is-active' : '')}
          onClick={() => p.onBookmark?.()}
        >
          <Bookmark size={14} fill={p.bookmarked ? 'currentColor' : 'none'} />
          <span>{p.bookmarked ? '已标记' : '记书签'}</span>
        </button>
        <button type="button" className="mk-mdocs-tail-btn" onClick={copyChapter}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          <span>{copied ? '已复制' : '复制本节'}</span>
        </button>
        <button
          type="button"
          className="mk-mdocs-tail-btn is-primary"
          disabled={p.disabled || !next?.available}
          onClick={() => next && p.onChapter(next.n)}
        >
          <span>下一节</span>
          <ChevronRight size={15} />
        </button>
      </div>
      <div className="mk-mdocs-tail-meta">
        <span>{isFeishu ? '飞书云文档 · 刚刚自动保存' : '已自动保存至本机备忘录'}</span>
        <span>
          {(p.progressPercent ?? 0).toFixed(1)}% · 左滑翻下节
        </span>
      </div>
    </div>
  );

  return (
    <div
      className={
        'mk-mdocs ' +
        (isFeishu ? 'mk-mdocs-feishu ' : 'mk-mdocs-notes ') +
        (theme === 'dark' ? 'mk-theme-dark ' : '') +
        (chromeHidden ? 'mk-chrome-hidden' : '')
      }
      data-product={p.product}
      data-paper={paper}
      style={{ ['--md-line-height' as string]: String(lineHeight) }}
    >
      <header className="mk-mdocs-top">
        {isFeishu ? (
          <div className="mk-mdocs-crumbs" aria-label="文档导航">
            <button type="button" onClick={p.onBack} title="返回我的书架">
              <ArrowLeft size={13} style={{ marginRight: 2, verticalAlign: '-2px' }} />
              首页
            </button>
            <ChevronRight size={12} />
            <button type="button" onClick={p.onProjects} title="切换书籍 / 工作区">
              我的空间
            </button>
            <ChevronRight size={12} />
            <button type="button" onClick={() => setTocOpen(v => !v)} title="打开文档大纲抽屉">
              {p.revealReal ? p.realBookTitle || maskDocTitle : maskDocTitle}
            </button>
          </div>
        ) : (
          <>
            <button type="button" className="mk-mdocs-back" onClick={p.onProjects} title="查看全部备忘录（切换书籍）">
              <ChevronLeft size={16} />
              <span>备忘录</span>
            </button>
            <div className="mk-mdocs-crumbs">
              <button type="button" onClick={() => setTocOpen(v => !v)}>
                <PeekText mask={maskSection} real={p.realChapterTitle || maskSection} />
              </button>
            </div>
          </>
        )}
        <div className="mk-mdocs-top-tools">
          <RevealToggle active={!!p.revealReal} onToggle={() => p.onToggleReveal?.()} label={p.revealReal ? '隐藏' : '显真'} />
          <button
            type="button"
            className="mk-mdocs-icon"
            aria-label="搜索与划线笔记"
            title="搜索正文 / 书签 / 划线笔记"
            onClick={() => p.onFindRecord?.('')}
          >
            <Search size={15} />
          </button>
          <button
            type="button"
            className={'mk-mdocs-icon' + (p.bookmarked ? ' is-active' : '')}
            aria-label="书签"
            title="切换当前位置书签"
            onClick={() => p.onBookmark?.()}
          >
            <Bookmark size={15} fill={p.bookmarked ? 'currentColor' : 'none'} />
          </button>
          {p.onToggleSummary && (
            <button
              type="button"
              className={'mk-mdocs-icon' + (p.summaryOpen ? ' is-active' : '')}
              aria-label="老板键工作摘要"
              title="切换工作摘要"
              onClick={p.onToggleSummary}
            >
              <EyeOff size={15} />
            </button>
          )}
          <button type="button" className="mk-mdocs-icon" aria-label="返回书架" title="返回书架" onClick={p.onBack}>
            <FolderOpen size={15} />
          </button>
        </div>
      </header>

      <div className="mk-mdocs-body">
        {tocOpen && (
          <>
            <button type="button" className="mk-mdocs-scrim" aria-label="关闭目录抽屉" onClick={() => setTocOpen(false)} />
            <aside className="mk-mdocs-drawer" aria-label="章节大纲抽屉">
              <div className="mk-mdocs-drawer-head">
                <span>
                  {isFeishu ? '文档大纲' : '备忘录目录'} ({p.chapters.length})
                </span>
                <button type="button" className="mk-mdocs-icon" aria-label="关闭目录" onClick={() => setTocOpen(false)}>
                  <X size={15} />
                </button>
              </div>
              <label className="mk-mdocs-filter">
                <Search size={14} />
                <input
                  value={tocQuery}
                  onChange={e => setTocQuery(e.target.value)}
                  placeholder="筛选章节名或编号…"
                  aria-label="筛选章节"
                />
              </label>
              <div className="mk-mdocs-toc">
                {filteredChapters.slice(0, 120).map(item => (
                  <button
                    key={item.n}
                    type="button"
                    className="mk-mdocs-toc-item"
                    aria-current={item.n === p.chapter ? 'page' : undefined}
                    disabled={p.disabled || !item.available}
                    onClick={() => {
                      setTocOpen(false);
                      if (item.n !== p.chapter) p.onChapter(item.n);
                    }}
                  >
                    <small>#{item.n + 1}</small>
                    <PeekText mask={item.title} real={item.realTitle} />
                  </button>
                ))}
              </div>
            </aside>
          </>
        )}

        <div
          className="mk-mdocs-sheet-host"
          onClick={handleBodyClick}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <ReaderLedeContext.Provider value={lede}>
            <ReaderTailContext.Provider value={tail}>{p.children}</ReaderTailContext.Provider>
          </ReaderLedeContext.Provider>
        </div>

        {chromeHidden && (
          <button
            type="button"
            className="mk-mdocs-float-pill"
            onClick={() => setChromeHidden(false)}
            aria-label="呼出阅读菜单"
          >
            <span>
              第 {p.chapter + 1}/{p.chapters.length} 节 · {(p.progressPercent ?? 0).toFixed(0)}% · 点此呼出菜单
            </span>
          </button>
        )}
      </div>

      {typoPop && (
        <div className="mk-mdocs-typo-pop" role="dialog" aria-label="排版与阅读设置">
          <div className="mk-typo-row">
            <span>纸张护眼</span>
            <div className="mk-typo-papers">
              {paperOptions.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  className={'mk-typo-chip mk-paper-' + opt.value + (paper === opt.value ? ' is-active' : '')}
                  aria-pressed={paper === opt.value}
                  onClick={() => {
                    p.onPaperTheme?.(opt.value);
                    if (opt.value === 'dark') p.onShellTheme?.('dark');
                    else if (theme === 'dark') p.onShellTheme?.('light');
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mk-typo-row">
            <span>字号大小</span>
            <div className="mk-typo-stepper">
              <button
                type="button"
                disabled={fontSize <= 14}
                onClick={() => p.onFontSize?.(Math.max(14, fontSize - 2))}
                aria-label="减小字号"
              >
                A-
              </button>
              <strong>{fontSize}px</strong>
              <button
                type="button"
                disabled={fontSize >= 26}
                onClick={() => p.onFontSize?.(Math.min(26, fontSize + 2))}
                aria-label="增大字号"
              >
                A+
              </button>
            </div>
          </div>

          <div className="mk-typo-row">
            <span>行距密度</span>
            <div className="mk-typo-seg">
              {lineHeightOptions.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={Math.abs(lineHeight - opt.value) < 0.05}
                  onClick={() => p.onLineHeight?.(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {p.chapters.length > 1 && (
            <div className="mk-typo-slider-row">
              <div className="mk-typo-slider-head">
                <span>进度跳转</span>
                <small>
                  第 {p.chapter + 1} / {p.chapters.length} 节
                </small>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, p.chapters.length - 1)}
                value={Math.max(0, at >= 0 ? at : 0)}
                aria-label="章节进度条"
                onChange={e => {
                  const idx = Number(e.target.value);
                  const target = p.chapters[idx];
                  if (target?.available && target.n !== p.chapter) p.onChapter(target.n);
                }}
              />
            </div>
          )}

          <button
            type="button"
            className="mk-typo-more"
            onClick={() => {
              setTypoPop(false);
              p.onSettings();
            }}
          >
            <Settings2 size={13} />
            <span>全部阅读设置（工作提示 / 书签导出）…</span>
          </button>
        </div>
      )}

      <footer className="mk-mdocs-foot">
        <button
          type="button"
          className="mk-mdocs-foot-btn"
          disabled={p.disabled || !prev?.available}
          onClick={() => prev && p.onChapter(prev.n)}
        >
          <ChevronLeft size={15} />
          <span>上节</span>
        </button>
        <button type="button" className="mk-mdocs-foot-btn" onClick={() => { setTypoPop(false); setSkinPop(false); setTocOpen(v => !v); }}>
          <List size={15} />
          <span>目录</span>
        </button>
        <button
          type="button"
          className={'mk-mdocs-foot-btn' + (typoPop ? ' is-active' : '')}
          onClick={() => { setSkinPop(false); setTypoPop(v => !v); }}
          aria-expanded={typoPop}
        >
          <Type size={15} />
          <span>排版</span>
        </button>
        <div className="mk-mdocs-pop-anchor">
          <button
            type="button"
            className={'mk-mdocs-foot-btn' + (skinPop ? ' is-active' : '')}
            onClick={() => { setTypoPop(false); setSkinPop(v => !v); }}
            title="切换伪装皮肤"
          >
            {isFeishu ? <Share2 size={14} /> : <FileText size={14} />}
            <span>{isFeishu ? '飞书' : '备忘'}</span>
          </button>
          {skinPop && (
            <ModelSwitcherPopover open onClose={() => setSkinPop(false)} theme={theme} align="right" placement="above" p={p} />
          )}
        </div>
        <button
          type="button"
          className="mk-mdocs-foot-btn"
          disabled={p.disabled || !next?.available}
          onClick={() => next && p.onChapter(next.n)}
        >
          <span>下节</span>
          <ChevronRight size={15} />
        </button>
      </footer>
    </div>
  );
}
