'use strict';
const {BrowserWindow,WebContentsView,session,ipcMain,app}=require('electron');
const path=require('node:path');const {pathToFileURL}=require('node:url');const {createHash}=require('node:crypto');
const {finalizeBook}=require('./core.cjs');const {withCatalog}=require('./sources.cjs');
const {PLATFORMS,platform,isPlatformURL,isLoginURL,bookID,bookURL,isChapterURL,searchURL,isFontURL}=require('./platform-config.cjs');
const {extractPlatformPage}=require('./platform-extract.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const bounded=(promise,ms,message)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})]).finally(()=>clearTimeout(timer));};
class Platforms {
 constructor({onImport,parent}){this.onImport=onImport;this.parent=parent;this.entries=new Map();this.queues=new Map();this.workers=new Map();this.fontCache=new Map();this.initializedSessions=new Set();this.popups=new Set();this.closing=false;this.file=path.join(__dirname,'platform-browser.html');
  ipcMain.handle('platform-browser:action',(e,action,value)=>{const entry=[...this.entries.values()].find(x=>x.window.webContents===e.sender);if(!entry||e.senderFrame!==e.sender.mainFrame||e.senderFrame.url!==pathToFileURL(this.file).href)throw new Error('非法平台窗口请求');return this.browserAction(entry,action,value);});
 }
 supports(id){return PLATFORMS.some(p=>p.id===id);}
 platformSession(id){platform(id);const s=session.fromPartition('persist:cotex-platform-'+id);if(this.initializedSessions.has(id))return s;this.initializedSessions.add(id);s.on('will-download',event=>event.preventDefault());s.setPermissionRequestHandler((wc,p,cb)=>cb(false));s.setPermissionCheckHandler(()=>false);return s;}
 webPreferences(id){return {partition:'persist:cotex-platform-'+id,sandbox:true,contextIsolation:true,nodeIntegration:false,spellcheck:false};}
 protect(wc,id){
  // Platform content never receives a preload or a Cotex IPC bridge.
  wc.on('will-navigate',(event,url)=>{if(!isLoginURL(url,id))event.preventDefault();});
  wc.on('will-redirect',(event,url)=>{if(!isLoginURL(url,id))event.preventDefault();});
  wc.setWindowOpenHandler(({url})=>{if(!isLoginURL(url,id))return {action:'deny'};if(isPlatformURL(url,id)){this.open(id,url).catch(()=>{});return {action:'deny'};}return {action:'allow',overrideBrowserWindowOptions:{width:650,height:700,autoHideMenuBar:true,webPreferences:this.webPreferences(id)}};});
  wc.on('did-create-window',popup=>{this.popups.add(popup);this.protect(popup.webContents,id);popup.on('closed',()=>this.popups.delete(popup));});

 }
 status(entry,message='',busy=false){if(entry.window.isDestroyed())return;entry.window.webContents.send('platform-browser:state',{name:platform(entry.id).name,url:entry.view.webContents.getURL(),message,busy,canBack:entry.view.webContents.navigationHistory.canGoBack(),canForward:entry.view.webContents.navigationHistory.canGoForward()});}
 async open(id,url){const p=platform(id);if(url&&!isLoginURL(url,id))throw new Error('仅支持该平台的官方页面。');let e=this.entries.get(id);
  if(!e||e.window.isDestroyed()){
   this.platformSession(id);
   const window=new BrowserWindow({width:1120,height:850,minWidth:780,minHeight:600,title:p.name+' · Cotex',autoHideMenuBar:true,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:path.join(__dirname,'platform-browser-preload.cjs')}});
   const view=new WebContentsView({webPreferences:this.webPreferences(id)});e={id,window,view,busy:false};this.entries.set(id,e);window.contentView.addChildView(view);
   const size=()=>{const [width,height]=window.getContentSize();view.setBounds({x:0,y:104,width,height:Math.max(0,height-104)});};size();window.on('resize',size);this.protect(view.webContents,id);
   window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
   for(const event of ['did-navigate','did-navigate-in-page','did-finish-load'])view.webContents.on(event,()=>this.status(e));
   view.webContents.on('did-fail-load',(event,code,description,url,isMainFrame)=>{if(isMainFrame&&code!==-3)this.status(e,'页面未能加载，请刷新或检查网络。');});
   window.on('closed',()=>{if(!view.webContents.isDestroyed())view.webContents.close();this.entries.delete(id);});
   await window.loadFile(this.file);window.show();this.status(e,'请在下方官方页面登录或选书，然后点击“加入 Cotex”。');
   view.webContents.loadURL(url||p.home).catch(()=>{});
  }else{e.window.show();e.window.focus();if(url&&url!==e.view.webContents.getURL())e.view.webContents.loadURL(url).catch(()=>{});}
  return {opened:true};
 }
 async browserAction(e,action,value){const wc=e.view.webContents;
  if(action==='state'){this.status(e);return true;}
  if(action==='navigate'){const u=String(value||'').trim();if(!isPlatformURL(u,e.id))throw new Error('地址栏只接受该平台的 HTTPS 官方链接。');await wc.loadURL(u);return true;}
  if(action==='home')return wc.loadURL(platform(e.id).home).then(()=>true);
  if(action==='shelf')return wc.loadURL(platform(e.id).shelf).then(()=>true);
  if(action==='back'){if(wc.navigationHistory.canGoBack())wc.navigationHistory.goBack();return true;}
  if(action==='forward'){if(wc.navigationHistory.canGoForward())wc.navigationHistory.goForward();return true;}
  if(action==='reload'){wc.reload();return true;}
  if(action==='import'){
   if(e.busy)throw new Error('正在加入，请稍候。');e.busy=true;this.status(e,'正在读取书籍和目录…',true);
   try{if(!isPlatformURL(wc.getURL(),e.id))throw new Error('请先完成登录，再打开一本书的详情页或阅读页。');const current=await this.snapshot(wc,e.id);if(!/^\d{1,22}$/.test(current.bookId))throw new Error('请先进入一本书的详情页或阅读页，然后再加入。');const result=await this.add(e.id,current.bookId);const index=result.chapters.findIndex(c=>c.url===current.url);if(index>=0)result.progress={chapter:index,paragraph:0};await this.onImport(result,index);this.status(e,'已加入 Cotex，可以返回阅读。');this.parent()?.show();this.parent()?.focus();return true;
   }catch(error){this.status(e,error.message);throw error;}finally{e.busy=false;}
  }
  throw new Error('不支持的窗口操作。');
 }
 async snapshot(wc,id){if(!isPlatformURL(wc.getURL(),id))throw new Error('请在官方窗口完成登录或验证，再重试。');return bounded(wc.executeJavaScript('('+extractPlatformPage.toString()+')('+JSON.stringify(id)+')',false),8000,'页面读取超时，请在官方窗口重新打开这本书。');}
 enqueue(id,fn){const previous=this.queues.get(id)||Promise.resolve();const job=previous.catch(()=>{}).then(()=>{if(this.closing)throw new Error('应用正在退出。');return fn();});this.queues.set(id,job);job.finally(()=>{if(this.queues.get(id)===job)this.queues.delete(id);}).catch(()=>{});return job;}
 async load(id,url,kind){
  if(!isPlatformURL(url,id))throw new Error('无效的平台地址。');const visible=this.entries.get(id);
  if(visible&&!visible.window.isDestroyed()&&visible.view.webContents.getURL()===url){const snap=await this.snapshot(visible.view.webContents,id);if(this.ready(snap,kind))return snap;}
  let worker=this.workers.get(id);if(!worker||worker.isDestroyed()){this.platformSession(id);worker=new BrowserWindow({show:false,width:1280,height:900,webPreferences:this.webPreferences(id)});this.protect(worker.webContents,id);this.workers.set(id,worker);}
  const wc=worker.webContents;
  try{await bounded(wc.loadURL(url),25000,'连接平台超时，请在官方窗口检查网络后重试。');}catch(error){wc.stop();if(wc.isDestroyed())throw new Error('平台窗口已关闭。');if(!isPlatformURL(wc.getURL(),id))throw new Error('平台需要登录，请打开官方窗口完成登录。');if(error.message.includes('超时'))throw error;}
  if(kind==='book'&&id==='qidian'){await wc.executeJavaScript("(()=>{const link=[...document.querySelectorAll('a,button')].find(a=>/^(目录|作品目录)([（(]\\d+[）)])?$/.test(a.textContent.trim()));if(link)link.click();})()").catch(()=>{});}
  const until=Date.now()+12000;let snap;
  do{snap=await this.snapshot(wc,id);if(snap.requiresAccess||this.ready(snap,kind))break;await pause(500);}while(Date.now()<until&&!this.closing&&!wc.isDestroyed());
  if(snap?.checkpoint||!snap||!this.ready(snap,kind)&&!snap.requiresAccess)throw new Error('平台尚未返回可读内容。请点击“登录 / 官方窗口”完成验证，打开目标书籍后重试。');
  return snap;
 }
 ready(s,kind){return kind==='chapter'?s.paragraphs.length>0||s.requiresAccess:kind==='book'?!!s.bookId&&s.chapters.length>0:s.items.length>0||s.searchEmpty;}
 async fonts(s,id,metadata=false){if(!(metadata?s.metadataEncoded:s.encoded))return [];let definitions=s.fontDefs;if(!metadata&&s.fontFamily)definitions=definitions.filter(d=>s.fontFamily.split(',').some(f=>f.replace(/["']/g,'').trim()===d.family));const output=[];
  for(const d of definitions.slice(0,4)){if(!isFontURL(d.url,id))continue;let font=this.fontCache.get(d.url);if(!font){const response=await this.platformSession(id).fetch(d.url,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok||!isFontURL(response.url||d.url,id))throw new Error('原站字体加载失败，请重试。');const parts=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>2*1024*1024)throw new Error('原站字体过大，暂不能在 Cotex 显示。');parts.push(Buffer.from(chunk));}const bytes=Buffer.concat(parts);if(bytes.length<4)throw new Error('原站没有返回有效字体。');if(!['wOF2','wOFF','OTTO'].includes(bytes.subarray(0,4).toString())&&bytes.readUInt32BE(0)!==65536)throw new Error('原站未返回有效字体，请重试。');const hash=createHash('sha256').update(bytes).digest('hex').slice(0,24);const format=/\.woff2/.test(d.url)?'woff2':/\.woff/.test(d.url)?'woff':'otf';font={id:hash,data:'data:font/'+format+';base64,'+bytes.toString('base64')};if(this.fontCache.size>=32)this.fontCache.delete(this.fontCache.keys().next().value);this.fontCache.set(d.url,font);}output.push(font);}
  if(!output.length)throw new Error('暂未识别到原站字体。请打开官方窗口阅读，稍后重试。');return output;
 }
 async search(id,query,page=1){platform(id);const q=String(query||'').trim().slice(0,500);if(page>1)return {items:[],hasMore:false,notice:'更多结果可在官方窗口中浏览。'};
  if(/^https:\/\//i.test(q)||/^\d{1,22}$/.test(q)){const b=await this.add(id,bookID(q,id));return {items:[{sourceId:id,remoteId:b.source.remoteId,title:b.title,author:b.author,description:b.description,url:b.source.url,fonts:b.fonts,hasVip:b.chapters.some(c=>c.vip)}],hasMore:false};}
  return this.enqueue(id,async()=>{const s=await this.load(id,searchURL(id,q),'search');const fonts=await this.fonts(s,id,true);return {items:s.items.map(item=>({...item,fonts})),hasMore:false,notice:s.items.length?'显示官方页面的当前结果。更多结果、书架和登录请打开官方窗口。':'官方搜索未返回结果。可粘贴书籍详情页链接，或在官方窗口登录后重试。'};});
 }
 async add(id,value){const remoteId=bookID(value,id);return this.enqueue(id,async()=>{let s=await this.load(id,bookURL(id,remoteId),'book');if(!s.chapters.length)throw new Error('未读到目录，请在官方窗口打开目录后重试。');if(s.bookId!==remoteId)throw new Error('平台返回了其他书籍，已停止加入。');const chapters=s.chapters.filter(c=>isChapterURL(c.url,id));if(!chapters.length)throw new Error('原站尚未返回有效章节。');const fonts=await this.fonts(s,id,true);return finalizeBook({title:s.title||s.pageTitle,author:s.author,description:s.description,chapters,fonts,format:'在线'},id+':'+remoteId,{id,name:platform(id).name,remoteId,url:bookURL(id,remoteId)});});}
 async chapter(book,index){const c=book.chapters[index],id=book.source.id;if(!c)throw new Error('章节不存在。');if(c.paragraphs?.length)return c;if(!isChapterURL(c.url,id))throw new Error('章节链接无效。');return this.enqueue(id,async()=>{const s=await this.load(id,c.url,'chapter');if(s.requiresAccess)throw new Error('此章节需要在官方窗口登录或订阅。完成后返回 Cotex 点击“重试”。');if(new URL(s.url).pathname.replace(/\/$/,'')!==new URL(c.url).pathname.replace(/\/$/,''))throw new Error('原站跳转到了其他章节，请打开官方窗口检查后重试。');if(s.bookId&&s.bookId!==book.source.remoteId)throw new Error('章节与当前书籍不一致，已停止读取。');if(!s.paragraphs.length)throw new Error('原站尚未提供正文，请在官方窗口检查此章节。');const fonts=await this.fonts(s,id);return {...c,title:s.chapterTitle||c.title,paragraphs:s.paragraphs,fonts,encoded:!!s.encoded,locked:false};});}
 async refresh(book){const next=await this.add(book.source.id,book.source.remoteId);return {...withCatalog(book,next.chapters),fonts:next.fonts||book.fonts};}
 close(){this.closing=true;for(const p of this.popups)if(!p.isDestroyed())p.destroy();this.popups.clear();for(const e of this.entries.values()){if(!e.view.webContents.isDestroyed())e.view.webContents.close();if(!e.window.isDestroyed())e.window.destroy();}for(const w of this.workers.values())if(!w.isDestroyed())w.destroy();this.entries.clear();this.workers.clear();}
}
module.exports={Platforms};
