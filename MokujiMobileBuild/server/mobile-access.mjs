import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { isIPv4 } from 'node:net';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

function ipv4(value) {
  if (typeof value !== 'string' || !isIPv4(value)) return null;
  return value.split('.').reduce((sum,part)=>((sum << 8) | Number(part)) >>> 0,0);
}
function privateAddress(value) {
  return ipv4(value) !== null && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(value);
}
function maskValue(mask) {
  const value=ipv4(mask);
  if (value===null || value===0) return null;
  const inverted=(~value)>>>0;
  return ((inverted & (inverted+1))===0) ? value : null;
}
export function peerAllowed(remote,address,netmask) {
  if (!privateAddress(remote) || !privateAddress(address)) return false;
  const mask=maskValue(netmask);
  if (mask===null) return false;
  const peer=ipv4(remote);
  const network=(ipv4(address) & mask)>>>0;
  if (((peer & mask)>>>0)!==network) return false;
  const broadcast=(network | (~mask))>>>0;
  return mask>=0xfffffffe || (peer!==network && peer!==broadcast);
}
const virtualName = /loopback|bluetooth|bridge|docker|hyper[\s-]?v|vethernet|vmware|virtual|virtualbox|zerotier|tailscale|wireguard|wintun|tap.windows|tunnel|hamachi|pseudo|clash|mihomo|(?:^|[\s_-])(?:vpn|tun|tap|wsl)(?:$|[\s_-])|wi-fi direct|虚拟|隧道|蓝牙|本地连接\s*\*/i;
let cachedRoute = {when:0,address:''};
function defaultWindowsAddress() {
  if (process.platform!=='win32') return '';
  if (Date.now()-cachedRoute.when<60000) return cachedRoute.address;
  let address='';
  try {
    const route=join(process.env.SystemRoot || 'C:\\Windows','System32','route.exe');
    const output=execFileSync(route,['PRINT','-4'],{encoding:'utf8',windowsHide:true,timeout:1200,stdio:['ignore','pipe','ignore']});
    const rows=[...output.matchAll(/^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+\d+(?:\.\d+){3}\s+(\d+(?:\.\d+){3})\s+(\d+)\s*$/gm)];
    rows.sort((a,b)=>Number(a[2])-Number(b[2]));
    address=rows.find(row=>privateAddress(row[1]))?.[1] || '';
  } catch { /* Network interface ranking remains available without route.exe. */ }
  cachedRoute={when:Date.now(),address};
  return address;
}
export function listPrivateAddresses(interfaces, preferred) {
  if (interfaces===undefined) {
    try {interfaces=networkInterfaces();} catch {return [];}
    preferred=defaultWindowsAddress();
  }
  const result=[];
  for (const [label,records] of Object.entries(interfaces)) {
    if (virtualName.test(label)) continue;
    for (const item of records || []) {
      if (item.internal || !(item.family==='IPv4' || item.family===4) || !privateAddress(item.address) || maskValue(item.netmask)===null) continue;
      const wifi=/wi[\s-]?fi|wireless|wlan|无线|airport/i.test(label);
      result.push({address:item.address,label,netmask:item.netmask,rank:(wifi?4:0)+(item.address===preferred?2:0)+(/ethernet|以太网|^en\d+$/i.test(label)?1:0)});
    }
  }
  result.sort((a,b)=>b.rank-a.rank || a.label.localeCompare(b.label) || a.address.localeCompare(b.address));
  const seen=new Set();
  return result.filter(item=>!seen.has(item.address) && seen.add(item.address)).map(({address,label,netmask})=>({address,label,netmask}));
}

const headers={
  'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin',
  'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
};
function json(res,status,error) {
  res.writeHead(status,headers);
  res.end(JSON.stringify({error}));
}
function pairingPage(res,status,message='') {
  res.writeHead(status,{...headers,'Content-Type':'text/html; charset=utf-8'});
  res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>目次 · 手机配对</title><style>*{box-sizing:border-box}body{background:#f5f4ed;color:#253f34;font:16px/1.65 system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center}main{width:min(90%,25rem);background:#fffefa;border:1px solid #ced7ca;border-radius:16px;padding:2rem}h1{font-weight:650;font-size:1.8rem;margin:0 0 .4rem}p{margin:.55rem 0 1.3rem}input,button{display:block;width:100%;font:inherit;border-radius:8px;padding:.7rem}input{border:1px solid #8f9f91;background:#fff;letter-spacing:.22em}button{margin-top:1rem;border:0;background:#315943;color:white;font-weight:600}.error{color:#963e2e}</style>' +
    '<main><h1>连接电脑上的目次</h1><p>在电脑的「手机访问」中查看 8 位配对码。连接后可以在手机上阅读和更新这个书架。</p>' +
    (message?'<p role="alert" class="error">'+message+'</p>':'') +
    '<form method="post" action="/pair"><label for="code">配对码</label><input id="code" name="code" required inputmode="numeric" pattern="[0-9]{8}" maxlength="8" autocomplete="one-time-code"><button>配对并打开书架</button></form><p><a href="/install/">安装到手机</a></p></main></html>');
}
function go(res,path,cookie) {
  res.writeHead(303,{...headers,Location:path,...(cookie?{'Set-Cookie':cookie}:{})});res.end();
}
function deny(message,status=400) {return Object.assign(new Error(message),{status});}
function hash(value) {return createHash('sha256').update(value).digest('hex');}
function equalCode(actual,expected) {
  return typeof actual==='string' && /^\d{8}$/.test(actual) && timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
}
async function formCode(req) {
  if ((req.headers['content-type'] || '').split(';')[0].trim()!=='application/x-www-form-urlencoded') return null;
  if (Number(req.headers['content-length'])>256) return null;
  let size=0;
  const chunks=[];
  for await (const chunk of req.iterator({destroyOnReturn:false})) {
    size+=chunk.length;
    if (size>256) {req.resume();return null;}
    chunks.push(chunk);
  }
  const params=new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  return params.getAll('code').length===1 ? params.get('code')?.trim() : null;
}

export function createMobileAccess({port=5199,handleApp,getAddresses=listPrivateAddresses,now=Date.now,
  createListener=handler=>createServer({headersTimeout:12000,requestTimeout:30000,maxHeaderSize:8192},handler),
  allowPeer=(req,iface)=>req.socket.localAddress===iface.address && peerAllowed(req.socket.remoteAddress,iface.address,iface.netmask),
  codeLifetimeMs=5*60*1000,sessionLifetimeMs=12*60*60*1000}={}) {
  if (!Number.isInteger(port) || port<1 || port>65535 || typeof handleApp!=='function') throw new TypeError('手机访问端口或处理程序无效。');
  let active=null;
  let sequence=Promise.resolve();
  const cookieName='duji_mobile_'+port;
  const rateWindow=5*60*1000;
  const queue=fn=>{const next=sequence.then(fn);sequence=next.catch(()=>{});return next;};
  function prune(ctx) {
    const time=now();
    if (ctx.challenge && ctx.challenge.end<=time) ctx.challenge=null;
    for (const [token,s] of ctx.sessions) if (s.end<=time) ctx.sessions.delete(token);
    ctx.failures=ctx.failures.filter(f=>time-f.at<rateWindow);
  }
  function rotate(ctx) {
    ctx.challenge={value:String(randomInt(100000000)).padStart(8,'0'),end:now()+codeLifetimeMs};
  }
  function status() {
    if (active) prune(active);
    return {enabled:!!active,addresses:getAddresses().map(({address,label})=>({address,label})),
      urls:active?[active.origin+'/']:[],code:active?.challenge?.value ?? null,
      expiresAt:active?.challenge?new Date(active.challenge.end).toISOString():null,pairedDevices:active?.sessions.size || 0};
  }
  async function handle(ctx,req,res) {
    if (ctx!==active || !allowPeer(req,ctx.iface) || !ctx.hosts.has(req.headers.host)) return json(res,403,'仅允许从同一私有网段直接连接。');
    if (Object.keys(req.headers).some(key=>key==='forwarded'||key==='via'||key.startsWith('x-forwarded-'))) return json(res,403,'请直接使用电脑上显示的局域网地址。');
    if (!req.url?.startsWith('/') || req.url.startsWith('//') || req.url.includes('\\')) return json(res,400,'网址格式不正确。');
    const url=new URL(req.url,ctx.origin);
    if (url.origin!==ctx.origin || (req.headers.origin!==undefined && req.headers.origin!==ctx.origin)) return json(res,403,'请求来自其他站点。');
    const site=req.headers['sec-fetch-site'];
    const navigation=req.method==='GET' && ['/', '/pair', '/install', '/install/'].includes(url.pathname) && req.headers['sec-fetch-mode']==='navigate' && req.headers['sec-fetch-dest']==='document';
    if (site && site!=='same-origin' && site!=='none' && !navigation) return json(res,403,'请使用已打开的目次页面。');
    if (url.pathname==='/api/mobile' || url.pathname.startsWith('/api/mobile/') || url.pathname==='/api/local-status') return json(res,403,'此功能只对电脑本机开放。');
    // Local downloads contain only public program files. Shelf and session routes still require pairing.
    if (['/install', '/install/', '/install/index.html', '/install/install.js','/install/install.css', '/install/Mokuji-Android.apk', '/install/Mokuji-iPhone-Unsigned.ipa', '/install/Mokuji.mobileconfig'].includes(url.pathname)) {
      if (!['GET','HEAD'].includes(req.method)) return json(res,405,'下载页只接受读取请求。');
      return handleApp(req,res);
    }
    prune(ctx);
    const peer=req.socket.remoteAddress;
    if (url.pathname==='/pair' && req.method==='POST') {
      if (req.headers.origin!==ctx.origin) return json(res,403,'请使用本页的配对表单。');
      const value=await formCode(req);
      // A slow form submission must not succeed after disabling, rotation, or expiry.
      if (ctx!==active) return json(res,403,'电脑已关闭手机访问。');
      prune(ctx);
      if (ctx.failures.length>=30 || ctx.failures.filter(f=>f.peer===peer).length>=5) {
        res.setHeader('Retry-After',String(Math.ceil(rateWindow/1000)));
        return pairingPage(res,429,'尝试次数过多，请在五分钟后重试。');
      }
      if (!ctx.challenge || !equalCode(value,ctx.challenge.value)) {
        ctx.failures.push({at:now(),peer});
        return pairingPage(res,401,'配对码无效或已过期，请在电脑上获取新码。');
      }
      if (ctx.sessions.size>=32) return pairingPage(res,409,'已达设备上限。请在电脑上关闭并重新开启手机访问。');
      ctx.challenge=null;
      const token=randomBytes(32).toString('base64url');
      ctx.sessions.set(hash(token),{peer,end:now()+sessionLifetimeMs});
      const cookie=cookieName+'='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+Math.floor(sessionLifetimeMs/1000);
      return go(res,'/',cookie);
    }
    if (url.pathname==='/pair') return req.method==='GET' ? pairingPage(res,200) : json(res,405,'不支持该请求方法。');
    const cookie=(req.headers.cookie || '').split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1);
    const session=cookie && /^[A-Za-z0-9_-]{43}$/.test(cookie) ? ctx.sessions.get(hash(cookie)) : null;
    if (!session || session.peer!==peer) {
      if (req.method==='GET' && !url.pathname.startsWith('/api/')) return go(res,'/pair');
      return json(res,401,'请先打开电脑上的局域网地址，并使用配对码连接。');
    }
    await handleApp(req,res);
  }
  async function closeActive() {
    const ctx=active;
    active=null;
    if (!ctx) return;
    ctx.challenge=null;ctx.sessions.clear();ctx.failures=[];
    const closed=new Promise(resolve=>ctx.server.close(()=>resolve()));
    for (const socket of ctx.sockets) socket.destroy();
    await closed;
  }
  async function enable(address) {
    return queue(async()=>{
      const choices=getAddresses();
      const iface=address?choices.find(a=>a.address===address):choices[0];
      if (!iface || !privateAddress(iface.address) || maskValue(iface.netmask)===null) {
        throw deny('没有找到可用的私有网卡地址。请连接 Wi-Fi 或有线局域网后重试。');
      }
      if (active?.iface.address===iface.address && active.iface.netmask===iface.netmask) {rotate(active);return status();}
      const ctx={iface,origin:new URL('http://'+iface.address+':'+port).origin,hosts:new Set([iface.address+':'+port]),
        challenge:null,sessions:new Map(),failures:[],sockets:new Set()};
      if (port===80) ctx.hosts.add(iface.address);
      const listener=createListener((req,res)=>handle(ctx,req,res).catch(()=>{
        if (!res.headersSent && !res.destroyed) json(res,500,'手机访问暂时不可用。');else res.destroy();
      }));
      ctx.server=listener;
      listener.on('connection',socket=>{ctx.sockets.add(socket);socket.once('close',()=>ctx.sockets.delete(socket));});
      try {
        await new Promise((resolve,reject)=>{
          const fail=err=>{listener.off('listening',ready);reject(err);};
          const ready=()=>{listener.off('error',fail);resolve();};
          listener.once('error',fail);listener.once('listening',ready);
          listener.listen(port,iface.address);
        });
      } catch (error) {
        throw deny(error.code==='EADDRINUSE'?'手机访问端口已被占用。':'无法绑定选择的网卡，请检查连接后重试。',409);
      }
      await closeActive();
      active=ctx;rotate(ctx);
      listener.on('error',()=>{if (active===ctx) void queue(closeActive);});
      return status();
    });
  }
  async function disable() {return queue(async()=>{await closeActive();return status();});}
  return {status,enable,disable};
}

