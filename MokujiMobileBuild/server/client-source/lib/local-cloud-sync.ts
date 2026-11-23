// Browser/Android-native compatible Qiniu Kodo S3 (AWS4-HMAC-SHA256) & WebDAV sync helpers.

export type StoredSyncConfig = {
  provider: 'none' | 'kodo' | 'webdav';
  kodo: {
    accessKey: string;
    secretKey: string;
    bucket: string;
    region: string;
    prefix: string;
    endpoint: string;
  };
  webdav: {
    url: string;
    username: string;
    password: string;
    prefix: string;
  };
  lastSyncAt: string | null;
  lastDirection: string | null;
  lastSummary: string | null;
};

export const defaultStoredSyncConfig = (): StoredSyncConfig => ({
  provider: 'none',
  kodo: { accessKey: '', secretKey: '', bucket: '', region: 'cn-east-1', prefix: 'mokuji-sync', endpoint: '' },
  webdav: { url: '', username: '', password: '', prefix: 'mokuji-sync' },
  lastSyncAt: null,
  lastDirection: null,
  lastSummary: null,
});

export type BridgeHttpResponse = { ok: boolean; status: number; body: string; error?: string };

function nativeBridge() {
  return (window as unknown as {
    MokujiNative?: {
      isOfflineShell?: () => boolean;
      httpRequest?: (url: string, method: string, headersJson: string, bodyBase64: string) => string;
      saveTextFile?: (filename: string, content: string) => boolean;
    };
  }).MokujiNative;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export async function crossPlatformHttp(
  url: string,
  method = 'GET',
  headers: Record<string, string> = {},
  bodyText = '',
  nativeFetch?: typeof window.fetch,
): Promise<BridgeHttpResponse> {
  const bridge = nativeBridge();
  if (bridge?.httpRequest) {
    const b64 = bodyText ? bytesToBase64(new TextEncoder().encode(bodyText)) : '';
    const raw = bridge.httpRequest(url, method, JSON.stringify(headers), b64);
    try {
      return JSON.parse(raw) as BridgeHttpResponse;
    } catch {
      return { ok: false, status: 0, body: '', error: 'Android 原生网络桥接返回异常' };
    }
  }
  const f = nativeFetch || window.fetch.bind(window);
  try {
    const reqInit: RequestInit = { method, headers };
    if (bodyText && method !== 'GET' && method !== 'HEAD') reqInit.body = bodyText;
    const res = await f(url, reqInit);
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: '',
      error: e instanceof Error ? e.message : '请求失败（浏览器受跨域限制，请在 Android App 或电脑客户端中测试）',
    };
  }
}

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(u8, b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256HexText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return toHex(digest);
}

async function hmacSha256(keyBytes: Uint8Array | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const rawKey = keyBytes instanceof ArrayBuffer ? new Uint8Array(keyBytes) : keyBytes;
  const keyCopy = new Uint8Array(rawKey.byteLength);
  keyCopy.set(rawKey);
  const key = await crypto.subtle.importKey('raw', keyCopy, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
}

async function signS3V4(opts: {
  method: string;
  host: string;
  pathname: string;
  region: string;
  accessKey: string;
  secretKey: string;
  payloadHash: string;
  extraHeaders?: Record<string, string>;
}): Promise<Record<string, string>> {
  const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = timestamp.slice(0, 8);
  const signingHeaders: Record<string, string> = {
    ...(opts.extraHeaders || {}),
    host: opts.host,
    'x-amz-content-sha256': opts.payloadHash,
    'x-amz-date': timestamp,
  };
  const keys = Object.keys(signingHeaders).sort();
  const signedNames = keys.join(';');
  const canonicalHeaders = keys.map(k => `${k}:${signingHeaders[k].trim().replace(/\s+/g, ' ')}\n`).join('');
  const canonical = [opts.method, opts.pathname, '', canonicalHeaders, signedNames, opts.payloadHash].join('\n');
  const scope = [day, opts.region, 's3', 'aws4_request'].join('/');
  const toSign = ['AWS4-HMAC-SHA256', timestamp, scope, await sha256HexText(canonical)].join('\n');

  const kDate = await hmacSha256(new TextEncoder().encode('AWS4' + opts.secretKey), day);
  const kRegion = await hmacSha256(kDate, opts.region);
  const kService = await hmacSha256(kRegion, 's3');
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = toHex(await hmacSha256(kSigning, toSign));

  const { host: _h, ...headers } = signingHeaders;
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${opts.accessKey}/${scope}, SignedHeaders=${signedNames}, Signature=${signature}`,
  };
}

export function createClientCloudAdapter(cfg: StoredSyncConfig, nativeFetch?: typeof window.fetch) {
  if (cfg.provider === 'kodo') {
    const { accessKey, secretKey, bucket, region, prefix, endpoint } = cfg.kodo;
    if (!accessKey || !secretKey || !bucket || !region) {
      throw new Error('请先填写完整的七牛云 AccessKey、SecretKey、存储空间 Bucket 和区域');
    }
    const cleanPrefix = prefix ? prefix.replace(/^\/+|\/+$/g, '') + '/' : '';
    let protocol = 'https:';
    let host = '';
    let pathStyle = false;
    if (endpoint) {
      const parsed = new URL(endpoint);
      protocol = parsed.protocol;
      host = parsed.host;
      pathStyle = true;
    } else {
      const baseHost = `s3.${region}.qiniucs.com`;
      pathStyle = bucket.includes('.');
      host = pathStyle ? baseHost : `${bucket}.${baseHost}`;
    }

    const req = async (method: string, relKey: string, bodyText = '') => {
      const fullKey = (cleanPrefix + relKey).split('/').filter(Boolean).map(s => encodeURIComponent(s)).join('/');
      const pathname = pathStyle ? `/${encodeURIComponent(bucket)}/${fullKey}` : `/${fullKey}`;
      const url = `${protocol}//${host}${pathname}`;
      const payloadHash = await sha256HexText(bodyText);
      const extraHeaders: Record<string, string> = method === 'PUT' ? { 'content-type': 'application/json; charset=utf-8' } : {};
      const headers = await signS3V4({ method, host, pathname, region, accessKey, secretKey, payloadHash, extraHeaders });
      return crossPlatformHttp(url, method, headers, bodyText, nativeFetch);
    };

    return {
      async test() {
        const res = await req('PUT', '.mokuji-health.json', JSON.stringify({ ok: true, client: 'mobile', at: new Date().toISOString() }));
        if (!res.ok) throw new Error(res.error || `七牛云鉴权/连接失败（HTTP ${res.status}）`);
        const chk = await req('GET', '.mokuji-health.json');
        if (!chk.ok) throw new Error(chk.error || `七牛云读取验证失败（HTTP ${chk.status}）`);
        return { ok: true, message: `已直连七牛云存储空间「${bucket}」（${region}）` };
      },
      async putJson(relKey: string, val: unknown) {
        const res = await req('PUT', relKey, JSON.stringify(val));
        if (!res.ok) throw new Error(res.error || `上传 ${relKey} 失败（HTTP ${res.status}）`);
      },
      async getJson(relKey: string) {
        const res = await req('GET', relKey);
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(res.error || `下载 ${relKey} 失败（HTTP ${res.status}）`);
        return JSON.parse(res.body);
      },
    };
  }

  if (cfg.provider === 'webdav') {
    const base = new URL(cfg.webdav.url);
    const auth = cfg.webdav.username || cfg.webdav.password ? 'Basic ' + btoa(`${cfg.webdav.username || ''}:${cfg.webdav.password || ''}`) : '';
    const basePath = base.pathname.replace(/\/+$/, '');
    const prefixParts = (cfg.webdav.prefix || 'mokuji-sync').split('/').filter(Boolean);
    const targetUrl = (parts: string[]) => `${base.origin}${basePath}/${parts.map(encodeURIComponent).join('/')}`;
    const hdr = (extra: Record<string, string> = {}) => (auth ? { ...extra, authorization: auth } : extra);

    return {
      async test() {
        const rMk = await crossPlatformHttp(targetUrl(prefixParts), 'MKCOL', hdr(), '', nativeFetch);
        if (rMk.status === 401 || rMk.status === 403) throw new Error('NAS WebDAV 用户名或密码错误');
        const u = targetUrl([...prefixParts, '.mokuji-health.json']);
        const put = await crossPlatformHttp(u, 'PUT', hdr({ 'content-type': 'application/json; charset=utf-8' }), JSON.stringify({ ok: true }), nativeFetch);
        if (!put.ok) throw new Error(put.error || `NAS WebDAV 写入测试失败（HTTP ${put.status}）`);
        return { ok: true, message: `已连接 NAS WebDAV（${base.origin}）` };
      },
      async putJson(relKey: string, val: unknown) {
        const parts = relKey.split('/').filter(Boolean);
        if (parts.length > 1) await crossPlatformHttp(targetUrl([...prefixParts, ...parts.slice(0, -1)]), 'MKCOL', hdr(), '', nativeFetch);
        else await crossPlatformHttp(targetUrl(prefixParts), 'MKCOL', hdr(), '', nativeFetch);
        const res = await crossPlatformHttp(targetUrl([...prefixParts, ...parts]), 'PUT', hdr({ 'content-type': 'application/json; charset=utf-8' }), JSON.stringify(val), nativeFetch);
        if (!res.ok) throw new Error(res.error || `NAS 上传 ${relKey} 失败（HTTP ${res.status}）`);
      },
      async getJson(relKey: string) {
        const parts = relKey.split('/').filter(Boolean);
        const res = await crossPlatformHttp(targetUrl([...prefixParts, ...parts]), 'GET', hdr(), '', nativeFetch);
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(res.error || `NAS 下载 ${relKey} 失败（HTTP ${res.status}）`);
        return JSON.parse(res.body);
      },
    };
  }

  throw new Error('请先选择「七牛云 Kodo (S3)」或「NAS / WebDAV」同步方式');
}
