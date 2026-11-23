import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const dir = path.dirname(fileURLToPath(import.meta.url));
const port = 5198;
const url = 'http://127.0.0.1:' + port;
const data = path.join(dir, 'data');
const pidFile = path.join(data, 'local-server.pid');
const logFile = path.join(data, 'local-server.log');

async function health() {
  try {
    const response = await fetch(url + '/api/local-status', {signal: AbortSignal.timeout(1200), redirect:'error'});
    if (!response.ok) return 'occupied';
    const data = await response.json();
    return data?.app === 'duji-local' ? data : 'occupied';
  } catch (e) {
    return e.cause?.code === 'ECONNREFUSED' ? null : 'occupied';
  }
}
async function main() {
  if (Number(process.versions.node.split('.')[0]) < 24) throw Error('目次本地版需要 Node.js 24 或更高版本。');
  let current = await health();
  if (process.argv.includes('--stop')) {
    if (!current) { console.log('目次已停止。'); return; }
    const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8').trim()) : 0;
    if (!pid || current === 'occupied' || current.pid !== pid) throw Error('无法确认正在运行的进程属于本启动器。');
    process.kill(pid);
    for (let i=0; i<25 && await health(); i++) await delay(100);
    if (await health()) throw Error('服务仍在运行，请稍后重试。');
    if (existsSync(pidFile)) unlinkSync(pidFile);
    console.log('目次已停止。'); return;
  }
  if (current === 'occupied') throw Error('本机 5198 端口正被其他服务使用。');
  if (!current) {
    mkdirSync(data,{recursive:true});
    appendFileSync(logFile, '\n' + new Date().toISOString() + '\n');
    const log = openSync(logFile,'a');
    const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--preserve-symlinks', '--input-type=module', '-e', 'await import(process.argv[1])', pathToFileURL(path.join(dir,'server.mjs')).href], {
      cwd:dir, env:{...process.env, DUJI_PORT:String(port), DUJI_DATA_DIR:data},
      detached:true, windowsHide:true, stdio:['ignore',log,log]
    });
    closeSync(log); proc.unref();
    let startError;
    proc.on('error', e=>{startError=e;});
    for(let i=0;i<45;i++) {
      if(startError) throw startError;
      await delay(160); current=await health();
      if(current && current !== 'occupied') break;
      if(proc.exitCode !== null) break;
    }
    if(!current || current === 'occupied') throw Error('本地服务没有启动。日志在 data/local-server.log。');
    if(current.pid === proc.pid) writeFileSync(pidFile,String(proc.pid));
  }
  const entry=url+(process.argv.includes('--workspace')?'/?surface=desktop#/workspace':'/#/webfiction');
  console.log('目次本地版  ' + entry);
  if(!process.argv.includes('--no-open')) {
    const browser=spawn('rundll32.exe',['url.dll,FileProtocolHandler',entry],{detached:true,windowsHide:true,stdio:'ignore'});
    browser.on('error', () => console.log('请在浏览器打开 ' + entry)); browser.unref();
  }
}
main().catch(e=>{ console.error(e.message); process.exitCode=1; });
