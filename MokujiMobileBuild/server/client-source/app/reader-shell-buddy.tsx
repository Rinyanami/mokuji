import { useSidebarShortcut } from './reader-shortcuts';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlarmClock, ArrowDown, ArrowLeft, ArrowUp, Bell, BookOpen, Bot, BrainCircuit, Check,
  ChevronDown, ChevronLeft, ChevronRight, CirclePlus, Cloud, Globe2, History, Image,
  Laptop, LayoutGrid, ListFilter, Mic, Minus, MoreHorizontal, PanelLeft, PanelRight,
  Paperclip, PenLine, Plus, Search, Settings2, ShieldCheck, Sparkles, Square, SquarePen, Star, X,
} from 'lucide-react';
import type { ReaderShellProps } from './reader-shell-types';
import { ReaderLedeContext, ReaderTailContext } from './reader-shell-lede';
import { ModelSwitcherPopover, ShellActionBar, SidebarTaskActions } from './reader-shell-popovers';
import { PeekText, RevealToggle } from './reader-shell-peek';
import './reader-shell-buddy.css';

import buddyLogo from './skin-media/workbuddy-mark.svg';
import doubaoLogo from './skin-media/doubao.png';
import deepseekLogo from './skin-media/deepseek.svg';

function GlyphButton({
  label,
  children,
  onClick,
  disabled = false,
  active = false,
  className = '',
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={'bd-icon ' + (active ? 'is-active ' : '') + className}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function AssistantMark({ buddy }: { buddy: boolean }) {
  return (
    <span aria-hidden="true" className={'bd-mark ' + (buddy ? 'bd-mark-buddy' : 'bd-mark-doubao')}>
      <img alt="" src={buddy ? buddyLogo : doubaoLogo} />
    </span>
  );
}

function recordName(n: number) {
  return '工作记录 ' + String(n + 1).padStart(3, '0');
}

function Intro({
  buddy,
  p,
  openContents,
}: {
  buddy: boolean;
  p: ReaderShellProps;
  openContents: () => void;
}) {
  const hintsEnabled = p.workHints?.enabled ?? true;
  if (!buddy) {
    return (
      <div className="bd-intro">
        <div className="bd-question">
          <button type="button" onClick={openContents} title="点击打开章节与书签目录" style={{ textAlign: 'inherit', font: 'inherit', color: 'inherit' }}>
            {p.chapterTitle}
          </button>
        </div>
        <div className="bd-identity">
          <AssistantMark buddy={false} />
          <strong>豆包</strong>
        </div>
        <div className="bd-doubao-think">
          <button
            type="button"
            className="bd-think-toggle"
            onClick={() => p.onToggleSummary?.()}
            title="点击收起正文 / 切换工作摘要 (Space)"
          >
            <Sparkles size={13} />
            <span>已深度思考（用时 {Math.max(3, (p.chapter % 7) + 4)} 秒）</span>
            <ChevronDown size={13} />
          </button>
          {hintsEnabled && (
            <button type="button" className="bd-think-quote" onClick={openContents} title="打开章节目录与索引" style={{ textAlign: 'left', width: '100%' }}>
              已按当前目录索引定位至第 {p.chapter + 1} / {p.chapters.length} 项记录，正在核对上下文并输出正文。
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bd-intro">
      <div className="bd-question">
        <button type="button" onClick={openContents} title="点击打开章节与书签目录" style={{ textAlign: 'inherit', font: 'inherit', color: 'inherit' }}>
          {p.chapterTitle}
        </button>
      </div>
      <div className="bd-identity">
        <AssistantMark buddy />
        <strong>WorkBuddy</strong>
      </div>
      <div className="bd-run">
        <button
          type="button"
          onClick={() => p.onToggleSummary?.()}
          aria-expanded={!p.summaryOpen}
          title={p.summaryOpen ? '展开工作记录 (Space)' : '显示工作摘要 (Space)'}
        >
          <Check />
          已完成 {p.surface === 'desktop' ? `${Math.max(1, (p.chapter % 6) + 2)}m` : ''}
          <ChevronDown />
        </button>
        {hintsEnabled && (
          <button type="button" className="bd-tool" onClick={openContents}>
            <Globe2 />
            收集资料，核对工作记录 ({p.chapter + 1}/{p.chapters.length})
          </button>
        )}
      </div>
    </div>
  );
}

export function BuddyDoubaoShell(p: ReaderShellProps) {
  useSidebarShortcut(toggleRail);
  const buddy = p.product === 'workbuddy';
  const desktop = p.surface === 'desktop';
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 768px), (max-height: 500px) and (pointer: coarse)').matches);
  const [sidebar, setSidebar] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [contents, setContents] = useState(false);
  const [tab, setTab] = useState<'chapters' | 'marks'>('chapters');
  const [modelPopover, setModelPopover] = useState<'discover' | 'compose' | null>(null);
  const [topMenu, setTopMenu] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const chapterFilter = useRef<HTMLInputElement>(null);
  const menuTrigger = useRef<HTMLElement | null>(null);
  const story = useRef<HTMLDivElement>(null);
  const [canScrollDown, setCanScrollDown] = useState(false);

  useEffect(() => {
    const sheet = story.current?.querySelector<HTMLElement>('.mokuji-shell-text');
    if (p.summaryOpen || !sheet) {
      setCanScrollDown(false);
      return;
    }
    const update = () => setCanScrollDown(sheet.scrollHeight - sheet.clientHeight - sheet.scrollTop > 8);
    const resize = new ResizeObserver(update);
    resize.observe(sheet);
    const article = sheet.querySelector('article');
    if (article) resize.observe(article);
    sheet.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      sheet.removeEventListener('scroll', update);
      resize.disconnect();
    };
  }, [p.chapter, p.disabled, p.paragraphCount, p.summaryOpen]);

  const sideOpen = compact ? drawer : sidebar;
  const { current, previous, next } = useMemo(() => {
    const currentIdx = p.chapters.findIndex(c => c.n === p.chapter);
    const before = p.chapters.slice(0, Math.max(0, currentIdx)).filter(c => c.available);
    const after = p.chapters.slice(currentIdx + 1).filter(c => c.available);
    return { current: currentIdx, previous: before.at(-1), next: after[0] };
  }, [p.chapters, p.chapter]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px), (max-height: 500px) and (pointer: coarse)');
    const update = () => {
      setCompact(mq.matches);
      setDrawer(false);
    };
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (contents && tab === 'chapters') chapterFilter.current?.focus();
  }, [contents, tab]);

  useEffect(() => {
    if (!contents && !drawer && !topMenu && !modelPopover) return;
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (modelPopover) setModelPopover(null);
        else if (topMenu) setTopMenu(null);
        else {
          setContents(false);
          setDrawer(false);
          menuTrigger.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [contents, drawer, topMenu, modelPopover]);

  function rememberTrigger() {
    if (document.activeElement instanceof HTMLElement) menuTrigger.current = document.activeElement;
  }
  function toggleRail() {
    rememberTrigger();
    if (compact) setDrawer(!drawer);
    else setSidebar(!sidebar);
  }
  function openContents(search = '', defaultTab: 'chapters' | 'marks' = 'chapters') {
    rememberTrigger();
    setDrawer(false);
    setTopMenu(null);
    setModelPopover(null);
    setTab(defaultTab);
    setFilter(search);
    setContents(true);
  }
  function go(n: number) {
    if (!p.disabled) {
      p.onChapter(n);
      setContents(false);
      setDrawer(false);
      setQuery('');
    }
  }
  function submit(e?: FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!q) {
      if (next) go(next.n);
      else openContents();
      return;
    }
    if (p.onFindRecord) {
      setQuery('');
      p.onFindRecord(q);
      return;
    }
    const n = /^\d+$/.test(q) ? Number(q) - 1 : undefined;
    const found = p.chapters.filter(c =>
      c.available && (n === undefined ? c.title.includes(q) || (c.realTitle || '').includes(q) || recordName(c.n).includes(q) : c.n === n),
    );
    if (found.length === 1) go(found[0].n);
    else openContents(q);
  }

  const normalizedFilter = filter.trim().toLowerCase();
  const visibleChapters = contents
    ? p.chapters.filter(
        c =>
          !normalizedFilter ||
          c.title.toLowerCase().includes(normalizedFilter) ||
          (c.realTitle || '').toLowerCase().includes(normalizedFilter) ||
          recordName(c.n).toLowerCase().includes(normalizedFilter) ||
          String(c.n + 1) === normalizedFilter,
      )
    : [];
  const heading = p.projects.find(project => project.current)?.name || p.bookTitle;
  const percent =
    p.progressPercent ??
    (100 * (Math.max(0, current) + (p.paragraph + 1) / Math.max(1, p.paragraphCount))) /
      Math.max(1, p.chapters.length);
  const hintsEnabled = p.workHints?.enabled ?? true;

  const sideButton = (icon: ReactNode, label: string, fn: () => void, extra?: ReactNode, title?: string) => (
    <button
      type="button"
      title={title}
      onClick={() => {
        setDrawer(false);
        fn();
      }}
    >
      {icon}
      <span>{label}</span>
      {extra}
    </button>
  );

  const lede = <Intro buddy={buddy} p={p} openContents={() => openContents()} />;
  const activeTheme = p.shellTheme ?? (buddy && desktop ? 'dark' : 'light');
  const tail = (
    <ShellActionBar
      p={p}
      variant={buddy ? 'workbuddy' : 'doubao'}
      theme={activeTheme}
    />
  );

  const desktopMenus: Record<string, [string, () => void][]> = {
    '编辑(E)': [
      ['复制当前章节', () => p.onCopyChapter?.()],
      ['添加书签 (Ctrl+D)', () => p.onBookmark?.()],
      ['查找记录 (Ctrl+F)', () => openContents()],
    ],
    '窗口(W)': [
      ['切换侧栏 (Ctrl+B)', toggleRail],
      ['工作摘要 (Space)', () => p.onToggleSummary?.()],
      ['切换工作区 (Ctrl+K)', p.onProjects],
    ],
    '帮助(H)': [
      ['工作台与外观设置', p.onSettings],
      ['我的书签记录', () => openContents('', 'marks')],
    ],
    '关于(A)': [
      ['返回书架主页', p.onBack],
      ['导入 TXT / EPUB', p.onImportFiles],
    ],
  };

  return (
    <div
      className={
        'bd-reader ' +
        (buddy ? 'bd-buddy' : 'bd-doubao') +
        (desktop ? ' bd-desktop' : ' bd-web')
      }
      data-surface={p.surface}
      data-product={p.product}
    >
      {desktop && (
        <div className="bd-frame">
          {buddy ? (
            <>
              <GlyphButton label="切换侧栏 (Ctrl+B)" onClick={toggleRail}>
                <PanelLeft />
              </GlyphButton>
              <GlyphButton label="搜索记录 (Ctrl+F)" onClick={() => openContents()}>
                <Search />
              </GlyphButton>
              <GlyphButton label="书签与目录" onClick={() => openContents('', 'marks')}>
                <ListFilter />
              </GlyphButton>
            </>
          ) : (
            <>
              <GlyphButton label="展开或收起侧栏 (Ctrl+B)" onClick={toggleRail}>
                <PanelLeft />
              </GlyphButton>
              <GlyphButton label="返回资料库" onClick={p.onBack}>
                <ArrowLeft />
              </GlyphButton>
            </>
          )}
          {buddy ? (
            <div className="bd-menubar">
              {Object.keys(desktopMenus).map(label => (
                <div key={label} className="bd-menu-wrap">
                  <button
                    type="button"
                    aria-expanded={topMenu === label}
                    onClick={() => setTopMenu(m => (m === label ? null : label))}
                  >
                    {label}
                  </button>
                  {topMenu === label && (
                    <div className="bd-menu-pop">
                      {desktopMenus[label].map(([text, fn]) => (
                        <button
                          key={text}
                          type="button"
                          onClick={() => {
                            setTopMenu(null);
                            fn();
                          }}
                        >
                          {text}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="bd-desktop-tab">
                <AssistantMark buddy={false} />
                <span>{heading}</span>
                <button
                  type="button"
                  className="bd-tab-close"
                  aria-label="返回书架"
                  onClick={p.onBack}
                >
                  <X size={11} />
                </button>
              </div>
              <GlyphButton label="新建对话（导入书籍）" onClick={p.onImportFiles}>
                <Plus />
              </GlyphButton>
            </>
          )}
          <span className="bd-fill" />
          <div className="bd-window-glyphs">
            <button type="button" aria-label="工作摘要" title="切换工作摘要 (Space)" onClick={() => p.onToggleSummary?.()}>
              <Minus />
            </button>
            <button type="button" aria-label="设置" title="阅读设置" onClick={p.onSettings}>
              <Square />
            </button>
            <button type="button" className="bd-win-close" aria-label="返回书架" title="返回书架" onClick={p.onBack}>
              <X />
            </button>
          </div>
        </div>
      )}

      <div className="bd-columns">
        {sideOpen && compact && (
          <button
            type="button"
            className="bd-backdrop"
            aria-label="收起侧边栏"
            onClick={() => setDrawer(false)}
          />
        )}
        {sideOpen && (
          <aside className="bd-side" aria-label="工作区侧栏">
            <div className="bd-brand-row">
              {buddy ? (
                <>
                  <div className="bd-brandtext">
                    <strong>WorkBuddy</strong>
                    <small>{desktop ? 'V1.1.3-platform.1' : '工作空间'}</small>
                  </div>
                  <div className="bd-pop-anchor">
                    <button
                      type="button"
                      className="bd-discover"
                      onClick={() => setModelPopover(m => (m === 'discover' ? null : 'discover'))}
                      title="切换其他工作台外观"
                    >
                      <LayoutGrid />
                      <span>发现应用</span>
                      <ChevronDown />
                    </button>
                    {modelPopover === 'discover' && (
                      <ModelSwitcherPopover
                        open
                        onClose={() => setModelPopover(null)}
                        theme={activeTheme}
                        align="left"
                        placement="below"
                        p={p}
                      />
                    )}
                  </div>
                </>
              ) : (
                <>
                  <AssistantMark buddy={false} />
                  <strong>豆包</strong>
                  <span className="bd-fill" />
                  <GlyphButton label="收起侧栏" onClick={toggleRail}>
                    <PanelLeft />
                  </GlyphButton>
                </>
              )}
            </div>

            <nav className="bd-actions">
              {buddy ? (
                <>
                  {sideButton(<CirclePlus />, '新建任务', p.onImportFiles, undefined, '导入 TXT / EPUB')}
                  {sideButton(
                    <Bot />,
                    '助理',
                    () => p.onToggleSummary?.(),
                    <em>BETA</em>,
                    '切换工作摘要 (Space)',
                  )}
                  {sideButton(
                    <LayoutGrid />,
                    '专家·技能·连接器',
                    () => setModelPopover(m => (m === 'discover' ? null : 'discover')),
                    undefined,
                    '切换工作界面与模型',
                  )}
                  {sideButton(
                    <AlarmClock />,
                    '定时任务',
                    () => openContents('', 'marks'),
                    undefined,
                    '查看书签与阅读进度',
                  )}
                  {sideButton(<FolderIcon />, '资料库', p.onProjects, undefined, '切换书库工作区 (Ctrl+K)')}
                  {sideButton(<MoreHorizontal />, '更多', p.onSettings)}
                </>
              ) : (
                <>
                  {sideButton(<SquarePen />, '新对话', p.onImportFiles, undefined, '导入 TXT / EPUB')}
                  {sideButton(<Search />, 'AI 搜索', () => openContents(), undefined, '搜索章节 (Ctrl+F)')}
                  {sideButton(<PenLine />, '帮我写作', () => openContents('', 'marks'), undefined, '查看书签笔记')}
                  {sideButton(<Cloud />, '云盘', p.onProjects, undefined, '打开工作区书库 (Ctrl+K)')}
                  {sideButton(<Image />, '图像生成', () => p.onToggleSummary?.(), undefined, '切换工作摘要 (Space)')}
                  {desktop && sideButton(<Star />, '收藏', () => openContents('', 'marks'), undefined, '查看我的书签')}
                </>
              )}
            </nav>

            <div className="bd-history">
              <div className="bd-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>{buddy ? `任务 (${p.projects.length})` : '今天 · 历史对话'}</span>
                <RevealToggle active={!!p.revealReal} onToggle={p.onToggleReveal} />
              </div>
              {p.projects.map(project => (
                <div
                  key={project.id}
                  className={'bd-side-item-row' + (project.current ? ' selected' : '')}
                >
                  <button
                    type="button"
                    className={'bd-side-item' + (project.current ? ' selected' : '')}
                    title={project.realTitle || project.name}
                    aria-current={project.current ? 'page' : undefined}
                    onClick={() => {
                      setDrawer(false);
                      p.onProject(project.id);
                    }}
                  >
                    <PeekText mask={project.name} real={project.realTitle} />
                    {buddy && <time>{project.current ? '刚刚' : '已保存'}</time>}
                  </button>
                  <SidebarTaskActions
                    projectId={project.id}
                    onRename={p.onRenameProject}
                    onManage={p.onProjects}
                  />
                </div>
              ))}
              {buddy ? (
                <>
                  <div className="bd-section-label">空间 (0)</div>
                  <div className="bd-empty">暂无任务</div>
                </>
              ) : (
                <button type="button" className="bd-show-history" onClick={p.onProjects}>
                  <History /> 全部历史 (Ctrl+K)
                </button>
              )}
            </div>

            <div className="bd-profile">
              <span className="bd-avatar">
                {buddy ? <img src={buddyLogo} alt="" /> : <BookOpen size={14} />}
              </span>
              <button type="button" onClick={p.onSettings}>
                {buddy ? '心碎的咸菜' : '我的空间'}
              </button>
              <span className="bd-fill" />
              {buddy && (
                <GlyphButton label="书签记录" onClick={() => openContents('', 'marks')}>
                  <Bell />
                </GlyphButton>
              )}
              <GlyphButton label="工作台设置" onClick={p.onSettings}>
                {buddy ? <Laptop /> : <Settings2 />}
              </GlyphButton>
            </div>
          </aside>
        )}

        <section className="bd-room" aria-label={buddy ? 'WorkBuddy 工作区' : '豆包对话'}>
          <header className="bd-roomhead">
            {(!sideOpen || compact || !desktop) && (
              <GlyphButton label="切换侧栏" onClick={toggleRail}>
                <PanelLeft />
              </GlyphButton>
            )}
            <button type="button" className="bd-heading" title={p.realBookTitle || heading} onClick={p.onProjects}>
              <PeekText mask={heading} real={p.realBookTitle} />
              <ChevronDown />
            </button>
            <span className="bd-fill" />
            <GlyphButton label="查找章节 (Ctrl+F)" onClick={() => openContents()}>
              <Search />
            </GlyphButton>
            <GlyphButton
              label={p.bookmarked ? '取消书签 (Ctrl+D)' : '保存当前书签 (Ctrl+D)'}
              active={!!p.bookmarked}
              onClick={() => p.onBookmark?.()}
            >
              <Star fill={p.bookmarked ? 'currentColor' : 'none'} />
            </GlyphButton>
            <GlyphButton label="工作台外观与字号" onClick={p.onSettings}>
              <MoreHorizontal />
            </GlyphButton>
            <GlyphButton label="章节目录与书签" onClick={() => openContents()}>
              <PanelRight />
            </GlyphButton>
          </header>

          <div className="bd-story" ref={story}>
            <ReaderLedeContext.Provider value={lede}>
              <ReaderTailContext.Provider value={tail}>{p.children}</ReaderTailContext.Provider>
            </ReaderLedeContext.Provider>
            {!p.summaryOpen && canScrollDown && (
              <button
                type="button"
                className="bd-jump"
                title="转到当前记录末尾"
                aria-label="转到当前记录末尾"
                onClick={() => {
                  const sheet = story.current?.querySelector<HTMLElement>('.mokuji-shell-text');
                  if (sheet) sheet.scrollTop = sheet.scrollHeight;
                }}
              >
                <ArrowDown />
              </button>
            )}
          </div>

          <div className="bd-dock">
            <form className="bd-composer" onSubmit={submit}>
              <textarea
                ref={input}
                rows={buddy && desktop ? 2 : 1}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
                aria-label="按记录名称或编号定位"
                title="输入章号或关键词，按 Enter 定位"
                placeholder={
                  buddy
                    ? '今天帮你做些什么？ @ 添加上下文，调用技能与指令'
                    : '发消息或输入「/」选择技能（输入章号按 Enter 跳转）'
                }
              />
              <div className="bd-composebar">
                <GlyphButton label="选择章节 / 目录" onClick={() => openContents()}>
                  {buddy ? <Plus /> : <Paperclip />}
                </GlyphButton>
                {!buddy && (
                  <>
                    <button
                      className={'bd-chip' + (hintsEnabled ? ' is-on' : '')}
                      type="button"
                      onClick={() =>
                        p.onWorkHints?.({ enabled: !hintsEnabled, frequency: p.workHints?.frequency ?? 5 })
                      }
                      title="切换工作提示行显示"
                    >
                      <BrainCircuit />
                      <span>深度思考</span>
                    </button>
                    <button
                      className="bd-chip"
                      type="button"
                      onClick={() => openContents()}
                      title="搜索全书章节"
                    >
                      <Globe2 />
                      <span>联网搜索</span>
                    </button>
                  </>
                )}
                {buddy && (
                  <button
                    type="button"
                    className={'bd-access' + (!hintsEnabled ? ' is-off' : '')}
                    onClick={() =>
                      p.onWorkHints?.({ enabled: !hintsEnabled, frequency: p.workHints?.frequency ?? 5 })
                    }
                    title="点击切换工作提示行"
                  >
                    <ShieldCheck />
                    <span>{hintsEnabled ? '允许完全访问' : '静默输出'}</span>
                    <ChevronDown />
                  </button>
                )}
                <span className="bd-fill" />
                {buddy && (
                  <button
                    type="button"
                    className="bd-readpercent"
                    aria-label={`阅读进度 ${percent.toFixed(1)}%`}
                    title={`阅读进度 ${percent.toFixed(1)}% · 第 ${p.chapter + 1}/${p.chapters.length} 章`}
                    onClick={() => openContents()}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" opacity=".22" strokeWidth="2" />
                      <circle
                        cx="10"
                        cy="10"
                        r="7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        pathLength="100"
                        strokeDasharray="100"
                        strokeDashoffset={100 - percent}
                        transform="rotate(-90 10 10)"
                      />
                    </svg>
                  </button>
                )}
                <div className="bd-pop-anchor">
                  <button
                    type="button"
                    className="bd-model"
                    title="切换模型皮肤、形态与字号"
                    onClick={() => setModelPopover(m => (m === 'compose' ? null : 'compose'))}
                  >
                    {buddy ? (
                      <>
                        <img src={deepseekLogo} alt="" />
                        <span>DeepSeek-V4.1-Flash</span>
                      </>
                    ) : (
                      <span>Doubao-Seed-2.0</span>
                    )}
                    <ChevronDown />
                  </button>
                  {modelPopover === 'compose' && (
                    <ModelSwitcherPopover
                      open
                      onClose={() => setModelPopover(null)}
                      theme={activeTheme}
                      align="right"
                      placement="above"
                      p={p}
                    />
                  )}
                </div>
                {buddy && desktop ? (
                  <GlyphButton
                    label={p.bookmarked ? '取消书签 (Ctrl+D)' : '保存当前书签 (Ctrl+D)'}
                    active={!!p.bookmarked}
                    onClick={() => p.onBookmark?.()}
                  >
                    <Mic />
                  </GlyphButton>
                ) : (
                  <GlyphButton
                    label="上一章 (Alt+←)"
                    onClick={() => previous && go(previous.n)}
                    disabled={!previous || p.disabled}
                  >
                    <ChevronLeft />
                  </GlyphButton>
                )}
                <button
                  type="submit"
                  className="bd-send"
                  title={query.trim() ? '定位章节' : '下一章'}
                  aria-label={query.trim() ? '定位章节' : '下一章'}
                  disabled={p.disabled || (!query.trim() && !next)}
                >
                  <ArrowUp />
                </button>
              </div>
            </form>
            {buddy && desktop && (
              <small className="bd-caveat" title="工作台提示">
                内容由 AI 生成，请核实重要信息
              </small>
            )}
          </div>
        </section>
      </div>

      {contents && (
        <div className="bd-overlay">
          <button
            type="button"
            className="bd-backdrop"
            aria-label="关闭记录选择"
            onClick={() => setContents(false)}
          />
          <div className="bd-index" role="dialog" aria-label="记录索引">
            <header>
              <div className="bd-index-tabs">
                <button
                  type="button"
                  aria-pressed={tab === 'chapters'}
                  onClick={() => setTab('chapters')}
                >
                  记录索引 ({p.chapters.length})
                </button>
                <button
                  type="button"
                  aria-pressed={tab === 'marks'}
                  onClick={() => setTab('marks')}
                >
                  书签 ({p.bookmarks?.length ?? 0})
                </button>
              </div>
              <RevealToggle active={!!p.revealReal} onToggle={p.onToggleReveal} label={p.revealReal ? '恢复伪装' : '显示真名'} />
              <GlyphButton
                label="关闭索引"
                onClick={() => {
                  setContents(false);
                  menuTrigger.current?.focus();
                }}
              >
                <X />
              </GlyphButton>
            </header>

            {tab === 'chapters' ? (
              <>
                <label>
                  <Search />
                  <input
                    ref={chapterFilter}
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    placeholder="输入记录名称、真实章节标题或编号"
                    aria-label="搜索记录"
                  />
                </label>
                <div className="bd-results">
                  {visibleChapters.map(c => (
                    <button
                      type="button"
                      key={c.n}
                      title={`第 ${c.n + 1} 章 · ${c.realTitle || c.title}`}
                      disabled={!c.available || p.disabled}
                      aria-current={c.n === p.chapter ? 'page' : undefined}
                      onClick={() => go(c.n)}
                    >
                      <span>{c.n + 1}</span>
                      <b><PeekText mask={c.title} real={c.realTitle} /></b>
                      {c.n === p.chapter && <Check />}
                    </button>
                  ))}
                  {!visibleChapters.length && <p>没有找到对应记录</p>}
                </div>
              </>
            ) : (
              <div className="bd-results">
                <button
                  type="button"
                  className="bd-mark-now"
                  onClick={() => p.onBookmark?.()}
                >
                  <Star size={14} fill={p.bookmarked ? 'currentColor' : 'none'} />
                  <b>{p.bookmarked ? '取消当前位置书签' : '保存当前位置书签'}</b>
                </button>
                {(p.bookmarks ?? []).map((mark, idx) => {
                  const realCh = p.chapters.find(c => c.n === mark.chapter)?.realTitle || `第 ${mark.chapter + 1} 章`;
                  return (
                    <button
                      type="button"
                      key={mark.chapter + ':' + mark.paragraph + ':' + idx}
                      title={`${realCh} · 第 ${mark.paragraph + 1} 段`}
                      onClick={() => {
                        setContents(false);
                        p.onJumpPoint?.(mark);
                      }}
                    >
                      <span>#{mark.chapter + 1}</span>
                      <b><PeekText mask={`第 ${mark.paragraph + 1} 段`} real={`${realCh} · 第 ${mark.paragraph + 1} 段`} /></b>
                    </button>
                  );
                })}
                {!(p.bookmarks?.length) && <p>还没有书签，按 Ctrl+D 或点击星标即可保存。</p>}
              </div>
            )}

            <button
              type="button"
              className="bd-settings"
              onClick={() => {
                setContents(false);
                p.onSettings();
              }}
            >
              <Settings2 />
              <span>工作台外观与字号</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

export default BuddyDoubaoShell;
