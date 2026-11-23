import React,{useState} from 'react';
import {ExternalLink,BookOpen} from 'lucide-react';
const valid=f=>f&&/^[a-f0-9]{24}$/.test(f.id)&&typeof f.data==='string'&&f.data.length<2900000&&/^data:font\/(?:woff2?|otf);base64,[A-Za-z0-9+/=]+$/.test(f.data);
export const platformFont=fonts=>{const names=(fonts||[]).filter(valid).map(f=>'CotexFont_'+f.id);return names.length?names.join(',')+', "Microsoft YaHei", sans-serif':undefined;};
export function PlatformFonts({entries}){const fonts=[...new Map(entries.flatMap(e=>e?.fonts||[]).filter(valid).map(f=>[f.id,f])).values()];return fonts.length?<style>{fonts.map(f=>'@font-face{font-family:CotexFont_'+f.id+';src:url("'+f.data+'");font-display:block;font-weight:400;}').join('\n')}</style>:null;}
export function PlatformActions({source,onError}){const [busy,setBusy]=useState(false);async function open(url){setBusy(true);try{await window.desk.platformOpen(source.id,url);}catch(e){onError(e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));}finally{setBusy(false);}}
 return <div className="platform-actions"><div><strong>{source.name}</strong><span>首次使用可先登录；也可以粘贴官方书籍链接。阅读位置保存在本机。</span></div><div className="platform-buttons"><button className="secondary" disabled={busy} onClick={()=>open()}><ExternalLink size={15}/>登录 / 官方窗口</button><button className="secondary" disabled={busy} onClick={()=>open(source.shelf)}><BookOpen size={15}/>官方书架</button></div><small>在官方窗口打开书籍详情或正文，点击顶部“加入 Cotex”。登录完成后返回这里重试即可。</small></div>;
}
