const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");

const BATCH_ROOT_DIR = process.env.BATCH_ROOT_DIR || "\\\\pixartnas\\home\\INTERNAL_PROCESSING\\BATCHES";
const REGISTRY_DB_PATH = path.join(BATCH_ROOT_DIR, "batch-registry.db");
const STATION_COUNT = 2;
const SLOTS_PER_BASKET = 12;
const stationStatePath = () => path.join(app.getPath("userData"), "sorting-station-state.json");

const DEFAULT_BUCKET_COLOURS = [
  "#800000",
  "#000075",
  "#dcbeff",
  "#fffac8",
  "#000000",
  "#3cb44b",
  "#42d4f4",
  "#f58231",
  "#f032e6",
  "#a9a9a9",
  "#ffe119",
  "#fabed4",
];

const DEFAULT_BASKET_COLOURS = [
  "#9A6324",
  "#f58231",
  "#fabed4",
  "#ffe119",
  "#3cb44b",
  "#42d4f4",
  "#4363d8",
  "#f032e6",
  "#000000",
  "#a9a9a9",
  "#dcbeff",
  "#e6194B",
];

let mainWindow = null;
let bucketColours = [...DEFAULT_BUCKET_COLOURS];
let basketColours = [...DEFAULT_BASKET_COLOURS];

const stationState = Array.from({ length: STATION_COUNT }, (_v, idx) => ({
  stationId: idx + 1,
  activeBatchId: null,
  selectedBucket: 1,
  selectedBasket: 1,
  arduino: {
    portPath: "",
    connected: false,
    baudRate: 9600,
    lastSlot: null,
    lastMessage: "",
    deviceId: "",
    syncArmed: false,
  },
  scanner: {
    mode: "keyboard",
    portPath: "",
    connected: false,
    baudRate: 9600,
    deviceId: "",
    syncArmed: false,
    lastScan: "",
  },
}));

const arduinoConnections = new Map();
const scannerConnections = new Map();

const clampStationId = (value) => {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1 || id > STATION_COUNT) {
    throw new Error("Invalid station id.");
  }
  return id;
};

const safeNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const asStationIndex = (stationId) => clampStationId(stationId) - 1;

const getStation = (stationId) => stationState[asStationIndex(stationId)];

const sanitizeStation = (state) => ({
  stationId: state.stationId,
  activeBatchId: state.activeBatchId,
  selectedBucket: state.selectedBucket,
  selectedBasket: state.selectedBasket,
  arduino: {
    portPath: state.arduino.portPath,
    connected: state.arduino.connected,
    baudRate: state.arduino.baudRate,
    lastSlot: state.arduino.lastSlot,
    lastMessage: state.arduino.lastMessage,
    deviceId: state.arduino.deviceId,
    syncArmed: state.arduino.syncArmed,
  },
  scanner: {
    mode: state.scanner.mode,
    portPath: state.scanner.portPath,
    connected: state.scanner.connected,
    baudRate: state.scanner.baudRate,
    deviceId: state.scanner.deviceId,
    syncArmed: state.scanner.syncArmed,
    lastScan: state.scanner.lastScan,
  },
});

const broadcastStation = (stationId, eventType, data = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const station = sanitizeStation(getStation(stationId));
  mainWindow.webContents.send("sorting:station-event", {
    stationId,
    eventType,
    data,
    station,
  });
};

const persistState = () => {
  try {
    const payload = {
      stations: stationState.map((s) => ({
        stationId: s.stationId,
        activeBatchId: s.activeBatchId,
        selectedBucket: s.selectedBucket,
        selectedBasket: s.selectedBasket,
        arduino: {
          portPath: s.arduino.portPath,
          baudRate: s.arduino.baudRate,
          deviceId: s.arduino.deviceId,
        },
        scanner: {
          mode: s.scanner.mode,
          portPath: s.scanner.portPath,
          baudRate: s.scanner.baudRate,
          deviceId: s.scanner.deviceId,
        },
      })),
    };
    fs.writeFileSync(stationStatePath(), JSON.stringify(payload, null, 2), "utf8");
  } catch (_error) {
    // Intentionally ignore persistence failures.
  }
};

const loadState = () => {
  try {
    const file = stationStatePath();
    if (!fs.existsSync(file)) return;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const stations = Array.isArray(parsed?.stations) ? parsed.stations : [];
    stations.forEach((saved) => {
      const id = safeNumber(saved?.stationId);
      if (!Number.isInteger(id) || id < 1 || id > STATION_COUNT) return;
      const state = getStation(id);
      state.activeBatchId = safeNumber(saved.activeBatchId);
      state.selectedBucket = Math.min(12, Math.max(1, Number(saved.selectedBucket) || 1));
      state.selectedBasket = Math.min(12, Math.max(1, Number(saved.selectedBasket) || 1));

      state.arduino.portPath = String(saved?.arduino?.portPath || "").trim();
      state.arduino.baudRate = Number(saved?.arduino?.baudRate) || 9600;
      state.arduino.deviceId = String(saved?.arduino?.deviceId || "").trim();

      state.scanner.mode = String(saved?.scanner?.mode || "keyboard") === "serial" ? "serial" : "keyboard";
      state.scanner.portPath = String(saved?.scanner?.portPath || "").trim();
      state.scanner.baudRate = Number(saved?.scanner?.baudRate) || 9600;
      state.scanner.deviceId = String(saved?.scanner?.deviceId || "").trim();
    });
  } catch (_error) {
    // Ignore malformed persisted state.
  }
};

const ensureRegistryDbPath = () => {
  if (!fs.existsSync(BATCH_ROOT_DIR)) {
    throw new Error(`Batch root not found at ${BATCH_ROOT_DIR}`);
  }
  if (!fs.existsSync(REGISTRY_DB_PATH)) {
    throw new Error(`Batch registry db not found at ${REGISTRY_DB_PATH}`);
  }
};

const readColourFile = () => {
  const localPath = path.resolve(__dirname, "..", "colour codes.txt");
  if (!fs.existsSync(localPath)) return;

  const lines = fs
    .readFileSync(localPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^#([0-9a-f]{6})$/i.test(line));

  if (lines.length >= 24) {
    bucketColours = lines.slice(0, 12);
    basketColours = lines.slice(12, 24);
  }
};

const parseQr = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return null;

  if (/^\d{43}$/.test(raw)) {
    return {
      kind: "structured43",
      raw,
      batchId: Number(raw.slice(23, 26)),
      bookId: Number(raw.slice(26, 31)),
      assignedFromQr: Number(raw.slice(33, 38)),
    };
  }

  const batchMatch = raw.match(/(?:batch|\bb)\D*(\d{1,5})/i);
  const bookMatch = raw.match(/(?:book|\bbk|\bid)\D*(\d{1,8})/i);
  if (batchMatch && bookMatch) {
    return {
      kind: "labeled",
      raw,
      batchId: Number(batchMatch[1]),
      bookId: Number(bookMatch[1]),
      assignedFromQr: null,
    };
  }

  return null;
};

const expectedSlotFromAssigned = (assignedNumber) => {
  const n = Number(assignedNumber);
  if (!Number.isInteger(n) || n <= 0) return null;
  return ((n - 1) % SLOTS_PER_BASKET) + 1;
};

const resolveColorNumber = (value, palette) => {
  const normalized = String(value || "").trim();
  const n = Number(normalized);
  if (Number.isInteger(n) && n >= 1 && n <= 12) return n;
  const idx = palette.findIndex((hex) => hex.toLowerCase() === normalized.toLowerCase());
  return idx >= 0 ? idx + 1 : null;
};

const withRegistryDb = (fn) => {
  ensureRegistryDbPath();
  const db = new Database(REGISTRY_DB_PATH, { readonly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
};

const getBatchRow = (batchId) =>
  withRegistryDb((db) =>
    db
      .prepare(
        `SELECT id, batch_name, status, active, created_at, db_path
         FROM batches
         WHERE id = ?`
      )
      .get(batchId)
  );

const withBatchDb = (batchId, fn) => {
  const batch = getBatchRow(batchId);
  if (!batch) throw new Error("Selected batch not found.");
  if (String(batch.status) !== "processing") {
    throw new Error("Selected batch is not in processing stage.");
  }
  if (!batch.db_path || !fs.existsSync(batch.db_path)) {
    throw new Error("Batch database path is missing.");
  }

  const db = new Database(batch.db_path);
  try {
    return fn(db, batch);
  } finally {
    db.close();
  }
};

const listProcessingBatches = () =>
  withRegistryDb((db) =>
    db
      .prepare(
        `SELECT id, batch_name, status, active, created_at, db_path
         FROM batches
         WHERE status = 'processing'
         ORDER BY datetime(created_at) DESC, id DESC`
      )
      .all()
  );

const disconnectPort = async (map, stationId, stateNode) => {
  const existing = map.get(stationId);
  if (!existing) return;

  map.delete(stationId);
  try {
    existing.port.removeAllListeners();
    existing.parser.removeAllListeners();
    if (existing.port.isOpen) {
      await new Promise((resolve) => existing.port.close(() => resolve()));
    }
  } catch (_error) {
    // no-op
  }

  stateNode.connected = false;
};

const extractSlotFromMessage = (line) => {
  const clean = String(line || "").trim();
  if (!clean) return null;

  if (/^\d{1,2}$/.test(clean)) {
    const n = Number(clean);
    if (n >= 1 && n <= 12) return n;
  }

  try {
    const parsed = JSON.parse(clean);
    const value = Number(parsed?.slot);
    if (Number.isInteger(value) && value >= 1 && value <= 12) {
      return value;
    }
  } catch (_error) {
    // ignore non-json
  }

  const match = clean.match(/(?:slot|s)\s*[:=\-]\s*(\d{1,2})/i);
  if (match) {
    const n = Number(match[1]);
    if (n >= 1 && n <= 12) return n;
  }

  return null;
};

const handleScannerLine = (stationId, line, source) => {
  const state = getStation(stationId);
  const value = String(line || "").trim();
  if (!value) return;

  if (state.scanner.syncArmed) {
    state.scanner.syncArmed = false;
    state.scanner.deviceId = value;
    persistState();
    broadcastStation(stationId, "scanner-synced", { source, value });
    return { consumedForSync: true, deviceId: value };
  }

  state.scanner.lastScan = value;
  broadcastStation(stationId, "scanner-line", { source, value });
  return { consumedForSync: false, value };
};

const handleArduinoLine = (stationId, line) => {
  const state = getStation(stationId);
  const value = String(line || "").trim();
  if (!value) return;

  state.arduino.lastMessage = value;
  const slot = extractSlotFromMessage(value);
  if (slot) {
    state.arduino.lastSlot = slot;
  }

  if (state.arduino.syncArmed) {
    state.arduino.syncArmed = false;
    const idMatch = value.match(/ARDUINO(?:_|\s)?ID\s*[:=]\s*(.+)$/i);
    state.arduino.deviceId = (idMatch ? idMatch[1] : value).trim();
    persistState();
    broadcastStation(stationId, "arduino-synced", { value, slot });
    return;
  }

  if (/ARDUINO(?:_|\s)?ID\s*[:=]/i.test(value)) {
    const idMatch = value.match(/ARDUINO(?:_|\s)?ID\s*[:=]\s*(.+)$/i);
    state.arduino.deviceId = String(idMatch?.[1] || "").trim();
    persistState();
  }

  broadcastStation(stationId, "arduino-line", { value, slot });
};

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1200,
    minHeight: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
};

ipcMain.handle("sorting:get-initial-data", () => ({
  ok: true,
  data: {
    batchRoot: BATCH_ROOT_DIR,
    registryPath: REGISTRY_DB_PATH,
    bucketColours,
    basketColours,
    stations: stationState.map(sanitizeStation),
  },
}));

ipcMain.handle("sorting:list-processing-batches", () => {
  try {
    const rows = listProcessingBatches();
    return { ok: true, data: rows };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to load processing batches." };
  }
});

ipcMain.handle("sorting:list-serial-ports", async () => {
  try {
    const ports = await SerialPort.list();
    return {
      ok: true,
      data: ports.map((port) => ({
        path: port.path,
        manufacturer: port.manufacturer || "",
        serialNumber: port.serialNumber || "",
        pnpId: port.pnpId || "",
        vendorId: port.vendorId || "",
        productId: port.productId || "",
      })),
    };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to list serial ports." };
  }
});

ipcMain.handle("sorting:connect-arduino", async (_event, payload) => {
  try {
    const stationId = clampStationId(payload?.stationId);
    const portPath = String(payload?.portPath || "").trim();
    const baudRate = Number(payload?.baudRate) || 9600;
    if (!portPath) return { ok: false, message: "Choose Arduino COM port." };

    for (const [otherId, conn] of arduinoConnections.entries()) {
      if (otherId !== stationId && conn.portPath === portPath) {
        return { ok: false, message: `Port ${portPath} is already used by Station ${otherId}.` };
      }
    }

    const state = getStation(stationId);
    await disconnectPort(arduinoConnections, stationId, state.arduino);

    const port = new SerialPort({ path: portPath, baudRate, autoOpen: true });
    const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

    parser.on("data", (line) => handleArduinoLine(stationId, line));
    port.on("error", (error) => broadcastStation(stationId, "arduino-error", { message: error.message }));
    port.on("close", () => {
      const current = getStation(stationId);
      current.arduino.connected = false;
      broadcastStation(stationId, "arduino-closed", {});
    });

    arduinoConnections.set(stationId, { port, parser, portPath });
    state.arduino.portPath = portPath;
    state.arduino.connected = true;
    state.arduino.baudRate = baudRate;
    persistState();
    broadcastStation(stationId, "arduino-connected", { portPath, baudRate });
    return { ok: true, data: sanitizeStation(state) };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to connect Arduino." };
  }
});

ipcMain.handle("sorting:disconnect-arduino", async (_event, payload) => {
  try {
    const stationId = clampStationId(payload?.stationId);
    const state = getStation(stationId);
    await disconnectPort(arduinoConnections, stationId, state.arduino);
    broadcastStation(stationId, "arduino-disconnected", {});
    return { ok: true, data: sanitizeStation(state) };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to disconnect Arduino." };
  }
});

ipcMain.handle("sorting:connect-scanner-serial", async (_event, payload) => {
  try {
    const stationId = clampStationId(payload?.stationId);
    const portPath = String(payload?.portPath || "").trim();
    const baudRate = Number(payload?.baudRate) || 9600;
    if (!portPath) return { ok: false, message: "Choose scanner COM port." };

    for (const [otherId, conn] of scannerConnections.entries()) {
      if (otherId !== stationId && conn.portPath === portPath) {
        return { ok: false, message: `Port ${portPath} is already used by Station ${otherId}.` };
      }
    }

    const state = getStation(stationId);
    await disconnectPort(scannerConnections, stationId, state.scanner);

    const port = new SerialPort({ path: portPath, baudRate, autoOpen: true });
    const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

    parser.on("data", (line) => handleScannerLine(stationId, line, "serial"));
    port.on("error", (error) => broadcastStation(stationId, "scanner-error", { message: error.message }));
    port.on("close", () => {
      const current = getStation(stationId);
      current.scanner.connected = false;
      broadcastStation(stationId, "scanner-closed", {});
    });

    scannerConnections.set(stationId, { port, parser, portPath });
    state.scanner.portPath = portPath;
    state.scanner.connected = true;
    state.scanner.baudRate = baudRate;
    state.scanner.mode = "serial";
    persistState();
    broadcastStation(stationId, "scanner-connected", { portPath, baudRate });
    return { ok: true, data: sanitizeStation(state) };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to connect scanner serial." };
  }
});

ipcMain.handle("sorting:disconnect-scanner-serial", async (_event, payload) => {
  try {
    const stationId = clampStationId(payload?.stationId);
    const state = getStation(stationId);
    await disconnectPort(scannerConnections, stationId, state.scanner);
    broadcastStation(stationId, "scanner-disconnected", {});
    return { ok: true, data: sanitizeStation(state) };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to disconnect scanner." };
  }
});

ipcMain.handle("sorting:set-scanner-mode", (_event, payload) => {
  try {
    const stationId = clampStationId(payload?.stationId);
    const mode = String(payload?.mode || "keyboard") === "serial" ? "serial" : "keyboard";
    const state = getStation(stationId);
    state.scanner.mode = mode;
    persistState();
    broadcastStation(stationId, "scanner-mode-updated", { mode });
    return { ok: true, data: sanitizeStation(state) };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to set scanner mode." };
  }
});

ipcMain.handle("sorting:arm-scanner-sync", (_event, payload) => {
  try {
    const stationId = clampStationId(payload?.stationId);
    const armed = Boolean(payload?.armed);
    const state = getStation(stationId);
    state.scanner.syncArmed = armed;
    broadcastStation(stationId, "scanner-sync-armed", { armed });
    return { ok: true, data: sanitizeStation(state) };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to arm scanner sync." };
  }
});

ipcMain.handle("sorting:arm-arduino-sync", (_event, payload) => {
  try {
    const stationId = clampStationId(payload?.stationId);
    const armed = Boolean(payload?.armed);
    const state = getStation(stationId);
    state.arduino.syncArmed = armed;
    broadcastStation(stationId, "arduino-sync-armed", { armed });
    return { ok: true, data: sanitizeStation(state) };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to arm arduino sync." };
  }
});

ipcMain.handle("sorting:register-keyboard-scan", (_event, payload) => {
  try {
    const stationId = clampStationId(payload?.stationId);
    const value = String(payload?.value || "").trim();
    if (!value) return { ok: false, message: "Scan value is empty." };
    const result = handleScannerLine(stationId, value, "keyboard");
    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to register keyboard scan." };
  }
});

ipcMain.handle("sorting:set-station-batch", (_event, payload) => {
  try {
    const stationId = clampStationId(payload?.stationId);
    const state = getStation(stationId);
    state.activeBatchId = safeNumber(payload?.batchId);
    persistState();
    broadcastStation(stationId, "station-batch-updated", { batchId: state.activeBatchId });
    return { ok: true, data: sanitizeStation(state) };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to set station batch." };
  }
});

ipcMain.handle("sorting:set-station-selection", (_event, payload) => {
  try {
    const stationId = clampStationId(payload?.stationId);
    const state = getStation(stationId);
    const bucket = Number(payload?.bucket);
    const basket = Number(payload?.basket);
    if (Number.isInteger(bucket) && bucket >= 1 && bucket <= 12) {
      state.selectedBucket = bucket;
    }
    if (Number.isInteger(basket) && basket >= 1 && basket <= 12) {
      state.selectedBasket = basket;
    }
    persistState();
    broadcastStation(stationId, "station-selection-updated", {
      bucket: state.selectedBucket,
      basket: state.selectedBasket,
    });
    return { ok: true, data: sanitizeStation(state) };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to set station selection." };
  }
});

ipcMain.handle("sorting:get-slot-progress", (_event, payload) => {
  try {
    const batchId = Number(payload?.batchId);
    const bucket = Number(payload?.bucket);
    const basket = Number(payload?.basket);
    if (!Number.isInteger(batchId) || batchId <= 0) return { ok: false, message: "Select valid batch." };
    if (!Number.isInteger(bucket) || bucket < 1 || bucket > 12) return { ok: false, message: "Select bucket 1-12." };
    if (!Number.isInteger(basket) || basket < 1 || basket > 12) return { ok: false, message: "Select basket 1-12." };

    const data = withBatchDb(batchId, (db) => {
      const rows = db
        .prepare(
          `SELECT assigned_number, sorting_status, colour_1, colour_2, school_name
           FROM school_student_books`
        )
        .all();

      const slots = Array.from({ length: 12 }, (_v, i) => ({
        slot: i + 1,
        total: 0,
        sorted: 0,
        schoolNames: [],
      }));

      rows.forEach((row) => {
        const rowBucket = resolveColorNumber(row.colour_1, bucketColours);
        const rowBasket = resolveColorNumber(row.colour_2, basketColours);
        if (rowBucket !== bucket || rowBasket !== basket) return;

        const slot = expectedSlotFromAssigned(row.assigned_number);
        if (!slot) return;
        const node = slots[slot - 1];
        node.total += 1;
        if (Number(row.sorting_status)) node.sorted += 1;
        const school = String(row.school_name || "").trim();
        if (school && !node.schoolNames.includes(school)) {
          node.schoolNames.push(school);
        }
      });

      return {
        slots,
        total: slots.reduce((sum, item) => sum + item.total, 0),
        sorted: slots.reduce((sum, item) => sum + item.sorted, 0),
      };
    });

    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to load slot progress." };
  }
});

ipcMain.handle("sorting:validate-scan", (_event, payload) => {
  try {
    const stationId = clampStationId(payload?.stationId);
    const qrValue = String(payload?.qrValue || "").trim();
    const selectedBatchId = Number(payload?.selectedBatchId);
    const selectedBucket = Number(payload?.selectedBucket);
    const selectedBasket = Number(payload?.selectedBasket);
    let arduinoSlot = Number(payload?.arduinoSlot);

    if (!qrValue) return { ok: false, message: "QR value is empty." };
    if (!Number.isInteger(selectedBatchId) || selectedBatchId <= 0) {
      return { ok: false, message: "Select active batch first." };
    }
    if (!Number.isInteger(selectedBucket) || selectedBucket < 1 || selectedBucket > 12) {
      return { ok: false, message: "Select bucket 1-12." };
    }
    if (!Number.isInteger(selectedBasket) || selectedBasket < 1 || selectedBasket > 12) {
      return { ok: false, message: "Select basket 1-12." };
    }

    if (!Number.isInteger(arduinoSlot) || arduinoSlot < 1 || arduinoSlot > 12) {
      arduinoSlot = Number(getStation(stationId).arduino.lastSlot);
    }
    if (!Number.isInteger(arduinoSlot) || arduinoSlot < 1 || arduinoSlot > 12) {
      return { ok: false, message: "Arduino slot is missing. Send slot 1-12 from Arduino." };
    }

    const parsedQr = parseQr(qrValue);
    if (!parsedQr) {
      return {
        ok: false,
        message: "QR format not recognized. Expected 43-digit project QR or labels containing batch/book ids.",
      };
    }

    if (!Number.isInteger(parsedQr.batchId) || !Number.isInteger(parsedQr.bookId)) {
      return { ok: false, message: "Unable to extract batch/book from QR." };
    }

    if (parsedQr.batchId !== selectedBatchId) {
      return {
        ok: false,
        message: `Batch mismatch. Scanned batch ${parsedQr.batchId}, selected batch ${selectedBatchId}.`,
        data: { parsedQr, arduinoSlot },
      };
    }

    const result = withBatchDb(selectedBatchId, (db, batch) => {
      const row = db
        .prepare(
          `SELECT book_id, school_id, school_name, student_id, student_name, name, assigned_number, colour_1, colour_2,
                  lamination_status, composing_status, sorting_status
           FROM school_student_books
           WHERE book_id = ?
           LIMIT 1`
        )
        .get(parsedQr.bookId);

      if (!row) {
        return {
          ok: false,
          message: `Book id ${parsedQr.bookId} not found in selected batch ${selectedBatchId}.`,
          data: { parsedQr, arduinoSlot },
        };
      }

      const expectedBucket = resolveColorNumber(row.colour_1, bucketColours);
      const expectedBasket = resolveColorNumber(row.colour_2, basketColours);
      const expectedSlot = expectedSlotFromAssigned(row.assigned_number);

      if (!expectedBucket || !expectedBasket || !expectedSlot) {
        return {
          ok: false,
          message: "Book mapping data is incomplete (colour/assigned_number).",
          data: { row, parsedQr, arduinoSlot },
        };
      }

      const matchesBucket = expectedBucket === selectedBucket;
      const matchesBasket = expectedBasket === selectedBasket;
      const matchesSlot = expectedSlot === arduinoSlot;

      if (!(matchesBucket && matchesBasket && matchesSlot)) {
        return {
          ok: false,
          message: `Wrong placement. Expected B${expectedBucket}-K${expectedBasket}-S${expectedSlot}, got B${selectedBucket}-K${selectedBasket}-S${arduinoSlot}.`,
          data: {
            parsedQr,
            row,
            expectedBucket,
            expectedBasket,
            expectedSlot,
            selectedBucket,
            selectedBasket,
            arduinoSlot,
          },
        };
      }

      const alreadySorted =
        Number(row.sorting_status) === 1 &&
        Number(row.lamination_status) === 1 &&
        Number(row.composing_status) === 1;
      if (!alreadySorted) {
        db.prepare(
          `UPDATE school_student_books
           SET lamination_status = 1,
               composing_status = 1,
               sorting_status = 1
           WHERE book_id = ?`
        ).run(row.book_id);
      }

      return {
        ok: true,
        message: alreadySorted
          ? `Already sorted earlier. Correct slot B${expectedBucket}-K${expectedBasket}-S${expectedSlot}.`
          : `Correct. Book placed in B${expectedBucket}-K${expectedBasket}-S${expectedSlot}.`,
        data: {
          batchId: batch.id,
          batchName: batch.batch_name,
          parsedQr,
          book: row,
          expectedBucket,
          expectedBasket,
          expectedSlot,
          selectedBucket,
          selectedBasket,
          arduinoSlot,
          alreadySorted,
        },
      };
    });

    broadcastStation(stationId, "scan-validated", result);
    return result;
  } catch (error) {
    return { ok: false, message: error.message || "Unable to validate scan." };
  }
});

app.whenReady().then(() => {
  readColourFile();
  loadState();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  for (const station of stationState) {
    await disconnectPort(arduinoConnections, station.stationId, station.arduino);
    await disconnectPort(scannerConnections, station.stationId, station.scanner);
  }
  persistState();
});
