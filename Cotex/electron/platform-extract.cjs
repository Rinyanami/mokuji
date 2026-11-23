'use strict';
// Executed only inside a sandboxed official platform page. Returns book data, never credentials.
function extractPlatformPage(id) {
 const text=e=>(e?.textContent||'').replace(/\s+/g,' ').trim();
 const visible=e=>!!e&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden'&&!!e.getClientRects().length;
 const meta=name=>document.querySelector('meta[property="'+name+'"],meta[name="'+name+'"]')?.content||'';
 const isHost=u=>u.protocol==='https:'&&(id==='fanqie'?/^(www\.)?fanqienovel\.com$/.test(u.hostname):u.hostname==='qidian.com'||u.hostname.endsWith('.qidian.com'));
 const urlOf=a=>{try{const u=new URL(a.href,location.href);return isHost(u)?u.href:'';}catch{return '';}};
 const bookIdOf=u=>{try{return new URL(u).pathname.match(id==='fanqie'?/^\/page\/(\d+)/:/^\/(?:book|info)\/(\d+)/)?.[1]||'';}catch{return '';}};
 const chapterLink=u=>{try{return id==='fanqie'?/^\/reader\/\d+\/?$/.test(new URL(u).pathname):/^\/chapter\/[^/]+\/[^/]+\/?$/.test(new URL(u).pathname)||/^\/book\/\d+\/\d+\/?$/.test(new URL(u).pathname);}catch{return false;}};
 const anchors=[...document.querySelectorAll('a[href]')];
 const root=id==='fanqie'?document.querySelector('.muye-reader-content'):document.querySelector('.read-content,.j_readContent,.chapter-content,#chaptercontent');
 const rawParagraphs=root&&visible(root)?[...root.querySelectorAll('p')].filter(visible).map(e=>e.innerText.trim()).filter(Boolean):[];
 const content=rawParagraphs.length?rawParagraphs:root&&visible(root)?root.innerText.split(/\n+/).map(x=>x.trim()).filter(Boolean):[];
 const pua=s=>/[\uE000-\uF8FF]/.test(s);
 const page=id==='fanqie'?window.__INITIAL_STATE__?.page:null;
 const chapterData=id==='fanqie'?window.__INITIAL_STATE__?.reader?.chapterData:null;
 const knownBook=anchors.find(a=>bookIdOf(urlOf(a))&&!chapterLink(urlOf(a)));
 const bid=bookIdOf(location.href)||String(chapterData?.bookId||chapterData?.book_id||page?.bookId||'')||bookIdOf(urlOf(knownBook||{}));
 const title=id==='fanqie'?(page?.bookName||text(document.querySelector('.muye-reader-nav-title'))||text(document.querySelector('h1'))):meta('og:novel:book_name')||text(document.querySelector('.book-info h1 em,.book-info h1,h1'));
 const author=id==='fanqie'?(page?.author||chapterData?.author||text(document.querySelector('.author-name'))):meta('og:novel:author')||text(document.querySelector('.writer,.book-info .author,.author a'));
 let chapterAnchors=anchors.filter(a=>chapterLink(urlOf(a))&&!/^最近更新|^开始阅读$|^上一章$|^下一章$/.test(text(a))); 
 if(id==='fanqie'){
  const inCatalog=chapterAnchors.filter(a=>a.closest('[class*="chapter-item"],[class*="chapter-list"],[class*="catalog"]'));
  chapterAnchors=inCatalog.length?inCatalog:chapterAnchors.filter(a=>!/^开始阅读$|^最近更新|^上一章$|^下一章$/.test(text(a)));
 }
 const seen=new Set();const chapters=[];
 for(const a of chapterAnchors){const u=urlOf(a);const t=a.getAttribute('title')||text(a);if(!t||seen.has(u)||/^上一章$|^下一章$|^目录$|^开始阅读$|^免费试读$/.test(t))continue;seen.add(u);chapters.push({title:t.replace(/\s*VIP\s*/ig,' ').trim(),url:u,locked:false,vip:/vip/i.test(a.outerHTML),paragraphs:null});}
 const items=[];const itemIds=new Set();
 for(const a of anchors){const u=urlOf(a),remoteId=bookIdOf(u);if(!remoteId||itemIds.has(remoteId)||chapterLink(u))continue;const t=a.getAttribute('title')||text(a)||a.querySelector('img')?.alt||'';if(!t||/^首页|^开始阅读|^免费阅读|^继续阅读|^书籍详情$/.test(t))continue;itemIds.add(remoteId);const row=a.closest('li,[class*="book-item"],[class*="book-info"],[class*="book-mid"],[class*="book-detail"]');items.push({sourceId:id,remoteId,title:t.slice(0,160),author:text(row?.querySelector('[class*="author"],.writer')).replace(/^作者[:：]\s*/,''),description:text(row?.querySelector('[class*="desc"],[class*="abstract"],.intro')).slice(0,160),url:u});if(items.length>=50)break;}
 const fontDefs=[];const fontSeen=new Set();
 const collect=rules=>{for(const rule of rules){if(rule.type===5){const family=rule.style.getPropertyValue('font-family').replace(/["']/g,'').trim();const weight=rule.style.getPropertyValue('font-weight');if(weight&&!['400','normal'].includes(weight))continue;const src=rule.style.getPropertyValue('src');const m=[...src.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map(m=>m[1]);const u=m.find(u=>/\.woff2(?:$|\?)/.test(u))||m[0];if(u&&!fontSeen.has(family)){fontSeen.add(family);fontDefs.push({family,url:new URL(u,location.href).href});}}else if(rule.cssRules)collect(rule.cssRules);}};
 for(const sheet of document.styleSheets)try{collect(sheet.cssRules);}catch{}
 const fontFamily=root?getComputedStyle(root).fontFamily:'';
 const accessNodes=[...document.querySelectorAll('[class*="paywall"],[class*="subscribe-guide"],[class*="vip-limit"],[class*="purchase"],.j_subscribe,.subscribe-btn')].filter(visible);
 const accessText=accessNodes.map(text).join(' ');
 const bodyText=document.body?.innerText||'';
 const requiresAccess=[true,1,"1","true"].includes(chapterData?.needPay)||[true,1,"1","true"].includes(chapterData?.isChapterLock)||accessNodes.some(e=>/订阅|购买|付费|会员|解锁|登录/.test(text(e)))||(/订阅本章|购买本章|登录后(?:继续)?阅读|后续内容需|开通会员继续|开通会员.*畅读/.test(bodyText)&&content.join('').length<12000);
 const searchEmpty=/\/search(?:\/|$)/.test(location.pathname)&&/(?:没有搜索到相关结果|没有找到相关结果|暂无搜索结果|共\s*0\s*(?:项|条|本))/.test(bodyText);
 const checkpoint=!root&&!items.length&&!chapters.length&&(!bodyText.trim()||/安全验证|验证码|访问频繁|访问异常|人机验证/.test(bodyText));
 return {url:location.href,pageTitle:document.title,bookId:bid,title:String(title||'').slice(0,160),author:String(author||'').slice(0,100),description:String(page?.abstract||meta('description')||'').slice(0,300),chapters,items,paragraphs:content.slice(0,10000),chapterTitle:text(document.querySelector('.muye-reader-title')||document.querySelector('.j_chapterName,.chapter-title')||document.querySelector('h1')),fontDefs,fontFamily,encoded:pua(content.join('')),metadataEncoded:pua(title+author+JSON.stringify(items)),requiresAccess,accessMessage:accessText.slice(0,150),checkpoint,searchEmpty,hasNext:anchors.some(a=>visible(a)&&/下一页/.test(text(a))&&!a.classList.contains('disabled'))};
}
module.exports={extractPlatformPage};
