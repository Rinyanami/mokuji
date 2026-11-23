import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  FileText,
  FolderOpen,
  List,
  Search,
  Settings2,
  Share2,
  Sparkles,
  X,
} from 'lucide-react';
import { ReaderLedeContext, ReaderTailContext } from './reader-shell-lede';
import { PeekText, RevealToggle } from './reader-shell-peek';
import { ModelSwitcherPopover, ShellActionBar } from './reader-shell-popovers';
import type { ReaderShellProps } from './reader-shell-types';
import './reader-shell-mobile-docs.css';

export default function MobileDocsShell(p: ReaderShellProps) {
  const isFeishu = p.product === 'feishu';
  const theme = p.shellTheme ?? 'light';
  const [tocOpen, setTocOpen] = useState(false);
  const [skinPop, setSkinPop] = useState(false);
  const [tocQuery, setTocQuery] = useState('');

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
  const todayLabel = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

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

  const tail = <ShellActionBar p={p} variant={isFeishu ? 'workbuddy' : 'doubao'} theme={theme} />;

  return (
    <div
      className={'mk-mdocs ' + (isFeishu ? 'mk-mdocs-feishu ' : 'mk-mdocs-notes ') + (theme === 'dark' ? 'mk-theme-dark' : '')}
      data-product={p.product}
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
            className={'mk-mdocs-icon' + (p.bookmarked ? ' is-active' : '')}
            aria-label="书签"
            title="切换当前位置书签"
            onClick={() => p.onBookmark?.()}
          >
            <Bookmark size={16} fill={p.bookmarked ? 'currentColor' : 'none'} />
          </button>
          {p.onToggleSummary && (
            <button
              type="button"
              className={'mk-mdocs-icon' + (p.summaryOpen ? ' is-active' : '')}
              aria-label="老板键工作摘要"
              title="切换工作摘要"
              onClick={p.onToggleSummary}
            >
              <EyeOff size={16} />
            </button>
          )}
          <button type="button" className="mk-mdocs-icon" aria-label="返回书架" title="返回书架" onClick={p.onBack}>
            <FolderOpen size={16} />
          </button>
        </div>
      </header>

      <div className="mk-mdocs-body">
        {tocOpen && (
          <>
            <button type="button" className="mk-mdocs-scrim" aria-label="关闭目录抽屉" onClick={() => setTocOpen(false)} />
            <aside className="mk-mdocs-drawer" aria-label="章节大纲抽屉">
              <div className="mk-mdocs-drawer-head">
                <span>{isFeishu ? '文档大纲' : '备忘录目录'} ({p.chapters.length})</span>
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

        <div className="mk-mdocs-sheet-host">
          <ReaderLedeContext.Provider value={lede}>
            <ReaderTailContext.Provider value={tail}>{p.children}</ReaderTailContext.Provider>
          </ReaderLedeContext.Provider>
        </div>
      </div>

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
        <button type="button" className="mk-mdocs-foot-btn" onClick={() => setTocOpen(v => !v)}>
          <List size={15} />
          <span>目录</span>
        </button>
        <button type="button" className="mk-mdocs-foot-btn" onClick={() => p.onFindRecord?.('')}>
          <Search size={15} />
          <span>搜索/笔记</span>
        </button>
        <div className="mk-mdocs-pop-anchor">
          <button type="button" className="mk-mdocs-foot-btn" onClick={() => setSkinPop(v => !v)} title="切换伪装皮肤">
            {isFeishu ? <Share2 size={14} /> : <FileText size={14} />}
            <span>{isFeishu ? '飞书' : '备忘'}</span>
          </button>
          {skinPop && (
            <ModelSwitcherPopover open onClose={() => setSkinPop(false)} theme={theme} align="right" placement="above" p={p} />
          )}
        </div>
        <button type="button" className="mk-mdocs-foot-btn" onClick={p.onSettings} aria-label="阅读设置">
          <Settings2 size={15} />
        </button>
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
