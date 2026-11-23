'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Laptop, RefreshCw, Smartphone, Sparkles } from 'lucide-react';
import './mobile-connection.css';
import MobileQr from './mobile-qr';

interface Connection {
  enabled: boolean;
  addresses: { address: string; label: string }[];
  urls: string[];
  code: string | null;
  expiresAt: string | null;
  pairedDevices: number;
}

function isConnection(value: unknown): value is Connection {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<Connection>;
  return typeof state.enabled === 'boolean' && Array.isArray(state.addresses) &&
    state.addresses.every(item => item && typeof item.address === 'string' && typeof item.label === 'string') &&
    Array.isArray(state.urls) && state.urls.every(url => typeof url === 'string') && typeof state.pairedDevices === 'number' &&
    (typeof state.code === 'string' || state.code === null) && (typeof state.expiresAt === 'string' || state.expiresAt === null);
}

export function isDesktopConnection(hostname: string) {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname.toLowerCase());
}

export default function MobileConnection() {
  if (typeof window === 'undefined' || !isDesktopConnection(window.location.hostname)) return null;
  return <DesktopConnection />;
}

function DesktopConnection() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [address, setAddress] = useState('');
  const [qrPurpose, setQrPurpose] = useState<'pair'|'install'>('pair');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [now, setNow] = useState(Date.now);
  const active = useRef<AbortController | null>(null);

  const request = useCallback(async (operation?: 'enable' | 'disable', selected?: string) => {
    if (!operation && active.current) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    if (operation) setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/mobile', {
        method: operation ? 'POST' : 'GET', cache: 'no-store', signal: controller.signal,
        ...(operation ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: operation, ...(operation === 'enable' && selected ? { address: selected } : {}) }),
        } : {}),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !isConnection(body)) {
        throw new Error(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : '无法读取本机手机连接设置，请确认目次 Mokuji 仍在运行。');
      }
      if (controller.signal.aborted) return;
      const state = body;
      setConnection(state);
      setAddress(previous => {
        if (state.addresses.some(item => item.address === previous)) return previous;
        const currentHost = state.urls.flatMap(value => {
          try { return [new URL(value).hostname]; } catch { return []; }
        });
        return state.addresses.find(item => currentHost.includes(item.address))?.address || state.addresses[0]?.address || '';
      });
      setNow(Date.now());
    } catch (failure) {
      if (!controller.signal.aborted) {
        setConnection(null);
        setError(failure instanceof Error ? failure.message : '暂时无法确认手机连接状态。');
      }
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }, []);

  useEffect(() => {
    void request();
    const timer = window.setInterval(() => { if (!document.hidden) void request(); }, 15000);
    return () => { window.clearInterval(timer); active.current?.abort(); active.current = null; };
  }, [request]);

  useEffect(() => {
    if (!connection?.enabled || !connection.expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [connection?.enabled, connection?.expiresAt]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(''), 2600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setCopied(value); }
    catch { setError('请选中手机网址后手动复制。'); }
  }

  const expires = connection?.expiresAt ? Date.parse(connection.expiresAt) : NaN;
  const validCode = connection?.enabled && connection.code && Number.isFinite(expires) && expires > now ? connection.code : '';
  const urls = (connection?.enabled ? connection.urls : []).filter(value => {
    try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
  });

  const install = qrPurpose === 'install';
  const qrUrls = install ? urls.map(url => new URL('/install/', url).href) : urls;
  const baseMobileOrigin = (urls[0] || (address ? `http://${address}:5199` : 'http://192.168.1.x:5199')).replace(/\/+$/, '');
  const iosShortcutTemplate = `${baseMobileOrigin}/?sniff=`;

  return <section className="duji-mobile-panel" aria-labelledby="duji-mobile-title" id="mobile-connection">
    <div className="duji-mobile-heading"><Smartphone size={21} aria-hidden="true" /><h2 id="duji-mobile-title">手机与全端客户端连接</h2>
      {connection && <span className={connection.enabled ? 'duji-mobile-enabled' : ''}>{connection.enabled ? '已开启' : '已关闭'}</span>}
    </div>
    <p className="duji-mobile-intro">手机和电脑连到同一局域网后，手机可以打开这台电脑的书架。阅读时请让电脑保持开机、联网，并运行目次 Mokuji。</p>
    {error && <p className="duji-mobile-error" role="alert">{error}</p>}
    {!connection ? <div className="duji-mobile-actions">{error ?
      <button className="button button-outline" type="button" disabled={busy} onClick={() => void request()}><RefreshCw size={14} />重新读取</button>
      : <p role="status">正在读取本机设置…</p>}</div> : <>
      {connection.addresses.length > 0 ? <label className="field-label duji-mobile-address">电脑的局域网地址
        <select value={address} disabled={busy} onChange={event => setAddress(event.target.value)}>
          {connection.addresses.map(item => <option key={item.address} value={item.address}>{item.label ? item.label + ' · ' : ''}{item.address}</option>)}
        </select>
      </label> : <p className="duji-mobile-intro">暂未找到局域网地址。连接 Wi-Fi 或有线网络后重新读取。</p>}
      {connection.enabled && <div className="duji-mobile-pair">
        <div className="duji-qr-choices" role="group" aria-label="选择手机二维码用途">
          <button type="button" aria-pressed={!install} onClick={() => setQrPurpose('pair')}>连接书架</button>
          <button type="button" aria-pressed={install} onClick={() => setQrPurpose('install')}>下载安装</button>
        </div>
        {qrUrls[0] && <MobileQr url={qrUrls[0]} install={install}/>}
        {qrUrls.length > 0 && <div className="duji-mobile-url-list"><strong>{install?'手机安装页网址':'手机浏览器打开'}</strong>{qrUrls.map(url => <div key={url} className="duji-mobile-url">
          <input value={url} readOnly aria-label={install?'手机安装页网址':'手机访问网址'} onFocus={event => event.target.select()} />
          <button type="button" className="button button-outline" onClick={() => void copy(url)} aria-label={install?'复制手机安装页网址':'复制手机网址'}><Copy size={14} />{copied === url ? '已复制' : '复制'}</button>
        </div>)}</div>}
        {validCode ? <div className="duji-mobile-code"><strong>配对码</strong><b>{validCode}</b><span>有效至 {new Date(expires).toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'})}</span></div>
          : <p className="duji-mobile-intro">当前没有有效配对码。新手机连接时，请生成新码。</p>}
        <p className="duji-mobile-count">已配对 {connection.pairedDevices} 台设备</p>
      </div>}
      <p className="duji-mobile-note">{connection.enabled ? '关闭连接会撤销所有手机的访问权限。' : '开启手机连接后，可用手机扫码打开书架或下载目次。'}</p>
      <div className="duji-mobile-actions">
        <button className="button button-sage" type="button" disabled={busy || !connection.addresses.length} onClick={() => void request('enable', address)}>
          {busy ? '正在处理…' : connection.enabled ? '生成新配对码' : '开启手机连接'}
        </button>
        {connection.enabled && <button type="button" className="button button-outline" disabled={busy} onClick={() => void request('disable')}>关闭手机连接</button>}
        <a className="duji-install-help" href="/install/">打开安装说明</a>
        {!connection.addresses.length && <button type="button" className="button button-outline" disabled={busy} onClick={() => void request()}>重新读取</button>}
      </div>

      <div className="eink-grid" style={{ marginTop: 18 }}>
        <div className="eink-box">
          <strong><Sparkles size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />iPhone / iPad 最省事方案（免签名永不掉签 + 快捷指令一键导书）</strong>
          <p>
            1. <strong>免签名全屏独立 App</strong>：用 Safari 扫上方「下载安装」码，点「下载 iPhone 全屏桌面图标（.mobileconfig）」或直接在 Safari 点「分享 → 添加到主屏幕」。全屏无地址栏、自带已读章节离线缓存，且<strong>永久无需每 7 天重签 IPA</strong>。<br/>
            2. <strong>iOS 快捷指令一键嗅探</strong>：在 iPhone「快捷指令」新建一条分享表单动作：接收「网页/URL」→「打开网址」拼接下方地址，即可在 Safari 看任何小说或漫画时一键点分享抓入目次：
          </p>
          <div className="eink-url-row">
            <code>{iosShortcutTemplate}[快捷指令输入]</code>
            <button type="button" className="button button-outline" onClick={() => void copy(iosShortcutTemplate)}>
              <Copy size={13} />{copied === iosShortcutTemplate ? '已复制前缀' : '复制快捷指令地址前缀'}
            </button>
          </div>
        </div>
        <div className="eink-box">
          <strong><Laptop size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />Android 客户端与 Windows 原生客户端（单 EXE 合一）</strong>
          <p>
            • <strong>Windows 桌面端（单个 <code>Mokuji.exe</code>）</strong>：全部功能合在一个程序里，不再分开快捷方式！双击运行 <code>Mokuji.exe</code>（可用 <code>Create-Desktop-Shortcut.cmd</code> 一键发送到桌面），内建 Edge WebView2 原生窗口、静默后台服务管理、系统托盘常驻、<strong>全局老板键 <code>Ctrl+Alt+M</code></strong>、窗口内一键切换「书架 / 摸鱼工作区」（<code>Ctrl+Shift+W</code> 或顶栏按钮）以及 <code>F11</code> 全屏。<br/>
            • <strong>Android</strong>：在安装页下载 <code>Mokuji-Android.apk</code> 原生客户端（自动记忆局域网地址与会话），或在 Chrome 点「安装应用」；支持从安卓系统分享菜单直接把小说网页分享到目次嗅探。
          </p>
        </div>
      </div>
    </>}
  </section>;
}
