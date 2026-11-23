import { useSidebarShortcut } from './reader-shortcuts';
import { useEffect, useRef, useState, type ReactNode, type FormEvent } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, AtSign, AudioLines, Bell, Bookmark, Check,
  ChevronDown, ChevronRight, Clock, Diamond, Files, GitFork, House, LayoutGrid, Mic,
  Minus, MoreHorizontal, PanelLeft, PanelRight, Plus, Search, ShieldAlert, SlidersHorizontal,
  Square, SquarePen, Wifi, X, Zap,
} from 'lucide-react';
import { ReaderLedeContext, ReaderTailContext } from './reader-shell-lede';
import { ModelSwitcherPopover, ShellActionBar, SidebarTaskActions } from './reader-shell-popovers';
import { PeekText, RevealToggle } from './reader-shell-peek';
import type { ReaderShellProps } from './reader-shell-types';
import './reader-shell-cotex.css';

type Panel = 'files' | 'bookmarks' | 'help' | null;
type Menu = '文件' | '编辑' | '视图' | '帮助' | null;

function Tool({
  label,
  children,
  onClick,
  disabled = false,
  active = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={'cx-tool' + (active ? ' active' : '')}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function DotPet() {
  return (
    <svg className="cx-dot" viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="cx-frog" x2="0" y2="1">
          <stop stopColor="#bde95b" />
          <stop offset="1" stopColor="#80c339" />
        </linearGradient>
      </defs>
      <path fill="#292c20" d="m7 17-1 5 6-2 6 2-1-5Z" />
      <ellipse fill="url(#cx-frog)" cx="12" cy="11.6" rx="10.3" ry="7.5" />
      <ellipse fill="#acd954" cx="6.5" cy="5.5" rx="3.8" ry="4.1" />
      <ellipse fill="#acd954" cx="17.5" cy="5.5" rx="3.8" ry="4.1" />
      <ellipse fill="#30372a" cx="7" cy="4.6" rx="1.2" ry="1.7" />
      <ellipse fill="#30372a" cx="17" cy="4.6" rx="1.2" ry="1.7" />
      <path d="M9.8 14q2.2 1 4.4 0" fill="none" stroke="#7ca336" strokeWidth=".7" />
    </svg>
  );
}

export default function CotexShell(p: ReaderShellProps) {
  const [rail, setRail] = useState(() => window.innerWidth > 720);
  useSidebarShortcut(() => setRail(value => !value));
  const [panel, setPanel] = useState<Panel>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [modelMenu, setModelMenu] = useState<'brand' | 'compose' | 'rail' | null>(null);
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useState(80);
  const [closed, setClosed] = useState(false);
  const [parked, setParked] = useState(false);
  const [windowed, setWindowed] = useState(false);
  const [minutes, setMinutes] = useState(1);
  const [composing, setComposing] = useState('');
  const body = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const field = useRef<HTMLInputElement>(null);

  const area = p.projects.find(project => project.current)?.name || p.bookTitle;
  const current = p.chapters.findIndex(c => c.n === p.chapter);
  const prev = current > 0 ? p.chapters[current - 1] : undefined;
  const next = p.chapters[current + 1];
  const norm = filter.trim().toLowerCase();
  const rows = norm
    ? p.chapters.filter(c => c.title.toLowerCase().includes(norm) || (c.realTitle || '').toLowerCase().includes(norm) || String(c.n + 1) === norm)
    : p.chapters;
  const percent = p.chapters.length
    ? (current + (p.paragraph + 1) / Math.max(p.paragraphCount, 1)) / p.chapters.length
    : 0;
  const percentText = Math.round(percent * 100);
  const hintsEnabled = p.workHints?.enabled ?? true;

  useEffect(() => {
    const media = window.matchMedia('(max-width: 720px)');
    const change = () => setRail(!media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    let chars = 0;
    body.current?.querySelectorAll('p[data-p]').forEach(line => {
      chars += line.textContent?.length || 0;
    });
    setMinutes(Math.max(1, Math.ceil(chars / 600)));
    setClosed(false);
  }, [p.chapter, p.paragraphCount]);

  useEffect(() => {
    function escape(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (modelMenu) setModelMenu(null);
      else if (menu) setMenu(null);
      else if (panel) setPanel(null);
      else if (parked) setParked(false);
      else if (window.innerWidth <= 720) setRail(false);
    }
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [panel, menu, parked, modelMenu]);

  function show(target: Panel, term = '') {
    setMenu(null);
    setParked(false);
    setModelMenu(null);
    setPanel(prevPanel => (prevPanel === target && !term ? null : target));
    setFilter(term);
    setLimit(80);
    if (window.innerWidth <= 720) setRail(false);
    if (target === 'files') requestAnimationFrame(() => field.current?.focus());
  }

  function jump(n: number) {
    if (p.disabled) return;
    setPanel(null);
    setClosed(false);
    if (n !== p.chapter) p.onChapter(n);
  }

  function locate(e?: FormEvent) {
    e?.preventDefault();
    const term = composing.trim();
    if (!term) {
      advance();
      return;
    }
    if (p.onFindRecord) {
      setComposing('');
      p.onFindRecord(term);
      return;
    }
    const direct = p.chapters.find(c => String(c.n + 1) === term);
    if (direct?.available) {
      setComposing('');
      jump(direct.n);
    } else {
      show('files', term);
    }
  }

  function advance() {
    const sheet = body.current?.querySelector<HTMLElement>('.mokuji-shell-text');
    if (!sheet) return;
    const remaining = sheet.scrollHeight - sheet.clientHeight - sheet.scrollTop;
    if (remaining < 4 && next?.available) jump(next.n);
    else if (p.onNextPage) p.onNextPage();
    else {
      sheet.focus();
      sheet.scrollBy({ top: sheet.clientHeight * 0.8, behavior: 'auto' });
    }
  }

  function maximize() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => setWindowed(w => !w));
    else if (document.documentElement.requestFullscreen)
      void document.documentElement.requestFullscreen().catch(() => setWindowed(w => !w));
    else setWindowed(w => !w);
  }

  const actions: Record<Exclude<Menu, null>, readonly [string, () => void][]> = {
    文件: [
      ['新聊天（导入文件）', p.onImportFiles],
      ['打开工作区 (Ctrl+K)', p.onProjects],
      ['返回书架', p.onBack],
    ],
    编辑: [
      ['复制当前章节', () => p.onCopyChapter?.()],
      ['添加书签 (Ctrl+D)', () => p.onBookmark?.()],
      ['查找章节 (Ctrl+F)', () => show('files')],
    ],
    视图: [
      ['切换侧栏 (Ctrl+B)', () => setRail(v => !v)],
      ['切换工作摘要 (Space)', () => toggleSummary()],
      ['切换全屏', maximize],
      ['外观与阅读设置', p.onSettings],
    ],
    帮助: [
      ['快捷键与使用说明', () => show('help')],
      ['查看书签记录', () => show('bookmarks')],
    ],
  };

  const toggleSummary = () => {
    if (p.onToggleSummary) p.onToggleSummary();
    else setClosed(v => !v);
  };

  const lead = (
    <div className="cx-lede">
      <div className="cx-user-bubble">
        <span>{p.chapterTitle}</span>
      </div>
      <button
        type="button"
        className="cx-timing"
        onClick={toggleSummary}
        aria-expanded={!(p.summaryOpen || closed)}
        title="点击切换工作摘要 (Space)"
      >
        <span>
          {closed || p.summaryOpen ? `已完成工作 · ${minutes} 分钟` : `用时 ${minutes} 分钟`}
        </span>
        {closed || p.summaryOpen ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
      </button>
      {hintsEnabled && (
        <div className="cx-check">
          <Wifi size={15} />
          <span>
            {closed ? '已完成资料核对' : `正在核对资料 ${p.chapter + 1}/${p.chapters.length}`}
          </span>
        </div>
      )}
      {closed && (
        <div className="cx-collapsed">
          已检查原始资料，完成结构核对与记录整理。
          <button type="button" onClick={() => setClosed(false)}>
            展开工作记录
          </button>
        </div>
      )}
    </div>
  );

  const tail = <ShellActionBar p={p} variant="codex" theme={p.shellTheme ?? 'dark'} />;

  return (
    <div
      className={
        'ags-shell cx-local' +
        (rail ? ' cx-side-on' : '') +
        (closed ? ' cx-collapse' : '') +
        (windowed ? ' cx-wide' : '')
      }
      data-product="codex"
      data-surface="desktop"
    >
      <header className="cx-bar">
        <Tool
          label="上一章 (Alt+←)"
          disabled={p.disabled || !prev?.available}
          onClick={() => prev && jump(prev.n)}
        >
          <ArrowLeft />
        </Tool>
        <Tool
          label="下一章 (Alt+→)"
          disabled={p.disabled || !next?.available}
          onClick={() => next && jump(next.n)}
        >
          <ArrowRight />
        </Tool>
        <Tool label="切换侧栏 (Ctrl+B)" onClick={() => setRail(s => !s)}>
          <PanelLeft />
        </Tool>
        <nav className="cx-menubar">
          {(Object.keys(actions) as Exclude<Menu, null>[]).map(key => (
            <button
              type="button"
              key={key}
              aria-expanded={key === menu}
              onClick={() => setMenu(menu === key ? null : key)}
            >
              {key}
            </button>
          ))}
        </nav>
        <div className="cx-window">
          <Tool
            label={parked ? '还原工作区' : '最小化工作区'}
            onClick={() => {
              setMenu(null);
              setParked(v => !v);
            }}
          >
            <Minus />
          </Tool>
          <Tool label="切换全屏" onClick={maximize}>
            <Square />
          </Tool>
          <Tool label="关闭并返回书架" onClick={p.onBack}>
            <X />
          </Tool>
        </div>
        {menu && (
          <>
            <button className="cx-menu-scrim" aria-label="收起菜单" onClick={() => setMenu(null)} />
            <div className="cx-menu">
              {actions[menu].map(([name, run]) => (
                <button
                  type="button"
                  key={name}
                  onClick={() => {
                    setMenu(null);
                    run();
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          </>
        )}
      </header>

      {parked && (
        <div className="cx-park">
          <button type="button" onClick={() => setParked(false)}>
            还原 Codex 工作区
          </button>
        </div>
      )}

      <div className="cx-frame" inert={parked}>
        <nav className="cx-strip" aria-label="快捷导航">
          <Tool
            label="当前阅读"
            active={!panel && !p.summaryOpen}
            onClick={() => {
              setPanel(null);
              setClosed(false);
              if (p.summaryOpen) p.onToggleSummary?.();
            }}
          >
            <House fill="currentColor" />
          </Tool>
          <Tool label="章节目录" active={panel === 'files'} onClick={() => show('files')}>
            <Files />
          </Tool>
          <Tool label="书签记录" active={panel === 'bookmarks'} onClick={() => show('bookmarks')}>
            <Clock />
          </Tool>
          <Tool
            label={p.bookmarked ? '取消当前书签 (Ctrl+D)' : '保存当前书签 (Ctrl+D)'}
            active={!!p.bookmarked}
            onClick={() => p.onBookmark?.()}
          >
            <AtSign />
          </Tool>
          <Tool label="全部设置" onClick={p.onSettings}>
            <MoreHorizontal />
          </Tool>
          <i />
          <Tool label="切换工作区 (Ctrl+K)" onClick={p.onProjects}>
            <GitFork />
          </Tool>
          <div className="cx-strip-pop-anchor">
            <Tool
              label="切换 AI 模型 / 皮肤"
              active={modelMenu === 'rail'}
              onClick={() => setModelMenu(m => (m === 'rail' ? null : 'rail'))}
            >
              <LayoutGrid />
            </Tool>
            {modelMenu === 'rail' && (
              <ModelSwitcherPopover
                open
                onClose={() => setModelMenu(null)}
                theme={p.shellTheme ?? 'dark'}
                align="left"
                placement="below"
                p={p}
              />
            )}
          </div>
          <div className="cx-spacer" />
          <button
            type="button"
            className="cx-ring"
            onClick={() => show('files')}
            title={`阅读进度 ${percentText}% · 第 ${p.chapter + 1}/${p.chapters.length} 章`}
            aria-label={`阅读进度 ${percentText}%`}
          >
            <svg aria-hidden="true" viewBox="0 0 28 28">
              <circle cx="14" cy="14" r="11" stroke="#47454c" />
              <circle
                cx="14"
                cy="14"
                r="11"
                pathLength="100"
                stroke="currentColor"
                strokeDasharray="100"
                strokeDashoffset={100 * Math.min(1, Math.max(0, percent))}
                transform="rotate(-90 14 14)"
              />
            </svg>
            <Diamond size={9} fill="currentColor" />
          </button>
          <button type="button" className="cx-avatar" onClick={p.onSettings} title="个人设置">
            TI
          </button>
        </nav>

        <div className="cx-frame-inner">
          {rail && (
            <>
              <button className="cx-side-scrim" aria-label="收起侧栏" onClick={() => setRail(false)} />
              <aside className="cx-sidebar">
                <div className="cx-side-head">
                  <div className="cx-brand-wrap">
                    <button
                      type="button"
                      className="cx-brand"
                      onClick={() => setModelMenu(m => (m === 'brand' ? null : 'brand'))}
                      title="切换模拟工作界面"
                    >
                      Codex <ChevronDown size={15} />
                    </button>
                    {modelMenu === 'brand' && (
                      <ModelSwitcherPopover
                        open
                        onClose={() => setModelMenu(null)}
                        theme={p.shellTheme ?? 'dark'}
                        align="left"
                        placement="below"
                        p={p}
                      />
                    )}
                  </div>
                  <span />
                  <Tool label="书签记录" onClick={() => show('bookmarks')}>
                    <Bell />
                  </Tool>
                  <Tool label="搜索小说库 (Ctrl+K)" onClick={p.onProjects}>
                    <Search />
                  </Tool>
                </div>

                <div className="cx-quick">
                  <button type="button" onClick={p.onImportFiles} title="导入 TXT / EPUB">
                    <SquarePen size={17} />
                    <span>新聊天</span>
                  </button>
                  <button type="button" onClick={() => show('help')} title="查看快捷键与操作指南">
                    <DotPet />
                    <span>你的 Dot</span>
                  </button>
                </div>

                <div className="cx-side-list">
                  <div className="cx-group" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>工作空间</span>
                    <RevealToggle active={!!p.revealReal} onToggle={p.onToggleReveal} />
                  </div>
                  <nav>
                    {p.projects.map(project => (
                      <div key={project.id} className={'cx-project-row' + (project.current ? ' current' : '')}>
                        <button
                          type="button"
                          className="cx-project"
                          title={project.realTitle || project.name}
                          aria-current={project.current ? 'page' : undefined}
                          onClick={() => {
                            if (window.innerWidth <= 720) setRail(false);
                            p.onProject(project.id);
                          }}
                        >
                          <PeekText mask={project.name} real={project.realTitle} />
                        </button>
                        <SidebarTaskActions
                          projectId={project.id}
                          onRename={p.onRenameProject}
                          onManage={p.onProjects}
                        />
                      </div>
                    ))}
                  </nav>
                  <div className="cx-group cx-second">项目资料</div>
                  <button type="button" className="cx-project" onClick={() => show('files')}>
                    查找资料
                  </button>
                  <button type="button" className="cx-project" onClick={() => show('bookmarks')}>
                    书签记录 ({p.bookmarks?.length ?? 0})
                  </button>
                  <button type="button" className="cx-project" onClick={() => show('help')}>
                    使用说明
                  </button>
                </div>
              </aside>
            </>
          )}

          <main className="cx-main">
            <header className="cx-head">
              <button type="button" onClick={p.onProjects} title={`切换工作区 / 重命名 · ${p.realBookTitle || area}`}>
                <PeekText mask={area} real={p.realBookTitle} />
                <ChevronDown size={14} />
              </button>
              <div>
                <Tool
                  label={p.summaryOpen ? '恢复工作记录 (Space)' : '切换工作摘要 (Space)'}
                  active={!!p.summaryOpen}
                  onClick={toggleSummary}
                >
                  <MoreHorizontal />
                </Tool>
                <Tool label="阅读设置" onClick={p.onSettings}>
                  <SlidersHorizontal />
                </Tool>
                <i />
                <Tool
                  label="切换章节索引面板"
                  active={panel === 'files'}
                  onClick={() => show('files')}
                >
                  <PanelRight />
                </Tool>
              </div>
            </header>

            <div className="cx-content" ref={body}>
              <ReaderLedeContext.Provider value={lead}>
                <ReaderTailContext.Provider value={tail}>{p.children}</ReaderTailContext.Provider>
              </ReaderLedeContext.Provider>
            </div>

            <div className="cx-compose-wrap">
              <Tool label="继续向下 / 下一章" onClick={advance}>
                <ArrowDown />
              </Tool>
              <form className="cx-compose" onSubmit={locate}>
                <textarea
                  ref={input}
                  value={composing}
                  onChange={e => setComposing(e.target.value)}
                  rows={2}
                  placeholder="和 Codex 一起工作（输入章号或关键词按 Enter 跳转）"
                  aria-label="查找章节"
                  title="输入章节号或关键词，按 Enter 定位"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      locate();
                    }
                  }}
                />
                <div className="cx-compose-row">
                  <Tool label="导入 TXT / EPUB" onClick={p.onImportFiles}>
                    <Plus />
                  </Tool>
                  <button
                    type="button"
                    className={'cx-access' + (!hintsEnabled ? ' is-off' : '')}
                    onClick={() => p.onWorkHints?.({ enabled: !hintsEnabled, frequency: p.workHints?.frequency ?? 5 })}
                    title="点击切换工作提示行"
                  >
                    <ShieldAlert size={15} />
                    <span>{hintsEnabled ? '完全访问' : '静默模式'}</span>
                  </button>
                  <span />
                  <div className="cx-model-wrap">
                    <button
                      type="button"
                      className="cx-model"
                      title="切换工作模式、表面或字号"
                      onClick={() => setModelMenu(m => (m === 'compose' ? null : 'compose'))}
                    >
                      <Zap size={12} fill="currentColor" />
                      <span>
                        GPT-6 Astra <em>Max</em>
                      </span>
                      <ChevronDown size={13} />
                    </button>
                    {modelMenu === 'compose' && (
                      <ModelSwitcherPopover
                        open
                        onClose={() => setModelMenu(null)}
                        theme={p.shellTheme ?? 'dark'}
                        align="right"
                        placement="above"
                        p={p}
                      />
                    )}
                  </div>
                  <Tool
                    label={p.bookmarked ? '取消书签 (Ctrl+D)' : '保存当前书签 (Ctrl+D)'}
                    active={!!p.bookmarked}
                    onClick={() => p.onBookmark?.()}
                  >
                    <Mic />
                  </Tool>
                  <button type="submit" className="cx-send" aria-label={composing.trim() ? '跳转章节' : '继续向下'}>
                    {composing.trim() ? <ArrowUp size={19} /> : <AudioLines size={19} />}
                  </button>
                </div>
              </form>
            </div>

            {panel && (
              <aside className="cx-details">
                <header>
                  <b>
                    {panel === 'files'
                      ? `工作记录 (${p.chapters.length})`
                      : panel === 'bookmarks'
                        ? `书签记录 (${p.bookmarks?.length ?? 0})`
                        : '使用说明'}
                  </b>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {panel !== 'help' && <RevealToggle active={!!p.revealReal} onToggle={p.onToggleReveal} label={p.revealReal ? '隐藏真名' : '显真名'} />}
                    <Tool label="关闭面板" onClick={() => setPanel(null)}>
                      <X />
                    </Tool>
                  </div>
                </header>
                {panel === 'files' ? (
                  <>
                    <div className="cx-filter">
                      <Search size={15} />
                      <input
                        ref={field}
                        value={filter}
                        onChange={e => {
                          setFilter(e.target.value);
                          setLimit(80);
                        }}
                        aria-label="查找资料"
                        placeholder="输入章号、真实章节名或关键词…"
                      />
                    </div>
                    <div className="cx-index">
                      {rows.slice(0, limit).map(item => (
                        <button
                          key={item.n}
                          type="button"
                          disabled={p.disabled || !item.available}
                          title={`第 ${item.n + 1} 章 · ${item.realTitle || item.title}`}
                          aria-current={item.n === p.chapter ? 'page' : undefined}
                          onClick={() => jump(item.n)}
                        >
                          <PeekText mask={item.title} real={item.realTitle} />
                          <small>#{item.n + 1}</small>
                        </button>
                      ))}
                      {rows.length === 0 && <p className="cx-empty-note">未找到对应资料。</p>}
                      {rows.length > limit && (
                        <button type="button" className="cx-more-btn" onClick={() => setLimit(v => v + 80)}>
                          显示更多
                        </button>
                      )}
                    </div>
                  </>
                ) : panel === 'bookmarks' ? (
                  <div className="cx-index">
                    <button
                      type="button"
                      className="cx-bookmark-add"
                      onClick={() => p.onBookmark?.()}
                    >
                      <Bookmark size={14} fill={p.bookmarked ? 'currentColor' : 'none'} />
                      <span>{p.bookmarked ? '取消当前位置书签' : '保存当前位置书签'}</span>
                    </button>
                    {(p.bookmarks ?? []).map((mark, i) => {
                      const realCh = p.chapters.find(c => c.n === mark.chapter)?.realTitle || `第 ${mark.chapter + 1} 章`;
                      return (
                        <button
                          key={mark.chapter + ':' + mark.paragraph + ':' + i}
                          type="button"
                          title={`${realCh} · 第 ${mark.paragraph + 1} 段`}
                          onClick={() => {
                            setPanel(null);
                            p.onJumpPoint?.(mark);
                          }}
                        >
                          <Bookmark size={13} />
                          <PeekText mask={`第 ${mark.chapter + 1} 项 · 第 ${mark.paragraph + 1} 段`} real={`${realCh} · 第 ${mark.paragraph + 1} 段`} />
                        </button>
                      );
                    })}
                    {!(p.bookmarks?.length) && (
                      <div className="cx-panel-copy">
                        <p>还没有保存的书签。</p>
                        <p>按 Ctrl+D 或点击输入框右下角麦克风即可保存。</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="cx-panel-copy">
                    <p>
                      <Check size={14} /> 底部输入章号或关键词，按 Enter 直接定位章节。
                    </p>
                    <p>· 点击「用时」行或按空格键：切换工作摘要（老板键）。</p>
                    <p>· 点击左下角进度环：查看百分比并打开目录。</p>
                    <p>· 点击「GPT-6 Astra Max」或左上角「Codex」：无缝切换 6 套工作皮肤、字号与提示密度。</p>
                    <p>· 点击麦克风或 @ 按钮：快速保存当前段落书签。</p>
                  </div>
                )}
              </aside>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
