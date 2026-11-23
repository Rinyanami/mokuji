import { createHash, createHmac } from 'node:crypto';
import { isIPv4 } from 'node:net';

// Server-side only. Region IDs and HTTPS hostnames follow Kodo's S3 endpoint table.
// https://developer.qiniu.com/kodo/4088/s3-access-domainname
const regions = new Set(['cn-east-1','cn-east-2','cn-north-1','cn-south-1','us-north-1','ap-southeast-1','ap-southeast-2','ap-southeast-3']);
const maxBytes = 8 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const emptyHash = sha256('');
const hmac = (key,value) => createHmac('sha256',key).update(value).digest();
const fail = (status,code,message) => Object.assign(new Error(message),{name:'KodoError',status,code});
const configError = message => fail(503,'KODO_CONFIG',message);
const corrupt = () => fail(502,'KODO_INTEGRITY','云端正文未通过完整性校验。');
const unavailable = () => fail(503,'KODO_UNAVAILABLE','暂时无法连接七牛对象存储，请稍后重试。');
const timeoutError = () => fail(504,'KODO_TIMEOUT','七牛对象存储请求超时，请稍后重试。');
const validDigest = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]{64}$/.test(value);

function parseConfig(env) {
  const names = ['REGION','BUCKET','ACCESS_KEY','SECRET_KEY','PREFIX'];
  if (!names.some(name=>typeof env['DUJI_KODO_'+name]==='string' && env['DUJI_KODO_'+name].trim())) return null;
  for (const name of names.slice(0,4)) {
    if (typeof env['DUJI_KODO_'+name]!=='string' || !env['DUJI_KODO_'+name].trim()) {
      throw configError('七牛配置不完整，请填写 DUJI_KODO_REGION、DUJI_KODO_BUCKET、DUJI_KODO_ACCESS_KEY 和 DUJI_KODO_SECRET_KEY。');
    }
  }
  const region=env.DUJI_KODO_REGION.trim();
  if (!regions.has(region)) throw configError('不支持该七牛 S3 存储区域，请使用空间概览中的 Region ID。');
  const bucket=env.DUJI_KODO_BUCKET.trim();
  const hostnamePart=/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
  if (bucket.length<3 || bucket.length>63 || isIPv4(bucket) || !bucket.split('.').every(part=>hostnamePart.test(part))) {
    throw configError('七牛 S3 空间名无效，请填写空间概览中的 S3 空间名。');
  }
  const accessKey=env.DUJI_KODO_ACCESS_KEY;
  const secretKey=env.DUJI_KODO_SECRET_KEY;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(accessKey) || !/^[\x21-\x7e]{1,512}$/.test(secretKey)) {
    throw configError('七牛服务端凭证格式无效，请重新核对。');
  }
  const prefix=(env.DUJI_KODO_PREFIX?.trim() || 'duji/reader/v1').replace(/^\/+|\/+$/g,'');
  const segments=prefix.split('/');
  if (Buffer.byteLength(prefix)>256 || segments.some(s=>!s || s==='.' || s==='..' || !/^[\p{L}\p{N}_ .-]+$/u.test(s))) {
    throw configError('七牛对象前缀无效，请使用文字、数字、空格、点、短横线或下划线，以斜杠分层。');
  }
  return {region,bucket,accessKey,secretKey,segments};
}

const encodeSegment = value => encodeURIComponent(value).replace(/[!'()*]/g,ch=>'%'+ch.charCodeAt(0).toString(16).toUpperCase());

// This function only signs a request. It never sends credentials or contacts a host.
export function signS3Headers({method,host,pathname,region,accessKey,secretKey,payloadHash,date,extraHeaders={}}) {
  const timestamp=date.toISOString().replace(/[:-]|\.\d{3}/g,'');
  const day=timestamp.slice(0,8);
  const signingHeaders={...extraHeaders,host,'x-amz-content-sha256':payloadHash,'x-amz-date':timestamp};
  const keys=Object.keys(signingHeaders).sort();
  const signedNames=keys.join(';');
  const canonicalHeaders=keys.map(k=>k+':'+signingHeaders[k].trim().replace(/\s+/g,' ')+'\n').join('');
  const canonical=[method,pathname,'',canonicalHeaders,signedNames,payloadHash].join('\n');
  const scope=[day,region,'s3','aws4_request'].join('/');
  const toSign=['AWS4-HMAC-SHA256',timestamp,scope,sha256(canonical)].join('\n');
  const key=hmac(hmac(hmac(hmac('AWS4'+secretKey,day),region),'s3'),'aws4_request');
  const signature=hmac(key,toSign).toString('hex');
  // fetch supplies the Host from the same fixed URL.
  const {host:_host,...headers}=signingHeaders;
  return {...headers,authorization:'AWS4-HMAC-SHA256 Credential='+accessKey+'/'+scope+', SignedHeaders='+signedNames+', Signature='+signature};
}

function upstreamError(status,method) {
  if (status===401 || status===403) return fail(503,'KODO_AUTH','七牛拒绝了服务器凭证，请核对授权、存储区域及服务器时间。');
  if (status===404) return method==='GET'
    ? fail(404,'KODO_NOT_FOUND','七牛未找到这份云端正文。')
    : fail(503,'KODO_BUCKET','七牛未找到目标存储空间，请核对服务端配置。');
  if (status>=300 && status<400) return fail(502,'KODO_REDIRECT','七牛返回意外跳转，请核对服务端存储区域。');
  if (status===408 || status===504) return timeoutError();
  if (status>=500 || status===429) return unavailable();
  return fail(502,'KODO_RESPONSE','七牛未接受本次对象请求，请核对存储配置。');
}
function cancelBody(response) {
  if (response.body && !response.body.locked) void response.body.cancel().catch(()=>{});
}

async function readText(response,digest,signal) {
  if (Number(response.headers.get('content-length'))>maxBytes) {
    cancelBody(response);
    throw fail(502,'KODO_OVERSIZE','云端正文超出 8 MiB 上限。');
  }
  if (!response.body) throw corrupt();
  const reader=response.body.getReader();
  const cancel=()=>{void reader.cancel().catch(()=>{});};
  signal.addEventListener('abort',cancel,{once:true});
  const chunks=[];
  let size=0;
  try {
    for (;;) {
      const {done,value}=await reader.read();
      if (signal.aborted) throw timeoutError();
      if (done) break;
      size+=value.byteLength;
      if (size>maxBytes) {
        cancel();
        throw fail(502,'KODO_OVERSIZE','云端正文超出 8 MiB 上限。');
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort',cancel);
    reader.releaseLock();
  }
  const bytes=Buffer.concat(chunks,size);
  if (sha256(bytes)!==digest) throw corrupt();
  try {return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}
  catch {throw corrupt();}
}

export function createKodoStore(env=process.env,{fetchImpl=globalThis.fetch,now=()=>new Date(),timeoutMs=15000}={}) {
  const config=parseConfig(env);
  if (!config) return null;
  if (!Number.isFinite(timeoutMs) || timeoutMs<=0) throw configError('七牛请求超时设置无效。');
  const endpoint='s3.'+config.region+'.qiniucs.com';
  // A wildcard HTTPS certificate covers a single bucket label. Kodo also supports path style.
  const pathStyle=config.bucket.includes('.');
  const host=pathStyle ? endpoint : config.bucket+'.'+endpoint;
  async function request(method,digest,bytes) {
    if (!validDigest(digest)) throw fail(400,'KODO_DIGEST','正文摘要格式无效。');
    const parts=[...config.segments,'sha256',digest.slice(0,2),digest+'.txt'];
    if (pathStyle) parts.unshift(config.bucket);
    const pathname='/'+parts.map(encodeSegment).join('/');
    const headers=signS3Headers({method,host,pathname,region:config.region,accessKey:config.accessKey,secretKey:config.secretKey,
      payloadHash:method==='PUT'?digest:emptyHash,date:now(),
      extraHeaders:method==='PUT'?{'content-type':'text/plain; charset=utf-8'}:{}});
    const controller=new AbortController();
    let timer;
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(timeoutError());},timeoutMs);});
    const perform=async()=>{
      const response=await fetchImpl('https://'+host+pathname,{
        method,headers,body:bytes,credentials:'omit',redirect:'manual',signal:controller.signal,
      });
      if (response.status!==200 && !(method==='PUT' && response.status===204)) {
        cancelBody(response);
        throw upstreamError(response.status,method);
      }
      if (method==='GET') return readText(response,digest,controller.signal);
      cancelBody(response);
      return {digest,bytes:bytes.length};
    };
    try {return await Promise.race([perform(),deadline]);}
    catch (error) {
      if (error?.name==='KodoError') throw error;
      if (controller.signal.aborted) throw timeoutError();
      throw unavailable();
    } finally {clearTimeout(timer);controller.abort();}
  }
  return {
    async putText(digest,text) {
      if (!validDigest(digest)) throw fail(400,'KODO_DIGEST','正文摘要格式无效。');
      if (typeof text!=='string' || !text.isWellFormed()) throw fail(400,'KODO_TEXT','请提供有效的 UTF-8 正文。');
      if (Buffer.byteLength(text,'utf8')>maxBytes) throw fail(413,'KODO_OVERSIZE','上传正文最多为 8 MiB。');
      const bytes=Buffer.from(text,'utf8');
      if (sha256(bytes)!==digest) throw fail(400,'KODO_DIGEST','正文和提交的摘要不一致。');
      // Every valid PUT to a given key has exactly the same bytes. No remote CAS is needed.
      return request('PUT',digest,bytes);
    },
    getText(digest) {return request('GET',digest);}
  };
}

