const STATION_COUNT = 2;
const stationsRoot = document.getElementById("stationsRoot");
const stationTemplate = document.getElementById("stationTemplate");
const refreshBatchesBtn = document.getElementById("refreshBatches");
const refreshPortsBtn = document.getElementById("refreshPorts");
const toggleStation1Btn = document.getElementById("toggleStation1");
const toggleStation2Btn = document.getElementById("toggleStation2");

const appState = {
  bucketColours: [],
  basketColours: [],
  batches: [],
  ports: [],
  stations: new Map(),
  hiddenStations: new Set(),
};

const ui = new Map();

const toneClass = (ok, msg) => {
  if (ok) return "ok";
  if (/mismatch|wrong|not found|invalid|error|unable|missing/i.test(String(msg || ""))) return "error";
  return "warn";
};

const nowLabel = () => new Date().toLocaleTimeString();

const safeText = (value) => String(value == null ? "" : value);

const createGridButton = (number, color, onClick) => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "grid-btn";
  btn.style.backgroundColor = color;
  btn.textContent = String(number);
  btn.addEventListener("click", onClick);
  return btn;
};

const addLog = (stationId, message, cls = "warn") => {
  const view = ui.get(stationId);
  if (!view) return;
  const item = document.createElement("p");
  item.className = `log-item ${cls}`;
  item.textContent = `[${nowLabel()}] ${message}`;
  view.logBox.prepend(item);
  while (view.logBox.children.length > 70) {
    view.logBox.removeChild(view.logBox.lastChild);
  }
};

const setStatus = (stationId, text) => {
  const view = ui.get(stationId);
  if (!view) return;
  view.stationStatus.textContent = `Status: ${text}`;
};

const getStationModel = (stationId) => appState.stations.get(stationId);

const updateStationModel = (stationData) => {
  if (!stationData) return;
  appState.stations.set(stationData.stationId, {
    ...(appState.stations.get(stationData.stationId) || {}),
    ...stationData,
  });
};

const renderBatchOptions = () => {
  for (const [stationId, view] of ui.entries()) {
    const model = getStationModel(stationId);
    const current = Number(model?.activeBatchId) || 0;
    view.batchSelect.innerHTML = `<option value="">Select batch</option>${appState.batches
      .map((b) => {
        const selected = Number(b.id) === current ? "selected" : "";
        const activeLabel = Number(b.active) ? " [ACTIVE]" : "";
        return `<option value="${b.id}" ${selected}>${b.id} - ${safeText(b.batch_name)}${activeLabel}</option>`;
      })
      .join("")}`;
  }
};

const renderTopbarToggleLabels = () => {
  if (toggleStation1Btn) {
    toggleStation1Btn.textContent = appState.hiddenStations.has(1) ? "Show Station 1" : "Hide Station 1";
  }
  if (toggleStation2Btn) {
    toggleStation2Btn.textContent = appState.hiddenStations.has(2) ? "Show Station 2" : "Hide Station 2";
  }
};

const updateLayoutMode = () => {
  const visibleCount = [...ui.values()].filter((view) => !appState.hiddenStations.has(view.stationId)).length;
  stationsRoot.classList.toggle("single-visible", visibleCount <= 1);
};

const hideStation = (stationId) => {
  if (appState.hiddenStations.size >= STATION_COUNT - 1) {
    addLog(stationId, "At least one station must remain visible.", "warn");
    return;
  }
  appState.hiddenStations.add(stationId);
  const view = ui.get(stationId);
  if (view) {
    view.root.classList.add("hidden");
    view.hideBtn.textContent = "Show Station";
  }
  renderTopbarToggleLabels();
  updateLayoutMode();
};

const showStation = (stationId) => {
  appState.hiddenStations.delete(stationId);
  const view = ui.get(stationId);
  if (view) {
    view.root.classList.remove("hidden");
    view.hideBtn.textContent = "Hide Station";
  }
  renderTopbarToggleLabels();
  updateLayoutMode();
};

const renderPortOptions = () => {
  for (const view of ui.values()) {
    const options = `<option value="">Select COM</option>${appState.ports
      .map((port) => `<option value="${port.path}">${port.path} ${safeText(port.manufacturer)}</option>`)
      .join("")}`;
    view.arduinoPort.innerHTML = options;
    view.scannerPort.innerHTML = options;
  }

  for (const [stationId, view] of ui.entries()) {
    const model = getStationModel(stationId);
    if (model?.arduino?.portPath) view.arduinoPort.value = model.arduino.portPath;
    if (model?.scanner?.portPath) view.scannerPort.value = model.scanner.portPath;
  }
};

const markActiveGrid = (stationId) => {
  const model = getStationModel(stationId);
  const view = ui.get(stationId);
  if (!model || !view) return;

  [...view.bucketGrid.children].forEach((node, idx) => {
    node.classList.toggle("active", idx + 1 === Number(model.selectedBucket));
  });
  [...view.basketGrid.children].forEach((node, idx) => {
    node.classList.toggle("active", idx + 1 === Number(model.selectedBasket));
  });
};

const renderStationMeta = (stationId) => {
  const view = ui.get(stationId);
  const model = getStationModel(stationId);
  if (!view || !model) return;

  view.scannerMode.value = model.scanner?.mode || "keyboard";
  view.arduinoMeta.textContent = `${model.arduino?.connected ? "Connected" : "Disconnected"} ${
    model.arduino?.portPath || ""
  } ${model.arduino?.deviceId ? `(ID: ${model.arduino.deviceId})` : ""} ${
    model.arduino?.lastSlot ? `Slot:${model.arduino.lastSlot}` : ""
  }`.trim();

  view.scannerMeta.textContent = `${model.scanner?.connected ? "Connected" : "Disconnected"} ${
    model.scanner?.portPath || ""
  } ${model.scanner?.deviceId ? `(ID: ${model.scanner.deviceId})` : ""}`.trim();

  view.lastScan.textContent = model.scanner?.lastScan || "-";
  view.slotInput.placeholder = model.arduino?.lastSlot ? `Auto: ${model.arduino.lastSlot}` : "Auto from Arduino";

  markActiveGrid(stationId);
};

const renderSlots = (stationId, slots) => {
  const view = ui.get(stationId);
  if (!view) return;

  view.slotGrid.innerHTML = "";
  slots.forEach((node) => {
    const tile = document.createElement("div");
    tile.className = "slot-tile";
    if (node.total === 0) {
      tile.classList.add("empty");
    } else if (node.sorted >= node.total) {
      tile.classList.add("complete");
    } else {
      tile.classList.add("partial");
    }
    const schools = Array.isArray(node.schoolNames) ? node.schoolNames : [];
    const schoolLabel =
      schools.length === 0
        ? "-"
        : schools.length <= 2
        ? schools.join(", ")
        : `${schools.slice(0, 2).join(", ")} +${schools.length - 2}`;

    tile.innerHTML = `<div>S${node.slot}</div><div>${node.sorted}/${node.total}</div><div class="slot-school">${schoolLabel}</div>`;
    view.slotGrid.appendChild(tile);
  });
};

const refreshSlotProgress = async (stationId) => {
  const model = getStationModel(stationId);
  if (!model) return;

  const batchId = Number(model.activeBatchId);
  const bucket = Number(model.selectedBucket);
  const basket = Number(model.selectedBasket);
  if (!Number.isInteger(batchId) || batchId <= 0) {
    renderSlots(
      stationId,
      Array.from({ length: 12 }, (_v, i) => ({ slot: i + 1, total: 0, sorted: 0 }))
    );
    return;
  }

  const result = await window.sortingBridge.getSlotProgress({ batchId, bucket, basket });
  if (!result?.ok) {
    addLog(stationId, result?.message || "Unable to load slot progress", "error");
    return;
  }

  renderSlots(stationId, result.data.slots || []);
};

const applyStationSelection = async (stationId, patch) => {
  const result = await window.sortingBridge.setStationSelection({ stationId, ...patch });
  if (!result?.ok) {
    addLog(stationId, result?.message || "Unable to update selection", "error");
    return;
  }
  updateStationModel(result.data);
  renderStationMeta(stationId);
  refreshSlotProgress(stationId);
};

const processScan = async (stationId, scanValue) => {
  const model = getStationModel(stationId);
  if (!model) return;

  const slotInputValue = Number(ui.get(stationId).slotInput.value);
  const slot = Number.isInteger(slotInputValue) && slotInputValue >= 1 && slotInputValue <= 12 ? slotInputValue : model.arduino?.lastSlot;

  const result = await window.sortingBridge.validateScan({
    stationId,
    qrValue: scanValue,
    selectedBatchId: model.activeBatchId,
    selectedBucket: model.selectedBucket,
    selectedBasket: model.selectedBasket,
    arduinoSlot: slot,
  });

  if (!result?.ok) {
    addLog(stationId, result?.message || "Validation failed", toneClass(false, result?.message));
    setStatus(stationId, "Validation error");
    return;
  }

  const cls = result.data?.alreadySorted ? "warn" : "ok";
  addLog(stationId, result.message || "Validated", cls);
  setStatus(stationId, "Scan validated");
  await refreshSlotProgress(stationId);
};

const bindStation = (stationId, root, bucketColours, basketColours) => {
  const view = {
    stationId,
    root,
    stationTitle: root.querySelector(".station-title"),
    stationStatus: root.querySelector(".station-status"),
    batchSelect: root.querySelector(".batch-select"),
    scannerMode: root.querySelector(".scanner-mode"),
    arduinoPort: root.querySelector(".arduino-port"),
    scannerPort: root.querySelector(".scanner-port"),
    arduinoConnectBtn: root.querySelector(".arduino-connect"),
    arduinoDisconnectBtn: root.querySelector(".arduino-disconnect"),
    scannerConnectBtn: root.querySelector(".scanner-connect"),
    scannerDisconnectBtn: root.querySelector(".scanner-disconnect"),
    scannerSyncBtn: root.querySelector(".scanner-sync"),
    arduinoSyncBtn: root.querySelector(".arduino-sync"),
    bucketGrid: root.querySelector(".bucket-grid"),
    basketGrid: root.querySelector(".basket-grid"),
    scanInput: root.querySelector(".scan-input"),
    slotInput: root.querySelector(".slot-input"),
    validateBtn: root.querySelector(".validate-btn"),
    arduinoMeta: root.querySelector(".arduino-meta"),
    scannerMeta: root.querySelector(".scanner-meta"),
    lastScan: root.querySelector(".last-scan"),
    slotGrid: root.querySelector(".slot-grid"),
    logBox: root.querySelector(".log-box"),
    hideBtn: root.querySelector(".station-hide-btn"),
  };

  view.stationTitle.textContent = `Station ${stationId}`;
  ui.set(stationId, view);

  view.hideBtn.addEventListener("click", () => {
    if (appState.hiddenStations.has(stationId)) {
      showStation(stationId);
      return;
    }
    hideStation(stationId);
  });

  for (let i = 1; i <= 12; i += 1) {
    view.bucketGrid.appendChild(
      createGridButton(i, bucketColours[i - 1], async () => {
        await applyStationSelection(stationId, { bucket: i });
      })
    );
    view.basketGrid.appendChild(
      createGridButton(i, basketColours[i - 1], async () => {
        await applyStationSelection(stationId, { basket: i });
      })
    );
  }

  view.validateBtn.addEventListener("click", async () => {
    const value = view.scanInput.value.trim();
    if (!value) {
      addLog(stationId, "Scan value is empty", "error");
      return;
    }

    const reg = await window.sortingBridge.registerKeyboardScan({ stationId, value });
    if (!reg?.ok) {
      addLog(stationId, reg?.message || "Unable to register scan", "error");
      return;
    }
    if (reg.data?.consumedForSync) {
      addLog(stationId, `Scanner synced: ${reg.data.deviceId}`, "ok");
      renderStationMeta(stationId);
      view.scanInput.value = "";
      return;
    }

    await processScan(stationId, value);
    view.scanInput.value = "";
  });

  view.scanInput.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    view.validateBtn.click();
  });

  view.batchSelect.addEventListener("change", async () => {
    const selected = Number(view.batchSelect.value);
    const result = await window.sortingBridge.setStationBatch({
      stationId,
      batchId: Number.isInteger(selected) && selected > 0 ? selected : null,
    });
    if (!result?.ok) {
      addLog(stationId, result?.message || "Unable to set batch", "error");
      return;
    }
    updateStationModel(result.data);
    renderStationMeta(stationId);
    addLog(stationId, `Batch changed to ${result.data.activeBatchId || "none"}`, "warn");
    refreshSlotProgress(stationId);
  });

  view.scannerMode.addEventListener("change", async () => {
    const mode = view.scannerMode.value;
    const result = await window.sortingBridge.setScannerMode({ stationId, mode });
    if (!result?.ok) {
      addLog(stationId, result?.message || "Unable to set scanner mode", "error");
      return;
    }
    updateStationModel(result.data);
    renderStationMeta(stationId);
  });

  view.arduinoConnectBtn.addEventListener("click", async () => {
    const portPath = view.arduinoPort.value;
    const result = await window.sortingBridge.connectArduino({ stationId, portPath, baudRate: 9600 });
    if (!result?.ok) {
      addLog(stationId, result?.message || "Unable to connect Arduino", "error");
      return;
    }
    updateStationModel(result.data);
    renderStationMeta(stationId);
    addLog(stationId, `Arduino connected: ${portPath}`, "ok");
  });

  view.arduinoDisconnectBtn.addEventListener("click", async () => {
    const result = await window.sortingBridge.disconnectArduino({ stationId });
    if (!result?.ok) {
      addLog(stationId, result?.message || "Unable to disconnect Arduino", "error");
      return;
    }
    updateStationModel(result.data);
    renderStationMeta(stationId);
    addLog(stationId, "Arduino disconnected", "warn");
  });

  view.scannerConnectBtn.addEventListener("click", async () => {
    if (view.scannerMode.value !== "serial") {
      addLog(stationId, "Set scanner mode to Serial before connecting COM port", "warn");
      return;
    }
    const portPath = view.scannerPort.value;
    const result = await window.sortingBridge.connectScannerSerial({ stationId, portPath, baudRate: 9600 });
    if (!result?.ok) {
      addLog(stationId, result?.message || "Unable to connect scanner", "error");
      return;
    }
    updateStationModel(result.data);
    renderStationMeta(stationId);
    addLog(stationId, `Scanner serial connected: ${portPath}`, "ok");
  });

  view.scannerDisconnectBtn.addEventListener("click", async () => {
    const result = await window.sortingBridge.disconnectScannerSerial({ stationId });
    if (!result?.ok) {
      addLog(stationId, result?.message || "Unable to disconnect scanner", "error");
      return;
    }
    updateStationModel(result.data);
    renderStationMeta(stationId);
    addLog(stationId, "Scanner serial disconnected", "warn");
  });

  view.scannerSyncBtn.addEventListener("click", async () => {
    const result = await window.sortingBridge.armScannerSync({ stationId, armed: true });
    if (!result?.ok) {
      addLog(stationId, result?.message || "Unable to arm scanner sync", "error");
      return;
    }
    updateStationModel(result.data);
    renderStationMeta(stationId);
    addLog(stationId, "Scanner sync armed. Next scan will bind scanner to this station.", "warn");
  });

  view.arduinoSyncBtn.addEventListener("click", async () => {
    const result = await window.sortingBridge.armArduinoSync({ stationId, armed: true });
    if (!result?.ok) {
      addLog(stationId, result?.message || "Unable to arm arduino sync", "error");
      return;
    }
    updateStationModel(result.data);
    renderStationMeta(stationId);
    addLog(stationId, "Arduino sync armed. Next Arduino message sets station Arduino ID.", "warn");
  });

  renderSlots(
    stationId,
    Array.from({ length: 12 }, (_v, i) => ({ slot: i + 1, total: 0, sorted: 0 }))
  );
};

const refreshBatches = async () => {
  const result = await window.sortingBridge.listProcessingBatches();
  if (!result?.ok) {
    for (const stationId of ui.keys()) {
      addLog(stationId, result?.message || "Unable to load batches", "error");
    }
    return;
  }
  appState.batches = Array.isArray(result.data) ? result.data : [];
  renderBatchOptions();
};

const refreshPorts = async () => {
  const result = await window.sortingBridge.listSerialPorts();
  if (!result?.ok) {
    for (const stationId of ui.keys()) {
      addLog(stationId, result?.message || "Unable to load ports", "error");
    }
    return;
  }
  appState.ports = Array.isArray(result.data) ? result.data : [];
  renderPortOptions();
};

const init = async () => {
  const initial = await window.sortingBridge.getInitialData();
  if (!initial?.ok) {
    alert(initial?.message || "Unable to initialize app");
    return;
  }

  const data = initial.data || {};
  appState.bucketColours = data.bucketColours || [];
  appState.basketColours = data.basketColours || [];

  (data.stations || []).forEach((station) => updateStationModel(station));

  for (let i = 1; i <= STATION_COUNT; i += 1) {
    const node = stationTemplate.content.firstElementChild.cloneNode(true);
    stationsRoot.appendChild(node);
    bindStation(i, node, appState.bucketColours, appState.basketColours);
    renderStationMeta(i);
  }

  await Promise.all([refreshBatches(), refreshPorts()]);

  for (const stationId of ui.keys()) {
    refreshSlotProgress(stationId);
  }

  refreshBatchesBtn.addEventListener("click", refreshBatches);
  refreshPortsBtn.addEventListener("click", refreshPorts);
  if (toggleStation1Btn) {
    toggleStation1Btn.addEventListener("click", () => {
      if (appState.hiddenStations.has(1)) showStation(1);
      else hideStation(1);
    });
  }
  if (toggleStation2Btn) {
    toggleStation2Btn.addEventListener("click", () => {
      if (appState.hiddenStations.has(2)) showStation(2);
      else hideStation(2);
    });
  }

  window.sortingBridge.onStationEvent((event) => {
    const stationId = Number(event?.stationId);
    if (!stationId || !ui.has(stationId)) return;

    updateStationModel(event.station);
    renderStationMeta(stationId);

    if (event.eventType === "scanner-line") {
      const val = event.data?.value;
      if (val) {
        const view = ui.get(stationId);
        view.scanInput.value = val;
        addLog(stationId, `Serial scan received: ${val}`, "warn");
        processScan(stationId, val);
      }
    }

    if (event.eventType === "arduino-line") {
      if (event.data?.slot) {
        const view = ui.get(stationId);
        view.slotInput.placeholder = `Auto: ${event.data.slot}`;
      }
    }

    if (event.eventType === "scanner-synced") {
      addLog(stationId, `Scanner synced with ID: ${event.data?.value}`, "ok");
    }

    if (event.eventType === "arduino-synced") {
      addLog(stationId, `Arduino synced. ID message: ${event.data?.value}`, "ok");
    }

    if (event.eventType === "arduino-error" || event.eventType === "scanner-error") {
      addLog(stationId, event.data?.message || "Device error", "error");
    }

    if (["scan-validated", "station-selection-updated", "station-batch-updated"].includes(event.eventType)) {
      refreshSlotProgress(stationId);
    }
  });

  setInterval(() => {
    for (const stationId of ui.keys()) {
      refreshSlotProgress(stationId);
    }
  }, 3000);

  renderTopbarToggleLabels();
  updateLayoutMode();
};

init();
