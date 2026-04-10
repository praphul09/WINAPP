const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DEFAULT_BATCH_ROOT = "\\\\pixartnas\\home\\INTERNAL_PROCESSING\\BATCHES";
const DEFAULT_BATCH_BACKUP_ROOT = "\\\\pixartnas\\home\\INTERNAL_PROCESSING\\BATCHES_BACKUP";
const DEFAULT_BOOKDETAIL_PATH = path.join(__dirname, "..", "BOOKDETAIL.json");
const MAX_BUCKETS = 12;
const BASKETS_PER_BUCKET = 12;
const STUDENTS_PER_BASKET = 12;
const TOTAL_BASKETS = MAX_BUCKETS * BASKETS_PER_BUCKET;

const FIRST_NAMES = [
  "Aarav",
  "Aanya",
  "Vihaan",
  "Anaya",
  "Ishaan",
  "Diya",
  "Reyansh",
  "Myra",
  "Advik",
  "Saanvi",
  "Kabir",
  "Kiara",
];

const LAST_NAMES = [
  "Sharma",
  "Patel",
  "Singh",
  "Gupta",
  "Reddy",
  "Nair",
  "Das",
  "Mehta",
  "Iyer",
  "Jain",
  "Khan",
  "Joshi",
];

const AREAS = [
  "Ashok Nagar",
  "Lake View",
  "Green Park",
  "Model Town",
  "Civil Lines",
  "Gandhi Road",
  "MG Road",
  "Station Road",
];

const PRODUCT_NAMES = [
  "Starter Book Set",
  "Scholar Pack",
  "Campus Combo",
  "Merit Series",
  "Bright Future Kit",
];

const BOOK_VARIANTS = [
  { suffix: "ENG", name: "English", cover: "CVR-ENG", inner: "110000101" },
  { suffix: "MAT", name: "Mathematics", cover: "CVR-MAT", inner: "110000102" },
  { suffix: "SCI", name: "Science", cover: "CVR-SCI", inner: "110000103" },
  { suffix: "SOC", name: "Social Studies", cover: "CVR-SOC", inner: "110000104" },
  { suffix: "GK", name: "General Knowledge", cover: "CVR-GK", inner: "110000105" },
  { suffix: "ART", name: "Art", cover: "CVR-ART", inner: "110000106" },
  { suffix: "COMP", name: "Computer", cover: "CVR-COM", inner: "110000107" },
  { suffix: "HW", name: "Homework", cover: "CVR-HWK", inner: "110000108" },
  { suffix: "EVS", name: "EVS", cover: "CVR-EVS", inner: "110000109" },
  { suffix: "HIN", name: "Hindi", cover: "CVR-HIN", inner: "110000110" },
  { suffix: "MOR", name: "Moral Science", cover: "CVR-MOR", inner: "110000111" },
  { suffix: "DRAW", name: "Drawing", cover: "CVR-DRW", inner: "110000112" },
  { suffix: "GRAM", name: "Grammar", cover: "CVR-GRM", inner: "110000113" },
  { suffix: "CURS", name: "Cursive Writing", cover: "CVR-CUR", inner: "110000114" },
  { suffix: "TEST", name: "Test Notebook", cover: "CVR-TST", inner: "110000115" },
  { suffix: "ACT", name: "Activity", cover: "CVR-ACT", inner: "110000116" },
  { suffix: "LAB", name: "Lab Record", cover: "CVR-LAB", inner: "110000117" },
  { suffix: "PROJ", name: "Project Book", cover: "CVR-PRJ", inner: "110000118" },
  { suffix: "READ", name: "Reading Log", cover: "CVR-REA", inner: "110000119" },
  { suffix: "SPELL", name: "Spell Book", cover: "CVR-SPL", inner: "110000120" },
  { suffix: "PHON", name: "Phonics", cover: "CVR-PHO", inner: "110000121" },
  { suffix: "NUM", name: "Numbers", cover: "CVR-NUM", inner: "110000122" },
  { suffix: "RHY", name: "Rhymes", cover: "CVR-RHY", inner: "110000123" },
  { suffix: "WRK", name: "Worksheet File", cover: "CVR-WRK", inner: "110000124" },
  { suffix: "BIO", name: "Biology", cover: "CVR-BIO", inner: "110000125" },
  { suffix: "CHE", name: "Chemistry", cover: "CVR-CHE", inner: "110000126" },
  { suffix: "PHY", name: "Physics", cover: "CVR-PHY", inner: "110000127" },
  { suffix: "GEO", name: "Geography", cover: "CVR-GEO", inner: "110000128" },
  { suffix: "HIS", name: "History", cover: "CVR-HIS", inner: "110000129" },
  { suffix: "CIV", name: "Civics", cover: "CVR-CIV", inner: "110000130" },
  { suffix: "ACC", name: "Accounts", cover: "CVR-ACC", inner: "110000131" },
  { suffix: "ECO", name: "Economics", cover: "CVR-ECO", inner: "110000132" },
  { suffix: "BST", name: "Business Studies", cover: "CVR-BST", inner: "110000133" },
  { suffix: "STAT", name: "Statistics", cover: "CVR-STA", inner: "110000134" },
  { suffix: "ALG", name: "Algebra", cover: "CVR-ALG", inner: "110000135" },
  { suffix: "GEO2", name: "Geometry", cover: "CVR-GE2", inner: "110000136" },
  { suffix: "TRI", name: "Trigonometry", cover: "CVR-TRI", inner: "110000137" },
  { suffix: "CAL", name: "Calculus", cover: "CVR-CAL", inner: "110000138" },
  { suffix: "ROBO", name: "Robotics", cover: "CVR-ROB", inner: "110000139" },
  { suffix: "AI", name: "Artificial Intelligence", cover: "CVR-AII", inner: "110000140" },
  { suffix: "COD", name: "Coding", cover: "CVR-COD", inner: "110000141" },
  { suffix: "DES", name: "Design Thinking", cover: "CVR-DES", inner: "110000142" },
  { suffix: "MUS", name: "Music", cover: "CVR-MUS", inner: "110000143" },
  { suffix: "DAN", name: "Dance", cover: "CVR-DAN", inner: "110000144" },
  { suffix: "PE", name: "Physical Education", cover: "CVR-PEE", inner: "110000145" },
  { suffix: "YOG", name: "Yoga", cover: "CVR-YOG", inner: "110000146" },
  { suffix: "LIB", name: "Library", cover: "CVR-LIB", inner: "110000147" },
  { suffix: "JRN", name: "Journal", cover: "CVR-JRN", inner: "110000148" },
];

const BOOK_SIZES = ["BIG", "MEDIUM", "SMALL"];
const BOOK_TYPES = ["11", "12", "22"];
const YES_NO = ["Y", "N"];

const parseArgs = (argv) => {
  const result = {
    students: 500,
    schools: 20,
    grades: 4,
    detailsPerClass: 8,
    batches: 1,
    batchName: "test-batch",
    root: process.env.BATCH_ROOT_DIR || DEFAULT_BATCH_ROOT,
    status: "building",
    active: false,
    bookDetailPath: DEFAULT_BOOKDETAIL_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--students" && next) {
      result.students = Number(next);
      index += 1;
    } else if (arg === "--schools" && next) {
      result.schools = Number(next);
      index += 1;
    } else if (arg === "--grades" && next) {
      result.grades = Number(next);
      index += 1;
    } else if (arg === "--details-per-class" && next) {
      result.detailsPerClass = Number(next);
      index += 1;
    } else if (arg === "--batches" && next) {
      result.batches = Number(next);
      index += 1;
    } else if (arg === "--batch-name" && next) {
      result.batchName = String(next);
      index += 1;
    } else if (arg === "--root" && next) {
      result.root = String(next);
      index += 1;
    } else if (arg === "--status" && next) {
      result.status = String(next);
      index += 1;
    } else if (arg === "--active") {
      result.active = true;
    } else if (arg === "--bookdetail-path" && next) {
      result.bookDetailPath = String(next);
      index += 1;
    }
  }

  return result;
};

const validateOptions = (options) => {
  const numericFields = ["students", "schools", "grades", "detailsPerClass", "batches"];
  numericFields.forEach((field) => {
    if (!Number.isInteger(options[field]) || options[field] <= 0) {
      throw new Error(`Invalid value for ${field}: ${options[field]}`);
    }
  });

  if (!["new", "building", "processing", "completed"].includes(options.status)) {
    throw new Error(`Invalid status: ${options.status}. Use "new", "building", "processing", or "completed".`);
  }

  if (options.active && options.status !== "processing") {
    throw new Error('The "--active" flag can only be used with status "processing".');
  }

  if (options.detailsPerClass > BOOK_VARIANTS.length) {
    throw new Error(
      `detailsPerClass exceeds supported variants. Maximum: ${BOOK_VARIANTS.length}, received: ${options.detailsPerClass}.`
    );
  }

  const requiredBaskets = options.schools * Math.ceil(options.students / options.schools / STUDENTS_PER_BASKET);
  if (requiredBaskets > TOTAL_BASKETS) {
    throw new Error(
      `Requested data exceeds slot capacity. Required baskets: ${requiredBaskets}, available baskets: ${TOTAL_BASKETS}.`
    );
  }
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_batches_single_active ON batches(active) WHERE active = 1;
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
  `);
};

const pick = (list) => list[Math.floor(Math.random() * list.length)];

const zeroPad = (value, length) => String(value).padStart(length, "0");

const formatBackupTimestamp = (date) =>
  `${String(date.getDate()).padStart(2, "0")}${String(date.getMonth() + 1).padStart(2, "0")}${String(
    date.getFullYear()
  ).slice(-2)}${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;

const backupBatchRegistry = (registryDb, root) => {
  const registryPath = path.join(root, "batch-registry.db");
  if (!fs.existsSync(registryPath)) {
    throw new Error(`Batch registry not found: ${registryPath}`);
  }

  if (!fs.existsSync(DEFAULT_BATCH_BACKUP_ROOT)) {
    fs.mkdirSync(DEFAULT_BATCH_BACKUP_ROOT, { recursive: true });
  }

  const parsed = path.parse(registryPath);
  const backupPath = path.join(
    DEFAULT_BATCH_BACKUP_ROOT,
    `${parsed.name}-${formatBackupTimestamp(new Date())}${parsed.ext}`
  );

  registryDb.pragma("wal_checkpoint(FULL)");
  fs.copyFileSync(registryPath, backupPath);
  return backupPath;
};

const toElevenDigitNumber = (value) => zeroPad(String(value).replace(/\D/g, ""), 11).slice(-11);

const pickUniqueVariants = (variants, count) => {
  const pool = [...variants];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  return pool.slice(0, count);
};

const makeRandomBookDetailEntry = (innercode, variantIndex) => {
  const type = pick(BOOK_TYPES);
  const bookSize = pick(BOOK_SIZES);
  const per = pick(YES_NO);
  const realtime = pick(YES_NO);
  const spinePrefix = ["AB", "AC", "NX", "SP", "QT"][variantIndex % 5];
  return {
    "OLD SPINE": "-",
    REV: variantIndex % 4 === 0 ? "R1" : "",
    "NEW SPINE COVER": `${spinePrefix}${zeroPad((variantIndex % 97) + 1, 2)}`,
    PER: per,
    TYPE: type,
    "BOOK SIZE": bookSize,
    REAL_TIME_PRINT: realtime,
    INNERCODE: innercode,
  };
};

const buildSchools = (schoolCount, namespace) =>
  Array.from({ length: schoolCount }, (_value, index) => {
    const schoolNumber = index + 1;
    const prefix = namespace ? `${namespace}-` : "";
    return {
      school_id: `SCH-${zeroPad(schoolNumber, 3)}`,
      school_name: `School ${zeroPad(schoolNumber, 2)}`,
      order_number: `${prefix}ORD-${zeroPad(schoolNumber, 4)}`,
      order_details_id: `${prefix}OD-${zeroPad(schoolNumber, 4)}`,
      product_id: `${prefix}PROD-${zeroPad(schoolNumber, 4)}`,
      product_name: `${pick(PRODUCT_NAMES)} ${schoolNumber}`,
      product_type: "personalized",
    };
  });

const buildGrades = (gradeCount) =>
  Array.from({ length: gradeCount }, (_value, index) => ({
    class_id: `GRADE-${index + 1}`,
    class_name: `Grade ${index + 1}`,
  }));

const assignStudentSlots = (students) => {
  const studentsBySchool = new Map();
  students.forEach((student) => {
    const key = student.school_id;
    if (!studentsBySchool.has(key)) {
      studentsBySchool.set(key, []);
    }
    studentsBySchool.get(key).push(student);
  });

  let nextBasketSlot = 0;
  const assigned = [];
  for (const schoolStudents of studentsBySchool.values()) {
    schoolStudents.forEach((student, index) => {
      const slotIndex = nextBasketSlot + Math.floor(index / STUDENTS_PER_BASKET);
      const bucketNumber = Math.floor(slotIndex / BASKETS_PER_BUCKET) + 1;
      const basketNumber = (slotIndex % BASKETS_PER_BUCKET) + 1;
      const positionInBasket = (index % STUDENTS_PER_BASKET) + 1;

      assigned.push({
        ...student,
        colour1: String(bucketNumber),
        colour2: String(basketNumber),
        assigned_number: slotIndex * STUDENTS_PER_BASKET + positionInBasket,
      });
    });

    nextBasketSlot += Math.ceil(schoolStudents.length / STUDENTS_PER_BASKET);
  }

  return assigned;
};

const assignNonpOrderSlots = (orders, startBasketSlot) => {
  let nextBasketSlot = Number.isInteger(startBasketSlot) && startBasketSlot >= 0 ? startBasketSlot : 0;
  const assignments = [];

  orders.forEach((order) => {
    const quantity = Math.max(0, Math.floor(Number(order.quantity) || 0));
    if (!quantity) return;

    for (let index = 0; index < quantity; index += 1) {
      const slotIndex = nextBasketSlot + Math.floor(index / STUDENTS_PER_BASKET);
      const bucketNumber = Math.floor(slotIndex / BASKETS_PER_BUCKET) + 1;
      const basketNumber = (slotIndex % BASKETS_PER_BUCKET) + 1;
      const positionInBasket = (index % STUDENTS_PER_BASKET) + 1;

      assignments.push({
        nonp_order_source_id: order.source_id,
        order_details_id: order.order_details_id,
        product_id: order.product_id,
        class_id: order.class_id,
        school_id: order.school_id,
        unit_index: index + 1,
        colour1: String(bucketNumber),
        colour2: String(basketNumber),
        assigned_number: slotIndex * STUDENTS_PER_BASKET + positionInBasket,
        raw_json: order.raw_json,
      });
    }

    nextBasketSlot += Math.ceil(quantity / STUDENTS_PER_BASKET);
  });

  return assignments;
};

const getStudentBasketUsage = (students) => {
  if (!students.length) return 0;
  return Math.ceil(
    Math.max(...students.map((student) => Number(student.assigned_number) || 0)) / STUDENTS_PER_BASKET
  );
};

const buildStudents = ({ studentCount, schools, grades }) => {
  const rawStudents = Array.from({ length: studentCount }, (_value, index) => {
    const studentNumber = index + 1;
    const school = schools[index % schools.length];
    const grade = grades[index % grades.length];
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const studentName = `${firstName} ${lastName}`;
    const guardianName = `${pick(FIRST_NAMES)} ${lastName}`;
    const secondGuardianName = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    const dobYear = 2010 + (index % 8);
    const dobMonth = zeroPad((index % 12) + 1, 2);
    const dobDay = zeroPad((index % 28) + 1, 2);

    const raw = {
      id: `SRC-STU-${zeroPad(studentNumber, 5)}`,
      student_id: `STU-${zeroPad(studentNumber, 5)}`,
      order_details_id: school.order_details_id,
      school_id: school.school_id,
      school_name: school.school_name,
      product_id: school.product_id,
      personalized: 1,
      student: {
        class_section: {
          class_id: grade.class_id,
          name: grade.class_name,
          class: {
            id: grade.class_id,
            full_name: grade.class_name,
          },
        },
        guardian: {
          full_name: guardianName,
          mobile: `98${zeroPad(studentNumber, 8)}`,
          sec_guardian: {
            sec_guardian_full_name: secondGuardianName,
            sec_guardian_mobile: `97${zeroPad(studentNumber, 8)}`,
          },
        },
      },
    };

    return {
      source_id: raw.id,
      order_details_id: school.order_details_id,
      student_id: raw.student_id,
      school_id: school.school_id,
      school_name: school.school_name,
      class_id: grade.class_id,
      class_name: grade.class_name,
      student_name: studentName,
      dob: `${dobYear}-${dobMonth}-${dobDay}`,
      current_address: `${(index % 50) + 1}, ${pick(AREAS)}`,
      photo: "",
      guardian_name: guardianName,
      guardian_mobile: raw.student.guardian.mobile,
      guardian_image: "",
      sec_guardian_name: secondGuardianName,
      sec_guardian_mobile: raw.student.guardian.sec_guardian.sec_guardian_mobile,
      sec_guardian_image: "",
      raw_json: JSON.stringify(raw),
    };
  });

  return assignStudentSlots(rawStudents);
};

const buildProducts = (schools) =>
  schools.map((school, index) => ({
    source_id: school.product_id,
    school_id: school.school_id,
    name: school.product_name,
    type: school.product_type,
    raw_json: JSON.stringify({
      id: school.product_id,
      school_id: school.school_id,
      name: school.product_name,
      type: school.product_type,
      order_details_id: school.order_details_id,
      order_details: {
        id: school.order_details_id,
      },
      school_name: school.school_name,
      ordinal: index + 1,
    }),
  }));

const buildProductDetails = ({ schools, grades, detailsPerClass }) => {
  return schools.flatMap((school) =>
    grades.flatMap((grade) =>
      pickUniqueVariants(BOOK_VARIANTS, detailsPerClass).map((variant, index) => {
        const gradeDigits = zeroPad(Number(grade.class_id.replace(/\D/g, "")) || 0, 2);
        const schoolDigits = zeroPad(Number(school.school_id.replace(/\D/g, "")) || 0, 3);
        const variantDigits = zeroPad(index + 1, 1);
        const innercode = toElevenDigitNumber(`${variant.inner}${gradeDigits}${variantDigits}`);
        const covercode = toElevenDigitNumber(`${schoolDigits}${variant.inner}${gradeDigits}`);
        return {
          source_id: `${school.product_id}-${grade.class_id}-${index + 1}`,
          product_id: school.product_id,
          school_id: school.school_id,
          class_id: grade.class_id,
          name: `${grade.class_name} ${variant.name}`,
          covercode,
          innercode,
          raw_json: JSON.stringify({
            id: `${school.product_id}-${grade.class_id}-${index + 1}`,
            product_id: school.product_id,
            school_id: school.school_id,
            class_id: grade.class_id,
            name: `${grade.class_name} ${variant.name}`,
            covercode,
            innercode,
          }),
        };
      })
    )
  );
};

const buildBookDetailJson = (productDetails) => {
  const config = {};
  const seen = new Set();
  productDetails.forEach((detail, index) => {
    if (!detail.innercode || seen.has(detail.innercode)) {
      return;
    }
    seen.add(detail.innercode);
    config[detail.innercode] = makeRandomBookDetailEntry(detail.innercode, index);
  });
  return config;
};

const writeBookDetailJson = (targetPath, config) => {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(targetPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
};

const buildOrders = (schools, createdAt) =>
  schools.map((school) => ({
    order_number: school.order_number,
    school_id: school.school_id,
    school_name: school.school_name,
    personalized: "1",
    product_id: school.product_id,
    product_type: school.product_type,
    order_date: createdAt.slice(0, 10),
    added_at: createdAt,
  }));

const buildNonpOrders = ({ schools, grades }) =>
  schools.slice(0, 3).flatMap((school, schoolIndex) =>
    grades.map((grade, gradeIndex) => {
      const quantity = 4 + ((schoolIndex + gradeIndex) % 7);
      return {
        source_id: `${school.order_details_id}-NONP-${grade.class_id}`,
        order_details_id: `${school.order_details_id}-NONP-${grade.class_id}`,
        product_id: school.product_id,
        class_id: grade.class_id,
        quantity,
        school_id: school.school_id,
        raw_json: JSON.stringify({
          id: `${school.order_details_id}-NONP-${grade.class_id}`,
          order_details_id: `${school.order_details_id}-NONP-${grade.class_id}`,
          product_id: school.product_id,
          class_id: grade.class_id,
          school_id: school.school_id,
          quantity,
          type: "nonp",
        }),
      };
    })
  );

const buildNonpOrderRows = (schools, grades, createdAt) =>
  schools.slice(0, 3).flatMap((school) =>
    grades.map((grade) => ({
      order_number: `${school.order_number}-NONP-${grade.class_id}`,
      school_id: school.school_id,
      school_name: school.school_name,
      personalized: "0",
      product_id: school.product_id,
      product_type: "nonp",
      order_date: createdAt.slice(0, 10),
      added_at: createdAt,
    }))
  );

const safeBatchBase = (value) =>
  String(value)
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9-_]/g, "")
    .replace(/-+/g, "-") || "test-batch";

const createBatchFiles = ({ registryDb, root, batchName, status, active }) => {
  const createdAt = new Date().toISOString();
  const timestamp = createdAt.replace(/[-:.TZ]/g, "").slice(0, 14);
  const dbFileName = `${safeBatchBase(batchName)}-${timestamp}.db`;
  const dbPath = path.join(root, dbFileName);
  const batchDb = new Database(dbPath);
  ensureBatchDbSchema(batchDb);
  batchDb.prepare("INSERT INTO batch_info (batch_name, created_at) VALUES (?, ?)").run(batchName, createdAt);
  const normalizedActive = active && status === "processing" ? 1 : 0;
  const binderGenerated = ["processing", "completed"].includes(status) ? 1 : 0;
  const insert = registryDb.prepare(`
    INSERT INTO batches (batch_name, created_at, status, active, inner_binder_generated, cover_binder_generated, db_path)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const info = insert.run(
    batchName,
    createdAt,
    status,
    normalizedActive,
    binderGenerated,
    binderGenerated,
    dbPath
  );
  const registryBackupPath = backupBatchRegistry(registryDb, root);

  return {
    batchDb,
    batchId: Number(info.lastInsertRowid),
    batchName,
    createdAt,
    dbPath,
    registryBackupPath,
  };
};

const insertBatchData = ({
  registryDb,
  batchDb,
  batchId,
  createdAt,
  schools,
  grades,
  students,
  products,
  productDetails,
  nonpOrders,
  nonpAssignments,
}) => {
  const orderRows = buildOrders(schools, createdAt);
  const nonpOrderRows = buildNonpOrderRows(schools, grades, createdAt);
  const insertRegistryOrder = registryDb.prepare(`
    INSERT INTO batch_orders (batch_id, order_number, school_id, school_name, order_date, added_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  [...orderRows, ...nonpOrderRows].forEach((order) => {
    insertRegistryOrder.run(
      batchId,
      order.order_number,
      order.school_id,
      order.school_name,
      order.order_date,
      order.added_at
    );
  });

  const transaction = batchDb.transaction(() => {
    const insertOrder = batchDb.prepare(`
      INSERT INTO orders (
        order_number, school_id, school_name, personalized, product_id, product_type, order_date, added_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    [...orderRows, ...nonpOrderRows].forEach((order) => {
      insertOrder.run(
        order.order_number,
        order.school_id,
        order.school_name,
        order.personalized,
        order.product_id,
        order.product_type,
        order.order_date,
        order.added_at
      );
    });

    const insertStudent = batchDb.prepare(`
      INSERT INTO prepared_students (
        source_id, order_details_id, student_id, school_id, school_name, colour1, colour2, assigned_number, class_id, class_name,
        student_name, dob, current_address, photo, guardian_name, guardian_mobile, guardian_image, sec_guardian_name,
        sec_guardian_mobile, sec_guardian_image, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    students.forEach((student) => {
      insertStudent.run(
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
    });

    const insertProduct = batchDb.prepare(`
      INSERT INTO prepared_products (source_id, school_id, name, type, raw_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    products.forEach((product) => {
      insertProduct.run(product.source_id, product.school_id, product.name, product.type, product.raw_json);
    });

    const insertProductDetail = batchDb.prepare(`
      INSERT INTO prepared_product_details (
        source_id, product_id, school_id, class_id, name, covercode, innercode, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    productDetails.forEach((detail) => {
      insertProductDetail.run(
        detail.source_id,
        detail.product_id,
        detail.school_id,
        detail.class_id,
        detail.name,
        detail.covercode,
        detail.innercode,
        detail.raw_json
      );
    });

    const insertNonpOrder = batchDb.prepare(`
      INSERT INTO nonp_orders (
        source_id, order_details_id, product_id, class_id, quantity, school_id, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    nonpOrders.forEach((order) => {
      insertNonpOrder.run(
        order.source_id,
        order.order_details_id,
        order.product_id,
        order.class_id,
        order.quantity,
        order.school_id,
        order.raw_json
      );
    });

    const insertNonpOrderAssignment = batchDb.prepare(`
      INSERT INTO nonp_order_assignments (
        nonp_order_source_id, order_details_id, product_id, class_id, school_id, unit_index, colour1, colour2, assigned_number, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    nonpAssignments.forEach((assignment) => {
      insertNonpOrderAssignment.run(
        assignment.nonp_order_source_id,
        assignment.order_details_id,
        assignment.product_id,
        assignment.class_id,
        assignment.school_id,
        assignment.unit_index,
        assignment.colour1,
        assignment.colour2,
        assignment.assigned_number,
        assignment.raw_json
      );
    });

    batchDb
      .prepare("INSERT INTO batch_log (message, created_at) VALUES (?, ?)")
      .run(
        `Seeded ${students.length} students, ${products.length} products, ${productDetails.length} product details, ${nonpOrders.length} nonp orders and ${nonpAssignments.length} nonp assignments.`,
        createdAt
      );
  });

  transaction();
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  validateOptions(options);

  if (!fs.existsSync(options.root)) {
    throw new Error(`Batch root not found: ${options.root}`);
  }

  const registryPath = path.join(options.root, "batch-registry.db");
  const registryDb = new Database(registryPath);
  ensureBatchRegistrySchema(registryDb);

  const grades = buildGrades(options.grades);

  const createdBatches = [];
  let latestBookDetailConfig = {};
  try {
    for (let index = 0; index < options.batches; index += 1) {
      const batchName =
        options.batches === 1
          ? options.batchName
          : `${options.batchName}-${zeroPad(index + 1, 2)}`;
      const namespace = `B${zeroPad(index + 1, 2)}`;
      const schools = buildSchools(options.schools, namespace);
      const students = buildStudents({
        studentCount: options.students,
        schools,
        grades,
      });
      const products = buildProducts(schools);
      const productDetails = buildProductDetails({
        schools,
        grades,
        detailsPerClass: options.detailsPerClass,
      });
      const allProducts = [...products];
      const allProductDetails = [...productDetails];
      const nonpOrders = buildNonpOrders({ schools, grades });
      const nonpAssignments = assignNonpOrderSlots(nonpOrders, getStudentBasketUsage(students));
      latestBookDetailConfig = buildBookDetailJson(allProductDetails);
      const { batchDb, batchId, createdAt, dbPath, registryBackupPath } = createBatchFiles({
        registryDb,
        root: options.root,
        batchName,
        status: options.status,
        active: options.active && index === 0,
      });

      try {
        insertBatchData({
          registryDb,
          batchDb,
          batchId,
          createdAt,
          schools,
          grades,
          students,
          products: allProducts,
          productDetails: allProductDetails,
          nonpOrders,
          nonpAssignments,
        });
        createdBatches.push({
          batchId,
          batchName,
          dbPath,
          registryBackupPath,
          students: students.length,
          products: allProducts.length,
          productDetails: allProductDetails.length,
        });
      } finally {
        batchDb.close();
      }
    }
  } finally {
    registryDb.close();
  }

  writeBookDetailJson(options.bookDetailPath, latestBookDetailConfig);

  createdBatches.forEach((batch) => {
    console.log(
      [
        `Created batch ${batch.batchId}`,
        `name=${batch.batchName}`,
        `students=${batch.students}`,
        `products=${batch.products}`,
        `product_details=${batch.productDetails}`,
        `db=${batch.dbPath}`,
        `registry_backup=${batch.registryBackupPath}`,
        `bookdetail=${options.bookDetailPath}`,
      ].join(" | ")
    );
  });
};

main();
