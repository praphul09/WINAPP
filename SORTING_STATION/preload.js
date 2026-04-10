const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sortingBridge", {
  getInitialData: () => ipcRenderer.invoke("sorting:get-initial-data"),
  listProcessingBatches: () => ipcRenderer.invoke("sorting:list-processing-batches"),
  listSerialPorts: () => ipcRenderer.invoke("sorting:list-serial-ports"),
  connectArduino: (payload) => ipcRenderer.invoke("sorting:connect-arduino", payload),
  disconnectArduino: (payload) => ipcRenderer.invoke("sorting:disconnect-arduino", payload),
  connectScannerSerial: (payload) => ipcRenderer.invoke("sorting:connect-scanner-serial", payload),
  disconnectScannerSerial: (payload) => ipcRenderer.invoke("sorting:disconnect-scanner-serial", payload),
  setScannerMode: (payload) => ipcRenderer.invoke("sorting:set-scanner-mode", payload),
  armScannerSync: (payload) => ipcRenderer.invoke("sorting:arm-scanner-sync", payload),
  armArduinoSync: (payload) => ipcRenderer.invoke("sorting:arm-arduino-sync", payload),
  registerKeyboardScan: (payload) => ipcRenderer.invoke("sorting:register-keyboard-scan", payload),
  setStationBatch: (payload) => ipcRenderer.invoke("sorting:set-station-batch", payload),
  setStationSelection: (payload) => ipcRenderer.invoke("sorting:set-station-selection", payload),
  validateScan: (payload) => ipcRenderer.invoke("sorting:validate-scan", payload),
  getSlotProgress: (payload) => ipcRenderer.invoke("sorting:get-slot-progress", payload),
  onStationEvent: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("sorting:station-event", listener);
    return () => ipcRenderer.removeListener("sorting:station-event", listener);
  },
});
