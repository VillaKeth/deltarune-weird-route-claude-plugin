const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("weird", {
  onJob: (fn) => ipcRenderer.on("job", (_e, data) => fn(data)),
  requestJob: () => ipcRenderer.send("job:request"),
  // No `answer` channel. Keys are read in the main process via
  // before-input-event, so the page has no say in the decision at all — and an
  // unused renderer->main channel on the boundary that grants permission is
  // exactly the kind of thing that should not exist "just in case".
  ready: () => ipcRenderer.send("ready"),
  onRender: (fn) => ipcRenderer.on("render", (_e, data) => fn(data)),
  onSfx: (fn) => ipcRenderer.on("sfx", (_e, file) => fn(file)),
});
