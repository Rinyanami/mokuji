const test=require('node:test'),assert=require('node:assert/strict');
const {bookID,bookURL,identifyPlatform,isPlatformURL,isLoginURL,isChapterURL,isFontURL}=require('../electron/platform-config.cjs');
const {withCatalog}=require('../electron/sources.cjs');
test('official platform URLs reject credentials, insecure schemes, lookalike hosts and arbitrary font endpoints',()=>{
 assert.equal(bookID('https://fanqienovel.com/page/7143038691944959011?source=share','fanqie'),'7143038691944959011');
 assert.equal(bookID('https://book.qidian.com/info/1010868264/','qidian'),'1010868264');
 for(const bad of ['https://qidian.com.evil.test/book/123/','https://evil.test/?q=qidian.com','http://www.qidian.com/book/123','https://user:secret@www.qidian.com/book/123','https://www.qidian.com:8080/book/123','file:///C:/private.txt'])assert.equal(isPlatformURL(bad,'qidian'),false,bad);
 assert.equal(identifyPlatform('https://fanqienovel.com/reader/123'),'fanqie');
 assert.throws(()=>bookID('https://fanqienovel.com/reader/123','fanqie'),/详情页/);
 assert.equal(isChapterURL('https://www.qidian.com/chapter/123/456/','qidian'),true);
 assert.equal(isChapterURL('https://www.qidian.com/book/123/','qidian'),false);
 assert.equal(isLoginURL('https://xui.ptlogin2.qq.com/cgi-bin/xlogin','qidian'),true);
 assert.equal(isLoginURL('https://xui.ptlogin2.qq.com.evil.test/','qidian'),false);
 assert.equal(isFontURL('https://lf6-awef.bytetos.com/obj/font.woff2','fanqie'),true);
 assert.equal(isFontURL('https://127.0.0.1/font.woff2','fanqie'),false);
 assert.equal(isFontURL('https://lf6-awef.bytetos.com/obj/font.js','fanqie'),false);
 assert.equal(bookURL('qidian','123'),'https://www.qidian.com/book/123/');
});
test('catalogue refresh retains encoded fonts, cached content, bookmarks and progress when chapters move',()=>{
 const font={id:'a'.repeat(24),data:'data:font/woff2;base64,AA=='};
 const book={chapters:[{url:'https://fanqienovel.com/reader/1',title:'一',paragraphs:['缓存正文'],fonts:[font],encoded:true}],progress:{chapter:0,paragraph:3},bookmarks:[{chapter:0,paragraph:2}],collapsed:[0]};
 const next=withCatalog(book,[{url:'https://fanqienovel.com/reader/0',title:'序章'},{url:'https://fanqienovel.com/reader/1',title:'一'}]);
 assert.equal(next.progress.chapter,1);assert.equal(next.progress.paragraph,3);assert.equal(next.bookmarks[0].chapter,1);assert.deepEqual(next.chapters[1].fonts,[font]);assert.equal(next.chapters[1].encoded,true);assert.deepEqual(next.chapters[1].paragraphs,['缓存正文']);
});
