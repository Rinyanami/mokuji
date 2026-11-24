export const readerModes = [
  { value: 'normal', label: '正常阅读' },
  { value: 'notes', label: '手机备忘录' },
  { value: 'feishu', label: '飞书文档' },
  { value: 'codex', label: 'Codex' },
  { value: 'antigravity', label: 'Antigravity' },
  { value: 'doubao', label: '豆包' },
  { value: 'workbuddy', label: 'WorkBuddy' },
  { value: 'claude', label: 'Claude' },
  { value: 'vscode', label: 'VS Code' },
] as const;

export type ReaderAppearance = (typeof readerModes)[number]['value'];
export type ImmersiveProduct = Exclude<ReaderAppearance, 'normal'>;
export type ReaderSurface = 'web' | 'desktop';
export type UiTheme = 'light' | 'dark';
export type ReaderPaperTheme = 'default' | 'sepia' | 'green' | 'dark';

const appearanceKey = 'mokuji.reader.appearance';
const surfaceKey = 'mokuji.reader.surface';
const appThemeKey = 'mokuji.ui.theme';
const shellThemeKey = 'mokuji.reader.shellTheme';
const paperThemeKey = 'mokuji.reader.paper';
const lineHeightKey = 'mokuji.reader.lineHeight';

export function defaultWorkspaceMode(): ImmersiveProduct {
  if (typeof window !== 'undefined' && window.innerWidth <= 900) return 'notes';
  return 'codex';
}

export function syncNativeStatusBar(theme: UiTheme) {
  try {
    (window as unknown as { MokujiNative?: { setSystemTheme?: (t: string) => void } }).MokujiNative?.setSystemTheme?.(theme);
  } catch {}
}

export function readAppearance(): ReaderAppearance {
  try {
    const value = localStorage.getItem(appearanceKey);
    if (value === 'chat') return 'claude';
    if (value === 'editor') return 'vscode';
    if (value === 'terminal') return 'codex';
    return readerModes.find(mode => mode.value === value)?.value || 'normal';
  } catch {
    return 'normal';
  }
}

export function saveAppearance(value: ReaderAppearance) {
  try { localStorage.setItem(appearanceKey, value); } catch { /* Retain the current in-memory selection. */ }
}

export function readSurface(): ReaderSurface {
  try { return localStorage.getItem(surfaceKey) === 'desktop' ? 'desktop' : 'web'; }
  catch { return 'web'; }
}

export function saveSurface(value: ReaderSurface) {
  try { localStorage.setItem(surfaceKey, value); } catch { /* Retain the current in-memory selection. */ }
}

export function readAppTheme(): UiTheme {
  try { return localStorage.getItem(appThemeKey) === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
}

export function saveAppTheme(value: UiTheme) {
  try { localStorage.setItem(appThemeKey, value); } catch {}
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = value;
  }
  syncNativeStatusBar(value);
}

export function readPaperTheme(): ReaderPaperTheme {
  try {
    const val = localStorage.getItem(paperThemeKey);
    if (val === 'sepia' || val === 'green' || val === 'dark') return val;
  } catch {}
  return 'default';
}

export function savePaperTheme(value: ReaderPaperTheme) {
  try { localStorage.setItem(paperThemeKey, value); } catch {}
}

export function readLineHeight(): number {
  try {
    const n = Number(localStorage.getItem(lineHeightKey));
    if (n === 1.6 || n === 1.85 || n === 2.15) return n;
  } catch {}
  return 1.85;
}

export function saveLineHeight(value: number) {
  try { localStorage.setItem(lineHeightKey, String(value)); } catch {}
}

export function defaultShellTheme(product: ImmersiveProduct, surface: ReaderSurface): UiTheme {
  if (product === 'notes' || product === 'feishu') return 'light';
  if (product === 'vscode') return 'dark';
  if (product === 'antigravity') return surface === 'desktop' ? 'dark' : 'light';
  if (product === 'codex') return 'dark';
  if (product === 'workbuddy') return surface === 'desktop' ? 'dark' : 'light';
  return 'light';
}

export function readShellTheme(product: ImmersiveProduct, surface: ReaderSurface): UiTheme {
  try {
    const saved = localStorage.getItem(shellThemeKey);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {}
  return defaultShellTheme(product, surface);
}

export function saveShellTheme(value: UiTheme) {
  try { localStorage.setItem(shellThemeKey, value); } catch {}
}
