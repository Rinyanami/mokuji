// Keep reader links portable (including Unicode source IDs) while giving a
// simulated workspace the same neutral address after refresh or sharing.
export function workspaceFragment(id: string) {
  const bytes = new TextEncoder().encode(id);
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
  return '#/work/' + btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function workspaceBookId(token: string) {
  if (!/^[a-zA-Z0-9_-]{1,4096}$/.test(token)) return '';
  try {
    const raw = atob(token.replaceAll('-', '+').replaceAll('_', '/'));
    const bytes = Uint8Array.from(raw, character => character.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return ''; }
}

export function syncReaderAddress(id: string, immersive: boolean) {
  if (!id || !/^#\/(?:work|body)\//.test(location.hash)) return;
  const hash = immersive ? workspaceFragment(id) : '#/body/' + encodeURIComponent(id);
  if (hash !== location.hash) history.replaceState(history.state, '', hash);
}

export function setTabAppearance(productLabel?: string) {
  document.title = productLabel || '目次 Mokuji · 阅读书架';
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon) icon.href = productLabel ? '/workspace.svg' : '/favicon.svg';
}
