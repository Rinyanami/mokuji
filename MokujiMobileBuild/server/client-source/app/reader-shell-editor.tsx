'use client';

import { useSidebarShortcut } from './reader-shortcuts';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowRight, Bell, Bookmark, BookOpen, Boxes, BugPlay, Check,
  ChevronDown, ChevronRight, CircleAlert, Code2, Columns2, Copy, Eye, Files, Folder,
  FolderOpen, GitBranch, History, ListTree, Menu, MessageSquare, MoreHorizontal, PanelBottom,
  PanelLeft, PanelRight, Plus, Search, Settings, Sparkles, Square, Terminal, TriangleAlert, X,
} from 'lucide-react';
import { ModelSwitcherPopover, simulatedModels } from './reader-shell-popovers';
import { PeekText, RevealToggle } from './reader-shell-peek';
import type { ReaderShellProps } from './reader-shell-types';
import './reader-shell-editor.css';

function ProductMark({ gravity = false }: { gravity?: boolean }) {
  return gravity ? (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M1.6 18.4c4.6-.5 5.9-6.3 8.2-11.8 1-2.3 3.8-2.6 5-.2 2.4 5 3.7 11.1 7.6 12.1l-3.3 1.2c-3.6-1.8-4.6-6.1-6.7-10.6-2 4.4-3.5 9.2-7.3 10.6z"
      />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="#007acc"
        d="M17.2 1.7 8.6 9.5 4 6 1.9 7.2v9.6L4 18l4.6-3.5 8.6 7.8 5-2.2V3.9zM4.2 9.5 7 12l-2.8 2.6zm7 2.5 6.1-4.7v9.4z"
      />
    </svg>
  );
}

const projectName = 'client-platform';
const documents = [
  ['overview', 'Architecture overview', 'Review platform architecture'],
  ['requirements', 'Product requirements', 'Refine the requirements'],
  ['user-flows', 'User flows', 'Map navigation flows'],
  ['interaction-spec', 'Interaction details', 'Review interaction states'],
  ['api-contract', 'API contract', 'Check API contracts'],
  ['data-model', 'Data model', 'Review the data model'],
  ['accessibility', 'Accessibility audit', 'Review accessibility findings'],
  ['error-handling', 'Error handling', 'Refine error handling'],
  ['migration', 'Migration plan', 'Plan the migration'],
  ['test-plan', 'Test coverage', 'Review test coverage'],
  ['observability', 'Instrumentation', 'Review event instrumentation'],
  ['performance', 'Performance budget', 'Check performance budgets'],
  ['rollout', 'Rollout plan', 'Review the rollout plan'],
  ['release-notes', 'Release notes', 'Draft release notes'],
  ['handoff', 'Implementation handoff', 'Prepare the handoff'],
  ['retrospective', 'Retrospective', 'Summarize the release'],
] as const;

function documentFor(n: number) {
  return documents[n % documents.length];
}
function filename(n: number) {
  return documentFor(n)[0] + '.md';
}
function releaseFolder(n: number) {
  const release = Math.floor(n / documents.length);
  return 'v' + (1 + Math.floor(release / 10)) + '.' + (release % 10);
}

type ActivityView = 'explorer' | 'search' | 'git' | 'debug' | 'extensions';
type SidebarProps = Pick<ReaderShellProps, 'chapter' | 'chapters' | 'disabled' | 'onChapter'> & {
  query: string;
  manager?: boolean;
};

function ChapterTree({ chapter, chapters, disabled, onChapter, query, manager }: SidebarProps) {
  const [limit, setLimit] = useState(100);
  const [folder, setFolder] = useState<string | null>(null);
  const page = folder ?? releaseFolder(chapter);
  const term = query.trim().toLowerCase();
  useEffect(() => {
    setLimit(100);
  }, [term]);
  useEffect(() => {
    setFolder(null);
  }, [chapter]);

  const folders = useMemo(() => {
    const groups = new Map<string, ReaderShellProps['chapters'][number][]>();
    for (const item of chapters) {
      const key = releaseFolder(item.n);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    return groups;
  }, [chapters]);

  const filtered = term
    ? chapters.filter(item =>
        [releaseFolder(item.n), ...documentFor(item.n), filename(item.n), item.title, item.realTitle || '', String(item.n + 1)]
          .join(' ')
          .toLowerCase()
          .includes(term),
      )
    : chapters;
  const grouped = !term && folders.size > 1;

  function row(item: ReaderShellProps['chapters'][number]) {
    const file = filename(item.n);
    const label = manager ? documentFor(item.n)[2] : file;
    const real = item.realTitle || `第 ${item.n + 1} 章`;
    const folderName = releaseFolder(item.n);
    const path = (folders.size > 1 ? folderName + '/' : '') + file;
    return (
      <button
        type="button"
        key={item.n}
        className="mke-file"
        aria-current={chapter === item.n ? 'page' : undefined}
        disabled={!item.available || disabled}
        onClick={() => onChapter(item.n)}
        title={`第 ${item.n + 1} 章 · ${real} (${path})`}
        aria-label={manager ? `${label} · ${real}` : `${path} · ${real}`}
      >
        {manager ? (
          <MessageSquare />
        ) : (
          <span className="mke-md" aria-hidden="true">
            <ArrowDown />
          </span>
        )}
        <PeekText mask={label} real={real} />
        <small>{term && folders.size > 1 ? folderName : `#${item.n + 1}`}</small>
      </button>
    );
  }

  return (
    <div className="mke-files">
      {grouped
        ? Array.from(folders, ([key, items]) => {
            const active = page === key;
            const firstNum = items[0] ? items[0].n + 1 : 1;
            const lastNum = items[items.length - 1] ? items[items.length - 1].n + 1 : items.length;
            const rangeText = `第 ${firstNum}–${lastNum} 章`;
            return (
              <div key={key}>
                <button
                  type="button"
                  className="mke-group"
                  aria-expanded={active}
                  title={rangeText}
                  onClick={() => setFolder(active ? '' : key)}
                >
                  {active ? <ChevronDown /> : <ChevronRight />}
                  <Folder />
                  <PeekText mask={manager ? 'Release ' + key : key} real={rangeText} />
                </button>
                {active && items.map(row)}
              </div>
            );
          })
        : filtered.slice(0, limit).map(row)}
      {!grouped && filtered.length > limit && (
        <button type="button" className="mke-more" onClick={() => setLimit(limit + 100)}>
          Show more…
        </button>
      )}
      {term && !filtered.length && <div className="mke-empty">No matching files</div>}
    </div>
  );
}

export default function EditorShell(props: ReaderShellProps) {
  return <EditorWorkbench key={props.product + '-' + props.surface} {...props} />;
}

const compactViewportQuery = '(max-width: 768px), (max-height: 500px) and (pointer: coarse)';
const isCompactEditorViewport = () => window.matchMedia(compactViewportQuery).matches;

function EditorWorkbench(props: ReaderShellProps) {
  const { product, surface, chapter, chapters, paragraph, disabled, children, onChapter, onBack, onSettings } =
    props;
  const gravity = product === 'antigravity';
  const [manager, setManager] = useState(gravity && surface === 'web');
  const [sidebar, setSidebar] = useState(() => !isCompactEditorViewport());
  const [docsOpen, setDocsOpen] = useState(true);
  const [activity, setActivity] = useState<ActivityView>('explorer');
  const [aux, setAux] = useState(() => window.matchMedia('(min-width: 1040px) and (min-height: 501px)').matches);
  const [query, setQuery] = useState('');
  const [agentPrompt, setAgentPrompt] = useState('');
  const [termCmd, setTermCmd] = useState('');
  const [menu, setMenu] = useState('');
  const [panel, setPanel] = useState(false);
  const [panelTab, setPanelTab] = useState<'output' | 'terminal'>('terminal');
  const [expanded, setExpanded] = useState(true);
  const [workspacesOpen, setWorkspacesOpen] = useState(false);
  const [modelPop, setModelPop] = useState(false);

  const input = useRef<HTMLInputElement>(null);
  const menuRoot = useRef<HTMLDivElement>(null);
  const at = chapters.findIndex(item => item.n === chapter);
  const name = filename(chapter);
  const multiRelease = chapters.some(item => releaseFolder(item.n) !== releaseFolder(chapter));
  const path = 'docs/' + (multiRelease ? releaseFolder(chapter) + '/' : '') + name;
  const hintsEnabled = props.workHints?.enabled ?? true;
  const percent = props.progressPercent ?? 0;

  const openTabs = useMemo(() => {
    const list = [chapters[at - 1], chapters[at], chapters[at + 1]].filter(
      (item): item is NonNullable<typeof item> => !!item,
    );
    return list;
  }, [chapters, at]);

  function navigate(n: number) {
    onChapter(n);
    if (isCompactEditorViewport()) setSidebar(false);
  }
  function openView(view: ActivityView) {
    if (sidebar && activity === view && view !== 'search') {
      setSidebar(false);
      return;
    }
    setActivity(view);
    setSidebar(true);
    setExpanded(true);
    setMenu('');
    if (isCompactEditorViewport()) setAux(false);
    if (view === 'search') requestAnimationFrame(() => input.current?.focus());
  }
  function find() {
    openView('search');
  }
  function move(dir: number) {
    const entry = chapters[at + dir];
    if (entry?.available && !disabled) navigate(entry.n);
  }

  useEffect(() => {
    if (sidebar && activity === 'search') input.current?.focus();
  }, [sidebar, activity]);

  useEffect(() => {
    function dismiss(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenu('');
        setModelPop(false);
        if (isCompactEditorViewport()) {
          setSidebar(false);
          setAux(false);
        }
      }
    }
    function outside(event: PointerEvent) {
      if (menuRoot.current && !menuRoot.current.contains(event.target as Node)) setMenu('');
    }
    window.addEventListener('keydown', dismiss);
    document.addEventListener('pointerdown', outside);
    return () => {
      window.removeEventListener('keydown', dismiss);
      document.removeEventListener('pointerdown', outside);
    };
  }, []);

  const toggleSidebar = () => {
    setSidebar(!sidebar);
    if (!sidebar && isCompactEditorViewport()) setAux(false);
  };
  useSidebarShortcut(toggleSidebar);
  const toggleAux = () => {
    setAux(!aux);
    if (!aux && isCompactEditorViewport()) setSidebar(false);
  };

  function submitAgentPrompt(e?: FormEvent) {
    e?.preventDefault();
    const term = agentPrompt.trim();
    if (!term) {
      move(1);
      return;
    }
    setAgentPrompt('');
    if (props.onFindRecord) props.onFindRecord(term);
    else openView('search');
  }

  function submitTerminal(e: FormEvent) {
    e.preventDefault();
    const raw = termCmd.trim();
    setTermCmd('');
    if (!raw) return;
    if (raw === 'boss' || raw === 'summary') props.onToggleSummary?.();
    else if (raw === 'mark' || raw === 'bookmark') props.onBookmark?.();
    else if (raw === 'next') move(1);
    else if (raw === 'prev') move(-1);
    else if (raw.startsWith('goto ')) props.onFindRecord?.(raw.slice(5).trim());
    else props.onFindRecord?.(raw);
  }

  const tree = (
    <ChapterTree
      chapter={chapter}
      chapters={chapters}
      disabled={disabled}
      onChapter={navigate}
      query={activity === 'search' ? query : ''}
      manager={manager}
    />
  );

  const searchBox = activity === 'search' && (
    <div className="mke-searchbox">
      <Search />
      <input
        ref={input}
        aria-label="搜索工作区"
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && query.trim() && props.onFindRecord) {
            e.preventDefault();
            props.onFindRecord(query.trim());
            setQuery('');
          }
        }}
        placeholder={manager ? 'Search conversations…' : 'Search files or chapter #…'}
        value={query}
        onChange={event => setQuery(event.target.value)}
      />
      {query && (
        <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}>
          <X />
        </button>
      )}
    </div>
  );

  const previous = (
    <button
      type="button"
      title="Previous chapter (Alt+←)"
      aria-label="上一章"
      disabled={disabled || !chapters[at - 1]?.available}
      onClick={() => move(-1)}
    >
      <ArrowLeft />
    </button>
  );
  const next = (
    <button
      type="button"
      title="Next chapter (Alt+→)"
      aria-label="下一章"
      disabled={disabled || !chapters[at + 1]?.available}
      onClick={() => move(1)}
    >
      <ArrowRight />
    </button>
  );
  const returnAction = (
    <button type="button" title="Close workspace" aria-label="返回书架" onClick={onBack}>
      <FolderOpen />
    </button>
  );
  const settings = (
    <button type="button" title="Settings" aria-label="阅读设置" onClick={onSettings}>
      <Settings />
    </button>
  );
  const toggleOverview = (
    <button
      type="button"
      title={gravity ? 'Toggle Agent Panel' : 'Toggle Secondary Side Bar'}
      aria-label="切换辅助侧栏"
      aria-pressed={aux}
      onClick={toggleAux}
    >
      <PanelRight />
    </button>
  );
  const nav = (
    <button
      type="button"
      title="Toggle sidebar (Ctrl+B)"
      aria-label="展开或收起章节侧栏"
      aria-pressed={sidebar}
      onClick={toggleSidebar}
    >
      <PanelLeft />
    </button>
  );

  const menus = manager
    ? []
    : surface === 'desktop'
      ? ['File', 'Edit', 'Selection', 'View', 'Go', 'Run', 'Terminal', 'Help']
      : ['Menu'];

  function finish(action: () => void) {
    setMenu('');
    action();
  }
  function selectText() {
    const article = menuRoot.current?.closest('.mk-editor')?.querySelector('.mke-body article');
    if (!article) return;
    const range = document.createRange();
    range.selectNodeContents(article);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  const commands =
    menu === 'Go' ? (
      <>
        <button onClick={() => finish(() => move(-1))} disabled={disabled || !chapters[at - 1]?.available}>
          <ArrowLeft />
          Previous File
        </button>
        <button onClick={() => finish(() => move(1))} disabled={disabled || !chapters[at + 1]?.available}>
          <ArrowRight />
          Next File
        </button>
        <button onClick={find}>
          <Search />
          Go to File…
        </button>
      </>
    ) : menu === 'Selection' ? (
      <>
        <button onClick={() => finish(selectText)}>Select All</button>
        <button onClick={() => finish(() => props.onCopyChapter?.())}>
          <Copy />
          Copy Current File
        </button>
      </>
    ) : menu === 'Run' || menu === 'Terminal' ? (
      <button onClick={() => finish(() => setPanel(!panel))}>
        <PanelBottom />
        {panel ? 'Hide' : 'Show'} Terminal Panel
      </button>
    ) : menu === 'Edit' ? (
      <>
        <button onClick={find}>
          <Search />
          Find in Workspace…
        </button>
        <button onClick={() => finish(() => props.onBookmark?.())}>
          <Bookmark />
          Toggle Bookmark (Ctrl+D)
        </button>
        <button onClick={() => finish(selectText)}>Select All</button>
      </>
    ) : menu === 'Help' ? (
      <>
        <button onClick={() => finish(onSettings)}>
          <Settings />
          Workspace Settings
        </button>
        <button onClick={() => finish(() => openView('extensions'))}>
          <Boxes />
          Switch UI Theme / Skin
        </button>
      </>
    ) : (
      <>
        <button onClick={() => finish(props.onProjects)}>
          <FolderOpen />
          Open Workspace… (Ctrl+K)
        </button>
        <button onClick={() => finish(props.onImportFiles)}>
          <Files />
          Import File…
        </button>
        <button onClick={find}>
          <Search />
          Go to File…
        </button>
        <button onClick={() => finish(toggleSidebar)}>
          <PanelLeft />
          Toggle Side Bar
        </button>
        <button onClick={() => finish(() => props.onToggleSummary?.())}>
          <Eye />
          Toggle Boss Summary (Space)
        </button>
        <button onClick={() => finish(onSettings)}>
          <Settings />
          Settings
        </button>
        <button onClick={() => finish(onBack)}>
          <FolderOpen />
          Close Workspace
        </button>
      </>
    );

  const activeWorkName = props.projects.find(p => p.current)?.name || projectName;

  return (
    <div
      className={'mk-editor' + (manager ? ' mk-manager' : '')}
      data-product={product}
      data-surface={surface}
      data-side={sidebar || undefined}
      data-aux={aux || undefined}
    >
      <header className="mke-title">
        {manager ? (
          <>
            <ProductMark gravity />
            <strong>Antigravity</strong>
            {nav}
          </>
        ) : (
          <>
            <ProductMark gravity={gravity} />
            <div ref={menuRoot} className="mke-menubar">
              {menus.map(label => (
                <button
                  key={label}
                  type="button"
                  aria-expanded={menu === label}
                  aria-label={label}
                  onClick={() => setMenu(menu === label ? '' : label)}
                >
                  {label === 'Menu' ? <Menu /> : label}
                </button>
              ))}
              {menu && <div className="mke-popover">{commands}</div>}
            </div>
          </>
        )}
        <div className="mke-center">
          {previous}
          {next}
          <button
            type="button"
            className="mke-command"
            onClick={props.onProjects}
            title={`打开工作区列表 (Ctrl+K) · ${props.realBookTitle || activeWorkName}`}
          >
            <Search />
            <PeekText mask={activeWorkName} real={props.realBookTitle} />
            <kbd>Ctrl+K</kbd>
          </button>
        </div>
        <div className="mke-end">
          {gravity && (
            <button
              type="button"
              className="mke-agent-switch"
              onClick={() => {
                setManager(!manager);
                setAux(window.matchMedia('(min-width: 1040px)').matches);
              }}
            >
              {manager ? 'Open Editor' : 'Open Agent Manager'}
            </button>
          )}
          {!manager && nav}
          {!manager && (
            <button
              type="button"
              title="Toggle Terminal / Output"
              aria-label="切换输出面板"
              aria-pressed={panel}
              onClick={() => setPanel(!panel)}
            >
              <PanelBottom />
            </button>
          )}
          {toggleOverview}
          {settings}
          {surface === 'desktop' && (
            <span className="mke-window" aria-hidden="true">
              <i>─</i>
              <Square />
              <X />
            </span>
          )}
        </div>
      </header>

      <div className="mke-work">
        {(sidebar || aux) && isCompactEditorViewport() && (
          <button
            type="button"
            className="mke-scrim"
            aria-label="关闭侧栏"
            onClick={() => {
              setSidebar(false);
              setAux(false);
            }}
          />
        )}
        {!manager && (
          <div className="mke-activity" aria-label="活动栏">
            <button
              type="button"
              aria-label="资源管理器"
              title="Explorer (Chapters)"
              aria-pressed={sidebar && activity === 'explorer'}
              onClick={() => openView('explorer')}
            >
              <Files />
            </button>
            <button
              type="button"
              aria-label="搜索工作区"
              title="Search (Ctrl+F)"
              aria-pressed={sidebar && activity === 'search'}
              onClick={() => openView('search')}
            >
              <Search />
            </button>
            <button
              type="button"
              aria-label="源代码管理（书签）"
              title="Source Control (Bookmarks)"
              aria-pressed={sidebar && activity === 'git'}
              onClick={() => openView('git')}
            >
              <GitBranch />
              {(props.bookmarks?.length ?? 0) > 0 && (
                <em className="mke-act-badge">{props.bookmarks!.length}</em>
              )}
            </button>
            <button
              type="button"
              aria-label="运行与调试（进度与老板键）"
              title="Run & Debug (Stats / Boss Mode)"
              aria-pressed={sidebar && activity === 'debug'}
              onClick={() => openView('debug')}
            >
              <BugPlay />
            </button>
            <button
              type="button"
              aria-label="扩展（切换工作界面皮肤）"
              title="Extensions (Switch UI Mode)"
              aria-pressed={sidebar && activity === 'extensions'}
              onClick={() => openView('extensions')}
            >
              <Boxes />
            </button>
            <div className="mke-fill" />
            {returnAction}
            {settings}
          </div>
        )}

        {sidebar && (
          <aside className="mke-side" aria-label="工作区侧栏">
            {manager ? (
              <>
                <div className="mke-project-tools">
                  <button type="button" onClick={find}>
                    <Search />
                    Search
                  </button>
                  <button type="button" onClick={props.onProjects}>
                    <BookOpen />
                    Workspaces ({props.projects.length})
                  </button>
                  <button type="button" onClick={() => props.onBookmark?.()}>
                    <Bookmark />
                    {props.bookmarked ? 'Pinned Line' : 'Pin Current Line'}
                  </button>
                </div>
                <div className="mke-side-title">
                  <span>Projects</span>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <RevealToggle active={!!props.revealReal} onToggle={props.onToggleReveal} />
                    <FolderOpen />
                  </div>
                </div>
                <button
                  type="button"
                  className="mke-folder"
                  aria-expanded={expanded}
                  title={props.realBookTitle || activeWorkName}
                  onClick={() => setExpanded(!expanded)}
                >
                  <Folder />
                  <PeekText mask={activeWorkName} real={props.realBookTitle} />
                  <ChevronDown />
                </button>
                {searchBox}
                {expanded && tree}
                <div className="mke-fill" />
                <button type="button" className="mke-project-foot" onClick={onSettings}>
                  <Settings />
                  Settings
                </button>
              </>
            ) : activity === 'git' ? (
              <>
                <div className="mke-side-title">
                  <span>SOURCE CONTROL</span>
                  <button
                    type="button"
                    title="Stage / Bookmark current line (Ctrl+D)"
                    onClick={() => props.onBookmark?.()}
                  >
                    <Plus />
                  </button>
                </div>
                <div className="mke-git-box">
                  <button type="button" className="mke-git-commit" onClick={() => props.onBookmark?.()}>
                    <Check size={13} />
                    <span>{props.bookmarked ? 'Unstage Line' : 'Commit Bookmark'}</span>
                  </button>
                  <div className="mke-git-group">
                    CHANGES ({props.bookmarks?.length ?? 0})
                  </div>
                  {(props.bookmarks ?? []).map((mark, idx) => {
                    const markTitle = chapters.find(c => c.n === mark.chapter)?.realTitle || `第 ${mark.chapter + 1} 章`;
                    return (
                      <button
                        type="button"
                        key={mark.chapter + ':' + mark.paragraph + ':' + idx}
                        className="mke-git-row"
                        title={`${markTitle} · 第 ${mark.paragraph + 1} 段`}
                        onClick={() => props.onJumpPoint?.(mark)}
                      >
                        <span className="mke-git-m">M</span>
                        <PeekText mask={filename(mark.chapter)} real={markTitle} />
                        <small>Ln {mark.paragraph + 1}</small>
                      </button>
                    );
                  })}
                  {!(props.bookmarks?.length) && (
                    <p className="mke-empty">No staged bookmarks. Press Ctrl+D to pin a line.</p>
                  )}
                </div>
              </>
            ) : activity === 'debug' ? (
              <>
                <div className="mke-side-title">
                  <span>RUN AND DEBUG</span>
                </div>
                <div className="mke-debug-box">
                  <div className="mke-debug-stat">
                    <span>Workspace</span>
                    <strong>{activeWorkName}</strong>
                  </div>
                  <div className="mke-debug-stat">
                    <span>Progress</span>
                    <strong>{percent.toFixed(1)}%</strong>
                  </div>
                  <div className="mke-debug-stat">
                    <span>Cursor</span>
                    <strong>
                      Ch {chapter + 1}/{chapters.length} · Ln {paragraph + 1}
                    </strong>
                  </div>
                  <button type="button" className="mke-debug-btn" onClick={() => props.onToggleSummary?.()}>
                    <Eye size={14} />
                    <span>{props.summaryOpen ? 'Resume Code' : 'Boss Summary (Space)'}</span>
                  </button>
                  <button type="button" className="mke-debug-btn" onClick={() => props.onCopyChapter?.()}>
                    <Copy size={14} />
                    <span>Copy Current File</span>
                  </button>
                  <button type="button" className="mke-debug-btn" onClick={props.onImportFiles}>
                    <Plus size={14} />
                    <span>Import TXT / EPUB</span>
                  </button>
                </div>
              </>
            ) : activity === 'extensions' ? (
              <>
                <div className="mke-side-title">
                  <span>EXTENSIONS: WORKBENCH</span>
                </div>
                <div className="mke-ext-list">
                  {simulatedModels.map(item => {
                    const active = props.product === item.appearance;
                    return (
                      <button
                        type="button"
                        key={item.appearance}
                        className={'mke-ext-item' + (active ? ' is-active' : '')}
                        onClick={() => props.onSwitchAppearance?.(item.appearance)}
                      >
                        <div>
                          <strong>{item.label}</strong>
                          <small>{item.modelName}</small>
                        </div>
                        <span>{active ? 'Active' : 'Use'}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="mke-side-title">
                  <span>{activity === 'search' ? 'SEARCH' : 'EXPLORER'}</span>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    <RevealToggle active={!!props.revealReal} onToggle={props.onToggleReveal} />
                    <button type="button" title="Explorer options" aria-label="资源管理器设置" onClick={onSettings}>
                      <MoreHorizontal />
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  className="mke-folder"
                  aria-expanded={workspacesOpen}
                  onClick={() => setWorkspacesOpen(v => !v)}
                >
                  {workspacesOpen ? <ChevronDown /> : <ChevronRight />}
                  OPEN WORKSPACES ({props.projects.length})
                </button>
                {workspacesOpen && (
                  <div className="mke-ws-list">
                    {props.projects.map(proj => (
                      <button
                        type="button"
                        key={proj.id}
                        className="mke-file"
                        title={proj.realTitle || proj.name}
                        aria-current={proj.current ? 'page' : undefined}
                        onClick={() => props.onProject(proj.id)}
                      >
                        <Folder />
                        <PeekText mask={proj.name} real={proj.realTitle} />
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="mke-folder"
                  aria-expanded={expanded}
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded ? <ChevronDown /> : <ChevronRight />}
                  {projectName.toUpperCase()}
                </button>
                {searchBox}
                {expanded && (
                  <>
                    <button
                      type="button"
                      className="mke-dir"
                      aria-expanded={docsOpen}
                      onClick={() => setDocsOpen(v => !v)}
                    >
                      {docsOpen ? <ChevronDown /> : <ChevronRight />}
                      <FolderOpen />
                      docs
                    </button>
                    {docsOpen && tree}
                  </>
                )}
                <div className="mke-fill" />
                <button type="button" className="mke-folder mke-outline" onClick={props.onOpenBookmarks}>
                  <ChevronRight />
                  BOOKMARKS ({props.bookmarks?.length ?? 0})
                </button>
              </>
            )}
          </aside>
        )}

        <main className="mke-main">
          {manager ? (
            <div className="mke-convo-head mk-peek-host" title={props.realChapterTitle || documentFor(chapter)[2]}>
              <MessageSquare />
              <PeekText mask={documentFor(chapter)[2]} real={props.realChapterTitle} />
              <div className="mke-convo-tools">
                <RevealToggle active={!!props.revealReal} onToggle={props.onToggleReveal} />
                <button
                  type="button"
                  title={props.bookmarked ? '取消书签' : '保存书签 (Ctrl+D)'}
                  onClick={() => props.onBookmark?.()}
                >
                  <Bookmark fill={props.bookmarked ? 'currentColor' : 'none'} />
                </button>
                <button
                  type="button"
                  title="切换工作摘要 (Space)"
                  onClick={() => props.onToggleSummary?.()}
                >
                  <Eye />
                </button>
                <button type="button" title="Search conversations" aria-label="查找会话" onClick={find}>
                  <Search />
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="mke-tabs">
                <div className="mke-tab-strip">
                  {openTabs.map(tabItem => {
                    const isCurrent = tabItem.n === chapter;
                    return (
                      <div
                        key={tabItem.n}
                        className={isCurrent ? 'mke-active-tab' : 'mke-tab'}
                      >
                        <button
                          type="button"
                          className="mke-tab-btn"
                          title={tabItem.realTitle || filename(tabItem.n)}
                          disabled={!tabItem.available || disabled}
                          onClick={() => navigate(tabItem.n)}
                        >
                          <span className="mke-md">
                            <ArrowDown />
                          </span>
                          <PeekText mask={filename(tabItem.n)} real={tabItem.realTitle} />
                        </button>
                        {isCurrent && (
                          <button
                            type="button"
                            className="mke-tab-close"
                            title="Close editor & return to shelf"
                            aria-label="关闭编辑器并返回"
                            onClick={onBack}
                          >
                            <X />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mke-fill" />
                <button
                  type="button"
                  title={props.bookmarked ? 'Remove Bookmark (Ctrl+D)' : 'Pin Line Bookmark (Ctrl+D)'}
                  aria-label="切换书签"
                  className={props.bookmarked ? 'mke-btn-on' : ''}
                  onClick={() => props.onBookmark?.()}
                >
                  <Bookmark fill={props.bookmarked ? 'currentColor' : 'none'} />
                </button>
                <button
                  type="button"
                  title="Open Preview / Boss Summary (Space)"
                  aria-label="切换工作摘要"
                  className={props.summaryOpen ? 'mke-btn-on' : ''}
                  onClick={() => props.onToggleSummary?.()}
                >
                  <Eye />
                </button>
                <button type="button" title="Toggle auxiliary panel" aria-label="切换侧面板" onClick={toggleAux}>
                  <Columns2 />
                </button>
                <button type="button" title="Editor settings" aria-label="编辑器设置" onClick={onSettings}>
                  <MoreHorizontal />
                </button>
              </div>
              <div className="mke-crumb">
                <button type="button" title="Open Explorer" onClick={() => openView('explorer')}>
                  docs
                </button>
                <ChevronRight />
                {multiRelease && (
                  <>
                    <button type="button" title="Browse Volume / Folder" onClick={() => openView('explorer')}>
                      {releaseFolder(chapter)}
                    </button>
                    <ChevronRight />
                  </>
                )}
                <button
                  type="button"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  title={`Switch Chapter · ${props.realChapterTitle || name}`}
                  onClick={find}
                >
                  <span className="mke-md">
                    <ArrowDown />
                  </span>
                  {name}
                </button>
                <ChevronRight />
                <button
                  type="button"
                  title="打开全书索引 / 搜正文"
                  onClick={() => {
                    if (props.onFindRecord) props.onFindRecord('');
                    else find();
                  }}
                >
                  # {documentFor(chapter)[1]}
                </button>
              </div>
            </>
          )}

          <div className="mke-body">{children}</div>

          {!manager && !props.summaryOpen && gravity && (
            <div className="mke-review-bar">
              <span>
                {path} · {percent.toFixed(1)}%
              </span>
              <div>
                <button
                  type="button"
                  disabled={disabled || !chapters[at - 1]?.available}
                  onClick={() => move(-1)}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="mke-accept-btn"
                  disabled={disabled || !chapters[at + 1]?.available}
                  onClick={() => move(1)}
                >
                  Accept & Next
                </button>
              </div>
            </div>
          )}

          {manager && (
            <form className="mke-compose" onSubmit={submitAgentPrompt}>
              <input
                className="mke-search-prompt"
                value={agentPrompt}
                onChange={e => setAgentPrompt(e.target.value)}
                placeholder="Ask anything, type chapter # or keyword to jump…"
                aria-label="搜索或跳转章节"
              />
              <div>
                <div className="mke-compose-left">
                  <button
                    type="button"
                    title="Toggle Work Hints"
                    onClick={() =>
                      props.onWorkHints?.({
                        enabled: !hintsEnabled,
                        frequency: props.workHints?.frequency ?? 5,
                      })
                    }
                  >
                    <Plus size={14} />
                    <span>{hintsEnabled ? 'Planning' : 'Fast'}</span>
                    <ChevronDown size={12} />
                  </button>
                  <div className="mke-pop-anchor">
                    <button
                      type="button"
                      onClick={() => setModelPop(v => !v)}
                      title="切换模拟工作界面或字号"
                    >
                      <Sparkles size={13} />
                      <span>Gemini 3.5 Pro</span>
                      <ChevronDown size={12} />
                    </button>
                    {modelPop && (
                      <ModelSwitcherPopover
                        open
                        onClose={() => setModelPop(false)}
                        theme={props.shellTheme ?? 'light'}
                        align="left"
                        placement="above"
                        p={props}
                      />
                    )}
                  </div>
                </div>
                <button type="submit" aria-label="跳转章节">
                  <ArrowRight />
                </button>
              </div>
            </form>
          )}

          {!manager && panel && (
            <div className="mke-panel">
              <header>
                <div className="mke-panel-tabs">
                  <button
                    type="button"
                    aria-pressed={panelTab === 'terminal'}
                    onClick={() => setPanelTab('terminal')}
                  >
                    TERMINAL
                  </button>
                  <button
                    type="button"
                    aria-pressed={panelTab === 'output'}
                    onClick={() => setPanelTab('output')}
                  >
                    OUTPUT
                  </button>
                </div>
                <button type="button" aria-label="关闭输出" onClick={() => setPanel(false)}>
                  <X />
                </button>
              </header>
              {panelTab === 'output' ? (
                <code>
                  [info] Opened {path} · {props.paragraphCount} lines · UTF-8 · Progress {percent.toFixed(1)}%
                </code>
              ) : (
                <form className="mke-term-form" onSubmit={submitTerminal}>
                  <div className="mke-term-log">
                    <span>
                      PS C:\workspace\{projectName}&gt; status --file {path} --line {paragraph + 1}/
                      {props.paragraphCount}
                    </span>
                  </div>
                  <div className="mke-term-input">
                    <span>&gt;</span>
                    <input
                      value={termCmd}
                      onChange={e => setTermCmd(e.target.value)}
                      placeholder="Type command: goto 12 | next | prev | mark | boss"
                      aria-label="终端命令跳转"
                    />
                  </div>
                </form>
              )}
            </div>
          )}
        </main>

        {aux && (
          <aside className="mke-aux" aria-label={manager ? 'Overview' : 'Secondary side bar'}>
            {manager ? (
              <>
                <div className="mke-side-title">
                  Overview
                  <button type="button" aria-label="关闭概览" onClick={toggleAux}>
                    <X />
                  </button>
                </div>
                <button type="button" className="mke-overview-row" onClick={find}>
                  <Files />
                  Files ({chapters.length})
                  <ChevronRight />
                </button>
                <button type="button" className="mke-overview-row" onClick={props.onOpenBookmarks}>
                  <Bookmark />
                  Pinned Marks ({props.bookmarks?.length ?? 0})
                  <ChevronRight />
                </button>
                <div className="mke-side-title">Artifacts</div>
                <button
                  type="button"
                  className="mke-overview-row"
                  onClick={() => props.onToggleSummary?.()}
                >
                  <ListTree />
                  Walkthrough (Boss Key)
                </button>
                <div className="mke-overview-info">
                  Ln {paragraph + 1}/{props.paragraphCount} · {name} · {percent.toFixed(1)}%
                </div>
              </>
            ) : (
              <>
                <div className="mke-agent-title">
                  <span>{gravity ? 'Agent' : 'CHAT'}</span>
                  <div>
                    <button type="button" title="Search files (Ctrl+F)" aria-label="搜索文件" onClick={find}>
                      <History />
                    </button>
                    <button
                      type="button"
                      title="Open Bookmarks"
                      aria-label="书签"
                      onClick={props.onOpenBookmarks}
                    >
                      <Bookmark />
                    </button>
                    <button type="button" aria-label="关闭辅助侧栏" onClick={toggleAux}>
                      <X />
                    </button>
                  </div>
                </div>

                <div className="mke-agent-stream">
                  <div className="mke-agent-card">
                    <div className="mke-agent-thought">
                      <Sparkles size={13} />
                      <span>
                        {gravity ? `Thought for ${(chapter % 5) + 2}s` : 'Copilot Context'}
                      </span>
                    </div>
                    <p className="mke-agent-note">
                      Inspecting <code>{path}</code> at line {paragraph + 1} of {props.paragraphCount}.
                    </p>
                    <div className="mke-agent-chips">
                      <button type="button" onClick={find}>
                        <Files size={12} />
                        Task / Chapters
                      </button>
                      <button type="button" onClick={() => props.onBookmark?.()}>
                        <Bookmark size={12} />
                        {props.bookmarked ? 'Pinned' : 'Pin Line'}
                      </button>
                      <button type="button" onClick={() => props.onToggleSummary?.()}>
                        <ListTree size={12} />
                        Walkthrough
                      </button>
                    </div>
                  </div>
                </div>

                <form className="mke-agent-compose" onSubmit={submitAgentPrompt}>
                  <input
                    className="mke-agent-prompt"
                    value={agentPrompt}
                    onChange={e => setAgentPrompt(e.target.value)}
                    placeholder={
                      gravity
                        ? 'Ask anything, type # or keyword…'
                        : 'Ask Copilot… (chapter # / keyword)'
                    }
                    title="输入章节号或关键词按 Enter 定位"
                  />
                  <div>
                    <button
                      type="button"
                      title="Import TXT / EPUB"
                      onClick={props.onImportFiles}
                    >
                      <Plus size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        props.onWorkHints?.({
                          enabled: !hintsEnabled,
                          frequency: props.workHints?.frequency ?? 5,
                        })
                      }
                      title="切换工作提示行"
                    >
                      <span>{gravity ? (hintsEnabled ? 'Planning' : 'Fast') : 'Agent'}</span>
                      <ChevronDown />
                    </button>
                    <div className="mke-pop-anchor">
                      <button
                        type="button"
                        onClick={() => setModelPop(v => !v)}
                        title="切换模拟界面、布局或字号"
                      >
                        <span>{gravity ? 'Gemini' : 'Auto'}</span>
                        <ChevronDown />
                      </button>
                      {modelPop && (
                        <ModelSwitcherPopover
                          open
                          onClose={() => setModelPop(false)}
                          theme={props.shellTheme ?? 'dark'}
                          align="right"
                          placement="above"
                          p={props}
                        />
                      )}
                    </div>
                    <button type="submit" aria-label="查找文件">
                      <ArrowRight />
                    </button>
                  </div>
                </form>
              </>
            )}
          </aside>
        )}
      </div>

      {!manager && (
        <footer className="mke-status">
          <button
            type="button"
            className="mke-remote"
            onClick={onBack}
            title="关闭工作区返回书架"
          >
            <Code2 />
          </button>
          <button type="button" onClick={props.onProjects} title="切换书籍工作区 (Ctrl+K)">
            <GitBranch />
            <span>main</span>
          </button>
          <button
            type="button"
            className="mke-diag"
            onClick={() => props.onToggleSummary?.()}
            title="一键切换老板键工作摘要 (Space)"
          >
            <CircleAlert />
            0 <TriangleAlert />0
          </button>
          <div className="mke-fill" />
          <button type="button" title="Go to File / Index" onClick={find}>
            Ln {paragraph + 1}, Col 1 ({percent.toFixed(0)}%)
          </button>
          <span className="mke-opt">Spaces: 2</span>
          <span>UTF-8</span>
          <span className="mke-opt">LF</span>
          <button type="button" title="打开排版与外观设置" onClick={onSettings}>
            Markdown
          </button>
          <button
            type="button"
            title="查看书签列表"
            aria-label="书签列表"
            onClick={props.onOpenBookmarks}
          >
            <Bell />
          </button>
        </footer>
      )}
    </div>
  );
}
