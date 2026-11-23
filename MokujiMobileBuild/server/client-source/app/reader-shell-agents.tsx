import { useSidebarShortcut } from './reader-shortcuts';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft, ArrowRight, ArrowUp, Bookmark, BookOpen, Boxes, Brain, Check, Clock3,
  ChevronDown, ChevronLeft, ChevronRight, CirclePlus, Columns2, FileCode2, FileText,
  Folder, FolderGit2, GitBranch, List, PanelLeft, Plus, Search, Settings2, Sparkles,
  SquarePen, Terminal, X,
} from 'lucide-react';
import { ReaderLedeContext, ReaderTailContext } from './reader-shell-lede';
import { ModelSwitcherPopover, ShellActionBar, SidebarTaskActions } from './reader-shell-popovers';
import { PeekText, RevealToggle } from './reader-shell-peek';
import type { ReaderShellProps } from './reader-shell-types';
import CotexShell from './reader-shell-cotex';
import './reader-shell-agents.css';

type Pane = 'reader' | 'directory' | 'progress' | 'skills';
const chapterLabel = (chapter: { n: number; title: string }) => chapter.title || `工作项 ${chapter.n + 1}`;

function threadTitle(label: string, n: number) {
  const shortened = label.replace(/^第[零〇一二两三四五六七八九十百千万0-9]+[章回节卷][\s　：:、.．—-]*/, '').trim();
  return shortened || (label ? label : `会话 ${n + 1}`);
}

function Spark() {
  return (
    <svg className="ags-spark" aria-hidden="true" width="24" height="24" viewBox="0 0 32 32">
      <g fill="currentColor">
        {[0, 27, 58, 86, 118, 149, 181, 209, 239, 267, 300, 331].map((angle, index) => (
          <path
            key={angle}
            transform={`rotate(${angle} 16 16)`}
            d={index % 2 ? 'M14.8 16 14 2.8 16.3 2.5 17 16Z' : 'M14.4 16.6 12.9 1.9 15.6 1.2 17.2 16Z'}
          />
        ))}
      </g>
    </svg>
  );
}

function IconButton({
  label,
  onClick,
  children,
  disabled = false,
  active = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={'ags-icon' + (active ? ' is-active' : '')}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export default function AgentShell(props: ReaderShellProps) {
  if (props.product === 'codex' && props.surface === 'desktop') return <CotexShell {...props} />;
  return <ConversationShell {...props} />;
}

function ConversationShell(props: ReaderShellProps) {
  useSidebarShortcut(toggleRail);
  const {
    product,
    surface,
    bookTitle,
    chapterTitle,
    chapter,
    paragraph,
    paragraphCount,
    chapters,
    disabled,
    onChapter,
    onBack,
    onSettings,
  } = props;
  const claude = product === 'claude';
  const desktop = surface === 'desktop';
  const cloud = !claude && !desktop;
  const [pane, setPane] = useState<Pane>('reader');
  const [rail, setRail] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [review, setReview] = useState(() => !claude && window.matchMedia('(min-width: 1050px)').matches);
  const [reviewTab, setReviewTab] = useState<'diff' | 'logs'>('diff');
  const [artifactTab, setArtifactTab] = useState<'outline' | 'marks'>('outline');
  const [modelPopover, setModelPopover] = useState(false);

  const [query, setQuery] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const lastActivator = useRef<HTMLElement | null>(null);
  const at = chapters.findIndex(item => item.n === chapter);
  const normalized = query.trim().toLocaleLowerCase();
  const matches = normalized
    ? chapters.filter(c => chapterLabel(c).toLocaleLowerCase().includes(normalized) || (c.realTitle || '').toLocaleLowerCase().includes(normalized) || String(c.n + 1) === normalized)
    : chapters;
  const [limit, setLimit] = useState(80);
  const current = chapterTitle || `工作项 ${chapter + 1}`;
  const next = chapters[at + 1];
  const previous = at > 0 ? chapters[at - 1] : undefined;

  const taskTitle = threadTitle(current, chapter);
  const filename = 'notes/' + String(chapter + 1).padStart(3, '0') + '.md';
  const firstLine = Math.max(0, paragraph - 4);
  const lines = Array.from({ length: Math.min(18, Math.max(0, paragraphCount - firstLine)) }, (_, index) => {
    const n = firstLine + index;
    const marked = props.bookmarks?.some(m => m.chapter === chapter && m.paragraph === n);
    return {
      n,
      marked,
      current: n === paragraph,
      text: `record_${String(n + 1).padStart(3, '0')}: ${n === paragraph ? 'active_cursor' : n < paragraph ? 'verified' : 'indexed'}`,
    };
  });
  const hintsEnabled = props.workHints?.enabled ?? true;

  function showReview(tab: 'diff' | 'logs') {
    setPane('reader');
    setDrawer(false);
    setReviewTab(tab);
    setReview(true);
  }
  function display(target: Pane) {
    lastActivator.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDrawer(false);
    setPane(target);
    setLimit(80);
    if (target === 'directory') requestAnimationFrame(() => field.current?.focus());
  }
  function closePane() {
    setPane('reader');
    setDrawer(false);
    requestAnimationFrame(() => lastActivator.current?.isConnected && lastActivator.current.focus());
  }
  function pick(n: number) {
    if (disabled) return;
    closePane();
    if (n !== chapter) onChapter(n);
  }
  function toggleRail() {
    if (window.matchMedia('(max-width: 720px)').matches) setDrawer(open => !open);
    else setRail(open => !open);
  }

  useEffect(() => {
    function escape(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (modelPopover) {
        e.preventDefault();
        setModelPopover(false);
      } else if (drawer || pane !== 'reader') {
        e.preventDefault();
        closePane();
      } else if (review && window.matchMedia('(max-width:1049px)').matches) {
        e.preventDefault();
        setReview(false);
      }
    }
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [drawer, pane, review, modelPopover]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 720px)');
    function resize() {
      if (!media.matches) setDrawer(false);
    }
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (query.trim() && props.onFindRecord) {
      setQuery('');
      props.onFindRecord(query.trim());
    } else if (!query.trim() && next?.available) {
      pick(next.n);
    } else {
      display('directory');
    }
  }

  function chapterRows(items: typeof chapters, detail = false) {
    return items.map(item => {
      const mask = detail ? chapterLabel(item) : threadTitle(item.title, item.n);
      const real = item.realTitle || `第 ${item.n + 1} 章`;
      return (
        <button
          type="button"
          className="ags-row"
          key={item.n}
          disabled={disabled || !item.available}
          aria-current={item.n === chapter ? 'page' : undefined}
          title={`第 ${item.n + 1} 章 · ${real}`}
          onClick={() => pick(item.n)}
        >
          {detail && (cloud ? <Terminal size={15} /> : <FileText size={15} />)}
          <PeekText mask={mask} real={real} />
          {detail && <small>{item.n === chapter ? '当前' : item.available ? String(item.n + 1) : '待处理'}</small>}
        </button>
      );
    });
  }

  function searchField() {
    return (
      <div className="ags-query">
        <Search size={16} />
        <input
          ref={field}
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setLimit(80);
          }}
          placeholder="查找工作项、章节标题或编号"
          aria-label="查找工作项或编号"
        />
        {query && (
          <IconButton
            label="清空搜索"
            onClick={() => {
              setQuery('');
              field.current?.focus();
            }}
          >
            <X size={14} />
          </IconButton>
        )}
      </div>
    );
  }

  const steps = (
    <ul className="ags-steps">
      <li>
        <Check size={13} />
        <span>已打开工作区</span>
        <code><PeekText mask={bookTitle} real={props.realBookTitle || bookTitle} /></code>
      </li>
      <li>
        <Check size={13} />
        <span>已读取文档</span>
        <code><PeekText mask={filename} real={props.realChapterTitle || filename} /></code>
      </li>
      <li>
        <Check size={13} />
        <span>已解析 {paragraphCount} 项记录 · 当前行 {paragraph + 1}</span>
      </li>
    </ul>
  );

  const lede = claude ? (
    <div className="ags-claude-lede">
      <div className="ags-prompt">
        Please review and summarize the notes in「<PeekText mask={taskTitle} real={props.realChapterTitle || taskTitle} />」.
      </div>
      <div className="ags-claude-assistant-head">
        <Spark />
        <button
          type="button"
          className="ags-claude-thought"
          onClick={() => props.onToggleSummary?.()}
          title="点击切换工作摘要 (Space)"
        >
          <span>Thought for {Math.max(4, (chapter % 9) + 4)} seconds</span>
          <ChevronDown size={13} />
        </button>
      </div>
    </div>
  ) : (
    <div className="ags-codex-lede">
      <div className="ags-prompt">请整理「<PeekText mask={taskTitle} real={props.realChapterTitle || taskTitle} />」的文档内容，保留原有顺序。</div>
      <details className="ags-worked">
        <summary>
          已处理 1 个文件 <ChevronRight size={12} />
        </summary>
        {steps}
      </details>
      {cloud && (
        <div className="ags-summary-bar">
          <strong className="ags-summary-label">Summary</strong>
          <button
            type="button"
            className="ags-summary-boss"
            onClick={() => props.onToggleSummary?.()}
            title="切换工作摘要 (Space)"
          >
            收起正文
          </button>
        </div>
      )}
    </div>
  );

  const activeTheme = props.shellTheme ?? (claude ? 'light' : 'dark');
  const tail = (
    <ShellActionBar
      p={props}
      variant={claude ? 'claude' : 'codex'}
      theme={activeTheme}
      extraRight={
        claude ? (
          <button
            type="button"
            className="ags-artifact-pill"
            onClick={() => setReview(r => !r)}
            title="切换 Artifacts 目录面板"
          >
            <FileCode2 size={13} />
            <span>{review ? '隐藏 Artifact' : '查看 Artifact'}</span>
          </button>
        ) : undefined
      }
    />
  );

  return (
    <div
      className={
        'ags-shell ags-' +
        product +
        ' ags-' +
        surface +
        (cloud ? ' ags-cloud' : '') +
        (rail ? '' : ' ags-rail-off') +
        (drawer ? ' ags-drawer-open' : '')
      }
      data-product={product}
      data-surface={surface}
    >
      {!cloud && (
        <>
          {drawer && <button className="ags-scrim" aria-label="关闭侧栏" onClick={() => setDrawer(false)} />}
          <aside className="ags-rail" aria-label={claude ? '会话侧栏' : '项目侧栏'}>
            <div className="ags-rail-head">
              {desktop && !claude ? (
                <>
                  <span className="ags-rail-app">Codex</span>
                  <IconButton label="收起侧栏" onClick={toggleRail}>
                    <PanelLeft size={16} />
                  </IconButton>
                </>
              ) : (
                <>
                  <strong className="ags-wordmark">Claude</strong>
                  <IconButton label="收起侧栏" onClick={toggleRail}>
                    <PanelLeft size={17} />
                  </IconButton>
                </>
              )}
            </div>
            <div className="ags-actions">
              <button type="button" onClick={props.onImportFiles} title="导入本地书籍">
                {claude ? <CirclePlus className="ags-plus" size={18} /> : <SquarePen size={17} />}
                <span>{claude ? 'New chat' : '新会话'}</span>
              </button>
              {claude ? (
                <>
                  <button type="button" onClick={props.onProjects} title="全部工作区 (Ctrl+K)">
                    <Search size={17} />
                    <span>Chats</span>
                  </button>
                  <button type="button" onClick={() => display('directory')} title="章节索引">
                    <Folder size={17} />
                    <span>Projects</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPane('reader');
                      setReview(r => !r);
                    }}
                    title="目录与书签 Artifacts"
                  >
                    <Boxes size={17} />
                    <span>Artifacts</span>
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => display('progress')} title="已记录的工作位置">
                    <Clock3 size={17} />
                    <span>自动化</span>
                  </button>
                  <button type="button" onClick={() => display('skills')} title="查看工作区工具">
                    <Boxes size={17} />
                    <span>技能</span>
                  </button>
                </>
              )}
            </div>
            <div className="ags-rail-scroll">
              <div className="ags-group" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>{claude ? 'Recents' : '线程'}</span>
                <RevealToggle active={!!props.revealReal} onToggle={props.onToggleReveal} />
              </div>
              {!claude && (
                <button className="ags-folder" type="button" title={props.realBookTitle || bookTitle} onClick={() => display('directory')}>
                  <Folder size={15} />
                  <b><PeekText mask={bookTitle || '工作区'} real={props.realBookTitle} /></b>
                  <ChevronDown size={13} />
                </button>
              )}
              <nav className="ags-recent" aria-label="最近会话">
                {props.projects.map(project => (
                  <div
                    key={project.id}
                    className={'ags-project-row' + (project.current ? ' current' : '')}
                  >
                    <button
                      type="button"
                      className="ags-row"
                      title={project.realTitle || project.name}
                      aria-current={project.current ? 'page' : undefined}
                      onClick={() => {
                        setDrawer(false);
                        props.onProject(project.id);
                      }}
                    >
                      <PeekText mask={project.name} real={project.realTitle} />
                    </button>
                    <SidebarTaskActions
                      projectId={project.id}
                      onRename={props.onRenameProject}
                      onManage={props.onProjects}
                    />
                  </div>
                ))}
              </nav>
            </div>
            <button type="button" className="ags-profile" onClick={onSettings} title="外观与阅读设置">
              <span className="ags-avatar">M</span>
              <span>
                Mokuji
                <small>{claude ? 'Pro plan' : '个人工作区'}</small>
              </span>
              <Settings2 size={15} />
            </button>
          </aside>
        </>
      )}

      <div className="ags-main">
        <header className="ags-top">
          {cloud ? (
            <>
              <button type="button" className="ags-cloud-brand" onClick={props.onProjects}>
                <Terminal size={18} />
                <span>Codex</span>
              </button>
              <span className="ags-divider">/</span>
              <button type="button" className="ags-task-link" onClick={() => display('directory')}>
                Tasks
              </button>
              <ChevronRight className="ags-task-link" size={13} />
            </>
          ) : (
            <>
              <button
                type="button"
                className="ags-toolbar-toggle ags-icon"
                aria-label="切换侧栏"
                onClick={toggleRail}
              >
                <PanelLeft size={18} />
              </button>
              {desktop && (
                <div className="ags-history">
                  <IconButton
                    label="上一章 (Alt+←)"
                    disabled={disabled || !previous?.available}
                    onClick={() => previous && pick(previous.n)}
                  >
                    <ArrowLeft size={16} />
                  </IconButton>
                  <IconButton
                    label="下一章 (Alt+→)"
                    disabled={disabled || !next?.available}
                    onClick={() => next && pick(next.n)}
                  >
                    <ArrowRight size={16} />
                  </IconButton>
                </div>
              )}
            </>
          )}

          {claude && desktop ? (
            <nav className="ags-segments" aria-label="工作视图">
              <button type="button" aria-pressed={pane === 'reader'} onClick={closePane} title="正文阅读">
                Chat
              </button>
              <button
                type="button"
                aria-pressed={pane === 'progress'}
                onClick={() => display('progress')}
                title="阅读进度与书签"
              >
                Cowork
              </button>
              <button
                type="button"
                aria-pressed={pane === 'directory'}
                onClick={() => display('directory')}
                title="章节文件列表"
              >
                Code
              </button>
            </nav>
          ) : (
            <button
              type="button"
              className="ags-thread-title"
              title={`${props.realBookTitle || bookTitle} · ${props.realChapterTitle || taskTitle}`}
              onClick={() => display('directory')}
            >
              <PeekText mask={`${bookTitle} · ${taskTitle}`} real={`${props.realBookTitle || bookTitle} · ${props.realChapterTitle || taskTitle}`} />
              {claude && <ChevronDown size={14} />}
            </button>
          )}

          {!claude && desktop && (
            <span className="ags-repo">
              <Folder size={13} />
              {bookTitle}
            </span>
          )}

          <div className="ags-top-end">
            <RevealToggle active={!!props.revealReal} onToggle={() => props.onToggleReveal?.()} />
            <IconButton
              label={props.bookmarked ? '取消当前书签 (Ctrl+D)' : '保存当前书签 (Ctrl+D)'}
              active={!!props.bookmarked}
              onClick={() => props.onBookmark?.()}
            >
              <Bookmark size={16} fill={props.bookmarked ? 'currentColor' : 'none'} />
            </IconButton>
            {claude ? (
              <IconButton
                label="切换 Artifacts 面板"
                active={review}
                onClick={() => {
                  setPane('reader');
                  setReview(open => !open);
                }}
              >
                <Columns2 size={16} />
              </IconButton>
            ) : (
              <IconButton
                label="切换文件审阅 (Diff / Logs)"
                active={review}
                onClick={() => {
                  setPane('reader');
                  setReview(open => !open);
                }}
              >
                <Columns2 size={17} />
              </IconButton>
            )}
            {props.onToggleSummary && (
              <IconButton
                label={props.summaryOpen ? '展开工作记录 (Space)' : '查看工作摘要 (Space)'}
                active={!!props.summaryOpen}
                onClick={props.onToggleSummary}
              >
                <List size={16} />
              </IconButton>
            )}
            <IconButton label="返回书架" onClick={onBack}>
              <BookOpen size={16} />
            </IconButton>
            <IconButton label="外观设置" onClick={onSettings}>
              <Settings2 size={16} />
            </IconButton>
          </div>
        </header>

        <div className="ags-columns" inert={pane !== 'reader' || drawer}>
          <div className="ags-conversation">
            {cloud && (
              <div className="ags-task-card">
                <h1><PeekText mask={taskTitle} real={props.realChapterTitle || taskTitle} /></h1>
                <div className="ags-env">
                  <span>
                    <FolderGit2 size={13} />
                    <PeekText mask={bookTitle} real={props.realBookTitle || bookTitle} />
                  </span>
                  <i>·</i>
                  <span>
                    <GitBranch size={13} />
                    main
                  </span>
                  {paragraphCount > 0 && (
                    <>
                      <i>·</i>
                      <span className="ags-status-pill">
                        <Check size={12} />
                        已完成
                      </span>
                    </>
                  )}
                </div>
                <nav aria-label="任务视图">
                  <button type="button" aria-pressed={!review} onClick={() => setReview(false)}>
                    Summary
                  </button>
                  <button
                    type="button"
                    aria-pressed={review && reviewTab === 'diff'}
                    onClick={() => showReview('diff')}
                  >
                    Diff (+{paragraphCount})
                  </button>
                  <button
                    type="button"
                    aria-pressed={review && reviewTab === 'logs'}
                    onClick={() => showReview('logs')}
                  >
                    Logs
                  </button>
                </nav>
              </div>
            )}

            <div className="ags-body">
              <ReaderLedeContext.Provider value={lede}>
                <ReaderTailContext.Provider value={tail}>{props.children}</ReaderTailContext.Provider>
              </ReaderLedeContext.Provider>
            </div>

            <form className="ags-composer" onSubmit={search}>
              <input
                aria-label="查找工作项"
                title="输入章号或关键词，按 Enter 跳转"
                placeholder={
                  claude
                    ? 'Reply to Claude… (type chapter # or keyword to jump)'
                    : cloud
                      ? '描述任务或输入章节号定位…'
                      : '向 Codex 提问…'
                }
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
              <div className="ags-compose-tools">
                <IconButton label="打开工作记录索引" onClick={() => display('directory')}>
                  <Plus size={17} />
                </IconButton>
                {claude && (
                  <button
                    type="button"
                    className={'ags-thinking-chip' + (hintsEnabled ? ' is-on' : '')}
                    onClick={() =>
                      props.onWorkHints?.({
                        enabled: !hintsEnabled,
                        frequency: props.workHints?.frequency ?? 5,
                      })
                    }
                    title="切换 Extended thinking 工作提示"
                  >
                    <Brain size={13} />
                    <span>Extended</span>
                  </button>
                )}
                {cloud ? (
                  <button
                    type="button"
                    className="ags-model"
                    onClick={props.onProjects}
                    title="切换工作区 (Ctrl+K)"
                  >
                    <GitBranch size={12} />
                    <span>main</span>
                    <ChevronDown size={12} />
                  </button>
                ) : null}
                <div className="ags-pop-anchor">
                  <button
                    type="button"
                    className="ags-model"
                    onClick={() => setModelPopover(v => !v)}
                    title="切换模拟模型、形态与字号"
                  >
                    <span>{claude ? 'Sonnet 4.6' : 'GPT-5.5'}</span>
                    <ChevronDown size={12} />
                  </button>
                  {modelPopover && (
                    <ModelSwitcherPopover
                      open
                      onClose={() => setModelPopover(false)}
                      theme={activeTheme}
                      align="left"
                      placement="above"
                      p={props}
                    />
                  )}
                </div>
                <span className="ags-place">
                  {chapter + 1}/{chapters.length || '–'}
                </span>
                <button type="submit" className="ags-send" aria-label={query.trim() ? '查找资料' : '下一章'}>
                  {cloud ? (query.trim() ? 'Jump' : 'Next') : <ArrowUp size={17} />}
                </button>
              </div>
            </form>
          </div>

          {review && claude && !props.summaryOpen && (
            <aside className="ags-review ags-claude-artifact" aria-label="Claude Artifacts">
              <div className="ags-review-title">
                <div className="ags-review-tabs">
                  <button
                    type="button"
                    aria-pressed={artifactTab === 'outline'}
                    onClick={() => setArtifactTab('outline')}
                  >
                    Outline
                  </button>
                  <button
                    type="button"
                    aria-pressed={artifactTab === 'marks'}
                    onClick={() => setArtifactTab('marks')}
                  >
                    Bookmarks ({props.bookmarks?.length ?? 0})
                  </button>
                </div>
                <IconButton label="关闭 Artifacts" onClick={() => setReview(false)}>
                  <X size={15} />
                </IconButton>
              </div>
              {artifactTab === 'outline' ? (
                <div className="ags-artifact-list">
                  <div className="ags-artifact-meta">
                    <Sparkles size={13} />
                    <span>{bookTitle} · {chapters.length} sections</span>
                  </div>
                  {chapters.slice(0, 120).map(item => (
                    <button
                      key={item.n}
                      type="button"
                      className="ags-artifact-row"
                      title={`第 ${item.n + 1} 章 · ${item.realTitle || item.title}`}
                      aria-current={item.n === chapter ? 'page' : undefined}
                      disabled={disabled || !item.available}
                      onClick={() => pick(item.n)}
                    >
                      <small>#{item.n + 1}</small>
                      <PeekText mask={threadTitle(item.title, item.n)} real={item.realTitle} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="ags-artifact-list">
                  <button
                    type="button"
                    className="ags-artifact-add"
                    onClick={() => props.onBookmark?.()}
                  >
                    <Bookmark size={13} fill={props.bookmarked ? 'currentColor' : 'none'} />
                    <span>{props.bookmarked ? 'Remove current bookmark' : 'Pin current paragraph'}</span>
                  </button>
                  {(props.bookmarks ?? []).map((mark, idx) => (
                    <button
                      key={mark.chapter + ':' + mark.paragraph + ':' + idx}
                      type="button"
                      className="ags-artifact-row"
                      onClick={() => props.onJumpPoint?.(mark)}
                    >
                      <small>§{mark.chapter + 1}</small>
                      <span>Paragraph {mark.paragraph + 1}</span>
                    </button>
                  ))}
                </div>
              )}
            </aside>
          )}

          {review && !claude && !props.summaryOpen && (
            <aside className="ags-review" aria-label="文档审阅">
              <div className="ags-review-title">
                <div className="ags-review-tabs">
                  <button
                    type="button"
                    aria-pressed={reviewTab === 'diff'}
                    onClick={() => showReview('diff')}
                  >
                    {cloud ? 'Diff' : '文件'}
                  </button>
                  <button
                    type="button"
                    aria-pressed={reviewTab === 'logs'}
                    onClick={() => showReview('logs')}
                  >
                    {cloud ? 'Logs' : '日志'}
                  </button>
                </div>
                <IconButton label="关闭文件视图" onClick={() => setReview(false)}>
                  <X size={15} />
                </IconButton>
              </div>
              {reviewTab === 'diff' ? (
                <>
                  <div className="ags-file-count">
                    1 个文件 <span>+{paragraphCount}</span>
                    <small>点击行跳转段落</small>
                  </div>
                  <div className="ags-diff">
                    <div className="ags-diff-head">
                      <FileText size={13} />
                      <b><PeekText mask={filename} real={props.realChapterTitle || filename} /></b>
                      <em>+{paragraphCount}</em>
                    </div>
                    <div className="ags-hunk">
                      @@ +{(lines[0]?.n ?? 0) + 1},{lines.length} @@
                    </div>
                    {lines.map(line => (
                      <button
                        type="button"
                        className={'ags-diff-row' + (line.current ? ' is-current' : '')}
                        key={line.n}
                        onClick={() => props.onJumpPoint?.({ chapter, paragraph: line.n })}
                        title={`跳转到第 ${line.n + 1} 段`}
                      >
                        <small>{line.n + 1}</small>
                        <b>{line.marked ? '★' : '+'}</b>
                        <code>{line.text}</code>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="ags-review-log">
                  <code>$ open {filename}</code>
                  {steps}
                  <p>
                    当前行 · {paragraph + 1}/{paragraphCount || '–'}
                  </p>
                  <div className="ags-log-actions">
                    <button type="button" onClick={() => props.onBookmark?.()}>
                      <Bookmark size={13} /> {props.bookmarked ? '取消当前书签' : '保存当前书签'}
                    </button>
                    <button type="button" onClick={() => props.onToggleSummary?.()}>
                      <List size={13} /> 切换工作摘要
                    </button>
                  </div>
                </div>
              )}
            </aside>
          )}
        </div>

        {pane !== 'reader' && (
          <section className="ags-pane" aria-label="工作记录">
            <div className="ags-pane-inner">
              <button type="button" className="ags-return" onClick={closePane}>
                <ChevronLeft size={16} />
                返回当前{claude ? '对话' : '任务'}
              </button>
              {pane === 'directory' ? (
                <>
                  {claude && <Spark />}
                  <h2>{cloud ? '任务' : claude ? 'Projects & Index' : '会话'}</h2>
                  {searchField()}
                  <div className="ags-group" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span><PeekText mask={bookTitle} real={props.realBookTitle} /> · {matches.length} 项</span>
                    <RevealToggle active={!!props.revealReal} onToggle={props.onToggleReveal} label={props.revealReal ? '恢复伪装' : '显示真名'} />
                  </div>
                  <nav aria-label="工作记录">{chapterRows(matches.slice(0, limit), true)}</nav>
                  {!matches.length && <p>没有找到匹配的工作项。</p>}
                  {matches.length > limit && (
                    <button type="button" className="ags-more" onClick={() => setLimit(n => n + 80)}>
                      显示更多
                    </button>
                  )}
                </>
              ) : pane === 'skills' ? (
                <>
                  <h2>技能与面板</h2>
                  <button className="ags-progress" type="button" onClick={() => display('directory')}>
                    <Search size={17} />
                    查找工作区文件
                  </button>
                  <button className="ags-progress" type="button" onClick={() => showReview('diff')}>
                    <FileText size={17} />
                    查看文档变更
                  </button>
                  <button className="ags-progress" type="button" onClick={onSettings}>
                    <Settings2 size={17} />
                    调整工作区外观
                  </button>
                </>
              ) : (
                <>
                  <h2>{bookTitle || '工作区'}</h2>
                  <div className="ags-group">当前会话</div>
                  <button type="button" className="ags-progress" onClick={closePane}>
                    <Check size={16} />
                    <span>
                      {current}
                      <small>
                        第 {paragraph + 1} / {paragraphCount || '–'} 行
                      </small>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                  <div className="ags-group">已标记位置 ({props.bookmarks?.length ?? 0})</div>
                  {(props.bookmarks ?? []).map((mark, idx) => (
                    <button
                      key={mark.chapter + ':' + mark.paragraph + ':' + idx}
                      type="button"
                      className="ags-progress"
                      onClick={() => {
                        closePane();
                        props.onJumpPoint?.(mark);
                      }}
                    >
                      <Bookmark size={15} />
                      <span>
                        工作项 {mark.chapter + 1}
                        <small>第 {mark.paragraph + 1} 行</small>
                      </span>
                      <ChevronRight size={15} />
                    </button>
                  ))}
                  <button type="button" className="ags-more" onClick={() => display('directory')}>
                    查看全部 {chapters.length} 项
                  </button>
                </>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
