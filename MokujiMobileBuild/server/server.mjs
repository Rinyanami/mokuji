import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { bangumi, catalog, library, openDatabase } from './backend.mjs';
import { WEBCLIP_PATH, createWebClipProfile, webClipHeaders } from './webclip-profile.mjs';
import { createMobileAccess } from './mobile-access.mjs';
import { createReaderSource } from './reader-source.mjs';
import { bookFormLimit } from './epub-storage.mjs';
import { createShelfMeta } from './shelf-meta.mjs';
import { createSyncProvider } from './sync-provider.mjs';
import { createOpdsEink } from './opds-eink.mjs';
import { createBangumiSync } from './bangumi-sync.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(packageRoot, 'web');
const dataRoot = resolve(process.env.DUJI_DATA_DIR || join(packageRoot, 'data'));
const host = '127.0.0.1';
const hosted = process.env.DUJI_HOSTING_MODE === 'server';
const rawPort = process.env.DUJI_PORT || '5198';
const port = Number(rawPort);
if (!/^\d+$/.test(rawPort) || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error('DUJI_PORT 必须为 1 到 65535 之间的端口。');
}
const mobilePort=Number(process.env.DUJI_MOBILE_PORT || '5199');
if (!Number.isInteger(mobilePort) || mobilePort<1 || mobilePort>65535) throw new Error('DUJI_MOBILE_PORT 无效。');
const dataFromPublic = relative(publicRoot, dataRoot);
if (!dataFromPublic || (!isAbsolute(dataFromPublic) && dataFromPublic !== '..' && !dataFromPublic.startsWith('..' + sep))) {
  throw new Error('DUJI_DATA_DIR 必须放在静态网站目录 web 以外。');
}
const hosts = new Set([host + ':' + port, 'localhost:' + port]);
if (port === 80) {hosts.add(host); hosts.add('localhost');}
const routes = new Map([['/api/library', library], ['/api/catalog', catalog], ['/api/bangumi', bangumi]]);
const staticMime = new Map(Object.entries({
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.txt':'text/plain; charset=utf-8', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.apk':'application/vnd.android.package-archive', '.ipa':'application/octet-stream',
  '.webp':'image/webp', '.avif':'image/avif', '.gif':'image/gif', '.woff':'font/woff', '.woff2':'font/woff2',
  '.webmanifest':'application/manifest+json; charset=utf-8', '.json':'application/json; charset=utf-8',
}));
const localHeaders = {
  'X-Content-Type-Options':'nosniff', 'X-Frame-Options':'DENY', 'Referrer-Policy':'no-referrer',
  'Cross-Origin-Resource-Policy':'same-origin',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://api.bgm.tv https://lain.bgm.tv; font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
function json(res, status, body) {
  res.writeHead(status, {...localHeaders,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(body));
}

async function serveStatic(req, res, pathname) {
  let decoded;
  try {decoded=decodeURIComponent(pathname);} catch {return json(res, 400, {error:'网址格式不正确。'});}
  const parts = decoded === '/' ? ['index.html'] : decoded.slice(1).split('/');
  if (parts.some(segment=>!segment || segment.startsWith('.') || /[\\:\x00-\x1f\x7f]/u.test(segment))) {
    return json(res,404,{error:'文件不存在。'});
  }
  const type = staticMime.get(extname(parts.at(-1)).toLowerCase());
  if (!type) return json(res,404,{error:'文件不存在。'});
  let file = publicRoot;
  try {
    // A junction or symbolic link anywhere inside web must not expose a private file.
    const baseInfo = await lstat(file);
    if (!baseInfo.isDirectory() || baseInfo.isSymbolicLink()) return json(res,404,{error:'网页目录不可用。'});
    let info;
    for (const part of parts) {
      file = join(file,part);
      info = await lstat(file);
      if (info.isSymbolicLink()) return json(res,404,{error:'文件不存在。'});
    }
    if (!info.isFile()) return json(res,404,{error:'文件不存在。'});
    const download = ['/install/Mokuji-Android.apk', '/install/Mokuji-iPhone-Unsigned.ipa'].includes(pathname);
    const attachment = download ? {'Content-Disposition':'attachment; filename="' + parts.at(-1) + '"'} : {};
    res.writeHead(200,{...localHeaders,...attachment,'Content-Type':type,'Content-Length':info.size,'Cache-Control':'no-cache'});
    if (req.method === 'HEAD') return res.end();
    await pipeline(createReadStream(file),res);
  } catch (error) {
    if (!res.headersSent && ['ENOENT','ENOTDIR'].includes(error.code)) return json(res,404,{error:'文件不存在。'});
    throw error;
  }
}

async function bodyBuffer(req, limit) {
  if (Number(req.headers['content-length']) > limit) return null;
  const chunks=[];
  let size=0;
  for await (const chunk of req.iterator({destroyOnReturn:false})) {
    size += chunk.length;
    if (size>limit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks,size);
}

const database = openDatabase(join(dataRoot,'duji.sqlite'));
const reader = createReaderSource({dataDir:dataRoot});
const shelfMeta = createShelfMeta({db:database.sqlite});
const syncProvider = createSyncProvider({dataDir:dataRoot,dujiDb:database.sqlite,reader,shelfMeta});
const opdsEink = createOpdsEink({reader});
const bangumiSync = createBangumiSync({dataDir:dataRoot,dujiDb:database.sqlite});
const mobile = createMobileAccess({port:mobilePort,handleApp:(req,res)=>serve(req,res,true)});
async function serve(req,res,phone=false) {
  try {
    const authority = req.headers.host;
    if (!phone && (req.socket.remoteAddress !== host || !hosts.has(authority))) return json(res,403,{error:'仅接受本机访问。'});
    if (!req.url?.startsWith('/') || req.url.startsWith('//') || req.url.includes('\\')) return json(res,400,{error:'网址格式不正确。'});
    const origin = new URL('http://' + authority).origin;
    const url = new URL(req.url,origin);
    if (url.origin !== origin || (req.headers.origin !== undefined && req.headers.origin !== origin)) {
      return json(res,403,{error:'请求来自其他站点。'});
    }
    const api = url.pathname.startsWith('/api/');
    const isOpdsOrEink = url.pathname === '/opds' || url.pathname.startsWith('/opds/') || url.pathname === '/eink' || url.pathname.startsWith('/eink/');
    const site = req.headers['sec-fetch-site'];
    const externalNavigation = req.method === 'GET' && ['/', '/install/', '/install', '/eink', '/eink/', '/opds'].includes(url.pathname) && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
    if (site && site !== 'same-origin' && site !== 'none' && !externalNavigation) return json(res,403,{error:'此操作需要在本机目次页面中完成。'});
    if (isOpdsOrEink) {
      let bodyBuf;
      if (req.method === 'POST') {
        bodyBuf = await bodyBuffer(req, 16000);
        if (bodyBuf === null) { req.resume(); return json(res,413,{error:'请求内容过大。'}); }
      }
      const reqHeaders = new Headers();
      if (req.headers['content-type']) reqHeaders.set('content-type', req.headers['content-type']);
      const opdsReq = new Request(url, { method: req.method, headers: reqHeaders, body: bodyBuf });
      const opdsRes = await opdsEink.handle(opdsReq);
      if (!opdsRes) return json(res, 404, { error: '页面不存在。' });
      res.writeHead(opdsRes.status, { ...localHeaders, ...Object.fromEntries(opdsRes.headers) });
      return res.end(Buffer.from(await opdsRes.arrayBuffer()));
    }
    if (!api) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res,405,{error:'不支持该请求方法。'});
      if (url.pathname === WEBCLIP_PATH) {
        const address = hosted ? process.env.DUJI_PUBLIC_ORIGIN : mobile.status().urls[0];
        if (!address) return json(res,409,{error:hosted?'请为目次配置服务器公开网址后再下载。':'请先在电脑上的「手机连接」里开启局域网访问。'});
        const payload=Buffer.from(createWebClipProfile(address));
        res.writeHead(200,{...localHeaders,...webClipHeaders,'Content-Length':payload.length});
        return res.end(req.method==='HEAD' ? undefined : payload);
      }
      const page = ['/install','/install/'].includes(url.pathname) ? '/install/index.html' : url.pathname;
      return await serveStatic(req,res,page);
    }
    if (url.pathname === '/api/connection-mode' && req.method === 'GET') {
      return json(res,200,{mode:hosted ? 'server' : phone ? 'mobile' : 'desktop',txtStorage:reader.txtStorage});
    }
    if (url.pathname === '/api/mobile') {
      if (hosted) return json(res,403,{error:'服务器版通过同一 HTTPS 地址连接。'});
      if (phone) return json(res,403,{error:'手机访问管理仅限电脑本机。'});
      if (req.method==='GET') return json(res,200,mobile.status());
      if (req.method!=='POST') return json(res,405,{error:'不支持该请求方法。'});
      if (req.headers.origin!==origin) return json(res,403,{error:'请在电脑目次页面管理手机访问。'});
      if ((req.headers['content-type'] || '').split(';')[0].trim()!=='application/json') return json(res,415,{error:'请使用 JSON 提交。'});
      const payload=await bodyBuffer(req,1536);
      if (!payload) {req.resume();return json(res,413,{error:'请求内容过大。'});}
      let command;
      try {command=JSON.parse(payload.toString('utf8'));} catch {return json(res,400,{error:'数据格式无法识别。'});}
      try {
        if (command?.action==='disable') return json(res,200,await mobile.disable());
        if (command?.action!=='enable' || (command.address!==undefined && typeof command.address!=='string')) return json(res,400,{error:'请选择开启或关闭手机访问。'});
        return json(res,200,await mobile.enable(command.address));
      } catch (error) {
        if (error.status) return json(res,error.status,{error:error.message});
        throw error;
      }
    }
    if (url.pathname === '/api/local-status' && req.method === 'GET') {
      if (phone) return json(res,403,{error:'此接口仅限电脑本机。'});
      return json(res,200,{app:'duji-local',mode:'local',storage:'sqlite',pid:process.pid,port});
    }
    const readerPath=url.pathname==='/api/reader' || url.pathname.startsWith('/api/reader/');
    const shelfMetaPath=url.pathname==='/api/shelf-meta';
    const syncPath=url.pathname.startsWith('/api/sync/');
    const bgmSyncPath=url.pathname.startsWith('/api/bangumi-sync/');
    const route = routes.get(url.pathname);
    if (!route && !readerPath && !shelfMetaPath && !syncPath && !bgmSyncPath) return json(res,404,{error:'接口不存在。'});
    if (!['GET','POST'].includes(req.method) || (!readerPath && !shelfMetaPath && !syncPath && !bgmSyncPath && typeof route[req.method] !== 'function')) return json(res,405,{error:'不支持该请求方法。'});
    // The local identity is supplied by the bundled adapter. Never forward cookies or identity headers.
    const headers = new Headers();
    if (req.headers.origin) headers.set('origin',req.headers.origin);
    const options={method:req.method,headers};
    if (req.method === 'POST') {
      const type=req.headers['content-type'] || '';
      const bookUpload=url.pathname==='/api/reader/import' && /^multipart\/form-data\s*;/i.test(type);
      if (bookUpload && req.headers.origin!==origin) return json(res,403,{error:'请从目次页面导入文件。'});
      if (!bookUpload && type.split(';')[0].trim().toLowerCase() !== 'application/json') return json(res,415,{error:'请使用 JSON 提交。'});
      const largePayload=url.pathname==='/api/library' || url.pathname==='/api/reader/import' || url.pathname.startsWith('/api/reader/sources') || shelfMetaPath;
      const bytes=await bodyBuffer(req,bookUpload ? bookFormLimit : largePayload ? 16000000 : 32000);
      if (bytes === null) {
        req.resume();
        return json(res,413,{error:'请求内容过大。'});
      }
      headers.set('content-type',bookUpload?type:'application/json');
      headers.set('content-length',String(bytes.byteLength));
      options.body=bytes;
    }
    const request=new Request(url,options);
    let result;
    if (readerPath) result = await reader.handle(request);
    else if (shelfMetaPath) {
      try {
        if (req.method === 'GET') result = Response.json(shelfMeta.snapshot());
        else result = Response.json(shelfMeta.mutate(await request.json()));
      } catch (err) {
        result = Response.json({ error: err?.message || '整理操作失败' }, { status: Number.isInteger(err?.status) ? err.status : 500 });
      }
    } else if (syncPath) {
      result = await syncProvider.handle(request);
    } else if (bgmSyncPath) {
      try {
        if (url.pathname === '/api/bangumi-sync/status' && req.method === 'GET') {
          result = Response.json(bangumiSync.getStatus());
        } else if (url.pathname === '/api/bangumi-sync/config' && req.method === 'POST') {
          result = Response.json(await bangumiSync.updateConfig(await request.json()));
        } else if (url.pathname === '/api/bangumi-sync/push-one' && req.method === 'POST') {
          result = Response.json(await bangumiSync.pushOne(await request.json()));
        } else if (url.pathname === '/api/bangumi-sync/push-all' && req.method === 'POST') {
          result = Response.json(await bangumiSync.pushAll());
        } else if (url.pathname === '/api/bangumi-sync/pull' && req.method === 'POST') {
          result = Response.json(await bangumiSync.pullCollections(await request.json()));
        } else {
          result = Response.json({ error: '未知 Bangumi 同步接口' }, { status: 404 });
        }
      } catch (err) {
        result = Response.json({ error: err?.message || 'Bangumi 同步操作失败' }, { status: Number.isInteger(err?.status) ? err.status : 500 });
      }
    } else {
      result = await route[req.method](request);
    }
    if (!result) return json(res,404,{error:'接口不存在。'});
    res.writeHead(result.status,{...Object.fromEntries(result.headers),...localHeaders,'Cache-Control':'no-store'});
    res.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    if (req.aborted || res.destroyed) return;
    console.error('目次本地服务处理请求失败。',error.name);
    if (!res.headersSent) json(res,500,{error:'本地服务暂时无法读取或保存，请重试。'});
    else res.destroy();
  }
}
const server=createServer({requestTimeout:180000,headersTimeout:15000},serve);
server.on('error',error=>{
  console.error(error.code === 'EADDRINUSE' ? '端口已被占用：'+port : '无法启动目次：'+error.message);
  reader.close();bangumiSync.close();database.close();
  process.exitCode=1;
});
server.listen(port,host,()=>console.log('目次已启动：http://'+host+':'+port+'/'));
function stop() {
  const closed=new Promise(resolve=>server.close(resolve));
  Promise.all([closed,mobile.disable()]).finally(()=>{reader.close();bangumiSync.close();database.close();});
}
process.once('SIGINT',stop);
process.once('SIGTERM',stop);
