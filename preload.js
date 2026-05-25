const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("appInfo", {
  version: "0.1.0",
});

contextBridge.exposeInMainWorld("appBridge", {
  openBatchesWindow: () => ipcRenderer.invoke("open-batches-window"),
  createBatch: (batchName) => ipcRenderer.invoke("create-batch", batchName),
  listBatches: () => ipcRenderer.invoke("list-batches"),
  listAvailableBatches: () => ipcRenderer.invoke("list-available-batches"),
  listBatchOrders: (batchId) => ipcRenderer.invoke("list-batch-orders", batchId),
  listBatchPreparedProductDetails: (payload) =>
    ipcRenderer.invoke("list-batch-prepared-product-details", payload),
  listBatchDetailedInfo: (payload) => ipcRenderer.invoke("list-batch-detailed-info", payload),
  listOrderBatchLinks: () => ipcRenderer.invoke("list-order-batch-links"),
  addOrderToBatch: (payload) => ipcRenderer.invoke("add-order-to-batch", payload),
  removeOrderFromBatch: (payload) => ipcRenderer.invoke("remove-order-from-batch", payload),
  moveOrderToBatch: (payload) => ipcRenderer.invoke("move-order-to-batch", payload),
  listBatchPersonalizedOrderIds: (payload) => ipcRenderer.invoke("list-batch-personalized-order-ids", payload),
  comparePreparedStudentsMissing: (payload) => ipcRenderer.invoke("compare-prepared-students-missing", payload),
  addMissingPreparedStudentsToBatch: (payload) =>
    ipcRenderer.invoke("add-missing-prepared-students-to-batch", payload),
  finalizeBatchPreparation: (payload) => ipcRenderer.invoke("finalize-batch-preparation", payload),
  refetchAndPrepareBatch: (payload) => ipcRenderer.invoke("refetch-and-prepare-batch", payload),
  moveProductDetailToPrintLater: (payload) =>
    ipcRenderer.invoke("move-product-detail-to-print-later", payload),
  constructBookDetails: (payload) => ipcRenderer.invoke("construct-book-details", payload),
  generateBooks: (payload) => ipcRenderer.invoke("generate-books", payload),
  openBatchProcessingFolder: (payload) => ipcRenderer.invoke("open-batch-processing-folder", payload),
  regenerateBooks: (payload) => ipcRenderer.invoke("regenerate-books", payload),
  listBatchVerifyStudents: (payload) => ipcRenderer.invoke("list-batch-verify-students", payload),
  openStudentPhotoFile: (payload) => ipcRenderer.invoke("open-student-photo-file", payload),
  regenerateStudentExternal: (payload) => ipcRenderer.invoke("regenerate-student-external", payload),
  analyzeBatchStudentDuplicates: (payload) => ipcRenderer.invoke("analyze-batch-student-duplicates", payload),
  setBatchProcessing: (payload) => ipcRenderer.invoke("set-batch-processing", payload),
  setBatchActive: (payload) => ipcRenderer.invoke("set-batch-active", payload),
  prepareBatchCompletion: (payload) => ipcRenderer.invoke("prepare-batch-completion", payload),
  listBatchStageStatus: (payload) => ipcRenderer.invoke("list-batch-stage-status", payload),
  setBatchCompleted: (payload) => ipcRenderer.invoke("set-batch-completed", payload),
  exportBatchBookDetailsExcel: (payload) => ipcRenderer.invoke("export-batch-bookdetails-excel", payload),
  deleteBatch: (batchId) => ipcRenderer.invoke("delete-batch", batchId),
});
