import { useMemo } from 'react';
import QRCode from '../vendor/offline-qr';

export default function MobileQr({url,install=false}:{url:string;install?:boolean}) {
  const geometry=useMemo(()=>{
    const link=new URL(url);
    // A pairing code, credentials or query tokens must never enter the QR image.
    link.username='';link.password='';link.search='';link.hash='';
    const code=new QRCode(-1,0); // auto size, medium error correction
    code.addData(link.toString());code.make();
    const width=code.getModuleCount();
    const paths:string[]=[];
    for(let row=0;row<width;row++){
      for(let col=0;col<width;col++){
        if(code.isDark(row,col))paths.push(`M${col+4} ${row+4}h1v1h-1z`);
      }
    }
    return {width:width+8,path:paths.join('')};
  },[url]);
  return <figure className="mobile-qr">
    <svg xmlns="http://www.w3.org/2000/svg" width="172" height="172" viewBox={`0 0 ${geometry.width} ${geometry.width}`}
      role="img" aria-label={install?'目次手机安装页二维码':'手机访问网址二维码'} shapeRendering="crispEdges">
      <rect width={geometry.width} height={geometry.width} fill="white"/><path d={geometry.path} fill="#15261a"/>
    </svg><figcaption>{install?'手机扫码，选择安卓或 iPhone 安装方式。':'手机扫码打开，再输入配对码。'}</figcaption>
  </figure>;
}
