import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
const dir=process.argv[2];
const port=5247,phonePort=5248,host='http://127.0.0.1:'+port;
async function withServer(hosted,fn) {
  const data=mkdtempSync(path.join(tmpdir(),'MokujiPhoneClean-'));
  const cp=spawn(process.execPath,['--preserve-symlinks','--input-type=module','-e',"import('node:url').then(x=>import(x.pathToFileURL(process.argv[1])))",path.join(dir,'server.mjs')],{stdio:'ignore',env:{...process.env,DUJI_HOSTING_MODE:hosted?'server':'',DUJI_PUBLIC_ORIGIN:hosted?'https://books.example.com':'',DUJI_PORT:String(port),DUJI_MOBILE_PORT:String(phonePort),DUJI_DATA_DIR:data,APPDATA:data}});
  try {
    for (let i=0;i<40;i++) {try{if((await fetch(host+'/api/local-status')).ok)break}catch{}await delay(200);}
    await fn();
  }finally{await new Promise(resolve=>{if(cp.exitCode!==null){resolve();return;}cp.once('exit',resolve);cp.kill()});}
}
async function checkPage(origin, bookHost) {
 const page=await fetch(origin+'/install/');assert.equal(page.status,200);
 const html=await page.text();assert.ok(['/install/Mokuji-Android.apk','/install/Mokuji.mobileconfig','/install/Mokuji-iPhone-Unsigned.ipa'].every(target=>html.includes(target)));
 for(const name of ['install.css','install.js'])assert.equal((await fetch(origin+'/install/'+name)).status,200);
 const ios=await fetch(origin+'/install/Mokuji.mobileconfig');assert.equal(ios.status,200);assert.ok(ios.headers.get('content-type').includes('apple-aspen-config'));
 const profile=await ios.text();assert.ok(profile.includes(bookHost));assert.ok(profile.includes('com.apple.webClip.managed'));assert.ok(!profile.includes('com.apple.mdm'));
 const apk=await fetch(origin+'/install/Mokuji-Android.apk');assert.equal(apk.status,200);assert.equal(apk.headers.get('content-type'),'application/vnd.android.package-archive');
 const remote=Buffer.from(await apk.arrayBuffer());assert.equal(remote[0],0x50);assert.equal(remote[1],0x4b);
 const sha=b=>createHash('sha256').update(b).digest('hex');assert.equal(sha(remote),sha(readFileSync(path.join(dir,'web','install','Mokuji-Android.apk'))));
 const ipaName='Mokuji-iPhone-Unsigned.ipa';
 const ipa=await fetch(origin+'/install/'+ipaName);
 assert.equal(ipa.status,200);
 assert.equal(ipa.headers.get('Content-Type'),'application/octet-stream');
 assert.equal(ipa.headers.get('Content-Disposition'),'attachment; filename="'+ipaName+'"');
 assert.equal(sha(Buffer.from(await ipa.arrayBuffer())),sha(readFileSync(path.join(dir,'web','install',ipaName))));
 assert.equal((await fetch(origin+'/install/Mokuji.mobileconfig',{method:'HEAD'})).status,200);
}
await withServer(false,async()=>{
 const info=await (await fetch(host+'/api/mobile')).json(); assert.equal(info.enabled,false);
 assert.equal((await fetch(host+'/install/Mokuji.mobileconfig')).status,409);
 const action=async(mode)=>await (await fetch(host+'/api/mobile',{method:'POST',headers:{'Content-Type':'application/json','Origin':host},body:JSON.stringify({action:mode})})).json();
 const mobile=await action('enable');
 try{
  assert.ok(mobile.enabled,JSON.stringify(mobile));const peer=new URL(mobile.urls[0]).origin;
  assert.equal((await fetch(peer+'/api/reader/web-fiction')).status,401);
  await checkPage(peer,peer);await checkPage(host,peer);
  assert.equal((await fetch(peer+'/install/Mokuji.mobileconfig',{method:'POST'})).status,405);
  assert.equal((await fetch(peer+'/api/mobile')).status,403);
  const paired=await fetch(peer+'/pair',{method:'POST',redirect:'manual',headers:{Origin:peer,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:mobile.code})});assert.equal(paired.status,303);
  const cookie=paired.headers.get('set-cookie').split(';')[0];const res=await (await fetch(peer+'/api/reader/web-fiction',{headers:{Cookie:cookie}})).json();assert.equal(res.catalogTotal,6734);
 }finally{await action('disable');}
});
await withServer(true,async()=>await checkPage(host,'https://books.example.com'));
console.log('OK: LAN and HTTPS mode, public install without pairing, download hashes, Apple Web Clip, 6734 books with pairing.');