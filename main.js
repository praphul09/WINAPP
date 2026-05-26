const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { spawnSync } = require("child_process");
const console = require("console");

let mainWindow = null;
let batchesWindow = null;
let batchRegistryDb = null;
let assigneeDb = null;

const BATCH_ROOT_DIR = "\\\\pixartnas\\home\\INTERNAL_PROCESSING\\BATCHES";
const BATCH_BACKUP_DIR = "\\\\pixartnas\\home\\INTERNAL_PROCESSING\\BATCHES_BACKUP";
const BATCH_PROCESSING_DIR = "\\\\pixartnas\\home\\INTERNAL_PROCESSING\\BATCH_PROCESSING";
const BOOK_DETAIL_JSON_PATH = "\\\\pixartnas\\home\\INTERNAL_PROCESSING\\BOOKDETAIL.json";
const BOOK_GENERATOR_SCRIPT_PATH = path.join(__dirname, "book_generator", "generate_books.py");
const SAMPLE_COVER_ROOT = "\\\\pixartnas\\home\\INTERNAL_PROCESSING\\SAMPLECOVER";
const ALL_PHOTOS2_ROOT = "\\\\pixartnas\\home\\INTERNAL_PROCESSING\\ALL_PHOTOS2";
const EXTERNAL_STUDENT_REGENERATE_SCRIPT = "C:\\WORKSPACE\\ProductCreation\\app\\regenerate_student_wrapper.py";//String(process.env.WINAPP_STUDENT_REGENERATE_SCRIPT || "").trim();
const ASSIGNEE_DB_FILE_NAME = "assigenfor.db";
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
const ORDER_ASSIGNEES = ["Jagadish", "Ashwin", "Surya", "other"];

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

const normalizeOrderAssignee = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  const matched = ORDER_ASSIGNEES.find((candidate) => candidate.toLowerCase() === normalized);
  return matched || null;
};

const ensureAssigneeDbSchema = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      school_name TEXT,
      assigned_to TEXT NOT NULL DEFAULT 'other',
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_order_assignments_order_number ON order_assignments(order_number);
  `);

  const columns = db.prepare("PRAGMA table_info(order_assignments)").all();
  const hasSchoolNameColumn = columns.some((column) => column.name === "school_name");
  if (!hasSchoolNameColumn) {
    db.exec("ALTER TABLE order_assignments ADD COLUMN school_name TEXT;");
  }
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

const migrateLegacyAssigneeData = (registryDb, targetDb) => {
  const hasLegacyTable = registryDb
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'order_assignments'")
    .get();
  if (!hasLegacyTable) {
    return;
  }

  const existingCount = Number(
    targetDb.prepare("SELECT COUNT(*) AS c FROM order_assignments").get()?.c || 0
  );
  if (existingCount > 0) {
    return;
  }

  const legacyColumns = registryDb.prepare("PRAGMA table_info(order_assignments)").all();
  const hasLegacySchoolNameColumn = legacyColumns.some((column) => column.name === "school_name");
  const legacyRows = registryDb
    .prepare(
      hasLegacySchoolNameColumn
        ? "SELECT order_number, school_name, assigned_to, updated_at FROM order_assignments"
        : "SELECT order_number, assigned_to, updated_at FROM order_assignments"
    )
    .all();
  if (!legacyRows.length) {
    return;
  }

  const insert = targetDb.prepare(`
    INSERT INTO order_assignments (order_number, school_name, assigned_to, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  const transaction = targetDb.transaction((rows) => {
    rows.forEach((row) => {
      insert.run(
        String(row.order_number || "").trim(),
        row.school_name ? String(row.school_name) : null,
        normalizeOrderAssignee(row.assigned_to) || "other",
        row.updated_at || new Date().toISOString()
      );
    });
  });
  transaction(legacyRows);
};

const backfillAssigneeSchoolNames = (registryDb, targetDb) => {
  const rows = registryDb
    .prepare(`
      SELECT order_number, school_name
      FROM batch_orders
      WHERE COALESCE(TRIM(order_number), '') != ''
        AND COALESCE(TRIM(school_name), '') != ''
    `)
    .all();
  if (!rows.length) {
    return;
  }

  const update = targetDb.prepare(`
    UPDATE order_assignments
    SET school_name = ?
    WHERE order_number = ?
      AND COALESCE(TRIM(school_name), '') = ''
  `);
  const transaction = targetDb.transaction((items) => {
    items.forEach((row) => {
      update.run(String(row.school_name || "").trim(), String(row.order_number || "").trim());
    });
  });
  transaction(rows);
};

const getAssigneeDb = () => {
  if (assigneeDb) return assigneeDb;
  if (!fs.existsSync(BATCH_ROOT_DIR)) {
    throw new Error("Batch storage location not found.");
  }

  const dbPath = path.join(BATCH_ROOT_DIR, ASSIGNEE_DB_FILE_NAME);
  assigneeDb = new Database(dbPath);
  ensureAssigneeDbSchema(assigneeDb);
  const registryDb = getBatchRegistryDb();
  migrateLegacyAssigneeData(registryDb, assigneeDb);
  backfillAssigneeSchoolNames(registryDb, assigneeDb);
  return assigneeDb;
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

const assignPreparedStudentSlots = (students, startBasketSlot = 0) => {
  const normalizedStudents = Array.isArray(students) ? students : [];
  const initialBasketSlot =
    Number.isInteger(startBasketSlot) && startBasketSlot >= 0 ? startBasketSlot : 0;

  if (initialBasketSlot * STUDENTS_PER_BASKET + normalizedStudents.length > MAX_ASSIGNABLE_UNITS) {
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

  if (initialBasketSlot + requiredBaskets > TOTAL_BASKETS) {
    return {
      ok: false,
      message: `School allocation exceeds capacity. Required baskets: ${requiredBaskets}, available baskets: ${TOTAL_BASKETS - initialBasketSlot}.`,
    };
  }

  let nextBasketSlot = initialBasketSlot;
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

const getQrPerDigit = ({ isCover, nonpOrder, innercodePer }) => {
  const normalizedPer = String(innercodePer || "").trim().toUpperCase();
  const isOrderDetailsPersonalized = Number(nonpOrder || 0) === 0;

  if (!isCover) {
    return normalizedPer === "Y" ? "1" : "0";
  }

  if (!isOrderDetailsPersonalized) {
    return "0";
  }

  return normalizedPer === "Y" ? "1" : "2";
};

const buildBookQrCode = ({
  isCover,
  nonpOrder,
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
  const isOrderDetailsPersonalized = Number(nonpOrder || 0) === 0;
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
    getQrPerDigit({ isCover, nonpOrder, innercodePer }),
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

const runExternalStudentRegenerate = (payload) => {
  if (!EXTERNAL_STUDENT_REGENERATE_SCRIPT) {
    return {
      ok: false,
      message: "External regenerate script path is not configured. Set WINAPP_STUDENT_REGENERATE_SCRIPT.",
    };
  }
  if (!fs.existsSync(EXTERNAL_STUDENT_REGENERATE_SCRIPT)) {
    return { ok: false, message: `External regenerate script not found: ${EXTERNAL_STUDENT_REGENERATE_SCRIPT}` };
  }

  const commands = [
    { command: "py", args: ["-3"] },
    { command: "python", args: [] },
  ];
  const inputJson = JSON.stringify(payload || {});

  for (const candidate of commands) {
    const result = spawnSync(candidate.command, [...candidate.args, EXTERNAL_STUDENT_REGENERATE_SCRIPT], {
      encoding: "utf8",
      windowsHide: true,
      input: inputJson,
    });

    if (result.error) {
      console.log(result.error)
      continue;
    }

    const stdoutText = String(result.stdout || "").trim();
    let parsed = null;
    if (stdoutText) {
      try {
        parsed = JSON.parse(stdoutText);
      } catch (_error) {
        parsed = null;
      }
    }

    if (result.status !== 0) {
      if (parsed && typeof parsed === "object") return parsed;
      return {
        ok: false,
        message: String(result.stderr || "").trim() || stdoutText || "External student regenerate failed.",
      };
    }

    if (!parsed || typeof parsed !== "object") {
      return { ok: false, message: "External regenerate returned invalid JSON." };
    }
    return parsed;
  }

  return { ok: false, message: "Python runtime not found. Install Python or ensure `python`/`py -3` is available." };
};

const zpad5 = (value) => String(value || "").trim().padStart(5, "0");

const listBatchVerifyStudents = ({ batchId }) => {
  const normalizedBatchId = Number(batchId);
  if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
    return { ok: false, message: "Invalid batch id." };
  }

  const registryDb = getBatchRegistryDb();
  const batch = registryDb
    .prepare("SELECT id, batch_name, status, db_path FROM batches WHERE id = ?")
    .get(normalizedBatchId);

  if (!batch) return { ok: false, message: "Batch not found." };
  if (batch.status !== "building" && batch.status !== "processing") {
    return { ok: false, message: "Verify student is available only for building or processing batches." };
  }

  let batchDb;
  try {
    batchDb = new Database(batch.db_path);
    ensureBatchDbSchema(batchDb);

    if (!tableExists(batchDb, "prepared_students") || !tableExists(batchDb, "prepared_product_details")) {
      return { ok: false, message: "Prepared data not found. Prepare/construct batch first." };
    }

    const studentRows = batchDb
      .prepare(
        `
          SELECT school_id, school_name, student_id, student_name, class_id, class_name
          FROM prepared_students
          WHERE COALESCE(TRIM(school_id), '') != ''
            AND COALESCE(TRIM(student_id), '') != ''
            AND COALESCE(TRIM(class_id), '') != ''
          ORDER BY school_name ASC, school_id ASC, student_name ASC, student_id ASC, class_id ASC
        `
      )
      .all();

    const productRows = batchDb
      .prepare(
        `
          SELECT source_id, product_id, school_id, class_id, name, covercode, innercode
          FROM prepared_product_details
          WHERE COALESCE(TRIM(school_id), '') != ''
            AND COALESCE(TRIM(class_id), '') != ''
          ORDER BY id ASC
        `
      )
      .all();

    const productsBySchoolClass = new Map();
    productRows.forEach((row) => {
      const schoolId = String(row.school_id || "").trim();
      const classId = String(row.class_id || "").trim();
      if (!schoolId || !classId) return;
      const key = `${schoolId}::${classId}`;
      if (!productsBySchoolClass.has(key)) productsBySchoolClass.set(key, []);
      productsBySchoolClass.get(key).push({
        source_id: String(row.source_id || "").trim(),
        product_id: String(row.product_id || "").trim(),
        school_id: schoolId,
        class_id: classId,
        name: String(row.name || "").trim(),
        covercode: String(row.covercode || "").trim(),
        innercode: String(row.innercode || "").trim(),
      });
    });

    const uniqueStudents = new Map();
    studentRows.forEach((row) => {
      const schoolId = String(row.school_id || "").trim();
      const studentId = String(row.student_id || "").trim();
      const classId = String(row.class_id || "").trim();
      const schoolName = String(row.school_name || "").trim();
      const studentName = String(row.student_name || "").trim();
      const className = String(row.class_name || "").trim();
      if (!schoolId || !studentId || !classId) return;
      const key = `${schoolId}::${studentId}::${classId}`;
      if (uniqueStudents.has(key)) return;

      const sampleCoverPath = path.join(SAMPLE_COVER_ROOT, schoolId, `${studentId}.png`);
      const productKey = `${schoolId}::${classId}`;
      const classProducts = productsBySchoolClass.get(productKey) || [];

      uniqueStudents.set(key, {
        school_id: schoolId,
        school_name: schoolName || schoolId,
        student_id: studentId,
        student_name: studentName || studentId,
        class_id: classId,
        class_name: className || classId,
        sample_cover_path: sampleCoverPath,
        sample_cover_exists: fs.existsSync(sampleCoverPath),
        product_rows: classProducts,
      });
    });

    const students = Array.from(uniqueStudents.values()).filter(
      (row) => row.sample_cover_exists && Array.isArray(row.product_rows) && row.product_rows.length > 0
    );

    return {
      ok: true,
      data: {
        batch_id: batch.id,
        batch_name: batch.batch_name,
        status: batch.status,
        students,
      },
    };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to load verify students." };
  } finally {
    if (batchDb) batchDb.close();
  }
};

const openStudentPhotoFile = ({ schoolId, studentId }) => {
  const school = String(schoolId || "").trim();
  const student = String(studentId || "").trim();
  if (!school || !student) {
    return { ok: false, message: "school_id and student_id are required." };
  }

  const filePath = path.join(ALL_PHOTOS2_ROOT, school, "FULL", `${zpad5(school)}_${zpad5(student)}.png`);
  if (!fs.existsSync(filePath)) {
    return { ok: false, message: `Photo file not found: ${filePath}` };
  }

  shell.showItemInFolder(filePath);
  return { ok: true, data: { file_path: filePath } };
};

const regenerateStudentWithExternal = ({ batchId, student, productRows }) => {
  const normalizedBatchId = Number(batchId);
  if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
    return { ok: false, message: "Invalid batch id." };
  }

  const studentRow = student || {};
  const schoolId = String(studentRow.school_id || "").trim();
  const studentId = String(studentRow.student_id || "").trim();
  const classId = String(studentRow.class_id || "").trim();
  const products = Array.isArray(productRows) ? productRows : [];
  if (!schoolId || !studentId || !classId) {
    return { ok: false, message: "student.school_id, student.student_id and student.class_id are required." };
  }
  if (!products.length) {
    return { ok: false, message: "productRows cannot be empty." };
  }

  const registryDb = getBatchRegistryDb();
  const batch = registryDb
    .prepare("SELECT id, batch_name, status, db_path FROM batches WHERE id = ?")
    .get(normalizedBatchId);
  if (!batch) return { ok: false, message: "Batch not found." };
  if (batch.status !== "building" && batch.status !== "processing") {
    return { ok: false, message: "Verify student regenerate is available only for building or processing batches." };
  }

  const payload = {
    action: "regenerate_student",
    batch_id: batch.id,
    batch_name: batch.batch_name,
    registry_path: path.join(BATCH_ROOT_DIR, "batch-registry.db"),
    batch_db_path: batch.db_path,
    student: {
      school_id: schoolId,
      school_name: String(studentRow.school_name || "").trim(),
      student_id: studentId,
      student_name: String(studentRow.student_name || "").trim(),
      class_id: classId,
      class_name: String(studentRow.class_name || "").trim(),
    },
    product_rows: products,
  };

  return runExternalStudentRegenerate(payload);
};

const normalizeStudentNameForSimilarity = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const levenshteinDistance = (a, b) => {
  const left = String(a || "");
  const right = String(b || "");
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const prev = Array.from({ length: right.length + 1 }, (_v, i) => i);
  for (let i = 1; i <= left.length; i += 1) {
    let corner = i - 1;
    prev[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const upper = prev[j];
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, corner + cost);
      corner = upper;
    }
  }
  return prev[right.length];
};

const areNamesSimilar = (nameA, nameB) => {
  const a = normalizeStudentNameForSimilarity(nameA);
  const b = normalizeStudentNameForSimilarity(nameB);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  const minLen = Math.min(a.length, b.length);
  if (minLen < 4) return false;

  const distance = levenshteinDistance(a, b);
  if (minLen >= 10) return distance <= 2;
  return distance <= 1;
};

const analyzeBatchStudentDuplicates = ({ batchId }) => {
  const normalizedBatchId = Number(batchId);
  if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
    return { ok: false, message: "Invalid batch id." };
  }

  const registryDb = getBatchRegistryDb();
  const batch = registryDb
    .prepare("SELECT id, batch_name, status, db_path FROM batches WHERE id = ?")
    .get(normalizedBatchId);
  if (!batch) return { ok: false, message: "Batch not found." };
  if (batch.status !== "building" && batch.status !== "processing") {
    return { ok: false, message: "Analyze duplicates is available only for building or processing batches." };
  }

  let batchDb;
  try {
    batchDb = new Database(batch.db_path);
    ensureBatchDbSchema(batchDb);
    if (!tableExists(batchDb, "prepared_students")) {
      return { ok: false, message: "prepared_students table does not exist." };
    }

    const rows = batchDb
      .prepare(
        `
          SELECT school_id, school_name, student_id, student_name, class_name
          FROM prepared_students
          WHERE COALESCE(TRIM(school_id), '') != ''
            AND COALESCE(TRIM(student_id), '') != ''
            AND COALESCE(TRIM(student_name), '') != ''
          ORDER BY school_name ASC, school_id ASC, student_name ASC, student_id ASC
        `
      )
      .all()
      .map((row) => ({
        school_id: String(row.school_id || "").trim(),
        school_name: String(row.school_name || "").trim() || String(row.school_id || "").trim(),
        student_id: String(row.student_id || "").trim(),
        student_name: String(row.student_name || "").trim(),
        student_grade: String(row.class_name || "").trim(),
      }));

    const schools = new Map();
    rows.forEach((row) => {
      if (!schools.has(row.school_id)) schools.set(row.school_id, []);
      schools.get(row.school_id).push(row);
    });

    const results = [];
    schools.forEach((students, schoolId) => {
      const n = students.length;
      if (n < 2) return;

      const parent = Array.from({ length: n }, (_v, i) => i);
      const find = (x) => {
        let node = x;
        while (parent[node] !== node) {
          parent[node] = parent[parent[node]];
          node = parent[node];
        }
        return node;
      };
      const union = (a, b) => {
        const pa = find(a);
        const pb = find(b);
        if (pa !== pb) parent[pb] = pa;
      };

      for (let i = 0; i < n; i += 1) {
        for (let j = i + 1; j < n; j += 1) {
          if (areNamesSimilar(students[i].student_name, students[j].student_name)) {
            union(i, j);
          }
        }
      }

      const groups = new Map();
      for (let i = 0; i < n; i += 1) {
        const root = find(i);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(students[i]);
      }

      const duplicateGroups = Array.from(groups.values())
        .filter((group) => group.length > 1)
        .map((group) => ({
          school_id: schoolId,
          school_name: group[0]?.school_name || schoolId,
          members: group,
        }));

      results.push(...duplicateGroups);
    });

    return {
      ok: true,
      data: {
        batch_id: batch.id,
        batch_name: batch.batch_name,
        status: batch.status,
        groups: results,
        total_groups: results.length,
      },
    };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to analyze duplicates." };
  } finally {
    if (batchDb) batchDb.close();
  }
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
          nonpOrder: row.nonp_order,
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
          nonpOrder: row.nonp_order,
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

const listBatchStageStatus = ({ batchId }) => {
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

    if (!tableExists(batchDb, "school_student_books")) {
      return { ok: false, message: "school_student_books table does not exist. Construct book detail first." };
    }

    const schoolStudentBooksCount = getTableCount(batchDb, "school_student_books");
    if (schoolStudentBooksCount <= 0) {
      return { ok: false, message: "school_student_books has no entries. Construct book detail first." };
    }

    const summary = batchDb
      .prepare(`
        SELECT
          COUNT(*) AS total_rows,
          SUM(
            CASE
              WHEN (
                LOWER(TRIM(COALESCE(innercode, ''))) LIKE '%s'
                OR LOWER(TRIM(COALESCE(innercode, ''))) LIKE '%b'
                OR LOWER(TRIM(COALESCE(outercode, ''))) LIKE '%s'
                OR LOWER(TRIM(COALESCE(outercode, ''))) LIKE '%b'
              ) THEN 1
              ELSE 0
            END
          ) AS excluded_rows,
          SUM(
            CASE
              WHEN (
                LOWER(TRIM(COALESCE(innercode, ''))) LIKE '%s'
                OR LOWER(TRIM(COALESCE(innercode, ''))) LIKE '%b'
                OR LOWER(TRIM(COALESCE(outercode, ''))) LIKE '%s'
                OR LOWER(TRIM(COALESCE(outercode, ''))) LIKE '%b'
              ) THEN 0
              ELSE 1
            END
          ) AS considered_rows,
          SUM(
            CASE
              WHEN (
                LOWER(TRIM(COALESCE(innercode, ''))) LIKE '%s'
                OR LOWER(TRIM(COALESCE(innercode, ''))) LIKE '%b'
                OR LOWER(TRIM(COALESCE(outercode, ''))) LIKE '%s'
                OR LOWER(TRIM(COALESCE(outercode, ''))) LIKE '%b'
              ) THEN 0
              WHEN lamination_status = 1 THEN 1
              ELSE 0
            END
          ) AS lamination_done,
          SUM(
            CASE
              WHEN (
                LOWER(TRIM(COALESCE(innercode, ''))) LIKE '%s'
                OR LOWER(TRIM(COALESCE(innercode, ''))) LIKE '%b'
                OR LOWER(TRIM(COALESCE(outercode, ''))) LIKE '%s'
                OR LOWER(TRIM(COALESCE(outercode, ''))) LIKE '%b'
              ) THEN 0
              WHEN COALESCE(lamination_status, 0) = 1 THEN 0
              ELSE 1
            END
          ) AS lamination_pending,
          SUM(
            CASE
              WHEN (
                LOWER(TRIM(COALESCE(innercode, ''))) LIKE '%s'
                OR LOWER(TRIM(COALESCE(innercode, ''))) LIKE '%b'
                OR LOWER(TRIM(COALESCE(outercode, ''))) LIKE '%s'
                OR LOWER(TRIM(COALESCE(outercode, ''))) LIKE '%b'
              ) THEN 0
              WHEN composing_status = 1 THEN 1
              ELSE 0
            END
          ) AS composing_done,
          SUM(
            CASE
              WHEN (
                LOWER(TRIM(COALESCE(innercode, ''))) LIKE '%s'
                OR LOWER(TRIM(COALESCE(innercode, ''))) LIKE '%b'
                OR LOWER(TRIM(COALESCE(outercode, ''))) LIKE '%s'
                OR LOWER(TRIM(COALESCE(outercode, ''))) LIKE '%b'
              ) THEN 0
              WHEN COALESCE(composing_status, 0) = 1 THEN 0
              ELSE 1
            END
          ) AS composing_pending,
          SUM(
            CASE
              WHEN (
                LOWER(TRIM(COALESCE(innercode, ''))) LIKE '%s'
                OR LOWER(TRIM(COALESCE(innercode, ''))) LIKE '%b'
                OR LOWER(TRIM(COALESCE(outercode, ''))) LIKE '%s'
                OR LOWER(TRIM(COALESCE(outercode, ''))) LIKE '%b'
              ) THEN 0
              WHEN sorting_status = 1 THEN 1
              ELSE 0
            END
          ) AS sorting_done,
          SUM(
            CASE
              WHEN (
                LOWER(TRIM(COALESCE(innercode, ''))) LIKE '%s'
                OR LOWER(TRIM(COALESCE(innercode, ''))) LIKE '%b'
                OR LOWER(TRIM(COALESCE(outercode, ''))) LIKE '%s'
                OR LOWER(TRIM(COALESCE(outercode, ''))) LIKE '%b'
              ) THEN 0
              WHEN COALESCE(sorting_status, 0) = 1 THEN 0
              ELSE 1
            END
          ) AS sorting_pending
        FROM school_student_books
      `)
      .get();

    return {
      ok: true,
      data: {
        batch_id: batch.id,
        batch_name: batch.batch_name,
        status: batch.status,
        total_rows: Number(summary?.total_rows || 0),
        excluded_rows: Number(summary?.excluded_rows || 0),
        considered_rows: Number(summary?.considered_rows || 0),
        lamination_done: Number(summary?.lamination_done || 0),
        lamination_pending: Number(summary?.lamination_pending || 0),
        composing_done: Number(summary?.composing_done || 0),
        composing_pending: Number(summary?.composing_pending || 0),
        sorting_done: Number(summary?.sorting_done || 0),
        sorting_pending: Number(summary?.sorting_pending || 0),
      },
    };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to load batch stage status." };
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

const escapeCsvCell = (value) => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const toSafeFileNamePart = (value, fallback = "export") => {
  const sanitized = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || fallback;
};

const exportBatchBookDetailsExcel = async ({ batchId }) => {
  const normalizedBatchId = Number(batchId);
  if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
    return { ok: false, message: "Invalid batch id." };
  }

  const registryDb = getBatchRegistryDb();
  const batch = registryDb
    .prepare("SELECT id, batch_name, db_path FROM batches WHERE id = ?")
    .get(normalizedBatchId);
  if (!batch) {
    return { ok: false, message: "Batch not found." };
  }

  let batchDb;
  try {
    batchDb = new Database(batch.db_path);
    ensureBatchDbSchema(batchDb);

    if (!tableExists(batchDb, "BookDetails")) {
      return { ok: false, message: "BookDetails table does not exist. Construct book detail first." };
    }

    const columns = batchDb.prepare("PRAGMA table_info(BookDetails)").all();
    if (!columns.length) {
      return { ok: false, message: "BookDetails has no columns." };
    }

    const rows = batchDb.prepare("SELECT * FROM BookDetails ORDER BY id ASC").all();
    const headers = columns.map((column) => String(column.name || "").trim()).filter(Boolean);
    const lines = [headers.map((header) => escapeCsvCell(header)).join(",")];
    rows.forEach((row) => {
      lines.push(headers.map((header) => escapeCsvCell(row[header])).join(","));
    });

    const safeBatchName = toSafeFileNamePart(batch.batch_name || `batch-${batch.id}`, `batch-${batch.id}`);
    const defaultFileName = `${safeBatchName || `batch-${batch.id}`}-BookDetails.csv`;
    const saveResult = await dialog.showSaveDialog({
      title: "Export BookDetails to Excel-compatible CSV",
      defaultPath: path.join(app.getPath("documents"), defaultFileName),
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (saveResult.canceled || !saveResult.filePath) {
      return { ok: false, message: "Export cancelled." };
    }

    fs.writeFileSync(saveResult.filePath, `\uFEFF${lines.join("\r\n")}`, "utf8");
    return {
      ok: true,
      data: {
        batch_id: batch.id,
        batch_name: batch.batch_name,
        row_count: rows.length,
        file_path: saveResult.filePath,
      },
    };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to export BookDetails." };
  } finally {
    if (batchDb) {
      batchDb.close();
    }
  }
};

const exportOrdersStatusCsv = async ({ status, orders }) => {
  const normalizedOrders = Array.isArray(orders) ? orders : [];
  if (!normalizedOrders.length) {
    return { ok: false, message: "No orders available to export." };
  }

  const normalizedStatus = String(status || "orders").trim().toLowerCase() || "orders";
  const headers = [
    "order_number",
    "school_id",
    "school_name",
    "order_date",
    "status",
    "assigned_to",
    "personalized",
    "product_id",
    "product_type",
    "order_type",
    "batch_id",
    "batch_name",
    "batch_status",
    "batch_added_at",
  ];

  const lines = [headers.map((header) => escapeCsvCell(header)).join(",")];
  normalizedOrders.forEach((order) => {
    lines.push(
      headers
        .map((header) => escapeCsvCell(order?.[header]))
        .join(",")
    );
  });

  const datePart = new Date().toISOString().slice(0, 10);
  const defaultFileName = `${toSafeFileNamePart(normalizedStatus, "orders")}-orders-${datePart}.csv`;
  const saveResult = await dialog.showSaveDialog({
    title: `Export ${normalizedStatus} orders to CSV`,
    defaultPath: path.join(app.getPath("documents"), defaultFileName),
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (saveResult.canceled || !saveResult.filePath) {
    return { ok: false, message: "Export cancelled." };
  }

  fs.writeFileSync(saveResult.filePath, `\uFEFF${lines.join("\r\n")}`, "utf8");
  return {
    ok: true,
    data: {
      status: normalizedStatus,
      row_count: normalizedOrders.length,
      file_path: saveResult.filePath,
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

const listBatchPersonalizedOrderIds = ({ batchId }) => {
  const normalizedBatchId = Number(batchId);
  if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
    return { ok: false, message: "Invalid batch id." };
  }

  const registryDb = getBatchRegistryDb();
  const batch = registryDb
    .prepare("SELECT id, batch_name, db_path FROM batches WHERE id = ?")
    .get(normalizedBatchId);
  if (!batch) {
    return { ok: false, message: "Batch not found." };
  }

  let batchDb;
  try {
    batchDb = new Database(batch.db_path);
    ensureBatchDbSchema(batchDb);

    const rows = batchDb
      .prepare(
        `
          SELECT DISTINCT order_number
          FROM orders
          WHERE TRIM(COALESCE(CAST(personalized AS TEXT), '')) IN ('1', 'Y', 'y', 'true', 'TRUE')
          ORDER BY order_number ASC
        `
      )
      .all();

    const orderIds = rows
      .map((row) => normalizeIdValue(row?.order_number))
      .filter(Boolean);

    return {
      ok: true,
      data: {
        batch_id: batch.id,
        batch_name: batch.batch_name,
        order_ids: orderIds,
      },
    };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to load personalized orders for batch." };
  } finally {
    if (batchDb) batchDb.close();
  }
};

const comparePreparedStudentsMissing = ({ batchId, students }) => {
  const normalizedBatchId = Number(batchId);
  if (!Number.isInteger(normalizedBatchId) || normalizedBatchId <= 0) {
    return { ok: false, message: "Invalid batch id." };
  }

  const registryDb = getBatchRegistryDb();
  const batch = registryDb
    .prepare("SELECT id, batch_name, db_path FROM batches WHERE id = ?")
    .get(normalizedBatchId);
  if (!batch) {
    return { ok: false, message: "Batch not found." };
  }

  const incomingStudentsRaw = Array.isArray(students) ? students : [];
  const incomingStudents = normalizePreparedStudents(incomingStudentsRaw);
  let batchDb;
  try {
    batchDb = new Database(batch.db_path);
    ensureBatchDbSchema(batchDb);

    const existingRows = batchDb
      .prepare("SELECT school_id, student_id FROM prepared_students ORDER BY id ASC")
      .all();

    const existingKeys = new Set();
    existingRows.forEach((row) => {
      const schoolId = normalizeIdValue(row?.school_id);
      const studentId = normalizeIdValue(row?.student_id);
      if (!schoolId || !studentId) return;
      existingKeys.add(`${schoolId}::${studentId}`);
    });

    const incomingUnique = new Map();
    incomingStudents.forEach((row) => {
      const schoolId = normalizeIdValue(row?.school_id);
      const studentId = normalizeIdValue(row?.student_id);
      if (!schoolId || !studentId) return;
      const key = `${schoolId}::${studentId}`;
      if (!incomingUnique.has(key)) {
        incomingUnique.set(key, {
          school_id: schoolId,
          school_name: pickFirstValue(row?.school_name, schoolId),
          student_id: studentId,
        });
      }
    });

    const schoolCounts = new Map();
    let missingTotal = 0;
    incomingUnique.forEach((row, key) => {
      if (existingKeys.has(key)) return;
      missingTotal += 1;
      const schoolKey = row.school_id;
      if (!schoolCounts.has(schoolKey)) {
        schoolCounts.set(schoolKey, {
          school_id: row.school_id,
          school_name: row.school_name,
          missing_count: 0,
        });
      }
      schoolCounts.get(schoolKey).missing_count += 1;
    });

    const school_wise_missing = Array.from(schoolCounts.values()).sort((left, right) =>
      pickFirstValue(left.school_name, left.school_id).localeCompare(
        pickFirstValue(right.school_name, right.school_id)
      )
    );

    return {
      ok: true,
      data: {
        batch_id: batch.id,
        batch_name: batch.batch_name,
        incoming_students_unique_count: incomingUnique.size,
        prepared_students_unique_count: existingKeys.size,
        total_missing: missingTotal,
        school_wise_missing,
      },
    };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to compare missing prepared students." };
  } finally {
    if (batchDb) batchDb.close();
  }
};

const addMissingPreparedStudentsToBatch = ({
  sourceBatchId,
  targetBatchId,
  students,
  classes,
  products,
  productDetails,
  nonpOrders,
}) => {
  const normalizedSourceBatchId = Number(sourceBatchId);
  const normalizedTargetBatchId = Number(targetBatchId);
  if (!Number.isInteger(normalizedSourceBatchId) || normalizedSourceBatchId <= 0) {
    return { ok: false, message: "Invalid source batch id." };
  }
  if (!Number.isInteger(normalizedTargetBatchId) || normalizedTargetBatchId <= 0) {
    return { ok: false, message: "Invalid target batch id." };
  }
  if (normalizedSourceBatchId === normalizedTargetBatchId) {
    return { ok: false, message: "Source and target batch cannot be the same." };
  }

  const registryDb = getBatchRegistryDb();
  const sourceBatch = registryDb
    .prepare("SELECT id, batch_name, db_path FROM batches WHERE id = ?")
    .get(normalizedSourceBatchId);
  const targetBatch = registryDb
    .prepare("SELECT id, batch_name, status, db_path FROM batches WHERE id = ?")
    .get(normalizedTargetBatchId);

  if (!sourceBatch) {
    return { ok: false, message: "Source batch not found." };
  }
  if (!targetBatch) {
    return { ok: false, message: "Target batch not found." };
  }
  if (targetBatch.status !== "new" && targetBatch.status !== "building") {
    return { ok: false, message: "Only batches with status 'new' or 'building' can accept ReSyncForBug data." };
  }

  const incomingStudentsRaw = Array.isArray(students) ? students : [];
  const incomingStudentsNormalized = normalizePreparedStudents(incomingStudentsRaw);
  const incomingClasses = Array.isArray(classes) ? classes : [];
  const incomingProducts = Array.isArray(products) ? products : [];
  const incomingProductDetails = Array.isArray(productDetails) ? productDetails : [];
  const incomingNonpOrders = Array.isArray(nonpOrders) ? nonpOrders : [];

  const toStudentKey = (row) => {
    const schoolId = normalizeIdValue(row?.school_id);
    const studentId = normalizeIdValue(row?.student_id);
    if (!schoolId || !studentId) return null;
    return `${schoolId}::${studentId}`;
  };

  const toSchoolClassKey = (schoolId, classId) => {
    if (!schoolId || !classId) return null;
    return `${schoolId}::${classId}`;
  };

  let sourceBatchDb;
  let targetBatchDb;
  try {
    sourceBatchDb = new Database(sourceBatch.db_path);
    ensureBatchDbSchema(sourceBatchDb);
    targetBatchDb = new Database(targetBatch.db_path);
    ensureBatchDbSchema(targetBatchDb);

    const existingRows = sourceBatchDb
      .prepare("SELECT school_id, student_id FROM prepared_students ORDER BY id ASC")
      .all();

    const existingKeys = new Set();
    existingRows.forEach((row) => {
      const key = toStudentKey(row);
      if (key) existingKeys.add(key);
    });

    const incomingByKey = new Map();
    incomingStudentsNormalized.forEach((row) => {
      const key = toStudentKey(row);
      if (!key || incomingByKey.has(key)) return;
      incomingByKey.set(key, row);
    });

    const missingStudentKeys = new Set();
    incomingByKey.forEach((_row, key) => {
      if (!existingKeys.has(key)) missingStudentKeys.add(key);
    });

    if (!missingStudentKeys.size) {
      return { ok: false, message: "No missing students found to add." };
    }

    const missingStudentsNormalized = Array.from(incomingByKey.entries())
      .filter(([key]) => missingStudentKeys.has(key))
      .map(([, row]) => row);

    const missingStudentsRaw = incomingStudentsRaw.filter((item) => {
      const normalizedRows = normalizePreparedStudents([item]);
      return normalizedRows.some((row) => {
        const key = toStudentKey(row);
        return Boolean(key && missingStudentKeys.has(key));
      });
    });

    const missingSchoolIds = new Set();
    const missingClassPairs = new Set();
    missingStudentsNormalized.forEach((row) => {
      const schoolId = normalizeIdValue(row?.school_id);
      const classId = normalizeIdValue(row?.class_id);
      if (schoolId) missingSchoolIds.add(schoolId);
      const key = toSchoolClassKey(schoolId, classId);
      if (key) missingClassPairs.add(key);
    });

    const filteredClasses = incomingClasses.filter((item) => {
      const classId = normalizeIdValue(item?.id ?? item?.class_id);
      const schoolId = normalizeIdValue(item?.school_id);
      const key = toSchoolClassKey(schoolId, classId);
      return Boolean(key && missingSchoolIds.has(schoolId) && missingClassPairs.has(key));
    });

    const filteredProducts = incomingProducts.filter((item) => {
      const schoolId = normalizeIdValue(item?.school_id);
      return Boolean(schoolId && missingSchoolIds.has(schoolId));
    });

    const filteredProductDetails = incomingProductDetails.filter((item) => {
      const schoolId = normalizeIdValue(item?.school_id);
      const classId = normalizeIdValue(item?.class_id);
      const key = toSchoolClassKey(schoolId, classId);
      return Boolean(key && missingSchoolIds.has(schoolId) && missingClassPairs.has(key));
    });

    const filteredNonpOrders = incomingNonpOrders.filter((item) => {
      const schoolId = normalizeIdValue(item?.school_id);
      const classId = normalizeIdValue(item?.class_id);
      if (!(schoolId && missingSchoolIds.has(schoolId))) {
        return false;
      }
      if (!classId) {
        return true;
      }
      const key = toSchoolClassKey(schoolId, classId);
      return Boolean(key && missingClassPairs.has(key));
    });

    const requiredOrderNumbers = new Set();
    missingStudentsNormalized.forEach((row) => {
      const orderNumber = normalizeIdValue(row?.order_details_id);
      if (orderNumber) requiredOrderNumbers.add(orderNumber);
    });

    const sourceOrders = sourceBatchDb.prepare("SELECT * FROM orders ORDER BY id ASC").all();
    const sourceOrderByNumber = new Map();
    sourceOrders.forEach((row) => {
      const orderNumber = normalizeIdValue(row?.order_number);
      if (!orderNumber || sourceOrderByNumber.has(orderNumber)) return;
      sourceOrderByNumber.set(orderNumber, row);
    });

    const missingOrderNumbers = Array.from(requiredOrderNumbers).filter(
      (orderNumber) => !sourceOrderByNumber.has(orderNumber)
    );
    if (missingOrderNumbers.length) {
      return {
        ok: false,
        message: `Missing source orders for order_details_id: ${missingOrderNumbers.slice(0, 10).join(", ")}${
          missingOrderNumbers.length > 10 ? "..." : ""
        }`,
      };
    }

    const copiedAt = new Date().toISOString();
    const insertTargetOrder = targetBatchDb.prepare(`
      INSERT OR IGNORE INTO orders (
        order_number, school_id, school_name, personalized, product_id, product_type, order_date, added_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    Array.from(requiredOrderNumbers).forEach((orderNumber) => {
      const sourceOrderRow = sourceOrderByNumber.get(orderNumber);
      insertTargetOrder.run(
        sourceOrderRow?.order_number ?? null,
        sourceOrderRow?.school_id ?? null,
        sourceOrderRow?.school_name ?? null,
        sourceOrderRow?.personalized ?? null,
        sourceOrderRow?.product_id ?? null,
        sourceOrderRow?.product_type ?? null,
        sourceOrderRow?.order_date ?? null,
        copiedAt
      );
    });

    const result = finalizeBatchPreparation(
      {
        batchId: normalizedTargetBatchId,
        students: missingStudentsRaw,
        classes: filteredClasses,
        products: filteredProducts,
        productDetails: filteredProductDetails,
        nonpOrders: filteredNonpOrders,
      },
      {
        allowBuildingRefetch: targetBatch.status === "building",
        appendExisting: targetBatch.status === "building",
      }
    );

    if (!result?.ok) {
      return result;
    }

    return {
      ok: true,
      data: {
        ...result.data,
        source_batch_id: sourceBatch.id,
        source_batch_name: sourceBatch.batch_name,
        target_batch_id: targetBatch.id,
        target_batch_name: targetBatch.batch_name,
        orders_count: requiredOrderNumbers.size,
      },
    };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to add missing students to target batch." };
  } finally {
    if (sourceBatchDb) sourceBatchDb.close();
    if (targetBatchDb) targetBatchDb.close();
  }
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
      group.student_count = Array.isArray(group.students) ? group.students.length : 0;
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
  const assignmentDb = getAssigneeDb();
  const assignedByOrder = new Map(
    assignmentDb
      .prepare("SELECT order_number, assigned_to FROM order_assignments")
      .all()
      .map((row) => [String(row.order_number || "").trim(), String(row.assigned_to || "").trim()])
  );

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
    .all()
    .map((row) => ({
      ...row,
      assigned_to: String(assignedByOrder.get(String(row.order_number || "").trim()) || "").trim(),
    }));
};

const listOrderAssignments = () => {
  const db = getAssigneeDb();
  return db
    .prepare(`
      SELECT order_number, school_name, assigned_to, updated_at
      FROM order_assignments
    `)
    .all();
};

const setOrderAssignee = ({ orderNumber, assignee, currentStatus, schoolName }) => {
  const normalizedOrderNumber = String(orderNumber || "").trim();
  const normalizedStatus = String(currentStatus || "").trim().toLowerCase();
  const normalizedAssignee = normalizeOrderAssignee(assignee);
  const normalizedSchoolName = String(schoolName || "").trim() || null;
  const isClearingAssignee = String(assignee || "").trim() === "";

  if (!normalizedOrderNumber) {
    return { ok: false, message: "Order number is required." };
  }
  if (normalizedStatus !== "new" && normalizedStatus !== "freeze") {
    return { ok: false, message: "Assignee can change only for orders with status 'new' or 'freeze'." };
  }
  if (!isClearingAssignee && !normalizedAssignee) {
    return { ok: false, message: "Invalid assignee selected." };
  }

  const db = getAssigneeDb();
  const updatedAt = new Date().toISOString();
  if (isClearingAssignee) {
    db.prepare("DELETE FROM order_assignments WHERE order_number = ?").run(normalizedOrderNumber);
    return {
      ok: true,
      data: {
        order_number: normalizedOrderNumber,
        school_name: normalizedSchoolName,
        assigned_to: "",
        updated_at: updatedAt,
      },
    };
  }

  db.prepare(`
    INSERT INTO order_assignments (order_number, school_name, assigned_to, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(order_number) DO UPDATE SET
      school_name = excluded.school_name,
      assigned_to = excluded.assigned_to,
      updated_at = excluded.updated_at
  `).run(normalizedOrderNumber, normalizedSchoolName, normalizedAssignee, updatedAt);

  return {
    ok: true,
    data: {
      order_number: normalizedOrderNumber,
      school_name: normalizedSchoolName,
      assigned_to: normalizedAssignee,
      updated_at: updatedAt,
    },
  };
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

const moveOrderToBatch = ({ orderNumber, fromBatchId, toBatchId }) => {
  const normalizedOrderNumber = String(orderNumber || "").trim();
  const normalizedFromBatchId = Number(fromBatchId);
  const normalizedToBatchId = Number(toBatchId);

  if (!normalizedOrderNumber) {
    return { ok: false, message: "Order number is required." };
  }
  if (!Number.isInteger(normalizedFromBatchId) || normalizedFromBatchId <= 0) {
    return { ok: false, message: "Invalid source batch id." };
  }
  if (!Number.isInteger(normalizedToBatchId) || normalizedToBatchId <= 0) {
    return { ok: false, message: "Invalid target batch id." };
  }
  if (normalizedFromBatchId === normalizedToBatchId) {
    return { ok: false, message: "Source and target batch must be different." };
  }

  const registryDb = getBatchRegistryDb();
  const sourceBatch = registryDb
    .prepare("SELECT id, batch_name, status, db_path FROM batches WHERE id = ?")
    .get(normalizedFromBatchId);
  if (!sourceBatch) return { ok: false, message: "Source batch not found." };
  if (sourceBatch.status !== "building") {
    return { ok: false, message: "Orders can be moved only from batches with status 'building'." };
  }

  const targetBatch = registryDb
    .prepare("SELECT id, batch_name, status, db_path FROM batches WHERE id = ?")
    .get(normalizedToBatchId);
  if (!targetBatch) return { ok: false, message: "Target batch not found." };
  if (targetBatch.status !== "new") {
    return { ok: false, message: "Target batch must have status 'new'." };
  }

  const sourceOrderLink = registryDb
    .prepare(
      `
        SELECT batch_id, order_number, school_id, school_name, order_date
        FROM batch_orders
        WHERE batch_id = ? AND order_number = ?
      `
    )
    .get(normalizedFromBatchId, normalizedOrderNumber);
  if (!sourceOrderLink) {
    return { ok: false, message: "Order does not belong to the selected source batch." };
  }

  const existingInTarget = registryDb
    .prepare("SELECT 1 FROM batch_orders WHERE batch_id = ? AND order_number = ?")
    .get(normalizedToBatchId, normalizedOrderNumber);
  if (existingInTarget) {
    return { ok: false, message: "Order already exists in target batch." };
  }

  let sourceBatchDb;
  let targetBatchDb;
  const movedAt = new Date().toISOString();
  try {
    sourceBatchDb = new Database(sourceBatch.db_path);
    targetBatchDb = new Database(targetBatch.db_path);
    ensureBatchDbSchema(sourceBatchDb);
    ensureBatchDbSchema(targetBatchDb);

    const sourceOrderRow = sourceBatchDb
      .prepare(
        `
          SELECT order_number, school_id, school_name, personalized, product_id, product_type, order_date
          FROM orders
          WHERE order_number = ?
        `
      )
      .get(normalizedOrderNumber);
    if (!sourceOrderRow) {
      return { ok: false, message: "Order details not found in source batch database." };
    }

    const clearGeneratedTablesForRefetch = () => {
      sourceBatchDb.prepare("DELETE FROM prepared_students").run();
      sourceBatchDb.prepare("DELETE FROM prepared_classes").run();
      sourceBatchDb.prepare("DELETE FROM prepared_products").run();
      sourceBatchDb.prepare("DELETE FROM prepared_product_details").run();
      sourceBatchDb.prepare("DELETE FROM nonp_orders").run();
      sourceBatchDb.prepare("DELETE FROM nonp_order_assignments").run();
      sourceBatchDb.prepare("DELETE FROM BookDetails").run();
      sourceBatchDb.prepare("DELETE FROM school_student_books").run();
    };

    const transaction = registryDb.transaction(() => {
      registryDb
        .prepare("DELETE FROM batch_orders WHERE batch_id = ? AND order_number = ?")
        .run(normalizedFromBatchId, normalizedOrderNumber);

      registryDb
        .prepare(
          `
            INSERT INTO batch_orders (batch_id, order_number, school_id, school_name, order_date, added_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          normalizedToBatchId,
          normalizedOrderNumber,
          sourceOrderLink.school_id ?? null,
          sourceOrderLink.school_name ?? null,
          sourceOrderLink.order_date ?? null,
          movedAt
        );

      sourceBatchDb.prepare("DELETE FROM orders WHERE order_number = ?").run(normalizedOrderNumber);
      targetBatchDb
        .prepare(
          `
            INSERT INTO orders (
              order_number, school_id, school_name, personalized, product_id, product_type, order_date, added_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          sourceOrderRow.order_number,
          sourceOrderRow.school_id ?? null,
          sourceOrderRow.school_name ?? null,
          sourceOrderRow.personalized ?? null,
          sourceOrderRow.product_id ?? null,
          sourceOrderRow.product_type ?? null,
          sourceOrderRow.order_date ?? null,
          movedAt
        );

      clearGeneratedTablesForRefetch();

      sourceBatchDb
        .prepare("INSERT INTO batch_log (message, created_at) VALUES (?, ?)")
        .run(
          `Order ${normalizedOrderNumber} moved to batch ${targetBatch.batch_name}; source batch data cleared for refetch.`,
          movedAt
        );
      targetBatchDb
        .prepare("INSERT INTO batch_log (message, created_at) VALUES (?, ?)")
        .run(`Order ${normalizedOrderNumber} moved from batch ${sourceBatch.batch_name}.`, movedAt);
    });

    transaction();
    return {
      ok: true,
      data: {
        order_number: normalizedOrderNumber,
        source_batch_id: normalizedFromBatchId,
        source_batch_name: sourceBatch.batch_name,
        target_batch_id: normalizedToBatchId,
        target_batch_name: targetBatch.batch_name,
        moved_at: movedAt,
      },
    };
  } catch (error) {
    return { ok: false, message: error.message || "Unable to move order to another batch." };
  } finally {
    if (sourceBatchDb) sourceBatchDb.close();
    if (targetBatchDb) targetBatchDb.close();
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
  const appendExisting = Boolean(options.appendExisting);

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
  if (appendExisting && batch.status !== "building") {
    return { ok: false, message: "Append mode is only supported for batches with status 'building'." };
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
  let existingStudentsCount = 0;
  let existingClassesCount = 0;
  let existingProductsCount = 0;
  let existingProductDetailsCount = 0;
  let existingNonpOrdersCount = 0;
  let existingNonpAssignmentsCount = 0;
  let baseBasketSlot = 0;
  let batchDb;
  const preparedAt = new Date().toISOString();
  try {
    batchDb = new Database(batch.db_path);
    ensureBatchDbSchema(batchDb);

    if (appendExisting) {
      const maxStudentAssigned = Number(
        batchDb.prepare("SELECT MAX(COALESCE(assigned_number, 0)) AS v FROM prepared_students").get()?.v || 0
      );
      const maxNonpAssigned = Number(
        batchDb.prepare("SELECT MAX(COALESCE(assigned_number, 0)) AS v FROM nonp_order_assignments").get()?.v || 0
      );
      const maxAssigned = Math.max(maxStudentAssigned, maxNonpAssigned, 0);
      baseBasketSlot = Math.ceil(maxAssigned / STUDENTS_PER_BASKET);

      existingStudentsCount = Number(batchDb.prepare("SELECT COUNT(*) AS c FROM prepared_students").get()?.c || 0);
      existingClassesCount = Number(batchDb.prepare("SELECT COUNT(*) AS c FROM prepared_classes").get()?.c || 0);
      existingProductsCount = Number(batchDb.prepare("SELECT COUNT(*) AS c FROM prepared_products").get()?.c || 0);
      existingProductDetailsCount = Number(batchDb.prepare("SELECT COUNT(*) AS c FROM prepared_product_details").get()?.c || 0);
      existingNonpOrdersCount = Number(batchDb.prepare("SELECT COUNT(*) AS c FROM nonp_orders").get()?.c || 0);
      existingNonpAssignmentsCount = Number(batchDb.prepare("SELECT COUNT(*) AS c FROM nonp_order_assignments").get()?.c || 0);
    }

    const allocation = assignPreparedStudentSlots(preparedStudents, baseBasketSlot);
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

  try {
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
      if (!appendExisting) {
        batchDb.prepare("DELETE FROM prepared_students").run();
        batchDb.prepare("DELETE FROM prepared_classes").run();
        batchDb.prepare("DELETE FROM prepared_products").run();
        batchDb.prepare("DELETE FROM prepared_product_details").run();
        batchDb.prepare("DELETE FROM nonp_orders").run();
        batchDb.prepare("DELETE FROM nonp_order_assignments").run();
      }
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
        if (
          appendExisting &&
          batchDb
            .prepare(
              "SELECT 1 FROM prepared_students WHERE school_id = ? AND student_id = ? AND COALESCE(order_details_id, '') = COALESCE(?, '')"
            )
            .get(item.school_id, item.student_id, item.order_details_id)
        ) {
          return;
        }
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
        if (
          appendExisting &&
          batchDb
            .prepare("SELECT 1 FROM prepared_classes WHERE school_id = ? AND class_id = ?")
            .get(item.school_id, item.class_id)
        ) {
          return;
        }
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
        if (
          appendExisting &&
          batchDb
            .prepare("SELECT 1 FROM prepared_products WHERE source_id = ? AND school_id = ?")
            .get(item.source_id, item.school_id)
        ) {
          return;
        }
        insertProduct.run(item.source_id, item.school_id, item.name, item.type, item.raw_json);
      });

      const insertProductDetail = batchDb.prepare(`
        INSERT INTO prepared_product_details (
          source_id, product_id, school_id, class_id, name, covercode, innercode, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      preparedProductDetails.forEach((item) => {
        if (
          appendExisting &&
          batchDb
            .prepare("SELECT 1 FROM prepared_product_details WHERE source_id = ? AND school_id = ?")
            .get(item.source_id, item.school_id)
        ) {
          return;
        }
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
        if (
          appendExisting &&
          batchDb
            .prepare("SELECT 1 FROM nonp_orders WHERE source_id = ? AND school_id = ?")
            .get(item.source_id, item.school_id)
        ) {
          return;
        }
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
        if (
          appendExisting &&
          batchDb
            .prepare(
              "SELECT 1 FROM nonp_order_assignments WHERE nonp_order_source_id = ? AND unit_index = ? AND school_id = ?"
            )
            .get(item.nonp_order_source_id, item.unit_index, item.school_id)
        ) {
          return;
        }
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
          `${appendExisting ? "Batch appended and prepared" : allowBuildingRefetch ? "Batch fetched again and prepared" : "Batch prepared"} with ${assignedStudents.length} students, ${preparedClasses.length} classes, ${preparedProducts.length} products, ${preparedProductDetails.length} product details, ${preparedNonpOrders.length} nonp orders and ${assignedNonpOrderUnits.length} assigned nonp units. Buckets used: ${Math.ceil(nonpAllocationMeta.next_basket_slot / BASKETS_PER_BUCKET)}, baskets used: ${nonpAllocationMeta.next_basket_slot}.`,
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
        students_count: appendExisting ? existingStudentsCount + assignedStudents.length : assignedStudents.length,
        classes_count: appendExisting ? existingClassesCount + preparedClasses.length : preparedClasses.length,
        products_count: appendExisting ? existingProductsCount + preparedProducts.length : preparedProducts.length,
        product_details_count: appendExisting
          ? existingProductDetailsCount + preparedProductDetails.length
          : preparedProductDetails.length,
        nonp_orders_count: appendExisting ? existingNonpOrdersCount + preparedNonpOrders.length : preparedNonpOrders.length,
        nonp_order_units_count: appendExisting
          ? existingNonpAssignmentsCount + assignedNonpOrderUnits.length
          : assignedNonpOrderUnits.length,
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
  getAssigneeDb();
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
  ipcMain.handle("list-batch-personalized-order-ids", (_event, payload) => {
    try {
      return listBatchPersonalizedOrderIds(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to load personalized orders for batch." };
    }
  });
  ipcMain.handle("compare-prepared-students-missing", (_event, payload) => {
    try {
      return comparePreparedStudentsMissing(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to compare missing prepared students." };
    }
  });
  ipcMain.handle("add-missing-prepared-students-to-batch", (_event, payload) => {
    try {
      return addMissingPreparedStudentsToBatch(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to add missing students to target batch." };
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
      return {
        ok: true,
        data: {
          batch_links: listOrderBatchLinks(),
          order_assignments: listOrderAssignments(),
        },
      };
    } catch (error) {
      return { ok: false, message: error.message || "Unable to load batch assignments." };
    }
  });
  ipcMain.handle("set-order-assignee", (_event, payload) => {
    try {
      return setOrderAssignee(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to update order assignee." };
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
  ipcMain.handle("move-order-to-batch", (_event, payload) => {
    try {
      return moveOrderToBatch(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to move order to another batch." };
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
  ipcMain.handle("list-batch-verify-students", (_event, payload) => {
    try {
      return listBatchVerifyStudents(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to load verify students." };
    }
  });
  ipcMain.handle("open-student-photo-file", (_event, payload) => {
    try {
      return openStudentPhotoFile(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to open student photo file." };
    }
  });
  ipcMain.handle("regenerate-student-external", (_event, payload) => {
    try {
      return regenerateStudentWithExternal(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to regenerate student." };
    }
  });
  ipcMain.handle("analyze-batch-student-duplicates", (_event, payload) => {
    try {
      return analyzeBatchStudentDuplicates(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to analyze duplicates." };
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
  ipcMain.handle("list-batch-stage-status", (_event, payload) => {
    try {
      return listBatchStageStatus(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to load batch stage status." };
    }
  });
  ipcMain.handle("set-batch-completed", (_event, payload) => {
    try {
      return setBatchCompleted(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to update batch status." };
    }
  });
  ipcMain.handle("export-batch-bookdetails-excel", async (_event, payload) => {
    try {
      return await exportBatchBookDetailsExcel(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to export BookDetails." };
    }
  });
  ipcMain.handle("export-orders-status-csv", async (_event, payload) => {
    try {
      return await exportOrdersStatusCsv(payload || {});
    } catch (error) {
      return { ok: false, message: error.message || "Unable to export orders CSV." };
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
  if (assigneeDb) {
    assigneeDb.close();
    assigneeDb = null;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});
