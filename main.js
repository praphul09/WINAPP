const { app, BrowserWindow, ipcMain, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { spawnSync } = require("child_process");
const console = require("console");

let mainWindow = null;
let batchesWindow = null;
let batchRegistryDb = null;

const BATCH_ROOT_DIR = "\\\\pixartnas\\home\\INTERNAL_PROCESSING\\BATCHES";
const BATCH_BACKUP_DIR = "\\\\pixartnas\\home\\INTERNAL_PROCESSING\\BATCHES_BACKUP";
const BATCH_PROCESSING_DIR = "\\\\pixartnas\\home\\INTERNAL_PROCESSING\\BATCH_PROCESSING";
const BOOK_DETAIL_JSON_PATH = "\\\\pixartnas\\home\\INTERNAL_PROCESSING\\BOOKDETAIL.json";
const BOOK_GENERATOR_SCRIPT_PATH = path.join(__dirname, "book_generator", "generate_books.py");
const MAX_BUCKETS = 12;
const BASKETS_PER_BUCKET = 12;
const STUDENTS_PER_BASKET = 12;
const TOTAL_BASKETS = MAX_BUCKETS * BASKETS_PER_BUCKET;
const MAX_ASSIGNABLE_UNITS = TOTAL_BASKETS * STUDENTS_PER_BASKET;
const BOOK_SIZE_ORDER = {
  BIG: 0,
  MEDIUM: 1,
  SMALL: 2,
};

const ensureBatchRegistrySchema = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('new', 'building', 'processing', 'completed')) DEFAULT 'new',
      active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0, 1)),
      inner_binder_generated INTEGER NOT NULL DEFAULT 0,
      cover_binder_generated INTEGER NOT NULL DEFAULT 0,
      db_path TEXT NOT NULL UNIQUE
    );
    CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);
    CREATE INDEX IF NOT EXISTS idx_batches_created_at ON batches(created_at);
    CREATE TABLE IF NOT EXISTS batch_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      order_number TEXT NOT NULL UNIQUE,
      school_id TEXT,
      school_name TEXT,
      order_date TEXT,
      added_at TEXT NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_batch_orders_batch_id ON batch_orders(batch_id);
    CREATE INDEX IF NOT EXISTS idx_batch_orders_order_number ON batch_orders(order_number);
  `);

  const columns = db.prepare("PRAGMA table_info(batches)").all();
  const hasActiveColumn = columns.some((column) => column.name === "active");
  if (!hasActiveColumn) {
    db.exec("ALTER TABLE batches ADD COLUMN active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0, 1));");
  }

  db.exec("UPDATE batches SET active = 0 WHERE status != 'processing' AND active != 0;");
  db.exec(`
    UPDATE batches
    SET active = 0
    WHERE active = 1
      AND id NOT IN (
        SELECT id
        FROM batches
        WHERE active = 1 AND status = 'processing'
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT 1
      );
  `);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_batches_single_active ON batches(active) WHERE active = 1;");
};

const getBatchRegistryDb = () => {
  if (batchRegistryDb) return batchRegistryDb;
  if (!fs.existsSync(BATCH_ROOT_DIR)) {
    throw new Error("Batch storage location not found.");
  }
  const registryPath = path.join(BATCH_ROOT_DIR, "batch-registry.db");
  batchRegistryDb = new Database(registryPath);
  ensureBatchRegistrySchema(batchRegistryDb);
  return batchRegistryDb;
};

const ensureBatchDbSchema = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS batch_info (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS batch_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      school_id TEXT,
      school_name TEXT,
      personalized TEXT,
      product_id TEXT,
      product_type TEXT,
      order_date TEXT,
      added_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS prepared_students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT,
      order_details_id TEXT,
      student_id TEXT,
      school_id TEXT,
      school_name TEXT,
      colour1 TEXT,
      colour2 TEXT,
      assigned_number INTEGER,
      class_id TEXT,
      class_name TEXT,
      student_name TEXT,
      dob TEXT,
      current_address TEXT,
      photo TEXT,
      guardian_name TEXT,
      guardian_mobile TEXT,
      guardian_image TEXT,
      sec_guardian_name TEXT,
      sec_guardian_mobile TEXT,
      sec_guardian_image TEXT,
      raw_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS prepared_classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id TEXT,
      class_name TEXT,
      school_id TEXT,
      school_name TEXT,
      raw_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS prepared_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT,
      school_id TEXT,
      name TEXT,
      type TEXT,
      raw_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS prepared_product_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT,
      product_id TEXT,
      school_id TEXT,
      class_id TEXT,
      name TEXT,
      covercode TEXT,
      innercode TEXT,
      raw_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nonp_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT,
      order_details_id TEXT,
      product_id TEXT,
      class_id TEXT,
      quantity INTEGER,
      school_id TEXT,
      raw_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nonp_order_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nonp_order_source_id TEXT,
      order_details_id TEXT,
      product_id TEXT,
      class_id TEXT,
      school_id TEXT,
      unit_index INTEGER,
      colour1 TEXT,
      colour2 TEXT,
      assigned_number INTEGER,
      raw_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS BookDetails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT,
      order_details_id TEXT,
      student_id TEXT,
      school_id TEXT,
      school_name TEXT,
      class_id TEXT,
      class_name TEXT,
      student_name TEXT,
      dob TEXT,
      current_address TEXT,
      photo TEXT,
      guardian_name TEXT,
      guardian_mobile TEXT,
      guardian_image TEXT,
      sec_guardian_name TEXT,
      sec_guardian_mobile TEXT,
      sec_guardian_image TEXT,
      product_id TEXT,
      name TEXT,
      covercode TEXT,
      innercode TEXT,
      personlized TEXT,
      real_time_print TEXT,
      spine_code TEXT,
      book_size TEXT,
      type TEXT,
      coverqr TEXT,
      innerqr TEXT,
      colour_1 TEXT,
      colour_2 TEXT,
      assigned_number INTEGER,
      nonp_order INTEGER NOT NULL DEFAULT 0,
      book_id INTEGER,
      cover_generated INTEGER NOT NULL DEFAULT 0,
      inner_generated INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS school_student_books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id TEXT,
      school_name TEXT,
      student_id TEXT,
      student_name TEXT,
      book_id INTEGER,
      name TEXT,
      innercode TEXT,
      outercode TEXT,
      assigned_number INTEGER,
      colour_1 TEXT,
      colour_2 TEXT,
      lamination_status INTEGER NOT NULL DEFAULT 0,
      composing_status INTEGER NOT NULL DEFAULT 0,
      sorting_status INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_school_student_books_school ON school_student_books(school_id, school_name);
    CREATE INDEX IF NOT EXISTS idx_school_student_books_student ON school_student_books(student_id, student_name);
    CREATE INDEX IF NOT EXISTS idx_school_student_books_book ON school_student_books(book_id, innercode);
  `);
};

const normalizePreparedStudents = (students) =>
  (Array.isArray(students) ? students : []).flatMap((item) => {
    const user = item || {};
    const student = user?.student || {};
    const classSection = student?.class_section || {};
    const studentClass = classSection?.class || {};
    const guardian = student?.guardian || {};
    const secGuardian = guardian?.sec_guardian || {};

    const orderIdsFromArray = Array.isArray(item?.order_ids)
      ? item.order_ids
          .map((id) => pickFirstValue(id))
          .filter((id) => Boolean(id))
      : [];

    const fallbackOrderId = pickFirstValue(
      item?.order_details_id,
      item?.order_detail_id,
      item?.order_id,
      item?.order_number,
      item?.order_details?.id,
      item?.order_detail?.id,
      item?.pivot?.order_details_id,
      item?.pivot?.order_detail_id,
      item?.student?.order_details_id,
      item?.student?.order_detail_id,
      item?.student?.order_details?.id,
      item?.student?.order_detail?.id
    );

    const resolvedOrderIds = orderIdsFromArray.length
      ? orderIdsFromArray
      : fallbackOrderId
        ? [fallbackOrderId]
        : [null];

    return resolvedOrderIds.map((orderDetailsId) => ({
      source_id: normalizeIdValue(item?.id) || null,
      order_details_id: normalizeIdValue(orderDetailsId) || null,
      student_id: normalizeIdValue(item?.student_id ?? user?.id) || null,
      school_id: normalizeIdValue(user?.school_id ?? item?.school_id) || null,
      school_name:
        user?.school_name ??
        item?.school_name ??
        user?.school?.name ??
        item?.school?.name ??
        null,
      colour1: item?.colour1 ?? null,
      colour2: item?.colour2 ?? null,
      assigned_number: item?.assigned_number ?? null,
      class_id: normalizeIdValue(studentClass?.id ?? classSection?.class_id) || null,
      class_name:
        studentClass?.full_name ||
        studentClass?.name ||
        classSection?.full_name ||
        classSection?.name ||
        null,
      student_name:
        user?.full_name ||
        `${user?.first_name || ""} ${user?.last_name || ""}`.trim() ||
        null,
      dob: user?.dob ?? null,
      current_address: user?.current_address ?? null,
      photo: user?.image ?? null,
      guardian_name:
        guardian?.full_name ||
        `${guardian?.first_name || ""} ${guardian?.last_name || ""}`.trim() ||
        null,
      guardian_mobile: guardian?.mobile ?? null,
      guardian_image: guardian?.image ?? null,
      sec_guardian_name:
        secGuardian?.sec_guardian_full_name ||
        `${secGuardian?.sec_guardian_first_name || ""} ${secGuardian?.sec_guardian_last_name || ""}`.trim() ||
        null,
      sec_guardian_mobile: secGuardian?.sec_guardian_mobile ?? null,
      sec_guardian_image: secGuardian?.sec_guardian_image ?? null,
      raw_json: JSON.stringify(item || {}),
    }));
  });

const assignPreparedStudentSlots = (students) => {
  const normalizedStudents = Array.isArray(students) ? students : [];
  if (normalizedStudents.length > MAX_ASSIGNABLE_UNITS) {
    return {
      ok: false,
      message: `Total students exceed capacity. Maximum allowed is ${MAX_ASSIGNABLE_UNITS}, received ${normalizedStudents.length}.`,
    };
  }

  const schoolGroups = [];
  const schoolIndex = new Map();
  normalizedStudents.forEach((student, index) => {
    const schoolId = String(student?.school_id || "").trim();
    if (!schoolId) {
      throw new Error(`Student at position ${index + 1} is missing school_id.`);
    }

    if (!schoolIndex.has(schoolId)) {
      schoolIndex.set(schoolId, schoolGroups.length);
      schoolGroups.push({ schoolId, students: [] });
    }

    schoolGroups[schoolIndex.get(schoolId)].students.push(student);
  });

  const requiredBaskets = schoolGroups.reduce(
    (total, group) => total + Math.ceil(group.students.length / STUDENTS_PER_BASKET),
    0
  );

  if (requiredBaskets > TOTAL_BASKETS) {
    return {
      ok: false,
      message: `School allocation exceeds capacity. Required baskets: ${requiredBaskets}, available baskets: ${TOTAL_BASKETS}.`,
    };
  }

  let nextBasketSlot = 0;
  const assignedStudents = [];
  for (const group of schoolGroups) {
    for (let index = 0; index < group.students.length; index += 1) {
      const slotIndex = nextBasketSlot + Math.floor(index / STUDENTS_PER_BASKET);
      const bucketNumber = Math.floor(slotIndex / BASKETS_PER_BUCKET) + 1;
      const basketNumber = (slotIndex % BASKETS_PER_BUCKET) + 1;
      const positionInBasket = (index % STUDENTS_PER_BASKET) + 1;
      const assignedNumber = slotIndex * STUDENTS_PER_BASKET + positionInBasket;

      assignedStudents.push({
        ...group.students[index],
        colour1: String(bucketNumber),
        colour2: String(basketNumber),
        assigned_number: assignedNumber,
      });
    }

    nextBasketSlot += Math.ceil(group.students.length / STUDENTS_PER_BASKET);
  }

  return {
    ok: true,
    data: {
      students: assignedStudents,
      schools_count: schoolGroups.length,
      baskets_used: requiredBaskets,
      buckets_used: Math.ceil(requiredBaskets / BASKETS_PER_BUCKET),
      next_basket_slot: nextBasketSlot,
    },
  };
};

const normalizePreparedProducts = (products) =>
  (Array.isArray(products) ? products : []).map((item) => ({
    source_id: normalizeIdValue(item?.id) || null,
    school_id: normalizeIdValue(item?.school_id) || null,
    name: item?.name ?? null,
    type: item?.type ?? item?.product_type ?? null,
    raw_json: JSON.stringify(item || {}),
  }));

const normalizePreparedClasses = (classes) =>
  (Array.isArray(classes) ? classes : []).map((item) => ({
    class_id: normalizeIdValue(item?.id ?? item?.class_id) || null,
    class_name: item?.name ?? item?.class_name ?? null,
    school_id: normalizeIdValue(item?.school_id) || null,
    school_name: item?.school_name ?? null,
    raw_json: JSON.stringify(item || {}),
  }));

const normalizePreparedProductDetails = (productDetails) =>
  (Array.isArray(productDetails) ? productDetails : []).map((item) => ({
    source_id: normalizeIdValue(item?.id) || null,
    product_id: normalizeIdValue(item?.product_id) || null,
    school_id: normalizeIdValue(item?.school_id) || null,
    class_id: normalizeIdValue(item?.class_id) || null,
    name: item?.name ?? null,
    covercode: item?.covercode ?? null,
    innercode: item?.innercode ?? null,
    raw_json: JSON.stringify(item || {}),
  }));

const normalizeNonpOrders = (orders) =>
  (Array.isArray(orders) ? orders : []).map((item) => ({
    source_id: normalizeIdValue(item?.id) || null,
    order_details_id: normalizeIdValue(item?.order_details_id) || null,
    product_id: normalizeIdValue(item?.product_id) || null,
    class_id: normalizeIdValue(item?.class_id) || null,
    quantity: item?.quantity ?? null,
    school_id: normalizeIdValue(item?.school_id) || null,
    raw_json: JSON.stringify(item || {}),
  }));

const assignNonpOrderSlots = (orders, startBasketSlot) => {
  const normalizedOrders = Array.isArray(orders) ? orders : [];
  const initialBasketSlot =
    Number.isInteger(startBasketSlot) && startBasketSlot >= 0 ? startBasketSlot : 0;

  const totalQuantity = normalizedOrders.reduce((total, order, index) => {
    const quantity = Number(order?.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new Error(`Invalid nonp order quantity at position ${index + 1}.`);
    }
    return total + Math.floor(quantity);
  }, 0);

  if (initialBasketSlot * STUDENTS_PER_BASKET + totalQuantity > MAX_ASSIGNABLE_UNITS) {
    return {
      ok: false,
      message: `Student and nonp order allocation exceeds capacity. Maximum allowed is ${MAX_ASSIGNABLE_UNITS} units.`,
    };
  }

  let nextBasketSlot = initialBasketSlot;
  const assignments = [];
  normalizedOrders.forEach((order, orderIndex) => {
    const quantity = Math.floor(Number(order?.quantity) || 0);
    if (quantity === 0) {
      return;
    }

    for (let index = 0; index < quantity; index += 1) {
      const slotIndex = nextBasketSlot + Math.floor(index / STUDENTS_PER_BASKET);
      const bucketNumber = Math.floor(slotIndex / BASKETS_PER_BUCKET) + 1;
      const basketNumber = (slotIndex % BASKETS_PER_BUCKET) + 1;
      const positionInBasket = (index % STUDENTS_PER_BASKET) + 1;
      const assignedNumber = slotIndex * STUDENTS_PER_BASKET + positionInBasket;

      assignments.push({
        nonp_order_source_id: order.source_id,
        order_details_id: order.order_details_id,
        product_id: order.product_id,
        class_id: order.class_id,
        school_id: order.school_id,
        unit_index: index + 1,
        colour1: String(bucketNumber),
        colour2: String(basketNumber),
        assigned_number: assignedNumber,
        raw_json: order.raw_json,
      });
    }

    nextBasketSlot += Math.ceil(quantity / STUDENTS_PER_BASKET);
  });

  return {
    ok: true,
    data: {
      assignments,
      quantity_count: totalQuantity,
      baskets_used: nextBasketSlot - initialBasketSlot,
      next_basket_slot: nextBasketSlot,
      order_groups_count: normalizedOrders.filter((order) => Math.floor(Number(order?.quantity) || 0) > 0).length,
    },
  };
};

const parseJsonSafely = (value) => {
  if (!value || typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const pickFirstValue = (...values) => {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
};

const normalizeIdValue = (value) => {
  let text = String(value ?? "").trim();
  if (!text) return "";

  // Upstream sometimes sends numeric IDs as "... .o"; treat that as ".0".
  text = text.replace(/\.o+$/i, (match) => `.${"0".repeat(match.length - 1)}`);

  const integerMatch = text.match(/^(\d+)$/);
  if (integerMatch) {
    return integerMatch[1].replace(/^0+(?=\d)/, "");
  }

  const decimalMatch = text.match(/^(\d+)\.(\d+)$/);
  if (!decimalMatch) {
    return text;
  }

  const integerPart = decimalMatch[1];
  const fractionalPart = decimalMatch[2];
  if (!/^0+$/.test(fractionalPart)) {
    return "";
  }
  return integerPart.replace(/^0+(?=\d)/, "");
};

const getProductOrderDetailsId = (product) => {
  const raw = parseJsonSafely(product?.raw_json) || {};
  return pickFirstValue(
    product?.order_details_id,
    raw?.order_details_id,
    raw?.order_detail_id,
    raw?.order_details?.id,
    raw?.order_detail?.id,
    raw?.pivot?.order_details_id,
    raw?.pivot?.order_detail_id
  );
};

const getStudentProductId = (student) => {
  const raw = parseJsonSafely(student?.raw_json) || {};
  return pickFirstValue(
    student?.product_id,
    raw?.product_id,
    raw?.product?.id,
    raw?.product?.product_id,
    raw?.order_details?.product_id,
    raw?.order_detail?.product_id
  );
};

const loadBookDetailConfig = () => {
  if (!fs.existsSync(BOOK_DETAIL_JSON_PATH)) {
    throw new Error("BOOKDETAIL.json not found.");
  }

  const raw = fs.readFileSync(BOOK_DETAIL_JSON_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("BOOKDETAIL.json is invalid.");
  }
  return parsed;
};

const digitsOnly = (value) => String(value ?? "").replace(/\D/g, "");

const zeroPad = (value, length) => digitsOnly(value).padStart(length, "0").slice(-length);

const getOrderDetailsPersonalizedValue = (student) => {
  const raw = parseJsonSafely(student?.raw_json) || {};
  return (
    raw?.personalized ??
    raw?.is_personalized ??
    raw?.order_details?.personalized ??
    raw?.order_details?.is_personalized ??
    raw?.order_detail?.personalized ??
    raw?.order_detail?.is_personalized ??
    raw?.student?.order_details?.personalized ??
    raw?.student?.order_detail?.personalized ??
    0
  );
};

const isTruthyPersonalized = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "y", "yes"].includes(normalized);
};

const getQrPerDigit = ({ isCover, orderDetailsPersonalized, innercodePer }) => {
  const normalizedPer = String(innercodePer || "").trim().toUpperCase();

  if (!isCover) {
    return normalizedPer === "Y" ? "1" : "0";
  }

  if (!isTruthyPersonalized(orderDetailsPersonalized)) {
    return "0";
  }

  return normalizedPer === "Y" ? "1" : "2";
};

const buildBookQrCode = ({
  isCover,
  orderDetailsPersonalized,
  innercodePer,
  studentId,
  innercode,
  schoolId,
  batchId,
  bookId,
  layerType,
  assignedNumber,
}) => {
  const normalizedPer = String(innercodePer || "").trim().toUpperCase();
  const isOrderDetailsPersonalized = isTruthyPersonalized(orderDetailsPersonalized);
  const normalizedStudentId = normalizeIdValue(studentId);
  const normalizedInnercode = normalizeIdValue(innercode);
  const normalizedSchoolId = normalizeIdValue(schoolId);
  const normalizedBatchId = normalizeIdValue(batchId);
  const normalizedBookId = normalizeIdValue(bookId);
  const normalizedLayerType = normalizeIdValue(layerType);
  const normalizedAssignedNumber = normalizeIdValue(assignedNumber);

  if (!isCover && (!isOrderDetailsPersonalized || normalizedPer !== "Y")) {
    return [
      "01",
      "0",
      "0",
      "00",
      zeroPad(normalizedInnercode, 9),
      "00000",
      "000",
      "00000",
      zeroPad(normalizedLayerType, 2),
      "00000",
      "00000",
    ].join("");
  }

  return [
    "01",
    isCover ? "1" : "0",
    getQrPerDigit({ isCover, orderDetailsPersonalized, innercodePer }),
    zeroPad(normalizedStudentId, 5).slice(0, 2),
    zeroPad(normalizedInnercode, 9),
    zeroPad(normalizedSchoolId, 5),
    zeroPad(normalizedStudentId, 5).slice(-3),
    zeroPad(normalizedBatchId, 3),
    zeroPad(normalizedBookId, 5),
    zeroPad(normalizedLayerType, 2),
    zeroPad(normalizedAssignedNumber, 5),
    "00000",
  ].join("");
};

const getBookPriority = (row) => {
  const per = pickFirstValue(row?.personlized).toUpperCase();
  const realTime = pickFirstValue(row?.real_time_print).toUpperCase();

  if (per === "Y") return 0;
  if (realTime === "Y") return 1;
  return 2;
};

const tableExists = (db, tableName) =>
  Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName)
  );

const getTableCount = (db, tableName) =>
  db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get()?.count ?? 0;

const getBatchActiveLabel = (active) => (Number(active) ? "Yes" : "No");

const formatBackupTimestamp = (date) =>
  `${String(date.getDate()).padStart(2, "0")}${String(date.getMonth() + 1).padStart(2, "0")}${String(
    date.getFullYear()
  ).slice(-2)}${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;

const backupBatchRegistry = (registryDb) => {
  const registryPath = path.join(BATCH_ROOT_DIR, "batch-registry.db");
  if (!fs.existsSync(registryPath)) {
    throw new Error("Batch registry file not found for backup.");
  }

  if (!fs.existsSync(BATCH_BACKUP_DIR)) {
    fs.mkdirSync(BATCH_BACKUP_DIR, { recursive: true });
  }

  const parsed = path.parse(registryPath);
  const suffix = formatBackupTimestamp(new Date());
  const backupPath = path.join(BATCH_BACKUP_DIR, `${parsed.name}-${suffix}${parsed.ext}`);

  registryDb.pragma("wal_checkpoint(FULL)");
  fs.copyFileSync(registryPath, backupPath);
  return backupPath;
};

const getPrintLaterBatchName = (date = new Date()) =>
  `later_print_${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(
    date.getDate()
  ).padStart(2, "0")}`;

const createBuildingBatchRecord = (registryDb, batchName) => {
  const rootDir = BATCH_ROOT_DIR;
  const safeBase = String(batchName || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9-_]/g, "")
    .replace(/-+/g, "-");
  if (!safeBase) {
    throw new Error("Batch name must include letters or numbers.");
  }

  const now = new Date();
  const timestampSuffix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate()
  ).padStart(2, "0")}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(
    now.getSeconds()
  ).padStart(2, "0")}`;
  const fileName = `${safeBase}-${timestampSuffix}.db`;
  const dbPath = path.join(rootDir, fileName);

  if (fs.existsSync(dbPath)) {
    throw new Error(`Batch database already exists: ${fileName}`);
  }

  let batchDb;
  const createdAt = new Date().toISOString();
  try {
    batchDb = new Database(dbPath);
    ensureBatchDbSchema(batchDb);
    batchDb.prepare("INSERT INTO batch_info (batch_name, created_at) VALUES (?, ?)").run(batchName, createdAt);

    const info = registryDb
      .prepare(`
        INSERT INTO batches (batch_name, created_at, status, active, db_path)
        VALUES (?, ?, 'building', 0, ?)
      `)
      .run(batchName, createdAt, dbPath);

    return {
      id: Number(info.lastInsertRowid),
      batch_name: batchName,
      created_at: createdAt,
      status: "building",
      active: 0,
      db_path: dbPath,
    };
  } finally {
    if (batchDb) {
      batchDb.close();
    }
  }
};

const getOrCreatePrintLaterBatch = (registryDb) => {
  const existing = registryDb
    .prepare(`
      SELECT id, batch_name, created_at, status, active, db_path
      FROM batches
      WHERE status = 'building' AND batch_name LIKE 'later_print%'
      ORDER BY id DESC
      LIMIT 1
    `)
    .get();

  if (existing) {
    return { batch: existing, created: false };
  }

  const batch = createBuildingBatchRecord(registryDb, getPrintLaterBatchName());
  backupBatchRegistry(registryDb);
  return { batch, created: true };
};

const runBookGenerator = ({ batchId, batchName }) => {
  if (!fs.existsSync(BOOK_GENERATOR_SCRIPT_PATH)) {
    return { ok: false, message: "Book generator script not found." };
  }

  const commands = [
    { command: "py", args: ["-3"] },
    { command: "python", args: [] },
  ];

  for (const candidate of commands) {
    const result = spawnSync(
      candidate.command,
      [
        ...candidate.args,
        BOOK_GENERATOR_SCRIPT_PATH,
        "--batch-id",
        String(batchId),
        "--batch-name",
        String(batchName || ""),
        "--registry-path",
        path.join(BATCH_ROOT_DIR, "batch-registry.db"),
      ],
      {
        encoding: "utf8",
        windowsHide: true,
      }
    );

    if (result.error) {
      continue;
    }

    if (result.status !== 0) {
      return {
        ok: false,
        message:
          String(result.stderr || "").trim() ||
          String(result.stdout || "").trim() ||
          "Book generation failed.",
      };
    }

    return {
      ok: true,
      data: {
        message: String(result.stdout || "").trim() || "Book generation completed.",
      },
    };
  }

  return { ok: false, message: "Python runtime not found. Install Python or ensure `python`/`py -3` is available." };
};

const openBatchProcessingFolder = async ({ batchId }) => {
  const normalizedBatchId = Number(batchId);
  if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
    return { ok: false, message: "Invalid batch id." };
  }

  const targetPath = path.join(BATCH_PROCESSING_DIR, String(normalizedBatchId));
  if (!fs.existsSync(targetPath)) {
    return {
      ok: false,
      message: `Batch processing folder not found: ${targetPath}`,
    };
  }

  const openResult = await shell.openPath(targetPath);
  if (openResult) {
    return { ok: false, message: openResult };
  }

  return {
    ok: true,
    data: {
      batch_id: normalizedBatchId,
      path: targetPath,
    },
  };
};

const constructBookDetails = ({ batchId }) => {
  const normalizedBatchId = Number(batchId);
  if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
    return { ok: false, message: "Invalid batch id." };
  }

  const registryDb = getBatchRegistryDb();
  const batch = registryDb
    .prepare("SELECT id, batch_name, status, db_path FROM batches WHERE id = ?")
    .get(normalizedBatchId);

  if (!batch) {
    return { ok: false, message: "Batch not found." };
  }
  if (batch.status !== "building") {
    return { ok: false, message: "Book details can only be constructed for batches with status 'building'." };
  }

  let batchDb;
  try {
    const bookDetailConfig = loadBookDetailConfig();
    batchDb = new Database(batch.db_path);
    ensureBatchDbSchema(batchDb);

    const students = batchDb.prepare("SELECT * FROM prepared_students ORDER BY id ASC").all();
    const nonpOrderAssignments = batchDb
      .prepare("SELECT * FROM nonp_order_assignments ORDER BY assigned_number ASC, id ASC")
      .all();
    const batchOrders = batchDb.prepare("SELECT * FROM orders ORDER BY id ASC").all();
    const productDetails = batchDb
      .prepare("SELECT * FROM prepared_product_details ORDER BY id ASC")
      .all();

    if (!students.length && !nonpOrderAssignments.length) {
      return { ok: false, message: "No prepared student or nonp assignment data found for this batch." };
    }

    const orderByOrderNumber = new Map();
    const schoolNameBySchoolId = new Map();
    students.forEach((student) => {
      const schoolId = normalizeIdValue(pickFirstValue(student?.school_id));
      const schoolName = pickFirstValue(student?.school_name);
      if (schoolId && schoolName && !schoolNameBySchoolId.has(schoolId)) {
        schoolNameBySchoolId.set(schoolId, schoolName);
      }
    });

    batchOrders.forEach((order) => {
      const orderNumber = normalizeIdValue(pickFirstValue(order?.order_number));
      const schoolId = normalizeIdValue(pickFirstValue(order?.school_id));
      const schoolName = pickFirstValue(order?.school_name);
      if (orderNumber && !orderByOrderNumber.has(orderNumber)) {
        orderByOrderNumber.set(orderNumber, order);
      }
      if (schoolId && schoolName && !schoolNameBySchoolId.has(schoolId)) {
        schoolNameBySchoolId.set(schoolId, schoolName);
      }
    });


    const productDetailMap = new Map();
    productDetails.forEach((detail) => {
      const productId = normalizeIdValue(pickFirstValue(detail?.product_id));
      const classId = normalizeIdValue(pickFirstValue(detail?.class_id));
      const schoolId = normalizeIdValue(pickFirstValue(detail?.school_id));
      if (!productId || !classId || !schoolId) {
        return;
      }
      const key = `${productId}::${classId}::${schoolId}`;
      if (!productDetailMap.has(key)) {
        productDetailMap.set(key, []);
      }
      productDetailMap.get(key).push(detail);
    });

    const rows = [];
    for (const student of students) {
      const orderDetailsId = normalizeIdValue(pickFirstValue(student?.order_details_id));
      const classId = normalizeIdValue(pickFirstValue(student?.class_id));
      const schoolId = normalizeIdValue(pickFirstValue(student?.school_id));
      if (!orderDetailsId) {
        return {
          ok: false,
          message: `Student ${student.student_name || student.student_id || student.id} is missing order_details_id.`,
        };
      }
      if (!classId) {
        return {
          ok: false,
          message: `Student ${student.student_name || student.student_id || student.id} is missing class_id.`,
        };
      }
      if (!schoolId) {
        return {
          ok: false,
          message: `Student ${student.student_name || student.student_id || student.id} is missing school_id.`,
        };
      }

      const order = orderByOrderNumber.get(orderDetailsId);
      if (!order) {
        return {
          ok: false,
          message: `No order found for student ${student.student_name || student.student_id || student.id} with order_details_id ${orderDetailsId}.`,
        };
      }

      const productId = normalizeIdValue(pickFirstValue(order?.product_id));
      if (!productId) {
        return {
          ok: false,
          message: `Order ${orderDetailsId} is missing product_id for student ${student.student_name || student.student_id || student.id}.`,
        };
      }
      

      const mappedDetails = productDetailMap.get(`${productId}::${classId}::${schoolId}`) || [];
      if (!mappedDetails.length) {
        return {
          ok: false,
          message: `No product details found for student ${student.student_name || student.student_id || student.id}, product ${productId}, class ${classId}, school ${schoolId}.`,
        };
      }

      mappedDetails.forEach((detail) => {
        const innercode = pickFirstValue(detail?.innercode);
        const config = bookDetailConfig[innercode];
        if (!config) {
          throw new Error(
            `Missing BOOKDETAIL configuration for innercode ${innercode || "(blank)"} in student ${student.student_name || student.student_id || student.id}.`
          );
        }
        rows.push({
          source_id: normalizeIdValue(student.source_id),
          order_details_id: orderDetailsId,
          student_id: normalizeIdValue(student.student_id),
          school_id: schoolId,
          school_name: student.school_name,
          class_id: classId,
          class_name: student.class_name,
          student_name: student.student_name,
          dob: student.dob,
          current_address: student.current_address,
          photo: student.photo,
          guardian_name: student.guardian_name,
          guardian_mobile: student.guardian_mobile,
          guardian_image: student.guardian_image,
          sec_guardian_name: student.sec_guardian_name,
          sec_guardian_mobile: student.sec_guardian_mobile,
          sec_guardian_image: student.sec_guardian_image,
          product_id: productId,
          name: detail.name,
          covercode: detail.covercode,
          innercode,
          personlized: pickFirstValue(config?.PER),
          real_time_print: pickFirstValue(config?.REAL_TIME_PRINT),
          spine_code: pickFirstValue(config?.["NEW SPINE COVER"]),
          book_size: pickFirstValue(config?.["BOOK SIZE"]),
          type: pickFirstValue(config?.TYPE),
          order_details_personalized: getOrderDetailsPersonalizedValue(student),
          coverqr: "",
          innerqr: "",
          colour_1: student.colour1,
          colour_2: student.colour2,
          assigned_number: student.assigned_number,
          nonp_order: 0,
        });
      });
    }

    nonpOrderAssignments.forEach((assignment) => {
      const productId = normalizeIdValue(pickFirstValue(assignment?.product_id));
      const classId = normalizeIdValue(pickFirstValue(assignment?.class_id));
      const schoolId = normalizeIdValue(pickFirstValue(assignment?.school_id));

      if (!productId || !classId || !schoolId) {
        throw new Error(
          `Nonp order assignment ${assignment.nonp_order_source_id || assignment.id} is missing product_id, class_id, or school_id.`
        );
      }


      const mappedDetails = productDetailMap.get(`${productId}::${classId}::${schoolId}`) || [];
      if (!mappedDetails.length) {
        throw new Error(
          `No product details found for nonp order assignment ${assignment.nonp_order_source_id || assignment.id}, product ${productId}, class ${classId}, school ${schoolId}.`
        );
      }

      mappedDetails.forEach((detail) => {
        const innercode = pickFirstValue(detail?.innercode);
        const config = bookDetailConfig[innercode];
        if (!config) {
          throw new Error(
            `Missing BOOKDETAIL configuration for innercode ${innercode || "(blank)"} in nonp assignment ${assignment.nonp_order_source_id || assignment.id}.`
          );
        }

        rows.push({
          source_id: normalizeIdValue(assignment.nonp_order_source_id),
          order_details_id: normalizeIdValue(assignment.order_details_id),
          student_id: "",
          school_id: schoolId,
          school_name: schoolNameBySchoolId.get(schoolId) || "",
          class_id: classId,
          class_name: "",
          student_name: "",
          dob: "",
          current_address: "",
          photo: "",
          guardian_name: "",
          guardian_mobile: "",
          guardian_image: "",
          sec_guardian_name: "",
          sec_guardian_mobile: "",
          sec_guardian_image: "",
          product_id: productId,
          name: detail.name,
          covercode: detail.covercode,
          innercode,
          personlized: pickFirstValue(config?.PER),
          real_time_print: pickFirstValue(config?.REAL_TIME_PRINT),
          spine_code: pickFirstValue(config?.["NEW SPINE COVER"]),
          book_size: pickFirstValue(config?.["BOOK SIZE"]),
          type: pickFirstValue(config?.TYPE),
          order_details_personalized: 0,
          coverqr: "",
          innerqr: "",
          colour_1: assignment.colour1,
          colour_2: assignment.colour2,
          assigned_number: assignment.assigned_number,
          nonp_order: 1,
        });
      });
    });

    rows.sort((left, right) => {
      const leftSize = BOOK_SIZE_ORDER[pickFirstValue(left.book_size).toUpperCase()] ?? Number.MAX_SAFE_INTEGER;
      const rightSize = BOOK_SIZE_ORDER[pickFirstValue(right.book_size).toUpperCase()] ?? Number.MAX_SAFE_INTEGER;
      if (leftSize !== rightSize) return leftSize - rightSize;

      const priorityCompare = getBookPriority(left) - getBookPriority(right);
      if (priorityCompare !== 0) return priorityCompare;

      const innercodeCompare = pickFirstValue(left.innercode).localeCompare(pickFirstValue(right.innercode));
      if (innercodeCompare !== 0) return innercodeCompare;

      return Number(left.assigned_number || 0) - Number(right.assigned_number || 0);
    });

    const schoolStudentBookRows = rows
      .filter((row) => {
        const innercode = pickFirstValue(row.innercode).toLowerCase();
        return !(innercode.endsWith("s") || innercode.endsWith("b"));
      })
      .sort((left, right) => {
        const schoolCompare = pickFirstValue(left.school_name, left.school_id).localeCompare(
          pickFirstValue(right.school_name, right.school_id)
        );
        if (schoolCompare !== 0) return schoolCompare;

        const studentCompare = pickFirstValue(left.student_name, left.student_id).localeCompare(
          pickFirstValue(right.student_name, right.student_id)
        );
        if (studentCompare !== 0) return studentCompare;

        const bookCompare = Number(left.book_id || 0) - Number(right.book_id || 0);
        if (bookCompare !== 0) return bookCompare;

        return Number(left.assigned_number || 0) - Number(right.assigned_number || 0);
      });

    const constructedAt = new Date().toISOString();
    const transaction = batchDb.transaction(() => {
      batchDb.prepare("DELETE FROM BookDetails").run();
      batchDb.prepare("DELETE FROM school_student_books").run();

      const insert = batchDb.prepare(`
        INSERT INTO BookDetails (
          source_id, order_details_id, student_id, school_id, school_name, class_id, class_name, student_name, dob,
          current_address, photo, guardian_name, guardian_mobile, guardian_image, sec_guardian_name,
          sec_guardian_mobile, sec_guardian_image, product_id, name, covercode, innercode, personlized,
          real_time_print, spine_code, book_size, type, coverqr, innerqr, colour_1, colour_2, assigned_number, nonp_order,
          book_id, cover_generated, inner_generated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      rows.forEach((row, index) => {
        const bookId = index + 1;
        row.book_id = bookId;
        const coverqr = buildBookQrCode({
          isCover: true,
          orderDetailsPersonalized: row.order_details_personalized,
          innercodePer: row.personlized,
          studentId: row.student_id,
          innercode: row.innercode,
          schoolId: row.school_id,
          batchId: batch.id,
          bookId,
          layerType: row.type,
          assignedNumber: row.assigned_number,
        });
        const innerqr = buildBookQrCode({
          isCover: false,
          orderDetailsPersonalized: row.order_details_personalized,
          innercodePer: row.personlized,
          studentId: row.student_id,
          innercode: row.innercode,
          schoolId: row.school_id,
          batchId: batch.id,
          bookId,
          layerType: row.type,
          assignedNumber: row.assigned_number,
        });

        insert.run(
          row.source_id,
          row.order_details_id,
          row.student_id,
          row.school_id,
          row.school_name,
          row.class_id,
          row.class_name,
          row.student_name,
          row.dob,
          row.current_address,
          row.photo,
          row.guardian_name,
          row.guardian_mobile,
          row.guardian_image,
          row.sec_guardian_name,
          row.sec_guardian_mobile,
          row.sec_guardian_image,
          row.product_id,
          row.name,
          row.covercode,
          row.innercode,
          row.personlized,
          row.real_time_print,
          row.spine_code,
          row.book_size,
          row.type,
          coverqr,
          innerqr,
          row.colour_1,
          row.colour_2,
          row.assigned_number,
          row.nonp_order,
          bookId,
          0,
          0
        );
      });

      const insertSchoolStudentBook = batchDb.prepare(`
        INSERT INTO school_student_books (
          school_id, school_name, student_id, student_name, book_id, name, innercode, outercode,
          assigned_number, colour_1, colour_2, lamination_status, composing_status, sorting_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      schoolStudentBookRows.forEach((row) => {
        insertSchoolStudentBook.run(
          row.school_id,
          row.school_name,
          row.student_id,
          row.student_name,
          row.book_id,
          row.name,
          row.innercode,
          row.covercode,
          row.assigned_number,
          row.colour_1,
          row.colour_2,
          0,
          0,
          0
        );
      });

      batchDb
        .prepare("INSERT INTO batch_log (message, created_at) VALUES (?, ?)")
        .run(
          `Constructed ${rows.length} BookDetails rows and ${schoolStudentBookRows.length} school_student_books rows.`,
          constructedAt
        );
    });

    transaction();

    return {
      ok: true,
      data: {
        batch_id: batch.id,
        batch_name: batch.batch_name,
        rows_count: rows.length,
        school_student_books_count: schoolStudentBookRows.length,
      },
    };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to construct book details." };
  } finally {
    if (batchDb) {
      batchDb.close();
    }
  }
};

const generateBooks = ({ batchId }) => {
  const normalizedBatchId = Number(batchId);
  if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
    return { ok: false, message: "Invalid batch id." };
  }

  const registryDb = getBatchRegistryDb();
  const batch = registryDb
    .prepare("SELECT id, batch_name, status, db_path FROM batches WHERE id = ?")
    .get(normalizedBatchId);

  if (!batch) {
    return { ok: false, message: "Batch not found." };
  }
  if (batch.status !== "building") {
    return { ok: false, message: "Books can only be generated for batches with status 'building'." };
  }

  let batchDb;
  try {
    batchDb = new Database(batch.db_path);
    ensureBatchDbSchema(batchDb);

    if (!tableExists(batchDb, "BookDetails")) {
      return { ok: false, message: "BookDetails table does not exist. Construct book detail first." };
    }
    if (!tableExists(batchDb, "school_student_books")) {
      return { ok: false, message: "school_student_books table does not exist. Construct book detail first." };
    }

    const bookDetailsCount = getTableCount(batchDb, "BookDetails");
    if (bookDetailsCount <= 0) {
      return { ok: false, message: "BookDetails has no entries. Construct book detail first." };
    }

    const schoolStudentBooksCount = getTableCount(batchDb, "school_student_books");
    if (schoolStudentBooksCount <= 0) {
      return { ok: false, message: "school_student_books has no entries. Construct book detail first." };
    }

    const generationResult = runBookGenerator({
      batchId: batch.id,
      batchName: batch.batch_name,
    });

    if (!generationResult.ok) {
      return generationResult;
    }

    const generatedAt = new Date().toISOString();
    batchDb
      .prepare("INSERT INTO batch_log (message, created_at) VALUES (?, ?)")
      .run(`Generate books completed.`, generatedAt);

    return {
      ok: true,
      data: {
        batch_id: batch.id,
        batch_name: batch.batch_name,
        message: generationResult.data?.message || "Book generation completed.",
        book_details_count: bookDetailsCount,
        school_student_books_count: schoolStudentBooksCount,
      },
    };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to generate books." };
  } finally {
    if (batchDb) {
      batchDb.close();
    }
  }
};

const regenerateBooks = ({ batchId }) => {
  const normalizedBatchId = Number(batchId);
  if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
    return { ok: false, message: "Invalid batch id." };
  }

  const registryDb = getBatchRegistryDb();
  const batch = registryDb
    .prepare("SELECT id, batch_name, status, db_path FROM batches WHERE id = ?")
    .get(normalizedBatchId);

  if (!batch) {
    return { ok: false, message: "Batch not found." };
  }
  if (batch.status !== "building") {
    return { ok: false, message: "Books can only be regenerated for batches with status 'building'." };
  }

  let batchDb;
  try {
    batchDb = new Database(batch.db_path);
    ensureBatchDbSchema(batchDb);

    if (!tableExists(batchDb, "BookDetails")) {
      return { ok: false, message: "BookDetails table does not exist. Construct book detail first." };
    }
    if (!tableExists(batchDb, "school_student_books")) {
      return { ok: false, message: "school_student_books table does not exist. Construct book detail first." };
    }

    const bookDetailsCount = getTableCount(batchDb, "BookDetails");
    if (bookDetailsCount <= 0) {
      return { ok: false, message: "BookDetails has no entries. Construct book detail first." };
    }

    const schoolStudentBooksCount = getTableCount(batchDb, "school_student_books");
    if (schoolStudentBooksCount <= 0) {
      return { ok: false, message: "school_student_books has no entries. Construct book detail first." };
    }

    const resetAt = new Date().toISOString();
    const registryTransaction = registryDb.transaction(() => {
      registryDb
        .prepare(`
          UPDATE batches
          SET cover_binder_generated = 0, inner_binder_generated = 0
          WHERE id = ?
        `)
        .run(batch.id);
    });

    const batchTransaction = batchDb.transaction(() => {
      batchDb
        .prepare("UPDATE BookDetails SET cover_generated = 0, inner_generated = 0")
        .run();
      batchDb
        .prepare("INSERT INTO batch_log (message, created_at) VALUES (?, ?)")
        .run("Reset cover and inner generation flags for regeneration.", resetAt);
    });

    batchTransaction();
    registryTransaction();

    const generationResult = runBookGenerator({
      batchId: batch.id,
      batchName: batch.batch_name,
    });

    if (!generationResult.ok) {
      return generationResult;
    }

    const generatedAt = new Date().toISOString();
    batchDb
      .prepare("INSERT INTO batch_log (message, created_at) VALUES (?, ?)")
      .run(`Regenerate books completed.`, generatedAt);

    return {
      ok: true,
      data: {
        batch_id: batch.id,
        batch_name: batch.batch_name,
        message: generationResult.data?.message || "Book regeneration completed.",
        book_details_count: bookDetailsCount,
        school_student_books_count: schoolStudentBooksCount,
      },
    };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to regenerate books." };
  } finally {
    if (batchDb) {
      batchDb.close();
    }
  }
};

const listBatches = () => {
  const db = getBatchRegistryDb();
  const query = db.prepare(`
    SELECT id, batch_name, created_at, status, active, db_path, inner_binder_generated, cover_binder_generated
    FROM batches
    ORDER BY active DESC, datetime(created_at) DESC, id DESC
  `);
  return query.all();
};

const listAvailableBatches = () => {
  const db = getBatchRegistryDb();
  return db
    .prepare(`
      SELECT id, batch_name, created_at, status, active, db_path, inner_binder_generated, cover_binder_generated
      FROM batches
      WHERE status = 'new'
      ORDER BY datetime(created_at) DESC, id DESC
    `)
    .all();
};

const setBatchProcessing = ({ batchId }) => {
  const normalizedBatchId = Number(batchId);
  if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
    return { ok: false, message: "Invalid batch id." };
  }

  const registryDb = getBatchRegistryDb();
  const batch = registryDb
    .prepare(`
      SELECT id, batch_name, status, cover_binder_generated, inner_binder_generated
      FROM batches
      WHERE id = ?
    `)
    .get(normalizedBatchId);

  if (!batch) {
    return { ok: false, message: "Batch not found." };
  }
  if (batch.status !== "building") {
    return { ok: false, message: "Only batches with status 'building' can be moved to processing." };
  }
  if (!Number(batch.cover_binder_generated) || !Number(batch.inner_binder_generated)) {
    return {
      ok: false,
      message: "Batch can move to processing only after both cover and inner binders are generated.",
    };
  }

  const updatedAt = new Date().toISOString();
  registryDb
    .prepare("UPDATE batches SET status = 'processing', active = 0 WHERE id = ?")
    .run(normalizedBatchId);

  return {
    ok: true,
    data: {
      batch_id: batch.id,
      batch_name: batch.batch_name,
      status: "processing",
      active: 0,
      updated_at: updatedAt,
    },
  };
};

const setBatchActive = ({ batchId }) => {
  const normalizedBatchId = Number(batchId);
  if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
    return { ok: false, message: "Invalid batch id." };
  }

  const registryDb = getBatchRegistryDb();
  const batch = registryDb
    .prepare("SELECT id, batch_name, status, active FROM batches WHERE id = ?")
    .get(normalizedBatchId);

  if (!batch) {
    return { ok: false, message: "Batch not found." };
  }
  if (batch.status !== "processing") {
    return { ok: false, message: "Only batches with status 'processing' can be marked active." };
  }

  const updateActiveBatch = registryDb.transaction(() => {
    registryDb.prepare("UPDATE batches SET active = 0 WHERE active != 0").run();
    registryDb.prepare("UPDATE batches SET active = 1 WHERE id = ?").run(normalizedBatchId);
  });
  updateActiveBatch();

  return {
    ok: true,
    data: {
      batch_id: batch.id,
      batch_name: batch.batch_name,
      status: batch.status,
      active: 1,
      active_label: getBatchActiveLabel(1),
    },
  };
};

const prepareBatchCompletion = ({ batchId }) => {
  const normalizedBatchId = Number(batchId);
  if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
    return { ok: false, message: "Invalid batch id." };
  }

  const registryDb = getBatchRegistryDb();
  const batch = registryDb
    .prepare("SELECT id, batch_name, status, db_path FROM batches WHERE id = ?")
    .get(normalizedBatchId);

  if (!batch) {
    return { ok: false, message: "Batch not found." };
  }
  if (batch.status !== "processing") {
    return { ok: false, message: "Only batches with status 'processing' can be completed." };
  }

  let batchDb;
  try {
    batchDb = new Database(batch.db_path);
    ensureBatchDbSchema(batchDb);

    if (!tableExists(batchDb, "school_student_books")) {
      return { ok: false, message: "school_student_books table does not exist." };
    }

    const schoolStudentBooksCount = getTableCount(batchDb, "school_student_books");
    if (schoolStudentBooksCount <= 0) {
      return { ok: false, message: "school_student_books has no entries." };
    }

    const statusSummary = batchDb
      .prepare(`
        SELECT
          COUNT(*) AS total_rows,
          SUM(CASE WHEN lamination_status = 1 THEN 1 ELSE 0 END) AS lamination_done,
          SUM(CASE WHEN composing_status = 1 THEN 1 ELSE 0 END) AS composing_done,
          SUM(CASE WHEN sorting_status = 1 THEN 1 ELSE 0 END) AS sorting_done,
          SUM(
            CASE
              WHEN lamination_status = 1 AND composing_status = 1 AND sorting_status = 1 THEN 1
              ELSE 0
            END
          ) AS fully_done
        FROM school_student_books
      `)
      .get();

    const orderIds = registryDb
      .prepare(`
        SELECT order_number
        FROM batch_orders
        WHERE batch_id = ?
        ORDER BY id ASC
      `)
      .all(normalizedBatchId)
      .map((row) => String(row.order_number || "").trim())
      .filter(Boolean);

    if (!orderIds.length) {
      return { ok: false, message: "No orders found for this batch." };
    }

    const totalRows = Number(statusSummary?.total_rows || 0);
    const fullyDone = Number(statusSummary?.fully_done || 0);
    const allComplete = totalRows > 0 && fullyDone === totalRows;

    return {
      ok: true,
      data: {
        batch_id: batch.id,
        batch_name: batch.batch_name,
        all_complete: allComplete,
        total_rows: totalRows,
        incomplete_rows: Math.max(totalRows - fullyDone, 0),
        lamination_done: Number(statusSummary?.lamination_done || 0),
        composing_done: Number(statusSummary?.composing_done || 0),
        sorting_done: Number(statusSummary?.sorting_done || 0),
        order_ids: orderIds,
      },
    };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to prepare batch completion." };
  } finally {
    if (batchDb) {
      batchDb.close();
    }
  }
};

const setBatchCompleted = ({ batchId }) => {
  const normalizedBatchId = Number(batchId);
  if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
    return { ok: false, message: "Invalid batch id." };
  }

  const registryDb = getBatchRegistryDb();
  const batch = registryDb
    .prepare("SELECT id, batch_name, status FROM batches WHERE id = ?")
    .get(normalizedBatchId);

  if (!batch) {
    return { ok: false, message: "Batch not found." };
  }
  if (batch.status !== "processing") {
    return { ok: false, message: "Only batches with status 'processing' can be completed." };
  }

  registryDb
    .prepare("UPDATE batches SET status = 'completed', active = 0 WHERE id = ?")
    .run(normalizedBatchId);

  return {
    ok: true,
    data: {
      batch_id: batch.id,
      batch_name: batch.batch_name,
      status: "completed",
      active: 0,
    },
  };
};

const listBatchOrders = (batchId) => {
  const db = getBatchRegistryDb();
  return db
    .prepare(`
      SELECT
        bo.id,
        bo.batch_id,
        bo.order_number,
        bo.school_id,
        bo.school_name,
        bo.order_date,
        bo.added_at,
        b.batch_name
      FROM batch_orders bo
      INNER JOIN batches b ON b.id = bo.batch_id
      WHERE bo.batch_id = ?
      ORDER BY datetime(bo.added_at) DESC, bo.id DESC
    `)
    .all(batchId);
};

const listBatchPreparedProductDetails = ({ batchId }) => {
  const normalizedBatchId = Number(batchId);
  if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
    return { ok: false, message: "Invalid batch id." };
  }

  const registryDb = getBatchRegistryDb();
  const batch = registryDb
    .prepare("SELECT id, batch_name, status, db_path FROM batches WHERE id = ?")
    .get(normalizedBatchId);

  if (!batch) {
    return { ok: false, message: "Batch not found." };
  }
  if (batch.status !== "building") {
    return { ok: false, message: "Prepared product details are only available for batches with status 'building'." };
  }

  let batchDb;
  try {
    batchDb = new Database(batch.db_path);
    ensureBatchDbSchema(batchDb);

    const rows = batchDb
      .prepare(`
        SELECT
          ppd.source_id,
          ppd.product_id,
          ppd.school_id,
          COALESCE(sch.school_name, '') AS school_name,
          ppd.class_id,
          ppd.name,
          ppd.covercode,
          ppd.innercode
        FROM prepared_product_details ppd
        LEFT JOIN (
          SELECT school_id, MAX(school_name) AS school_name
          FROM prepared_students
          GROUP BY school_id
        ) sch ON sch.school_id = ppd.school_id
        ORDER BY sch.school_name ASC, ppd.school_id ASC, ppd.class_id ASC, ppd.name ASC, ppd.id ASC
      `)
      .all();

    return {
      ok: true,
      data: {
        batch_id: batch.id,
        batch_name: batch.batch_name,
        rows,
      },
    };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to load prepared product details." };
  } finally {
    if (batchDb) {
      batchDb.close();
    }
  }
};

const listBatchDetailedInfo = ({ batchId }) => {
  const normalizedBatchId = Number(batchId);
  if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
    return { ok: false, message: "Invalid batch id." };
  }

  const registryDb = getBatchRegistryDb();
  const batch = registryDb
    .prepare("SELECT id, batch_name, status, db_path FROM batches WHERE id = ?")
    .get(normalizedBatchId);

  if (!batch) {
    return { ok: false, message: "Batch not found." };
  }

  let batchDb;
  try {
    batchDb = new Database(batch.db_path);
    ensureBatchDbSchema(batchDb);

    const preparedClasses = batchDb
      .prepare(`
        SELECT class_id, class_name, school_id, school_name
        FROM prepared_classes
        ORDER BY id ASC
      `)
      .all();

    const preparedProductDetails = batchDb
      .prepare(`
        SELECT source_id, product_id, school_id, class_id, name, covercode, innercode
        FROM prepared_product_details
        ORDER BY id ASC
      `)
      .all();

    const preparedStudents = batchDb
      .prepare(`
        SELECT source_id, order_details_id, student_id, school_id, school_name, class_id, class_name, student_name, assigned_number, raw_json
        FROM prepared_students
        ORDER BY id ASC
      `)
      .all();

    const nonpOrderAssignments = batchDb
      .prepare(`
        SELECT school_id, class_id
        FROM nonp_order_assignments
        ORDER BY id ASC
      `)
      .all();

    const classNameByKey = new Map();
    const schoolNameById = new Map();
    const makeKey = (schoolId, classId) =>
      `${pickFirstValue(schoolId) || "-"}::${pickFirstValue(classId) || "-"}`;

    preparedClasses.forEach((row) => {
      const schoolId = pickFirstValue(row?.school_id);
      const classId = pickFirstValue(row?.class_id);
      const className = pickFirstValue(row?.class_name);
      const schoolName = pickFirstValue(row?.school_name);
      if (schoolId && schoolName && !schoolNameById.has(schoolId)) {
        schoolNameById.set(schoolId, schoolName);
      }
      if (schoolId && classId && className && !classNameByKey.has(makeKey(schoolId, classId))) {
        classNameByKey.set(makeKey(schoolId, classId), className);
      }
    });

    const resolveSchoolName = (schoolId, fallback) =>
      pickFirstValue(fallback, schoolNameById.get(pickFirstValue(schoolId)), schoolId, "-");
    const resolveClassName = (schoolId, classId, fallback) =>
      pickFirstValue(fallback, classNameByKey.get(makeKey(schoolId, classId)), classId, "-");

    const schools = new Map();
    const ensureSchool = (schoolId, schoolName) => {
      const normalizedSchoolId = pickFirstValue(schoolId) || "-";
      if (!schools.has(normalizedSchoolId)) {
        schools.set(normalizedSchoolId, {
          school_id: normalizedSchoolId,
          school_name: resolveSchoolName(normalizedSchoolId, schoolName),
          product_details_by_class: [],
          personalized_students_by_class: [],
          nonp_quantity_by_class: [],
        });
      }
      const bucket = schools.get(normalizedSchoolId);
      if (bucket.school_name === "-" && schoolName) {
        bucket.school_name = resolveSchoolName(normalizedSchoolId, schoolName);
      }
      return bucket;
    };

    const productClassGroups = new Map();
    preparedProductDetails.forEach((row) => {
      const schoolId = pickFirstValue(row?.school_id) || "-";
      const classId = pickFirstValue(row?.class_id) || "-";
      const school = ensureSchool(schoolId, "");
      const key = makeKey(schoolId, classId);

      if (!productClassGroups.has(key)) {
        productClassGroups.set(key, {
          school_id: school.school_id,
          class_id: classId,
          class_name: resolveClassName(schoolId, classId, ""),
          products: [],
        });
      }

      productClassGroups.get(key).products.push({
        source_id: pickFirstValue(row?.source_id),
        product_id: pickFirstValue(row?.product_id),
        name: pickFirstValue(row?.name, "-"),
        covercode: pickFirstValue(row?.covercode, "-"),
        innercode: pickFirstValue(row?.innercode, "-"),
      });
    });

    for (const group of productClassGroups.values()) {
      const school = ensureSchool(group.school_id, "");
      school.product_details_by_class.push(group);
    }

    const personalizedStudentGroups = new Map();
    preparedStudents.forEach((row) => {
      const personalized = isTruthyPersonalized(getOrderDetailsPersonalizedValue(row));
      if (!personalized) return;

      const schoolId = pickFirstValue(row?.school_id) || "-";
      const classId = pickFirstValue(row?.class_id) || "-";
      const schoolName = pickFirstValue(row?.school_name);
      const className = pickFirstValue(row?.class_name);
      const school = ensureSchool(schoolId, schoolName);
      const key = makeKey(schoolId, classId);

      if (!personalizedStudentGroups.has(key)) {
        personalizedStudentGroups.set(key, {
          school_id: school.school_id,
          class_id: classId,
          class_name: resolveClassName(schoolId, classId, className),
          students: [],
        });
      }

      personalizedStudentGroups.get(key).students.push({
        source_id: pickFirstValue(row?.source_id),
        order_details_id: pickFirstValue(row?.order_details_id),
        student_id: pickFirstValue(row?.student_id),
        student_name: pickFirstValue(row?.student_name, "-"),
        assigned_number: row?.assigned_number ?? null,
      });
    });

    for (const group of personalizedStudentGroups.values()) {
      const school = ensureSchool(group.school_id, "");
      school.personalized_students_by_class.push(group);
    }

    const nonpClassQuantities = new Map();
    nonpOrderAssignments.forEach((row) => {
      const schoolId = pickFirstValue(row?.school_id) || "-";
      const classId = pickFirstValue(row?.class_id) || "-";
      const key = makeKey(schoolId, classId);
      const current = nonpClassQuantities.get(key) || {
        school_id: schoolId,
        class_id: classId,
        quantity: 0,
      };
      current.quantity += 1;
      nonpClassQuantities.set(key, current);
    });

    for (const item of nonpClassQuantities.values()) {
      const school = ensureSchool(item.school_id, "");
      school.nonp_quantity_by_class.push({
        school_id: item.school_id,
        class_id: item.class_id,
        class_name: resolveClassName(item.school_id, item.class_id, ""),
        quantity: item.quantity,
      });
    }

    const sortByClass = (left, right) =>
      pickFirstValue(left?.class_name, left?.class_id).localeCompare(
        pickFirstValue(right?.class_name, right?.class_id)
      );
    const sortByStudent = (left, right) =>
      pickFirstValue(left?.student_name, left?.student_id).localeCompare(
        pickFirstValue(right?.student_name, right?.student_id)
      );
    const sortByProduct = (left, right) =>
      pickFirstValue(left?.name, left?.innercode, left?.covercode).localeCompare(
        pickFirstValue(right?.name, right?.innercode, right?.covercode)
      );

    const schoolList = Array.from(schools.values())
      .map((school) => {
        school.product_details_by_class.sort(sortByClass);
        school.personalized_students_by_class.sort(sortByClass);
        school.nonp_quantity_by_class.sort(sortByClass);
        school.product_details_by_class.forEach((group) => group.products.sort(sortByProduct));
        school.personalized_students_by_class.forEach((group) => group.students.sort(sortByStudent));
        return school;
      })
      .sort((left, right) =>
        pickFirstValue(left?.school_name, left?.school_id).localeCompare(
          pickFirstValue(right?.school_name, right?.school_id)
        )
      );

    const totals = schoolList.reduce(
      (acc, school) => {
        acc.school_count += 1;
        acc.product_detail_count += school.product_details_by_class.reduce(
          (total, group) => total + (Array.isArray(group.products) ? group.products.length : 0),
          0
        );
        acc.personalized_student_count += school.personalized_students_by_class.reduce(
          (total, group) => total + (Array.isArray(group.students) ? group.students.length : 0),
          0
        );
        acc.nonp_quantity_count += school.nonp_quantity_by_class.reduce(
          (total, group) => total + Number(group.quantity || 0),
          0
        );
        return acc;
      },
      {
        school_count: 0,
        product_detail_count: 0,
        personalized_student_count: 0,
        nonp_quantity_count: 0,
      }
    );

    return {
      ok: true,
      data: {
        batch_id: batch.id,
        batch_name: batch.batch_name,
        status: batch.status,
        schools: schoolList,
        totals,
      },
    };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to load batch detailed info." };
  } finally {
    if (batchDb) {
      batchDb.close();
    }
  }
};

const moveProductDetailToPrintLater = ({ batchId, productDetailSourceId }) => {
  const normalizedBatchId = Number(batchId);
  const normalizedSourceId = String(productDetailSourceId || "").trim();
  if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
    return { ok: false, message: "Invalid batch id." };
  }
  if (!normalizedSourceId) {
    return { ok: false, message: "Product detail source id is required." };
  }

  const registryDb = getBatchRegistryDb();
  const sourceBatch = registryDb
    .prepare("SELECT id, batch_name, status, db_path FROM batches WHERE id = ?")
    .get(normalizedBatchId);

  if (!sourceBatch) {
    return { ok: false, message: "Source batch not found." };
  }
  if (sourceBatch.status !== "building") {
    return { ok: false, message: "Print later is only available for batches with status 'building'." };
  }

  let sourceDb;
  let targetDb;
  try {
    sourceDb = new Database(sourceBatch.db_path);
    ensureBatchDbSchema(sourceDb);

    const detail = sourceDb
      .prepare("SELECT * FROM prepared_product_details WHERE source_id = ?")
      .get(normalizedSourceId);
    if (!detail) {
      return { ok: false, message: "Prepared product detail not found." };
    }

    const product = sourceDb
      .prepare("SELECT * FROM prepared_products WHERE source_id = ?")
      .get(detail.product_id);
    if (!product) {
      return { ok: false, message: "Prepared product not found for selected detail." };
    }

    const orderDetailsId = getProductOrderDetailsId(product);
    const relatedOrders = sourceDb
      .prepare("SELECT * FROM orders WHERE school_id = ? AND product_id = ? ORDER BY id ASC")
      .all(detail.school_id, detail.product_id);
    const relatedStudents = orderDetailsId
      ? sourceDb
          .prepare(`
            SELECT *
            FROM prepared_students
            WHERE school_id = ? AND class_id = ? AND order_details_id = ?
            ORDER BY id ASC
          `)
          .all(detail.school_id, detail.class_id, orderDetailsId)
      : [];

    const { batch: targetBatch, created } = getOrCreatePrintLaterBatch(registryDb);
    targetDb = new Database(targetBatch.db_path);
    ensureBatchDbSchema(targetDb);

    const targetHasDetail = targetDb
      .prepare("SELECT 1 FROM prepared_product_details WHERE source_id = ?")
      .get(normalizedSourceId);

    const transferAt = new Date().toISOString();
    const targetTransaction = targetDb.transaction(() => {
      if (!targetDb.prepare("SELECT 1 FROM prepared_products WHERE source_id = ?").get(product.source_id)) {
        targetDb
          .prepare(`
            INSERT INTO prepared_products (source_id, school_id, name, type, raw_json)
            VALUES (?, ?, ?, ?, ?)
          `)
          .run(product.source_id, product.school_id, product.name, product.type, product.raw_json);
      }

      relatedOrders.forEach((order) => {
        if (!targetDb.prepare("SELECT 1 FROM orders WHERE order_number = ?").get(order.order_number)) {
          targetDb
            .prepare(`
              INSERT INTO orders (
                order_number, school_id, school_name, personalized, product_id, product_type, order_date, added_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .run(
              order.order_number,
              order.school_id,
              order.school_name,
              order.personalized,
              order.product_id,
              order.product_type,
              order.order_date,
              order.added_at
            );
        }
      });

      relatedStudents.forEach((student) => {
        if (!targetDb.prepare("SELECT 1 FROM prepared_students WHERE source_id = ?").get(student.source_id)) {
          targetDb
            .prepare(`
              INSERT INTO prepared_students (
                source_id, order_details_id, student_id, school_id, school_name, colour1, colour2, assigned_number, class_id, class_name,
                student_name, dob, current_address, photo, guardian_name, guardian_mobile, guardian_image, sec_guardian_name,
                sec_guardian_mobile, sec_guardian_image, raw_json
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .run(
              student.source_id,
              student.order_details_id,
              student.student_id,
              student.school_id,
              student.school_name,
              student.colour1,
              student.colour2,
              student.assigned_number,
              student.class_id,
              student.class_name,
              student.student_name,
              student.dob,
              student.current_address,
              student.photo,
              student.guardian_name,
              student.guardian_mobile,
              student.guardian_image,
              student.sec_guardian_name,
              student.sec_guardian_mobile,
              student.sec_guardian_image,
              student.raw_json
            );
        }
      });

      if (!targetHasDetail) {
        targetDb
          .prepare(`
            INSERT INTO prepared_product_details (
              source_id, product_id, school_id, class_id, name, covercode, innercode, raw_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            detail.source_id,
            detail.product_id,
            detail.school_id,
            detail.class_id,
            detail.name,
            detail.covercode,
            detail.innercode,
            detail.raw_json
          );
      }

      targetDb
        .prepare("INSERT INTO batch_log (message, created_at) VALUES (?, ?)")
        .run(
          `Print later received product detail ${detail.source_id} from batch ${sourceBatch.batch_name}.`,
          transferAt
        );
    });

    const sourceTransaction = sourceDb.transaction(() => {
      sourceDb
        .prepare("DELETE FROM prepared_product_details WHERE source_id = ?")
        .run(normalizedSourceId);
      sourceDb
        .prepare("INSERT INTO batch_log (message, created_at) VALUES (?, ?)")
        .run(
          `Product detail ${detail.source_id} moved to print later batch ${targetBatch.batch_name}.`,
          transferAt
        );
    });

    targetTransaction();
    sourceTransaction();

    return {
      ok: true,
      data: {
        source_batch_id: sourceBatch.id,
        source_batch_name: sourceBatch.batch_name,
        target_batch_id: targetBatch.id,
        target_batch_name: targetBatch.batch_name,
        created_target_batch: created,
        product_detail_source_id: detail.source_id,
        class_id: detail.class_id,
        school_id: detail.school_id,
      },
      message: `Added to batch ${targetBatch.batch_name}.`,
    };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to move product detail to print later." };
  } finally {
    if (sourceDb) {
      sourceDb.close();
    }
    if (targetDb) {
      targetDb.close();
    }
  }
};

const listOrderBatchLinks = () => {
  const db = getBatchRegistryDb();
  return db
    .prepare(`
      SELECT
        bo.order_number,
        bo.batch_id,
        bo.added_at,
        b.batch_name,
        b.status AS batch_status
      FROM batch_orders bo
      INNER JOIN batches b ON b.id = bo.batch_id
    `)
    .all();
};

const addOrderToBatch = ({
  batchId,
  orderNumber,
  schoolId,
  schoolName,
  personalized,
  productId,
  productType,
  orderDate,
}) => {
  const normalizedBatchId = Number(batchId);
  const normalizedOrderNumber = String(orderNumber || "").trim();
  if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
    return { ok: false, message: "Invalid batch id." };
  }
  if (!normalizedOrderNumber) {
    return { ok: false, message: "Order number is required." };
  }

  const registryDb = getBatchRegistryDb();
  const batch = registryDb
    .prepare("SELECT id, batch_name, status, db_path FROM batches WHERE id = ?")
    .get(normalizedBatchId);
  if (!batch) {
    return { ok: false, message: "Batch not found." };
  }
  if (batch.status !== "new") {
    return { ok: false, message: "Only batches with status 'new' can accept orders." };
  }

  const existingAssignment = registryDb
    .prepare(`
      SELECT bo.batch_id, b.batch_name
      FROM batch_orders bo
      INNER JOIN batches b ON b.id = bo.batch_id
      WHERE bo.order_number = ?
    `)
    .get(normalizedOrderNumber);
  if (existingAssignment) {
    return {
      ok: false,
      message: `Order already belongs to batch ${existingAssignment.batch_name}.`,
    };
  }

  let batchDb;
  const addedAt = new Date().toISOString();
  try {
    batchDb = new Database(batch.db_path);
    ensureBatchDbSchema(batchDb);

    const transaction = registryDb.transaction(() => {
      registryDb
        .prepare(`
          INSERT INTO batch_orders (batch_id, order_number, school_id, school_name, order_date, added_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          normalizedBatchId,
          normalizedOrderNumber,
          schoolId ? String(schoolId) : null,
          schoolName ? String(schoolName) : null,
          orderDate ? String(orderDate) : null,
          addedAt
        );

      batchDb
        .prepare(`
          INSERT INTO orders (
            order_number, school_id, school_name, personalized, product_id, product_type, order_date, added_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          normalizedOrderNumber,
          schoolId ? String(schoolId) : null,
          schoolName ? String(schoolName) : null,
          personalized === undefined || personalized === null ? null : String(personalized),
          productId ? String(productId) : null,
          productType ? String(productType) : null,
          orderDate ? String(orderDate) : null,
          addedAt
        );

      batchDb
        .prepare("INSERT INTO batch_log (message, created_at) VALUES (?, ?)")
        .run(`Order ${normalizedOrderNumber} added to batch.`, addedAt);
    });

    transaction();

    return {
      ok: true,
      data: {
        batch_id: batch.id,
        batch_name: batch.batch_name,
        order_number: normalizedOrderNumber,
        added_at: addedAt,
      },
    };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to add order to batch." };
  } finally {
    if (batchDb) {
      batchDb.close();
    }
  }
};

const removeOrderFromBatch = ({ orderNumber, batchId }) => {
  const normalizedOrderNumber = String(orderNumber || "").trim();
  const normalizedBatchId =
    batchId === undefined || batchId === null ? null : Number(batchId);

  if (!normalizedOrderNumber) {
    return { ok: false, message: "Order number is required." };
  }

  const registryDb = getBatchRegistryDb();
  const assignment = registryDb
    .prepare(`
      SELECT
        bo.batch_id,
        bo.order_number,
        b.batch_name,
        b.status,
        b.db_path
      FROM batch_orders bo
      INNER JOIN batches b ON b.id = bo.batch_id
      WHERE bo.order_number = ?
    `)
    .get(normalizedOrderNumber);

  if (!assignment) {
    return { ok: false, message: "Order is not assigned to any batch." };
  }

  if (normalizedBatchId !== null && assignment.batch_id !== normalizedBatchId) {
    return { ok: false, message: "Order does not belong to the selected batch." };
  }

  if (assignment.status !== "new") {
    return { ok: false, message: "Orders can only be removed from batches with status 'new'." };
  }

  let batchDb;
  const removedAt = new Date().toISOString();
  try {
    batchDb = new Database(assignment.db_path);
    ensureBatchDbSchema(batchDb);

    const transaction = registryDb.transaction(() => {
      registryDb
        .prepare("DELETE FROM batch_orders WHERE order_number = ?")
        .run(normalizedOrderNumber);

      batchDb
        .prepare("DELETE FROM orders WHERE order_number = ?")
        .run(normalizedOrderNumber);

      batchDb
        .prepare("INSERT INTO batch_log (message, created_at) VALUES (?, ?)")
        .run(`Order ${normalizedOrderNumber} removed from batch.`, removedAt);
    });

    transaction();

    return {
      ok: true,
      data: {
        order_number: normalizedOrderNumber,
        batch_id: assignment.batch_id,
        batch_name: assignment.batch_name,
        removed_at: removedAt,
      },
    };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to remove order from batch." };
  } finally {
    if (batchDb) {
      batchDb.close();
    }
  }
};

const finalizeBatchPreparation = (
  { batchId, students, classes, products, productDetails, nonpOrders },
  options = {}
) => {
  const normalizedBatchId = Number(batchId);
  if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
    return { ok: false, message: "Invalid batch id." };
  }
  const allowBuildingRefetch = Boolean(options.allowBuildingRefetch);

  const registryDb = getBatchRegistryDb();
  const batch = registryDb
    .prepare("SELECT id, batch_name, status, db_path FROM batches WHERE id = ?")
    .get(normalizedBatchId);

  if (!batch) {
    return { ok: false, message: "Batch not found." };
  }
  if (batch.status !== "new" && !(allowBuildingRefetch && batch.status === "building")) {
    return { ok: false, message: "Only batches with status 'new' can be prepared." };
  }

  const preparedStudents = normalizePreparedStudents(students);
  const preparedClasses = normalizePreparedClasses(classes);
  const preparedProducts = normalizePreparedProducts(products);
  const preparedProductDetails = normalizePreparedProductDetails(productDetails);
  const preparedNonpOrders = normalizeNonpOrders(nonpOrders);
  let assignedStudents;
  let assignedNonpOrderUnits;
  let allocationMeta;
  let nonpAllocationMeta;
  try {
    const allocation = assignPreparedStudentSlots(preparedStudents);
    if (!allocation.ok) {
      return { ok: false, message: allocation.message };
    }
    assignedStudents = allocation.data.students;
    allocationMeta = allocation.data;

    const nonpAllocation = assignNonpOrderSlots(
      preparedNonpOrders,
      allocationMeta.next_basket_slot
    );
    if (!nonpAllocation.ok) {
      return { ok: false, message: nonpAllocation.message };
    }
    assignedNonpOrderUnits = nonpAllocation.data.assignments;
    nonpAllocationMeta = nonpAllocation.data;
  } catch (error) {
    return { ok: false, message: error.message || "Unable to assign bucket and basket values." };
  }
  
  let batchDb;
  const preparedAt = new Date().toISOString();
  try {
    batchDb = new Database(batch.db_path);
    ensureBatchDbSchema(batchDb);

    const registryTransaction = registryDb.transaction(() => {
      registryDb
        .prepare(`
          UPDATE batches
          SET status = 'building',
              cover_binder_generated = 0,
              inner_binder_generated = 0
          WHERE id = ?
        `)
        .run(normalizedBatchId);
    });

    const batchTransaction = batchDb.transaction(() => {
      batchDb.prepare("DELETE FROM prepared_students").run();
      batchDb.prepare("DELETE FROM prepared_classes").run();
      batchDb.prepare("DELETE FROM prepared_products").run();
      batchDb.prepare("DELETE FROM prepared_product_details").run();
      batchDb.prepare("DELETE FROM nonp_orders").run();
      batchDb.prepare("DELETE FROM nonp_order_assignments").run();
      batchDb.prepare("DELETE FROM BookDetails").run();
      batchDb.prepare("DELETE FROM school_student_books").run();

      const insertStudent = batchDb.prepare(`
        INSERT INTO prepared_students (
          source_id, order_details_id, student_id, school_id, school_name, colour1, colour2, assigned_number, class_id, class_name,
          student_name, dob, current_address, photo, guardian_name, guardian_mobile,
          guardian_image, sec_guardian_name, sec_guardian_mobile, sec_guardian_image, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      assignedStudents.forEach((item) => {
        insertStudent.run(
          item.source_id,
          item.order_details_id,
          item.student_id,
          item.school_id,
          item.school_name,
          item.colour1,
          item.colour2,
          item.assigned_number,
          item.class_id,
          item.class_name,
          item.student_name,
          item.dob,
          item.current_address,
          item.photo,
          item.guardian_name,
          item.guardian_mobile,
          item.guardian_image,
          item.sec_guardian_name,
          item.sec_guardian_mobile,
          item.sec_guardian_image,
          item.raw_json
        );
      });

      const insertClass = batchDb.prepare(`
        INSERT INTO prepared_classes (class_id, class_name, school_id, school_name, raw_json)
        VALUES (?, ?, ?, ?, ?)
      `);
      preparedClasses.forEach((item) => {
        insertClass.run(
          item.class_id,
          item.class_name,
          item.school_id,
          item.school_name,
          item.raw_json
        );
      });

      const insertProduct = batchDb.prepare(`
        INSERT INTO prepared_products (source_id, school_id, name, type, raw_json)
        VALUES (?, ?, ?, ?, ?)
      `);
      preparedProducts.forEach((item) => {
        insertProduct.run(item.source_id, item.school_id, item.name, item.type, item.raw_json);
      });

      const insertProductDetail = batchDb.prepare(`
        INSERT INTO prepared_product_details (
          source_id, product_id, school_id, class_id, name, covercode, innercode, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      preparedProductDetails.forEach((item) => {
        insertProductDetail.run(
          item.source_id,
          item.product_id,
          item.school_id,
          item.class_id,
          item.name,
          item.covercode,
          item.innercode,
          item.raw_json
        );
      });

      const insertNonpOrder = batchDb.prepare(`
        INSERT INTO nonp_orders (
          source_id, order_details_id, product_id, class_id, quantity, school_id, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      preparedNonpOrders.forEach((item) => {
        insertNonpOrder.run(
          item.source_id,
          item.order_details_id,
          item.product_id,
          item.class_id,
          item.quantity,
          item.school_id,
          item.raw_json
        );
      });

      const insertNonpOrderAssignment = batchDb.prepare(`
        INSERT INTO nonp_order_assignments (
          nonp_order_source_id, order_details_id, product_id, class_id, school_id,
          unit_index, colour1, colour2, assigned_number, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      assignedNonpOrderUnits.forEach((item) => {
        insertNonpOrderAssignment.run(
          item.nonp_order_source_id,
          item.order_details_id,
          item.product_id,
          item.class_id,
          item.school_id,
          item.unit_index,
          item.colour1,
          item.colour2,
          item.assigned_number,
          item.raw_json
        );
      });

      batchDb
        .prepare("INSERT INTO batch_log (message, created_at) VALUES (?, ?)")
        .run(
          `${allowBuildingRefetch ? "Batch fetched again and prepared" : "Batch prepared"} with ${assignedStudents.length} students, ${preparedClasses.length} classes, ${preparedProducts.length} products, ${preparedProductDetails.length} product details, ${preparedNonpOrders.length} nonp orders and ${assignedNonpOrderUnits.length} assigned nonp units. Buckets used: ${Math.ceil(nonpAllocationMeta.next_basket_slot / BASKETS_PER_BUCKET)}, baskets used: ${nonpAllocationMeta.next_basket_slot}.`,
          preparedAt
        );
    });

    batchTransaction();
    registryTransaction();

    return {
      ok: true,
      data: {
        batch_id: normalizedBatchId,
        batch_name: batch.batch_name,
        status: "building",
        students_count: assignedStudents.length,
        classes_count: preparedClasses.length,
        products_count: preparedProducts.length,
        product_details_count: preparedProductDetails.length,
        nonp_orders_count: preparedNonpOrders.length,
        nonp_order_units_count: assignedNonpOrderUnits.length,
        schools_count: allocationMeta.schools_count,
        buckets_used: Math.ceil(nonpAllocationMeta.next_basket_slot / BASKETS_PER_BUCKET),
        baskets_used: nonpAllocationMeta.next_basket_slot,
      },
    };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to finalize batch preparation." };
  } finally {
    if (batchDb) {
      batchDb.close();
    }
  }
};

const refetchAndPrepareBatch = (payload) =>
  finalizeBatchPreparation(payload, { allowBuildingRefetch: true });

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: "#0f1015",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });
  win.webContents.openDevTools();
  win.loadFile("index.html");
  return win;
};

const createBatchesWindow = () => {
  if (batchesWindow && !batchesWindow.isDestroyed()) {
    batchesWindow.focus();
    return batchesWindow;
  }

  batchesWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    backgroundColor: "#0f1015",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });
  batchesWindow.loadFile("batches.html");
  batchesWindow.on("closed", () => {
    batchesWindow = null;
  });

  return batchesWindow;
};

app.whenReady().then(() => {
  getBatchRegistryDb();
  mainWindow = createWindow();
  ipcMain.handle("open-batches-window", () => {
    createBatchesWindow();
  });
  ipcMain.handle("list-batches", () => {
    try {
      return { ok: true, data: listBatches() };
    } catch (error) {
      return { ok: false, message: error.message || "Unable to load batches." };
    }
  });
  ipcMain.handle("list-available-batches", () => {
    try {
      return { ok: true, data: listAvailableBatches() };
    } catch (error) {
      return { ok: false, message: error.message || "Unable to load available batches." };
    }
  });
  ipcMain.handle("list-batch-orders", (_event, batchId) => {
    try {
      const id = Number(batchId);
      if (!Number.isInteger(id) || id <= 0) {
        return { ok: false, message: "Invalid batch id." };
      }
      return { ok: true, data: listBatchOrders(id) };
    } catch (error) {
      return { ok: false, message: error.message || "Unable to load batch orders." };
    }
  });
  ipcMain.handle("list-batch-prepared-product-details", (_event, payload) => {
    try {
      return listBatchPreparedProductDetails(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to load prepared product details." };
    }
  });
  ipcMain.handle("list-batch-detailed-info", (_event, payload) => {
    try {
      return listBatchDetailedInfo(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to load batch detailed info." };
    }
  });
  ipcMain.handle("list-order-batch-links", () => {
    try {
      return { ok: true, data: listOrderBatchLinks() };
    } catch (error) {
      return { ok: false, message: error.message || "Unable to load batch assignments." };
    }
  });
  ipcMain.handle("add-order-to-batch", (_event, payload) => {
    try {
      return addOrderToBatch(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to add order to batch." };
    }
  });
  ipcMain.handle("remove-order-from-batch", (_event, payload) => {
    try {
      return removeOrderFromBatch(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to remove order from batch." };
    }
  });
  ipcMain.handle("finalize-batch-preparation", (_event, payload) => {
    try {
      return finalizeBatchPreparation(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to finalize batch preparation." };
    }
  });
  ipcMain.handle("refetch-and-prepare-batch", (_event, payload) => {
    try {
      return refetchAndPrepareBatch(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to fetch and prepare batch again." };
    }
  });
  ipcMain.handle("move-product-detail-to-print-later", (_event, payload) => {
    try {
      return moveProductDetailToPrintLater(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to move product detail to print later." };
    }
  });
  ipcMain.handle("construct-book-details", (_event, payload) => {
    try {
      return constructBookDetails(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to construct book details." };
    }
  });
  ipcMain.handle("generate-books", (_event, payload) => {
    try {
      return generateBooks(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to generate books." };
    }
  });
  ipcMain.handle("open-batch-processing-folder", async (_event, payload) => {
    try {
      return await openBatchProcessingFolder(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to open batch processing folder." };
    }
  });
  ipcMain.handle("regenerate-books", (_event, payload) => {
    try {
      return regenerateBooks(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to regenerate books." };
    }
  });
  ipcMain.handle("set-batch-processing", (_event, payload) => {
    try {
      return setBatchProcessing(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to update batch status." };
    }
  });
  ipcMain.handle("set-batch-active", (_event, payload) => {
    try {
      return setBatchActive(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to update active batch." };
    }
  });
  ipcMain.handle("prepare-batch-completion", (_event, payload) => {
    try {
      return prepareBatchCompletion(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to prepare batch completion." };
    }
  });
  ipcMain.handle("set-batch-completed", (_event, payload) => {
    try {
      return setBatchCompleted(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to update batch status." };
    }
  });
  ipcMain.handle("create-batch", (_event, batchName) => {
    const rootDir = BATCH_ROOT_DIR;
    if (!batchName || typeof batchName !== "string") {
      return { ok: false, message: "Batch name is required." };
    }
    if (!fs.existsSync(rootDir)) {
      return { ok: false, message: "Batch storage location not found." };
    }

    const trimmed = batchName.trim();
    const safeBase = trimmed
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9-_]/g, "")
      .replace(/-+/g, "-");
    if (!safeBase) {
      return { ok: false, message: "Batch name must include letters or numbers." };
    }

    const now = new Date();
    const dateSuffix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
      now.getDate()
    ).padStart(2, "0")}`;
    const fileName = `${safeBase}-${dateSuffix}.db`;
    const dbPath = path.join(rootDir, fileName);

    if (fs.existsSync(dbPath)) {
      return { ok: false, message: "Batch name already exists for today." };
    }

    let db;
    const registryDb = getBatchRegistryDb();
    const createdAt = new Date().toISOString();
    try {
      db = new Database(dbPath);
      ensureBatchDbSchema(db);
      const insert = db.prepare(
        "INSERT INTO batch_info (batch_name, created_at) VALUES (?, ?)"
      );
      insert.run(trimmed, createdAt);

      const registryInsert = registryDb.prepare(`
        INSERT INTO batches (batch_name, created_at, status, active, db_path)
        VALUES (?, ?, 'new', 0, ?)
      `);
      const info = registryInsert.run(trimmed, createdAt, dbPath);
      const registryBackupPath = backupBatchRegistry(registryDb);

      return {
        ok: true,
        data: {
          id: info.lastInsertRowid,
          batch_name: trimmed,
          created_at: createdAt,
          status: "new",
          active: 0,
          db_path: dbPath,
          registry_backup_path: registryBackupPath,
        },
        batchName: trimmed,
        fileName,
        registryBackupPath,
      };
    } catch (error) {
      if (db && fs.existsSync(dbPath)) {
        try {
          db.close();
          db = null;
        } catch {
          // ignore close error while cleaning up
        }
        try {
          fs.unlinkSync(dbPath);
        } catch {
          // keep original error response
        }
      }
      return { ok: false, message: error.message || "Failed to create batch." };
    } finally {
      if (db) {
        db.close();
      }
    }
  });
  ipcMain.handle("delete-batch", (_event, batchId) => {
    const id = Number(batchId);
    if (!Number.isInteger(id) || id <= 0) {
      return { ok: false, message: "Invalid batch id." };
    }

    try {
      const db = getBatchRegistryDb();
      const findStmt = db.prepare(
        "SELECT id, status, db_path FROM batches WHERE id = ?"
      );
      const row = findStmt.get(id);
      if (!row) {
        return { ok: false, message: "Batch not found." };
      }
      if (row.status !== "new") {
        return {
          ok: false,
          message: "Only batches with status 'new' can be deleted.",
        };
      }

      const deleteStmt = db.prepare("DELETE FROM batches WHERE id = ?");
      deleteStmt.run(id);
      db.prepare("DELETE FROM batch_orders WHERE batch_id = ?").run(id);

      if (row.db_path && fs.existsSync(row.db_path)) {
        try {
          fs.unlinkSync(row.db_path);
        } catch {
          // metadata was removed successfully; file cleanup can be retried manually
        }
      }

      return { ok: true };
    } catch (error) {
      return { ok: false, message: error.message || "Unable to delete batch." };
    }
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (batchRegistryDb) {
    batchRegistryDb.close();
    batchRegistryDb = null;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});
