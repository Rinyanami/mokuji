const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('platformBrowser',{
 action:(action,value)=>ipcRenderer.invoke('platform-browser:action',action,value),
 onState:fn=>{const handle=(_,state)=>fn(state);ipcRenderer.on('platform-browser:state',handle);return()=>ipcRenderer.removeListener('platform-browser:state',handle);}
});
