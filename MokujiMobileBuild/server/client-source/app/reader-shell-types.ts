import type { ReactNode } from 'react';
import type { ImmersiveProduct, ReaderAppearance, ReaderPaperTheme, ReaderSurface, UiTheme } from './reader-appearance';
import type { BookPoint, SavedPoint } from './reader-bookmarks';
import type { ChapterInfo } from './reading-client';
import type { WorkHints } from './reader-work-hints';
import type { WorkProject } from './reader-workspaces';

export type { ImmersiveProduct, ReaderAppearance, ReaderPaperTheme, ReaderSurface, UiTheme };

export type ReaderShellProps = {
  product: ImmersiveProduct;
  surface: ReaderSurface;
  shellTheme?: UiTheme;
  onShellTheme?: (theme: UiTheme) => void;
  bookTitle: string;
  realBookTitle?: string;
  author: string;
  chapterTitle: string;
  realChapterTitle?: string;
  revealReal?: boolean;
  onToggleReveal?: () => void;
  /** Chapter and paragraph indexes use the reader API's zero-based positions. */
  chapter: number;
  paragraph: number;
  paragraphCount: number;
  chapters: readonly ChapterInfo[];
  disabled: boolean;
  onChapter: (n: number) => void;
  onSettings: () => void;
  onFindRecord?: (query: string) => void;
  projects: readonly WorkProject[];
  onProjects: () => void;
  onProject: (id: string) => void;
  onImportFiles: () => void;
  onBack: () => void;
  summaryOpen?: boolean;
  onToggleSummary?: () => void;
  /* Rich hidden-interaction hooks shared across all six simulated shells */
  fontSize?: number;
  onFontSize?: (size: number) => void;
  paperTheme?: ReaderPaperTheme;
  onPaperTheme?: (theme: ReaderPaperTheme) => void;
  lineHeight?: number;
  onLineHeight?: (value: number) => void;
  workHints?: WorkHints;
  onWorkHints?: (next: WorkHints) => void;
  onSwitchAppearance?: (appearance: ReaderAppearance, surface?: ReaderSurface) => void;
  bookmarked?: boolean;
  bookmarks?: readonly SavedPoint[];
  onBookmark?: () => void;
  onOpenBookmarks?: () => void;
  onJumpPoint?: (point: BookPoint) => void;
  onCopyChapter?: () => void;
  onNextPage?: () => void;
  onRenameProject?: (id: string) => void;
  progressPercent?: number;
  children: ReactNode;
};
