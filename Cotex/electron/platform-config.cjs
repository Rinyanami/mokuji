'use strict';
const PLATFORMS = [
 {id:'fanqie',name:'番茄小说',url:'https://fanqienovel.com/',home:'https://fanqienovel.com/library',shelf:'https://fanqienovel.com/bookshelf',description:'搜索或粘贴番茄书籍链接；也可在官方窗口登录、选书，再加入 Cotex。',refreshable:true,account:true},
 {id:'qidian',name:'起点中文网',url:'https://www.qidian.com/',home:'https://www.qidian.com/',shelf:'https://my.qidian.com/bookcase/',description:'使用官方网页及当前账号的阅读权限；首次使用请在官方窗口完成登录或验证。',refreshable:true,account:true}
];
function platform(id){const p=PLATFORMS.find(p=>p.id===id);if(!p)throw new Error('不支持的阅读平台。');return p;}
function httpsURL(value){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443'))return null;return u;}catch{return null;}}
function isPlatformURL(value,id){const u=httpsURL(value);if(!u)return false;return id==='fanqie'?(u.hostname==='fanqienovel.com'||u.hostname==='www.fanqienovel.com'):id==='qidian'?(u.hostname==='qidian.com'||u.hostname.endsWith('.qidian.com')):false;}
function identifyPlatform(value){return PLATFORMS.find(p=>isPlatformURL(value,p.id))?.id||null;}
function isLoginURL(value,id){if(isPlatformURL(value,id))return true;const u=httpsURL(value);if(!u)return false;return id==='qidian'?['graph.qq.com','xui.ptlogin2.qq.com','ssl.ptlogin2.qq.com','ui.ptlogin2.qq.com','ptlogin2.qq.com','open.weixin.qq.com','aq.qq.com'].includes(u.hostname):['sso.douyin.com','sso.toutiao.com','passport.snssdk.com'].includes(u.hostname);}
function bookID(value,id){platform(id);const raw=String(value||'').trim();if(/^\d{1,22}$/.test(raw))return raw;if(!isPlatformURL(raw,id))throw new Error('请粘贴该平台的官方书籍详情页链接。');const u=new URL(raw);const m=id==='fanqie'?u.pathname.match(/^\/page\/(\d{1,22})\/?$/):u.pathname.match(/^\/(?:book|info)\/(\d{1,22})(?:\/.*)?$/);if(!m)throw new Error('请使用书籍详情页链接；阅读页可在官方窗口点击“加入 Cotex”。');return m[1];}
function bookURL(id,remoteId){const n=bookID(remoteId,id);return id==='fanqie'?'https://fanqienovel.com/page/'+n:'https://www.qidian.com/book/'+n+'/';}
function isChapterURL(value,id){if(!isPlatformURL(value,id))return false;const p=new URL(value).pathname;return id==='fanqie'?/^\/reader\/\d{1,22}\/?$/.test(p):/^\/chapter\/[^/]+\/[^/]+\/?$/.test(p)||/^\/book\/\d+\/\d+\/?$/.test(p);}
function searchURL(id,query){const p=platform(id);const q=String(query||'').trim().slice(0,120);return !q?p.home:id==='fanqie'?'https://fanqienovel.com/search/'+encodeURIComponent(q):'https://www.qidian.com/search?kw='+encodeURIComponent(q);}
function isFontURL(value,id){const u=httpsURL(value);if(!u||!/\.(woff2?|otf|ttf)(?:$|\?)/i.test(u.pathname))return false;return id==='fanqie'?['bytetos.com','fqnovelstatic.com','byteimg.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h)):['qidian.com','qdmm.com','qpic.cn','gtimg.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h));}
module.exports={PLATFORMS,platform,httpsURL,isPlatformURL,identifyPlatform,isLoginURL,bookID,bookURL,isChapterURL,searchURL,isFontURL};
