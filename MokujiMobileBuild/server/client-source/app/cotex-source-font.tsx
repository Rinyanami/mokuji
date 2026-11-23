import {useEffect,useState} from 'react';
import type {SourceFont} from './reading-client';

const localFont=(font:SourceFont)=>font&&/^[a-f0-9]{24}$/.test(font.id)&&typeof font.data==='string'&&font.data.length<=2800000&&/^data:font\/(?:woff2?|otf|ttf);base64,[A-Za-z0-9+/]+={0,2}$/.test(font.data);

export default function CotexSourceFont({fonts,sourceUrl}:{fonts?:SourceFont[];sourceUrl?:string}){
  if(!fonts?.length)return null;
  return <FontSet key={fonts.map(f=>f.id).join('-')} fonts={fonts} sourceUrl={sourceUrl}/>;
}

function FontSet({fonts,sourceUrl}:{fonts:SourceFont[];sourceUrl?:string}){
  const [state,setState]=useState<'loading'|'ready'|'error'>('loading');
  const names=fonts.filter(localFont).map(f=>'MokujiCotex_'+f.id);
  useEffect(()=>{
    let active=true;const faces:FontFace[]=[];
    async function install(){
      try{
        if(fonts.length>4||fonts.some(f=>!localFont(f)))throw Error();
        for(const f of fonts){
          const face=new FontFace('MokujiCotex_'+f.id,'url("'+f.data+'")',{display:'block'});
          faces.push(face);await face.load();
        }
        if(active){for(const face of faces)document.fonts.add(face);setState('ready');}
      }catch{if(active)setState('error');}
    }
    void install();
    return ()=>{active=false;for(const face of faces)document.fonts.delete(face);};
  },[fonts]);
  // A selector local to this article leaves the workspace chrome, labels and icons unchanged.
  const token=names.join('-')||'invalid';
  const selector='article:has(> [data-mokuji-font="'+token+'"]) .duji-reader-paragraph p[data-p]';
  return <div data-mokuji-font={token} style={state==='ready'?{display:'none'}:undefined}>
    <style>{state==='ready'?selector+'{font-family:'+names.join(',')+',sans-serif}':selector+'{visibility:hidden}'}</style>
    {state==='loading'&&<span role="status">正在加载文档字体…</span>}
    {state==='error'&&<span role="alert">此设备未能显示文档字体。{sourceUrl&&/^https:\/\//.test(sourceUrl)&&<a href={sourceUrl} target="_blank" rel="noreferrer">打开原站</a>}</span>}
  </div>;
}

