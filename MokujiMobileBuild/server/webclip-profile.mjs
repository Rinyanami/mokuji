import { isIPv4 } from 'node:net';

export const WEBCLIP_PATH = '/install/Mokuji.mobileconfig';
export const webClipHeaders = Object.freeze({
  'Content-Type': 'application/x-apple-aspen-config',
  'Content-Disposition': 'attachment; filename="Mokuji.mobileconfig"',
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
});

// Rasterized from the reader's own book mark. Embedded profiles work on a local
// network before the phone has paired; downloading an icon needs no credentials.
const iconPNG = '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';

function privateIPv4(host) {
  if (!isIPv4(host)) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function readerURL(origin) {
  if (typeof origin !== 'string' || !/^https?:\/\/[^/?#\\\s]+\/?$/i.test(origin) ||
      /[\u0000-\u001f\u007f@%]/.test(origin)) {
    throw new TypeError('需要有效的目次服务器地址。');
  }
  const url = new URL(origin);
  if (url.protocol === 'http:' && !privateIPv4(url.hostname)) {
    throw new TypeError('HTTP 仅支持电脑的局域网 IPv4 地址。');
  }
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost') ||
      url.hostname === '[::1]' || url.hostname.startsWith('127.') || url.hostname === '0.0.0.0') {
    throw new TypeError('请使用手机可访问的目次服务器地址。');
  }
  return url.origin + '/#/webfiction';
}

function xmlText(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

// Pass the listener's configured origin (or the canonical HTTPS deployment origin).
// Do not accept a query-string URL or infer the destination from proxy headers.
export function createWebClipProfile(trustedOrigin) {
  const url = xmlText(readerURL(trustedOrigin));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadVersion</key><integer>1</integer>
  <key>PayloadIdentifier</key><string>app.mokuji.reader.webclip</string>
  <key>PayloadUUID</key><string>B2E42277-E320-4756-B770-D48A058934AE</string>
  <key>PayloadDisplayName</key><string>目次 · 阅读书架</string>
  <key>PayloadDescription</key><string>在主屏幕添加目次书架入口，点按后打开 ${url} 。</string>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadType</key><string>com.apple.webClip.managed</string>
      <key>PayloadVersion</key><integer>1</integer>
      <key>PayloadIdentifier</key><string>app.mokuji.reader.webclip.bookmark</string>
      <key>PayloadUUID</key><string>F6C9DC84-5D9C-45E2-9A05-82AD742B694B</string>
      <key>PayloadDisplayName</key><string>目次</string>
      <key>Label</key><string>目次</string>
      <key>URL</key><string>${url}</string>
      <key>Icon</key><data>${iconPNG}</data>
      <key>IsRemovable</key><true/>
      <key>FullScreen</key><true/>
      <key>Precomposed</key><true/>
    </dict>
  </array>
</dict>
</plist>
`;
}
