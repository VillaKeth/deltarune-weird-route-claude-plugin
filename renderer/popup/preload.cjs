const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("weird", {
  onJob: (fn) => ipcRenderer.on("job", (_e, data) => fn(data)),
  requestJob: () => ipcRenderer.send("job:request"),
  answer: (choice) => ipcRenderer.send("choice", choice),
  ready: () => ipcRenderer.send("ready"),
});
