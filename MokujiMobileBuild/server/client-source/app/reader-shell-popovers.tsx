import { useEffect, useRef, useState } from 'react';
import { Bookmark, Check, Copy, EyeOff, Laptop, Moon, MoreHorizontal, Pencil, RefreshCw, SlidersHorizontal, Sparkles, Sun, ThumbsDown, ThumbsUp, Volume2, Globe } from 'lucide-react';
import type { ReaderAppearance, ReaderSurface, UiTheme } from './reader-appearance';
import type { ReaderShellProps } from './reader-shell-types';
import { supportsWorkHints, type WorkHints } from './reader-work-hints';
import './reader-shell-popovers.css';

export const simulatedModels: readonly {
  appearance: ReaderAppearance;
  label: string;
  modelName: string;
  badge?: string;
}[] = [
  { appearance: 'notes', label: '手机备忘录', modelName: '系统备忘随记', badge: 'Mobile' },
  { appearance: 'feishu', label: '飞书文档', modelName: 'Feishu 云文档', badge: 'Mobile' },
  { appearance: 'codex', label: 'Codex', modelName: 'GPT-6 Astra', badge: 'Max' },
  { appearance: 'workbuddy', label: 'WorkBuddy', modelName: 'DeepSeek-V4.1-Flash' },
  { appearance: 'doubao', label: '豆包', modelName: 'Doubao-Seed-2.0' },
  { appearance: 'claude', label: 'Claude', modelName: 'Sonnet 4.6', badge: 'Pro' },
  { appearance: 'antigravity', label: 'Antigravity', modelName: 'Gemini 3.5 Pro' },
  { appearance: 'vscode', label: 'VS Code', modelName: 'Dark Modern IDE' },
  { appearance: 'normal', label: '正常阅读', modelName: '纯净排版视图' },
];

export function ModelSwitcherPopover({
  open,
  onClose,
  theme = 'dark',
  align = 'right',
  placement = 'above',
  p,
}: {
  open: boolean;
  onClose: () => void;
  theme?: 'dark' | 'light';
  align?: 'left' | 'right';
  placement?: 'above' | 'below';
  p: ReaderShellProps;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    };
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose]);

  if (!open) return null;
  const hintsSupported = supportsWorkHints(p.product, p.surface);
  const currentHints: WorkHints = p.workHints ?? { enabled: true, frequency: 5 };
  const fontSize = p.fontSize ?? 16;

  return (
    <div
      ref={root}
      role="dialog"
      aria-label="切换模型与工作区模式"
      className={`mk-model-popover mk-pop-${theme} mk-align-${align} mk-place-${placement}`}
    >
      <div className="mk-pop-section">
        <div className="mk-pop-heading">模型与工作界面</div>
        <div className="mk-pop-models">
          {simulatedModels.map(item => {
            const active = p.product === item.appearance;
            return (
              <button
                key={item.appearance}
                type="button"
                className={'mk-pop-option' + (active ? ' active' : '')}
                onClick={() => {
                  p.onSwitchAppearance?.(item.appearance);
                  onClose();
                }}
              >
                <span className="mk-pop-option-main">
                  <strong>{item.modelName}</strong>
                  {item.badge && <em>{item.badge}</em>}
                </span>
                <span className="mk-pop-option-sub">{item.label}</span>
                {active && <Check size={14} className="mk-pop-check" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mk-pop-divider" />

      <div className="mk-pop-section">
        <div className="mk-pop-row">
          <span>客户端形态</span>
          <div className="mk-pop-segment" role="group" aria-label="界面版本">
            {([['desktop', '桌面端', Laptop], ['web', '网页版', Globe]] as const).map(([val, label, Icon]) => (
              <button
                key={val}
                type="button"
                aria-pressed={p.surface === val}
                onClick={() => p.onSwitchAppearance?.(p.product, val as ReaderSurface)}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {p.onShellTheme && (
          <div className="mk-pop-row">
            <span>明暗主题</span>
            <div className="mk-pop-segment" role="group" aria-label="界面主题">
              {([['light', '浅色', Sun], ['dark', '深色', Moon]] as const).map(([val, label, Icon]) => (
                <button
                  key={val}
                  type="button"
                  aria-pressed={(p.shellTheme ?? theme) === val}
                  onClick={() => p.onShellTheme?.(val as UiTheme)}
                >
                  <Icon size={12} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {p.onFontSize && (
          <div className="mk-pop-row">
            <span>正文密度</span>
            <div className="mk-pop-stepper">
              <button
                type="button"
                aria-label="减小字号"
                disabled={fontSize <= 14}
                onClick={() => p.onFontSize?.(Math.max(14, fontSize - 2))}
              >
                A-
              </button>
              <span>{fontSize}px</span>
              <button
                type="button"
                aria-label="增大字号"
                disabled={fontSize >= 26}
                onClick={() => p.onFontSize?.(Math.min(26, fontSize + 2))}
              >
                A+
              </button>
            </div>
          </div>
        )}

        {p.onToggleReveal && (
          <div className="mk-pop-row">
            <span>目录与任务名</span>
            <div className="mk-pop-segment" role="group" aria-label="目录真名显示">
              <button
                type="button"
                aria-pressed={!p.revealReal}
                title="平时保持伪装，鼠标悬停单行时显示真名"
                onClick={() => { if (p.revealReal) p.onToggleReveal?.(); }}
              >
                悬停看真
              </button>
              <button
                type="button"
                aria-pressed={!!p.revealReal}
                title="目录全显真名 (Alt+V)"
                onClick={() => { if (!p.revealReal) p.onToggleReveal?.(); }}
              >
                全显真名
              </button>
            </div>
          </div>
        )}

        {hintsSupported && p.onWorkHints && (
          <div className="mk-pop-row">
            <span>思维链提示</span>
            <div className="mk-pop-segment">
              {[
                { label: '关', enabled: false, freq: currentHints.frequency },
                { label: '少', enabled: true, freq: 9 },
                { label: '标准', enabled: true, freq: 5 },
                { label: '多', enabled: true, freq: 3 },
              ].map(preset => {
                const selected = preset.enabled ? currentHints.enabled && currentHints.frequency === preset.freq : !currentHints.enabled;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => p.onWorkHints?.({ enabled: preset.enabled, frequency: preset.freq })}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="mk-pop-divider" />

      <button
        type="button"
        className="mk-pop-footer"
        onClick={() => { onClose(); p.onSettings(); }}
      >
        <SlidersHorizontal size={13} />
        <span>全部阅读与外观设置…</span>
      </button>
    </div>
  );
}

export function ShellActionBar({
  p,
  variant,
  theme = 'dark',
  extraRight,
}: {
  p: ReaderShellProps;
  variant: 'codex' | 'workbuddy' | 'claude' | 'doubao';
  theme?: 'dark' | 'light';
  extraRight?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const nextChapter = p.chapters[p.chapters.findIndex(c => c.n === p.chapter) + 1];
  const percent = p.progressPercent ?? 0;

  function copy() {
    p.onCopyChapter?.();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className={`mk-assistant-actions mk-actions-${variant} mk-actions-${theme}`}>
      <button type="button" title="复制本章正文" aria-label="复制本章正文" onClick={copy}>
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
      <button
        type="button"
        className={p.bookmarked ? 'is-marked' : ''}
        title={p.bookmarked ? '取消当前位置书签 (Ctrl+D)' : '保存当前位置书签 (Ctrl+D)'}
        aria-label="保存当前位置书签"
        aria-pressed={p.bookmarked}
        onClick={() => p.onBookmark?.()}
      >
        {variant === 'codex' ? <Bookmark size={15} fill={p.bookmarked ? 'currentColor' : 'none'} /> : <ThumbsUp size={15} fill={p.bookmarked ? 'currentColor' : 'none'} />}
      </button>
      <button
        type="button"
        title={p.summaryOpen ? '恢复正文 (Space)' : '切换工作摘要 (Space)'}
        aria-label="切换工作摘要"
        onClick={() => p.onToggleSummary?.()}
      >
        {variant === 'codex' ? <EyeOff size={15} /> : <ThumbsDown size={15} />}
      </button>
      {variant === 'workbuddy' && (
        <button type="button" title="向下翻页" aria-label="向下翻页" onClick={() => p.onNextPage?.()}>
          <Volume2 size={15} />
        </button>
      )}
      <button
        type="button"
        title={nextChapter?.available ? '继续下一章 (Alt+→)' : '打开章节索引'}
        aria-label="下一章"
        disabled={p.disabled}
        onClick={() => (nextChapter?.available ? p.onChapter(nextChapter.n) : p.onFindRecord?.(''))}
      >
        <RefreshCw size={15} />
      </button>
      <button type="button" title="阅读设置" aria-label="阅读设置" onClick={p.onSettings}>
        <MoreHorizontal size={15} />
      </button>

      <span className="mk-actions-meta">
        {variant === 'workbuddy' && (
          <>
            <span>共消耗 ✧ {percent.toFixed(2)}</span>
            <span className="mk-actions-sep">·</span>
            <span>DeepSeek-V4.1-Flash</span>
          </>
        )}
        {variant === 'codex' && <span>{p.summaryOpen ? '已折叠' : '已保存'}</span>}
        {variant === 'claude' && <span>{p.paragraph + 1}/{p.paragraphCount || 1}</span>}
        {variant === 'doubao' && <span>内容由 AI 生成</span>}
      </span>
      {extraRight}
    </div>
  );
}

export function SidebarTaskActions({
  projectId,
  onRename,
  onManage,
}: {
  projectId: string;
  onRename?: (id: string) => void;
  onManage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer, true);
    return () => document.removeEventListener('pointerdown', onPointer, true);
  }, [open]);

  return (
    <div className="mk-task-more-wrap" ref={root}>
      <button
        type="button"
        className="mk-task-more-btn"
        aria-label="管理工作区"
        aria-expanded={open}
        onClick={event => { event.stopPropagation(); setOpen(v => !v); }}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div className="mk-task-menu" role="menu">
          {onRename && (
            <button type="button" role="menuitem" onClick={event => { event.stopPropagation(); setOpen(false); onRename(projectId); }}>
              <Pencil size={13} />
              <span>修改工作标题</span>
            </button>
          )}
          <button type="button" role="menuitem" onClick={event => { event.stopPropagation(); setOpen(false); onManage(); }}>
            <Sparkles size={13} />
            <span>全部工作区 (⌘K)</span>
          </button>
        </div>
      )}
    </div>
  );
}
