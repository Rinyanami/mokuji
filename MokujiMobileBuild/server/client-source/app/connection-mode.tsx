import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Connection = { mode: 'desktop' | 'mobile' | 'server'; txtStorage: 'kodo' | 'sqlite'; offlineLocal?: boolean };
const Context=createContext<Connection | null>(null);
export const useConnection=()=>useContext(Context);

export function txtLocation(connection:Connection | null) {
  if (!connection) return '导入后，在当前设备即可直接离线阅读。';
  if (connection.offlineLocal) return '文件保存在当前设备的本地离线库中，无需连接电脑即可随时阅读。';
  const online=connection.mode==='server';
  if (connection.txtStorage==='kodo') return 'TXT 转为 UTF-8 后不超过 8 MiB 的正文保存在七牛。更大的 TXT 和 EPUB 保存在当前目次服务上。'+(online?'登录同一服务器网址即可续读。':'配对手机阅读时，电脑需保持在线。');
  return online?'文件保存在当前服务器。手机和电脑登录同一网址即可阅读。':'文件保存在这台电脑。手机配对后可读，电脑需保持在线。';
}

export function ConnectionProvider({children}:{children:ReactNode}) {
  const [value,setValue]=useState<Connection|null>(null);
  useEffect(()=>{
    const ctl=new AbortController();
    fetch('/api/connection-mode',{signal:ctl.signal,cache:'no-store'})
      .then(async res=>res.ok?await res.json():null)
      .then(info=>{
        if (!ctl.signal.aborted && info && ['desktop','mobile','server'].includes(info.mode) && ['sqlite','kodo'].includes(info.txtStorage)) setValue(info);
      }).catch(()=>{});
    return ()=>ctl.abort();
  },[]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
