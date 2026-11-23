"use client";
import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowUpRight, Check, CheckCircle2, Cloud, CloudDownload, CloudUpload, Copy, HardDrive, Link2, RefreshCw, Server, Tablet } from 'lucide-react';
import { getLocalEngineMode, getPeerSyncConfig, subscribeLocalEngineMode, syncWithRemotePeer } from '../lib/local-first-engine';

type SyncStatus = {
  provider: 'none' | 'kodo' | 'webdav';
  kodo: {
    accessKey: string;
    hasSecretKey: boolean;
    bucket: string;
    region: string;
    prefix: string;
    endpoint: string;
  };
  webdav: {
    url: string;
    username: string;
    hasPassword: boolean;
    prefix: string;
  };
  lastSyncAt: string | null;
  lastDirection: string | null;
  lastSummary: string | null;
};

type BangumiSyncStatus = {
  hasToken: boolean;
  username: string;
  nickname: string;
  userId: number | null;
  avatar: string;
  autoPush: boolean;
  privateDefault: boolean;
  lastSyncAt: string | null;
  lastSummary: string;
};

export default function SyncPanel({ onPulled }: { onPulled?: () => void }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [provider, setProvider] = useState<'none' | 'kodo' | 'webdav'>('none');
  const [kodoAk, setKodoAk] = useState('');
  const [kodoSk, setKodoSk] = useState('');
  const [kodoBucket, setKodoBucket] = useState('');
  const [kodoRegion, setKodoRegion] = useState('cn-east-1');
  const [kodoPrefix, setKodoPrefix] = useState('mokuji-sync');
  const [kodoEndpoint, setKodoEndpoint] = useState('');

  const [davUrl, setDavUrl] = useState('');
  const [davUser, setDavUser] = useState('');
  const [davPass, setDavPass] = useState('');
  const [davPrefix, setDavPrefix] = useState('mokuji-sync');

  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');

  const [bgmStatus, setBgmStatus] = useState<BangumiSyncStatus | null>(null);
  const [bgmToken, setBgmToken] = useState('');
  const [bgmAutoPush, setBgmAutoPush] = useState(true);
  const [bgmPrivate, setBgmPrivate] = useState(false);
  const [bgmBusy, setBgmBusy] = useState('');
  const [bgmMsg, setBgmMsg] = useState('');
  const [bgmErr, setBgmErr] = useState('');

  const [localMode, setLocalMode] = useState(getLocalEngineMode);
  const [peerUrl, setPeerUrl] = useState(() => getPeerSyncConfig().url);
  const [peerSummary, setPeerSummary] = useState(() => getPeerSyncConfig().lastSummary || '');
  const [peerBusy, setPeerBusy] = useState('');
  const [peerMsg, setPeerMsg] = useState('');
  const [peerErr, setPeerErr] = useState('');

  useEffect(() => subscribeLocalEngineMode(setLocalMode), []);

  async function runPeerSync(direction: 'pull' | 'push' | 'disconnect') {
    setPeerBusy(direction);
    setPeerMsg('');
    setPeerErr('');
    try {
      const target = direction === 'disconnect' ? '' : peerUrl;
      const result = await syncWithRemotePeer(target, direction === 'push' ? 'push' : 'pull');
      if (!result.ok) {
        setPeerErr(result.message);
      } else {
        if (direction === 'disconnect') setPeerUrl('');
        setPeerSummary(result.message);
        setPeerMsg(result.message);
        if (direction === 'pull') onPulled?.();
      }
    } finally {
      setPeerBusy('');
    }
  }

  async function loadStatus() {
    try {
      const [res, bgmRes] = await Promise.all([
        fetch('/api/sync/status', { cache: 'no-store' }),
        fetch('/api/bangumi-sync/status', { cache: 'no-store' }),
      ]);
      if (res.ok) {
        const data = (await res.json()) as SyncStatus;
        setStatus(data);
        setProvider(data.provider || 'none');
        setKodoAk(data.kodo?.accessKey || '');
        setKodoBucket(data.kodo?.bucket || '');
        setKodoRegion(data.kodo?.region || 'cn-east-1');
        setKodoPrefix(data.kodo?.prefix || 'mokuji-sync');
        setKodoEndpoint(data.kodo?.endpoint || '');
        setDavUrl(data.webdav?.url || '');
        setDavUser(data.webdav?.username || '');
        setDavPrefix(data.webdav?.prefix || 'mokuji-sync');
      }
      if (bgmRes.ok) {
        const bgmData = (await bgmRes.json()) as BangumiSyncStatus;
        setBgmStatus(bgmData);
        setBgmAutoPush(bgmData.autoPush !== false);
        setBgmPrivate(Boolean(bgmData.privateDefault));
      }
    } catch {}
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  async function saveBangumiConfig(e: FormEvent) {
    e.preventDefault();
    setBgmBusy('save');
    setBgmErr('');
    setBgmMsg('');
    try {
      const res = await fetch('/api/bangumi-sync/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: bgmToken.trim(),
          autoPush: bgmAutoPush,
          privateDefault: bgmPrivate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '验证 Bangumi Token 失败');
      setBgmStatus(data);
      setBgmToken('');
      setBgmMsg(data.lastSummary || `已绑定 Bangumi 账号 @${data.nickname || data.username}`);
    } catch (e) {
      setBgmErr(e instanceof Error ? e.message : '连接 Bangumi 失败');
    } finally {
      setBgmBusy('');
    }
  }

  async function runBangumiAction(kind: 'push-all' | 'pull' | 'disconnect') {
    setBgmBusy(kind);
    setBgmErr('');
    setBgmMsg('');
    try {
      const endpoint = kind === 'disconnect' ? '/api/bangumi-sync/config' : `/api/bangumi-sync/${kind}`;
      const body = kind === 'disconnect' ? { clearToken: true } : {};
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Bangumi 同步失败');
      const nextStatus = data.statusInfo || data;
      setBgmStatus(nextStatus);
      setBgmMsg(nextStatus.lastSummary || 'Bangumi 同步完成');
      if (kind === 'pull') onPulled?.();
    } catch (e) {
      setBgmErr(e instanceof Error ? e.message : 'Bangumi 同步失败');
    } finally {
      setBgmBusy('');
    }
  }

  function buildPayload() {
    return {
      provider,
      kodo: {
        accessKey: kodoAk.trim(),
        secretKey: kodoSk.trim(),
        bucket: kodoBucket.trim(),
        region: kodoRegion.trim() || 'cn-east-1',
        prefix: kodoPrefix.trim() || 'mokuji-sync',
        endpoint: kodoEndpoint.trim(),
      },
      webdav: {
        url: davUrl.trim(),
        username: davUser.trim(),
        password: davPass,
        prefix: davPrefix.trim() || 'mokuji-sync',
      },
    };
  }

  async function saveConfig(e: FormEvent) {
    e.preventDefault();
    setBusy('save');
    setErr('');
    setMsg('');
    try {
      const res = await fetch('/api/sync/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '保存同步配置失败');
      setStatus(data.status);
      setKodoSk('');
      setDavPass('');
      setMsg('同步配置已保存在本服务本地目录');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存配置失败');
    } finally {
      setBusy('');
    }
  }

  async function runAction(kind: 'test' | 'push' | 'pull', forceFull = false) {
    setBusy(kind);
    setErr('');
    setMsg('');
    try {
      const res = await fetch(`/api/sync/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'test' ? buildPayload() : { forceFull }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '操作失败');
      if (data.status) setStatus(data.status);
      setMsg(data.message || data.summary || '已完成');
      if (kind === 'pull') onPulled?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '同步失败');
    } finally {
      setBusy('');
    }
  }

  function copyUrl(label: string, path: string) {
    const full = `${location.origin}${path}`;
    void navigator.clipboard?.writeText(full);
    setCopied(label);
    setTimeout(() => setCopied(''), 2200);
  }

  return (
    <div className="sync-stack">
      <section className="section sync-card">
        <div className="section-heading">
          <h2>
            <HardDrive size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />
            本机独立运行与可选主机同步
            <span>{localMode === 'local-offline' ? '当前：本机离线独立模式（IndexedDB）' : '当前：已连接主机服务端（同步并镜像到本机）'}</span>
          </h2>
        </div>

        <p className="sync-lead">
          三端均已支持<strong>免连接直接本地使用</strong>：不填任何地址也能在手机/电脑独立管理书架、导入本地 TXT/EPUB 与使用工作区伪装壳。下方仅在你需要与家里的电脑（<code>Mokuji.exe</code>「手机连接」）或自建服务器同步时<strong>选填</strong>。
        </p>

        <div className="sync-form">
          <div className="sync-fields">
            <label className="field-label">
              可选同步主机地址（电脑局域网地址或服务器 HTTPS 网址，留空则纯单机运行）
              <input
                type="url"
                value={peerUrl}
                onChange={e => setPeerUrl(e.target.value)}
                placeholder="例如 http://192.168.1.10:5198 或 https://books.example.com"
              />
            </label>
          </div>
          <div className="sync-actions">
            <button type="button" className="button button-sage" disabled={!peerUrl.trim() || !!peerBusy} onClick={() => void runPeerSync('pull')}>
              <CloudDownload size={14} />{peerBusy === 'pull' ? '拉取合并中…' : '从该地址拉取到本地'}
            </button>
            <button type="button" className="button button-outline" disabled={!peerUrl.trim() || !!peerBusy} onClick={() => void runPeerSync('push')}>
              <CloudUpload size={14} />{peerBusy === 'push' ? '推送合并中…' : '将本机书架推送给它'}
            </button>
            {peerUrl.trim() && (
              <button type="button" className="text-button quiet" disabled={!!peerBusy} onClick={() => void runPeerSync('disconnect')}>
                清空并仅用本机离线
              </button>
            )}
          </div>
        </div>

        {peerErr && <div className="form-error" style={{ marginTop: 10 }} role="alert"><AlertCircle size={15} /><span>{peerErr}</span></div>}
        {peerMsg && <div className="reader-hub-note" style={{ marginTop: 10 }} role="status"><CheckCircle2 size={15} /><span>{peerMsg}</span></div>}
        {peerSummary && !peerMsg && <p className="sync-last-meta">{peerSummary}</p>}
      </section>

      <section className="section sync-card">
        <div className="section-heading">
          <h2>
            <Link2 size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />
            Bangumi 番组计划双向深度联动
            <span>小说 · 轻小说 · 漫画阅读进度 / 评分 / 短评自动回写 Bangumi</span>
          </h2>
        </div>

        <p className="sync-lead">
          你用 Bangumi 记动画、用目次读小说与漫画时，无需两边重复打卡。绑定 Bangumi 个人令牌（Access Token）后，目次中的<strong>想读 / 在读 / 已读 / 搁置 / 弃读、1–10 评分、章/话/卷进度和读书短评</strong>可自动同步回你的 Bangumi 书籍时间线，也能把 Bangumi 的私密书籍收藏拉回目次。
        </p>

        <form className="sync-form" onSubmit={saveBangumiConfig}>
          <div className="sync-fields">
            <div className="form-row">
              <label className="field-label">
                Bangumi Personal Access Token {bgmStatus?.hasToken ? `（已连接 @${bgmStatus.nickname || bgmStatus.username}，留空保持不变）` : '*'}
                <input
                  type="password"
                  value={bgmToken}
                  onChange={e => setBgmToken(e.target.value)}
                  required={!bgmStatus?.hasToken}
                  placeholder={bgmStatus?.hasToken ? '••••••••（已验证连接，可仅修改下方开关）' : '粘贴在 next.bgm.tv/demo/access-token 生成的令牌'}
                />
              </label>
            </div>
            <div className="form-row" style={{ alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <label className="check-inline" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, width: 'auto', flex: '0 0 auto' }}>
                <input type="checkbox" style={{ width: 15, height: 15, margin: 0, flex: '0 0 auto' }} checked={bgmAutoPush} onChange={e => setBgmAutoPush(e.target.checked)} />
                <span>在目次保存评分或进度时，自动同步到 Bangumi</span>
              </label>
              <label className="check-inline" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, width: 'auto', flex: '0 0 auto' }}>
                <input type="checkbox" style={{ width: 15, height: 15, margin: 0, flex: '0 0 auto' }} checked={bgmPrivate} onChange={e => setBgmPrivate(e.target.checked)} />
                <span>同步到 Bangumi 时默认设为「仅自己可见（私密收藏）」</span>
              </label>
              <a
                className="text-link"
                href="https://next.bgm.tv/demo/access-token"
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 13, marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
              >
                前往 Bangumi 生成 Token <ArrowUpRight size={13} />
              </a>
            </div>
          </div>

          <div className="sync-actions">
            <button type="submit" className="button button-outline" disabled={!!bgmBusy}>
              <Check size={14} />{bgmBusy === 'save' ? '正在验证账号…' : bgmStatus?.hasToken ? '更新 Bangumi 设置' : '验证并绑定 Bangumi'}
            </button>
            {bgmStatus?.hasToken && (
              <>
                <button type="button" className="button button-sage" disabled={!!bgmBusy} onClick={() => void runBangumiAction('push-all')}>
                  <CloudUpload size={14} />{bgmBusy === 'push-all' ? '正在推送到 Bangumi…' : '一键推送关联书籍到 Bangumi'}
                </button>
                <button type="button" className="button button-outline" disabled={!!bgmBusy} onClick={() => void runBangumiAction('pull')}>
                  <RefreshCw size={14} />{bgmBusy === 'pull' ? '正在从 Bangumi 拉取…' : '从 Bangumi 拉取书籍收藏（含私密）'}
                </button>
                <button type="button" className="button button-outline" disabled={!!bgmBusy} onClick={() => void runBangumiAction('disconnect')}>
                  断开绑定
                </button>
              </>
            )}
          </div>
        </form>

        {bgmErr && <div className="form-error" style={{ marginTop: 10 }} role="alert"><AlertCircle size={15} /><span>{bgmErr}</span></div>}
        {bgmMsg && <div className="reader-hub-note" style={{ marginTop: 10 }} role="status"><CheckCircle2 size={15} /><span>{bgmMsg}</span></div>}
        {bgmStatus?.lastSyncAt && (
          <p className="sync-last-meta">
            Bangumi 状态：{new Date(bgmStatus.lastSyncAt).toLocaleString('zh-CN')} · {bgmStatus.lastSummary}
          </p>
        )}
      </section>

      <section className="section sync-card">
        <div className="section-heading">
          <h2>多端云同步（七牛云 Kodo · NAS WebDAV）<span>书架 / 书单 / 进度 / 书源 / 本地书全量同步</span></h2>
        </div>

        <p className="sync-lead">
          先用七牛云私有空间，以后换用家里 NAS 时只需切到 WebDAV 并点一次「上传同步」，全部书架与书档会自动无缝迁入新存储。
        </p>

        <div className="sync-provider-tabs" role="radiogroup" aria-label="选择云同步后端">
          <button type="button" className={provider === 'none' ? 'selected' : ''} onClick={() => setProvider('none')}>
            <HardDrive size={14} />仅本机离线
          </button>
          <button type="button" className={provider === 'kodo' ? 'selected' : ''} onClick={() => setProvider('kodo')}>
            <Cloud size={14} />七牛云 Kodo (S3)
          </button>
          <button type="button" className={provider === 'webdav' ? 'selected' : ''} onClick={() => setProvider('webdav')}>
            <Server size={14} />NAS / WebDAV
          </button>
        </div>

        <form className="sync-form" onSubmit={saveConfig}>
          {provider === 'kodo' && (
            <div className="sync-fields">
              <div className="form-row">
                <label className="field-label">AccessKey *<input value={kodoAk} onChange={e => setKodoAk(e.target.value)} required placeholder="七牛控制台密钥管理 AK" /></label>
                <label className="field-label">
                  SecretKey {status?.kodo.hasSecretKey ? '（已保存，留空表示不修改）' : '*'}
                  <input type="password" value={kodoSk} onChange={e => setKodoSk(e.target.value)} required={!status?.kodo.hasSecretKey} placeholder={status?.kodo.hasSecretKey ? '••••••••（已配置）' : '输入七牛 SK'} />
                </label>
              </div>
              <div className="form-row">
                <label className="field-label">存储空间 Bucket *<input value={kodoBucket} onChange={e => setKodoBucket(e.target.value)} required placeholder="私有空间名（如 mokuji-books）" /></label>
                <label className="field-label">
                  存储区域 Region
                  <select value={kodoRegion} onChange={e => setKodoRegion(e.target.value)}>
                    <option value="cn-east-1">华东-浙江 (cn-east-1)</option>
                    <option value="cn-east-2">华东-浙江2 (cn-east-2)</option>
                    <option value="cn-north-1">华北-河北 (cn-north-1)</option>
                    <option value="cn-south-1">华南-广东 (cn-south-1)</option>
                    <option value="ap-southeast-1">亚太-新加坡 (ap-southeast-1)</option>
                  </select>
                </label>
                <label className="field-label">目录前缀<input value={kodoPrefix} onChange={e => setKodoPrefix(e.target.value)} placeholder="mokuji-sync" /></label>
              </div>
              <label className="field-label">自定义 S3 Endpoint（七牛留空即可；若用 MinIO / 群晖 S3 / R2 请填完整网址）
                <input value={kodoEndpoint} onChange={e => setKodoEndpoint(e.target.value)} placeholder="留空自动使用七牛 s3.<region>.qiniucs.com" />
              </label>
            </div>
          )}

          {provider === 'webdav' && (
            <div className="sync-fields">
              <label className="field-label">
                NAS WebDAV 网址 *（支持群晖 DSM、飞牛 fnOS、威联通、Alist）
                <input type="url" value={davUrl} onChange={e => setDavUrl(e.target.value)} required placeholder="http://192.168.1.10:5005 或 https://nas.example.com/dav" />
              </label>
              <div className="form-row">
                <label className="field-label">账号<input value={davUser} onChange={e => setDavUser(e.target.value)} placeholder="WebDAV 用户名" /></label>
                <label className="field-label">
                  密码 {status?.webdav.hasPassword ? '（已保存，留空不变）' : ''}
                  <input type="password" value={davPass} onChange={e => setDavPass(e.target.value)} placeholder={status?.webdav.hasPassword ? '••••••••（已配置）' : 'WebDAV 密码或应用专用密码'} />
                </label>
                <label className="field-label">同步目录名<input value={davPrefix} onChange={e => setDavPrefix(e.target.value)} placeholder="mokuji-sync" /></label>
              </div>
            </div>
          )}

          <div className="sync-actions">
            <button type="submit" className="button button-outline" disabled={!!busy}>
              <Check size={14} />{busy === 'save' ? '保存中…' : '保存配置'}
            </button>
            {provider !== 'none' && (
              <>
                <button type="button" className="button button-outline" disabled={!!busy} onClick={() => void runAction('test')}>
                  {busy === 'test' ? '测试中…' : '测试连接'}
                </button>
                <button type="button" className="button button-sage" disabled={!!busy} onClick={() => void runAction('push')}>
                  <CloudUpload size={14} />{busy === 'push' ? '正在上传同步…' : '立即上传同步'}
                </button>
                <button type="button" className="button button-outline" disabled={!!busy} onClick={() => void runAction('pull')}>
                  <CloudDownload size={14} />{busy === 'pull' ? '正在拉取合并…' : '从云端拉取合并'}
                </button>
              </>
            )}
          </div>
        </form>

        {err && <div className="form-error" style={{ marginTop: 10 }} role="alert"><AlertCircle size={15} /><span>{err}</span></div>}
        {msg && <div className="reader-hub-note" style={{ marginTop: 10 }} role="status"><CheckCircle2 size={15} /><span>{msg}</span></div>}

        {status?.lastSyncAt && (
          <p className="sync-last-meta">
            最近同步：{new Date(status.lastSyncAt).toLocaleString('zh-CN')} · {status.lastSummary}
          </p>
        )}
      </section>

      <section className="section sync-card">
        <div className="section-heading">
          <h2><Tablet size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />电纸书无线传书与阅读（Kindle / 文石 / KOReader）</h2>
        </div>
        <div className="eink-grid">
          <div className="eink-box">
            <strong>OPDS 1.2 无线书库</strong>
            <p>适合 KOReader、静读天下、多看、KyBook。直接在阅读器「网络书库」填入下方地址，自动把 TXT / 书源缓存实时封包为规范 EPUB 下载。</p>
            <div className="eink-url-row">
              <code>{typeof location !== 'undefined' ? `${location.origin}/opds` : '/opds'}</code>
              <button type="button" className="button button-outline" onClick={() => copyUrl('opds', '/opds')}>
                <Copy size={13} />{copied === 'opds' ? '已复制' : '复制'}
              </button>
            </div>
          </div>
          <div className="eink-box">
            <strong>墨水屏极简阅读网页</strong>
            <p>专为 Kindle / 文石 / 海信墨水屏浏览器定制：纯白高对比排版、零动画无闪烁、翻章后可一键写回阅读进度。</p>
            <div className="eink-url-row">
              <code>{typeof location !== 'undefined' ? `${location.origin}/eink` : '/eink'}</code>
              <a className="button button-sage" href="/eink" target="_blank" rel="noreferrer">预览墨水屏版</a>
              <button type="button" className="button button-outline" onClick={() => copyUrl('eink', '/eink')}>
                <Copy size={13} />{copied === 'eink' ? '已复制' : '复制'}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
