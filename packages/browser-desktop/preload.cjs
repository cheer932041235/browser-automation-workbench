const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('browser',{command:(action,data)=>ipcRenderer.invoke('browser-command',action,data),onState:fn=>ipcRenderer.on('browser-state',(_,state)=>fn(state)),onError:fn=>ipcRenderer.on('browser-error',(_,message)=>fn(message))});
