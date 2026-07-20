import { API_ENDPOINTS } from "./api-config.js";
import { callApi, callApiFormData } from "./api.js";
import {
  getState,
  setActiveStatus,
  updateOrder,
  updateOrderStatus,
  subscribe,
} from "./state.js";

const STATUS_LABELS = [
  { key: "all", label: "All orders" },
  { key: "new", label: "New" },
  { key: "freeze", label: "Freeze" },
  { key: "pending_approval", label: "Pending approval" },
  { key: "processing", label: "Processing" },
  { key: "invoice", label: "Invoice" },
  { key: "dispatch", label: "Dispatch" },
  { key: "delivered", label: "Delivered" },
];
const ASSIGNEE_OPTIONS = ["Jagadish", "Ashwin", "Surya", "other"];

const STATUS_CHIPS = {
  new: "chip-new",
  freeze: "chip-freeze",
  pending_approval: "chip-pending",
  processing: "chip-processing",
  invoice: "chip-invoice",
  dispatch: "chip-dispatch",
  delivered: "chip-delivered",
};

const tabsContainer = document.getElementById("status-tabs");
const tableTitle = document.getElementById("table-title");
const tableCount = document.getElementById("table-count");
const ordersBody = document.getElementById("orders-body");
const refreshBtn = document.getElementById("refresh-btn");
const lastRefresh = document.getElementById("last-refresh");
const nameFilterInput = document.createElement("input");
const statusFilterSelect = document.createElement("select");
const orderTypeFilterSelect = document.createElement("select");
const assigneeFilterSelect = document.createElement("select");
const batchFilterInput = document.createElement("input");
const batchFilterOptions = document.createElement("datalist");
const selectAllOrdersInput = document.getElementById("select-all-orders");
const bulkPdfButton = document.createElement("button");
const bulkSendForApprovalButton = document.createElement("button");
const downloadCsvButton = document.createElement("button");

const modalBackdrop = document.getElementById("modal-backdrop");
const modalTitle = document.getElementById("modal-title");
const modalMessage = document.getElementById("modal-message");
const modalTable = document.getElementById("modal-table");
const modalClose = document.getElementById("modal-close");
const loadingBackdrop = document.getElementById("loading-backdrop");
let editBackdrop;
let editModalTitle;
let editForm;
let editCloseBtn;
let editError;
let editClassSelect;
let editCurrentAddressInput;
let currentEditContext = null;
const nameFiltersByStatus = new Map();
const selectedOrdersByStatus = new Map();
let currentVisibleOrders = [];
let jsPdfLoaderPromise = null;
let activeStatusFilter = "all";
let activeOrderTypeFilter = "all";
let activeAssigneeFilter = "all";
let activeBatchFilter = "";
const orderCountSummaryCache = new Map();
const ORDER_COUNT_BATCH_SIZE = 20;
const pendingOrderCountQueue = new Map();
let orderCountBatchProcessing = false;
let batchPickerBackdrop = null;
let batchPickerTitle = null;
let batchPickerMessage = null;
let batchPickerFilterInput = null;
let batchPickerSelect = null;
let batchPickerConfirm = null;
let batchPickerCancel = null;
let batchPickerResolve = null;
let batchPickerOptions = [];
let assigneePickerBackdrop = null;
let assigneePickerTitle = null;
let assigneePickerMessage = null;
let assigneePickerSelect = null;
let assigneePickerConfirm = null;
let assigneePickerCancel = null;
let assigneePickerResolve = null;
let activeActionMenuCloser = null;
let batchFilterOptionsSource = null;
let pendingTableRenderFrame = null;

const debounce = (callback, delay = 120) => {
  let timeoutId = null;
  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => callback(...args), delay);
  };
};

const closeActiveActionMenu = () => {
  if (typeof activeActionMenuCloser === "function") {
    activeActionMenuCloser();
  }
  activeActionMenuCloser = null;
};

document.addEventListener("click", () => {
  closeActiveActionMenu();
});

const toApiStatus = (status) => {
  if (status === "pending_approval") {
    return "pending approval";
  }
  return status;
};

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleDateString();
};

const formatCompactDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);
  return `${day} ${month} ${year}`;
};

const getNameFilterForStatus = (status) =>
  String(nameFiltersByStatus.get(status) || "").trim().toLowerCase();

const getNormalizedOrderType = (order) => {
  const value = String(order?.order_type || "").trim().toLowerCase();
  if (
    value === "curriculum_books" ||
    value === "non_personalized_order" ||
    value === "id_card" ||
    value === "report_card" ||
    value === "certificate" ||
    value === "other"
  ) {
    return value;
  }
  return value ? "other" : "";
};

const getNormalizedAssignee = (order) => String(order?.assigned_to || "").trim();
const getNormalizedBatchFilterValue = (order) => {
  const batchId = String(order?.batch_id || "").trim();
  if (batchId) {
    return `batch:${batchId}`;
  }
  return "unassigned";
};

const getBatchFilterOptions = (orders) => {
  const unique = new Map();
  (Array.isArray(orders) ? orders : []).forEach((order) => {
    const batchId = String(order?.batch_id || "").trim();
    const batchName = String(order?.batch_name || "").trim();
    const label = batchName || batchId;
    if (!label) {
      return;
    }

    const key = batchId || label.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, {
        value: label,
        label,
      });
    }
  });

  return Array.from(unique.values()).sort((left, right) => left.label.localeCompare(right.label));
};

const syncBatchFilterOptions = (orders) => {
  if (batchFilterOptionsSource === orders) {
    batchFilterInput.value = activeBatchFilter;
    return;
  }

  const options = getBatchFilterOptions(orders);
  batchFilterOptions.innerHTML = [
    `<option value="Unassigned"></option>`,
    ...options.map((option) => `<option value="${escapeHtml(option.label)}"></option>`),
  ].join("");
  batchFilterOptionsSource = orders;
  batchFilterInput.value = activeBatchFilter;
};

const syncStatusFilterVisibility = (activeStatus) => {
  if (!statusFilterSelect) return;
  const showStatusFilter = activeStatus === "all";
  statusFilterSelect.classList.toggle("hidden", !showStatusFilter);
  statusFilterSelect.disabled = !showStatusFilter;
  if (!showStatusFilter) {
    statusFilterSelect.value = "all";
  }
};

const getVisibleOrders = (state) => {
  const statusFiltered =
    state.activeStatus === "all"
      ? state.orders.filter((order) =>
          activeStatusFilter === "all" ? true : order.status === activeStatusFilter
        )
      : state.orders.filter((order) => order.status === state.activeStatus);
  const activeNameFilter = getNameFilterForStatus(state.activeStatus);
  return statusFiltered.filter((order) => {
    const matchesType =
      activeOrderTypeFilter === "all" ||
      getNormalizedOrderType(order) === activeOrderTypeFilter;
    if (!matchesType) return false;
    const matchesAssignee =
      activeAssigneeFilter === "all" ||
      getNormalizedAssignee(order) === activeAssigneeFilter;
    if (!matchesAssignee) return false;
    const normalizedBatchFilter = String(activeBatchFilter || "").trim().toLowerCase();
    const batchLabel = String(order.batch_name || order.batch_id || "").trim().toLowerCase();
    const batchId = String(order.batch_id || "").trim().toLowerCase();
    const unassignedLabel = !order.batch_id && !order.batch_name ? "unassigned" : "";
    const matchesBatch =
      !normalizedBatchFilter ||
      batchLabel.includes(normalizedBatchFilter) ||
      batchId.includes(normalizedBatchFilter) ||
      unassignedLabel.includes(normalizedBatchFilter);
    if (!matchesBatch) return false;
    if (!activeNameFilter) return true;
    const name = String(order.school_name || order.name || "").toLowerCase();
    return name.includes(activeNameFilter);
  });
};

const getSelectedOrdersForStatus = (status) => {
  if (!selectedOrdersByStatus.has(status)) {
    selectedOrdersByStatus.set(status, new Set());
  }
  return selectedOrdersByStatus.get(status);
};

const getSchoolOrderCounts = (orders) => {
  const counts = new Map();

  (Array.isArray(orders) ? orders : []).forEach((order) => {
    const schoolId = String(order?.school_id || "").trim();
    const schoolName = String(order?.school_name || "").trim().toLowerCase();
    const key = schoolId || schoolName;

    if (!counts.has(key)) {
      counts.set(key, 0);
    }

    counts.set(key, counts.get(key) + 1);
  });

  return counts;
};

const getSchoolOrderCountsForActiveProductType = (orders) => {
  const productFiltered =
    activeOrderTypeFilter === "all"
      ? Array.isArray(orders)
        ? orders
        : []
      : (Array.isArray(orders) ? orders : []).filter(
          (order) => getNormalizedOrderType(order) === activeOrderTypeFilter
        );
  return getSchoolOrderCounts(productFiltered);
};

const syncSelectionControls = (state, visibleOrders) => {
  const selected = getSelectedOrdersForStatus(state.activeStatus);
  const selectedCount = selected.size;
  const activeStatusLabel =
    STATUS_LABELS.find((status) => status.key === state.activeStatus)?.label || "Orders";
  bulkPdfButton.classList.toggle("hidden", selectedCount === 0);
  bulkPdfButton.textContent =
    selectedCount > 0
      ? `Get Student Details PDF (${selectedCount})`
      : "Get Student Details PDF";
  const showBulkApproval =
    state.activeStatus === "freeze" && selectedCount > 0;
  bulkSendForApprovalButton.classList.toggle("hidden", !showBulkApproval);
  bulkSendForApprovalButton.textContent =
    selectedCount > 0
      ? `Bulk Send For Approval (${selectedCount})`
      : "Bulk Send For Approval";
  downloadCsvButton.textContent = `Download ${activeStatusLabel} CSV`;

  if (!selectAllOrdersInput) return;
  if (!visibleOrders.length) {
    selectAllOrdersInput.checked = false;
    selectAllOrdersInput.indeterminate = false;
    selectAllOrdersInput.disabled = true;
    return;
  }

  const selectedVisibleCount = visibleOrders.filter((order) =>
    selected.has(order.order_number)
  ).length;
  selectAllOrdersInput.disabled = false;
  selectAllOrdersInput.checked = selectedVisibleCount === visibleOrders.length;
  selectAllOrdersInput.indeterminate =
    selectedVisibleCount > 0 && selectedVisibleCount < visibleOrders.length;
};

const normalizePdfResponseSchools = (responseData) => {
  if (Array.isArray(responseData)) return responseData;
  if (Array.isArray(responseData?.data)) return responseData.data;
  if (Array.isArray(responseData?.schools)) return responseData.schools;
  return [];
};

const getJsPdfCtor = async () => {
  if (window?.jspdf?.jsPDF) {
    return window.jspdf.jsPDF;
  }
  if (!jsPdfLoaderPromise) {
    jsPdfLoaderPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "./node_modules/jspdf/dist/jspdf.umd.min.js";
      script.onload = () => {
        if (window?.jspdf?.jsPDF) {
          resolve(window.jspdf.jsPDF);
          return;
        }
        reject(new Error("Unable to load jsPDF library."));
      };
      script.onerror = () => reject(new Error("Failed to load jsPDF script."));
      document.head.appendChild(script);
    });
  }
  return jsPdfLoaderPromise;
};

const toSafeFilePart = (value, fallback = "file") => {
  const sanitized = String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9-_]/g, "");
  return sanitized || fallback;
};

const sortStudentsByClassName = (students) =>
  [...(students || [])].sort((a, b) =>
    String(a?.class_name || "").localeCompare(String(b?.class_name || ""), undefined, {
      sensitivity: "base",
    })
  );

const imageUrlToDataUrl = async (url) => {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

const drawStudentPhoto = async (pdf, student, x, y, size) => {
  const dataUrl = await imageUrlToDataUrl(student?.photo);
  if (!dataUrl) {
    pdf.setDrawColor(180, 180, 180);
    pdf.rect(x, y, size, size);
    pdf.setFontSize(8);
    pdf.text("No photo", x + 2, y + size / 2);
    return;
  }
  try {
    pdf.addImage(dataUrl, "JPEG", x, y, size, size);
  } catch {
    try {
      pdf.addImage(dataUrl, "PNG", x, y, size, size);
    } catch {
      pdf.setDrawColor(180, 180, 180);
      pdf.rect(x, y, size, size);
      pdf.setFontSize(8);
      pdf.text("Photo error", x + 2, y + size / 2);
    }
  }
};

const generateSchoolPdf = async (school) => {
  const JsPdfCtor = await getJsPdfCtor();
  const pdf = new JsPdfCtor({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageHeight = pdf.internal.pageSize.getHeight();
  const marginX = 14;
  let y = 16;

  const ensureSpace = (neededHeight) => {
    if (y + neededHeight <= pageHeight - 12) return;
    pdf.addPage();
    y = 16;
  };

  pdf.setFontSize(16);
  pdf.text(`School: ${school?.school_name || "-"}`, marginX, y);
  y += 8;

  const orders = Array.isArray(school?.orders) ? school.orders : [];
  if (orders.length === 0) {
    pdf.setFontSize(11);
    pdf.text("No orders available.", marginX, y);
  }

  for (const order of orders) {
    const students = sortStudentsByClassName(order?.students);
    ensureSpace(12);
    pdf.setFontSize(13);
    pdf.text(`Order: ${order?.order_name || "-"} (${order?.order_id || "-"})`, marginX, y);
    y += 6;

    if (students.length === 0) {
      ensureSpace(8);
      pdf.setFontSize(10);
      pdf.text("No students.", marginX + 2, y);
      y += 6;
      continue;
    }

    for (const student of students) {
      ensureSpace(24);
      const photoX = marginX + 2;
      const textX = photoX + 20;
      const rowTop = y;

      await drawStudentPhoto(pdf, student, photoX, rowTop, 16);
      pdf.setFontSize(10);
      pdf.text(`Student: ${student?.name || "-"}`, textX, rowTop + 6);
      pdf.text(`Class: ${student?.class_name || "-"}`, textX, rowTop + 12);

      y += 20;
    }

    y += 2;
  }

  const datePart = new Date().toISOString().slice(0, 10);
  const schoolNamePart = toSafeFilePart(school?.school_name, "school");
  pdf.save(`${schoolNamePart}-student-details-${datePart}.pdf`);
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const hasAnyValue = (...values) =>
  values.some((value) => value !== null && value !== undefined && String(value).trim() !== "");

const requiredSectionFilled = (data, keys) => keys.every((key) => String(data[key] || "").trim());

const getOrderDetailItems = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.students)) return data.students;
  if (Array.isArray(data?.items)) return data.items;
  return [];
};

const getClassesFromResponse = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.classes)) return data.classes;
  return [];
};

const normalizeOrderDetail = (item) => {
  const user = item?.user || {};
  const student = user?.student || {};
  const classSection = student?.class_section || {};
  const studentClass = classSection?.class || {};
  const guardian = student?.guardian || {};
  const secGuardian = guardian?.sec_guardian || {};
  const className =
    studentClass?.full_name || studentClass?.name || classSection?.full_name || classSection?.name || "";
  const classId = studentClass?.id || classSection?.class_id || "";

  return {
    id: item?.id || "",
    orderDetailsId: item?.order_details_id || "",
    studentId: item?.student_id || user?.id || "",
    schoolId:
      user?.school_id ||
      "",
    studentName: user?.full_name || `${user?.first_name || ""} ${user?.last_name || ""}`.trim(),
    grade: className,
    className,
    classId,
    dob: user?.dob || "",
    photo: user?.image || "",
    currentAddress:
      user?.current_address ||
      "",
    guardianName: guardian?.full_name || `${guardian?.first_name || ""} ${guardian?.last_name || ""}`.trim(),
    guardianMobile: guardian?.mobile || "",
    guardianImage: guardian?.image || "",
    secGuardianName:
      secGuardian?.sec_guardian_full_name ||
      `${secGuardian?.sec_guardian_first_name || ""} ${secGuardian?.sec_guardian_last_name || ""}`.trim(),
    secGuardianMobile: secGuardian?.sec_guardian_mobile || "",
    secGuardianImage: secGuardian?.sec_guardian_image || "",
    hasGuardian: hasAnyValue(
      guardian?.id,
      guardian?.first_name,
      guardian?.last_name,
      guardian?.full_name,
      guardian?.mobile,
      guardian?.image
    ),
    hasSecGuardian: hasAnyValue(
      secGuardian?.id,
      secGuardian?.sec_guardian_first_name,
      secGuardian?.sec_guardian_last_name,
      secGuardian?.sec_guardian_full_name,
      secGuardian?.sec_guardian_mobile,
      secGuardian?.sec_guardian_image
    ),
  };
};

const getStudentClassMeta = (student) => {
  const classSection =
    student?.user?.student?.class_section ||
    student?.student?.class_section ||
    {};
  const nestedClass = classSection?.class || {};
  const classId = String(
    student?.class_id ||
    student?.classId ||
    nestedClass?.id ||
    classSection?.class_id ||
    ""
  ).trim();
  const className = String(
    student?.class_name ||
    student?.className ||
    student?.grade ||
    nestedClass?.full_name ||
    nestedClass?.name ||
    classSection?.full_name ||
    classSection?.name ||
    ""
  ).trim();

  return { classId, className };
};

const buildOrderCountSummaryFromStudents = (students, responseClasses = [], explicitTotalCount = null) => {
  const classCounts = new Map();
  const classNamesById = new Map();
  const orderedKeys = [];

  responseClasses.forEach((item) => {
    const classId = String(item?.id || "").trim();
    const className = String(item?.name || "").trim();
    const key = classId || className;
    if (!key) {
      return;
    }

    classNamesById.set(key, className || classId || "-");
    if (!orderedKeys.includes(key)) {
      orderedKeys.push(key);
    }
  });

  (Array.isArray(students) ? students : []).forEach((student) => {
    const { classId, className } = getStudentClassMeta(student);
    const key = classId || className || "-";
    const label = className || classNamesById.get(key) || key || "-";

    if (!classNamesById.has(key)) {
      classNamesById.set(key, label);
    }
    if (!orderedKeys.includes(key)) {
      orderedKeys.push(key);
    }

    classCounts.set(key, (classCounts.get(key) || 0) + 1);
  });

  const classWiseCount = orderedKeys
    .map((key) => {
      const label = classNamesById.get(key) || key || "-";
      const count = classCounts.get(key) || 0;
      return `${label}: ${count}`;
    })
    .join(" | ");

  const normalizedExplicitTotal = Number(explicitTotalCount);
  const totalCount =
    Number.isFinite(normalizedExplicitTotal) && normalizedExplicitTotal >= 0
      ? normalizedExplicitTotal
      : (Array.isArray(students) ? students.length : 0);

  return {
    class_wise_count: classWiseCount,
    total_count: totalCount,
    counts_loaded: true,
  };
};

const buildOrderCountSummary = (responseData) => {
  const details = getOrderDetailItems(responseData);
  const explicitTotalCount = responseData?.count;
  return buildOrderCountSummaryFromStudents(details, getClassesFromResponse(responseData), explicitTotalCount);
};

const buildOrderCountSummariesFromBatchResponse = (responseData) => {
  const summaries = new Map();
  const schools = normalizePdfResponseSchools(responseData);

  schools.forEach((school) => {
    const schoolClasses = Array.isArray(school?.classes) ? school.classes : [];
    const orders = Array.isArray(school?.orders) ? school.orders : [];

    orders.forEach((order) => {
      const orderNumber = String(order?.order_id || order?.order_number || order?.id || "").trim();
      if (!orderNumber) {
        return;
      }

      const orderClasses = Array.isArray(order?.classes) ? order.classes : schoolClasses;
      const explicitTotalCount = order?.total_count ?? order?.student_count ?? order?.count;
      summaries.set(
        orderNumber,
        buildOrderCountSummaryFromStudents(order?.students, orderClasses, explicitTotalCount)
      );
    });
  });

  if (!summaries.size) {
    const orderNumber = String(responseData?.order_id || responseData?.order_number || "").trim();
    if (orderNumber) {
      summaries.set(orderNumber, buildOrderCountSummary(responseData));
    }
  }

  return summaries;
};

const emptyOrderCountSummary = () => ({
  class_wise_count: "",
  total_count: 0,
  counts_loaded: true,
});

const fetchOrderCountSummariesForOrders = async (orders) => {
  const summaries = new Map();
  const missingOrders = (Array.isArray(orders) ? orders : []).filter((order) => {
    const orderNumber = String(order?.order_number || "").trim();
    if (!orderNumber) {
      return false;
    }
    if (orderCountSummaryCache.has(orderNumber)) {
      summaries.set(orderNumber, orderCountSummaryCache.get(orderNumber));
      return false;
    }
    return true;
  });

  for (let index = 0; index < missingOrders.length; index += ORDER_COUNT_BATCH_SIZE) {
    const chunk = missingOrders.slice(index, index + ORDER_COUNT_BATCH_SIZE);
    const chunkOrderNumbers = chunk
      .map((order) => String(order?.order_number || "").trim())
      .filter(Boolean);

    if (!chunkOrderNumbers.length) {
      continue;
    }

    const result = await callApi(API_ENDPOINTS.studentDetailsByOrders, {
      order_ids: chunkOrderNumbers,
    });

    const chunkSummaries = result?.ok
      ? buildOrderCountSummariesFromBatchResponse(result.data)
      : new Map();

    chunkOrderNumbers.forEach((orderNumber) => {
      const summary = chunkSummaries.get(orderNumber) || emptyOrderCountSummary();
      orderCountSummaryCache.set(orderNumber, summary);
      summaries.set(orderNumber, summary);
    });
  }

  return summaries;
};

const enrichOrdersForCsvExport = async (orders) => {
  const summaries = await fetchOrderCountSummariesForOrders(orders);
  return (Array.isArray(orders) ? orders : []).map((order) => {
    const orderNumber = String(order?.order_number || "").trim();
    return {
      ...order,
      ...(summaries.get(orderNumber) || emptyOrderCountSummary()),
    };
  });
};

const processPendingOrderCountQueue = () => {
  if (orderCountBatchProcessing) {
    return;
  }

  orderCountBatchProcessing = true;
  const run = async () => {
    try {
      while (pendingOrderCountQueue.size > 0) {
        const chunkEntries = Array.from(pendingOrderCountQueue.entries()).slice(0, ORDER_COUNT_BATCH_SIZE);
        chunkEntries.forEach(([orderNumber]) => {
          pendingOrderCountQueue.delete(orderNumber);
        });

        const orders = chunkEntries.map(([, order]) => order);
        const summaries = await fetchOrderCountSummariesForOrders(orders);

        chunkEntries.forEach(([orderNumber]) => {
          updateOrder(orderNumber, summaries.get(orderNumber) || emptyOrderCountSummary());
        });
      }
    } finally {
      orderCountBatchProcessing = false;
      if (pendingOrderCountQueue.size > 0) {
        processPendingOrderCountQueue();
      }
    }
  };

  run();
};

const hydrateVisibleOrderCounts = (orders) => {
  (Array.isArray(orders) ? orders : []).forEach((order) => {
    if (order?.counts_loaded) {
      return;
    }

    const orderNumber = String(order?.order_number || "").trim();
    if (!orderNumber) {
      return;
    }

    if (orderCountSummaryCache.has(orderNumber)) {
      updateOrder(orderNumber, orderCountSummaryCache.get(orderNumber));
      return;
    }

    pendingOrderCountQueue.set(orderNumber, order);
  });

  processPendingOrderCountQueue();
};

const normalizeClassOption = (item) => {
  const id = item?.id;
  const name = item?.name;
  if (!hasAnyValue(id, name)) return null;
  return {
    id: id ?? name,
    name: String(name || id),
  };
};

const buildPersonImage = (url, alt) =>
  url
    ? `<img class="detail-photo" src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" />`
    : `<div class="detail-photo detail-photo-fallback">No image</div>`;

const buildStudentCard = (detail, index) => `
  <article class="detail-card">
    <div class="detail-card-header">
      <h4>${escapeHtml(detail.studentName || "Unknown student")}</h4>
      <button class="primary-button detail-edit-btn" data-edit-index="${index}">Edit</button>
    </div>
    <div class="detail-grid">
      <p><strong>Student ID:</strong> ${escapeHtml(detail.studentId || "-")}</p>
      <p><strong>Grade:</strong> ${escapeHtml(detail.grade || "-")}</p>
      <p><strong>Date of birth:</strong> ${escapeHtml(detail.dob ? formatDate(detail.dob) : "-")}</p>
      <div class="detail-image-wrap">
        <p><strong>Student photo</strong></p>
        ${buildPersonImage(detail.photo, `${detail.studentName || "Student"} photo`)}
      </div>
      <p><strong>Guardian name:</strong> ${escapeHtml(detail.guardianName || "-")}</p>
      <p><strong>Guardian mobile:</strong> ${escapeHtml(detail.guardianMobile || "-")}</p>
      <div class="detail-image-wrap">
        <p><strong>Guardian image</strong></p>
        ${buildPersonImage(detail.guardianImage, `${detail.guardianName || "Guardian"} image`)}
      </div>
      <p><strong>Sec guardian name:</strong> ${escapeHtml(detail.secGuardianName || "-")}</p>
      <p><strong>Sec guardian mobile:</strong> ${escapeHtml(detail.secGuardianMobile || "-")}</p>
      <div class="detail-image-wrap">
        <p><strong>Sec guardian image</strong></p>
        ${buildPersonImage(detail.secGuardianImage, `${detail.secGuardianName || "Secondary guardian"} image`)}
      </div>
    </div>
  </article>
`;

const ensureEditModal = () => {
  if (editBackdrop) return;

  const wrapper = document.createElement("div");
  wrapper.id = "edit-modal-backdrop";
  wrapper.className = "modal-backdrop hidden";
  wrapper.innerHTML = `
    <div class="modal detail-edit-modal">
      <div class="modal-header">
        <h3 id="edit-modal-title">Edit student details</h3>
        <button class="ghost-button" id="edit-modal-close">Close</button>
      </div>
      <div class="modal-body">
        <p id="edit-modal-error" class="status-text hidden" data-tone="error"></p>
        <form id="edit-details-form" class="detail-edit-form">
          <h4>Student (required)</h4>
          <input class="text-input" name="student_id" placeholder="Student ID" readonly required />
          <input class="text-input" name="student_name" placeholder="Student name" required />
          <select class="text-input" name="class_id" id="edit-class-select" required></select>
          <input class="text-input" name="dob" placeholder="Date of birth (YYYY-MM-DD)" required />
          <input class="text-input" name="current_address" placeholder="Current address" />
          <input class="text-input" type="file" name="photo_file" accept="image/*" />

          <div class="detail-edit-actions">
            <button type="submit" class="primary-button">Submit</button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.appendChild(wrapper);
  editBackdrop = document.getElementById("edit-modal-backdrop");
  editModalTitle = document.getElementById("edit-modal-title");
  editForm = document.getElementById("edit-details-form");
  editCloseBtn = document.getElementById("edit-modal-close");
  editError = document.getElementById("edit-modal-error");
  editClassSelect = document.getElementById("edit-class-select");
  editCurrentAddressInput = editForm?.elements?.namedItem("current_address");

  editCloseBtn.addEventListener("click", () => {
    editBackdrop.classList.add("hidden");
  });

  editBackdrop.addEventListener("click", (event) => {
    if (event.target === editBackdrop) {
      editBackdrop.classList.add("hidden");
    }
  });

  editForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentEditContext) return;

    const getInputValue = (name) =>
      String(editForm?.elements?.namedItem(name)?.value || "").trim();
    const getInputFile = (name) => {
      const input = editForm?.elements?.namedItem(name);
      return input?.files?.[0] || null;
    };

    const studentId = getInputValue("student_id");
    const studentName = getInputValue("student_name");
    const classId = getInputValue("class_id");
    const dob = getInputValue("dob");
    const currentAddress = getInputValue("current_address");
    const photoFile = getInputFile("photo_file");

    if (
      !requiredSectionFilled(
        {
          student_id: studentId,
          student_name: studentName,
          class_id: classId,
          dob,
        },
        ["student_id", "student_name", "class_id", "dob"]
      )
    ) {
      editError.textContent = "Student details are mandatory.";
      editError.classList.remove("hidden");
      return;
    }

    if (currentEditContext.requiresCurrentAddress && !currentAddress) {
      editError.textContent = "Current address is required for this student.";
      editError.classList.remove("hidden");
      return;
    }

    const selectedClass = (currentEditContext.classes || []).find(
      (item) => String(item.id) === classId
    );
    if (!selectedClass) {
      editError.textContent = "Please select a valid class.";
      editError.classList.remove("hidden");
      return;
    }

    const payload = new FormData();
    payload.append("school_id", String(currentEditContext.schoolId || ""));
    payload.append("student_id", studentId);
    payload.append("student_name", studentName);
    payload.append("grade", selectedClass.name);
    payload.append("class_id", String(selectedClass.id));
    payload.append("classes", JSON.stringify({ id: selectedClass.id, name: selectedClass.name }));
    payload.append("dob", dob);
    payload.append("current_address", currentAddress);
    if (photoFile) {
      payload.append("student_photo", photoFile);
    }

    showLoading();
    try {
      const result = await callApiFormData(API_ENDPOINTS.submitStudentDetails, payload);

      if (result.ok) {
        editBackdrop.classList.add("hidden");
        showModal({
          title: "Success",
          message: result.data?.message || "Student details updated successfully.",
        });
        await showOrderDetails(currentEditContext.order);
        return;
      }

      editError.textContent = result.data?.message || "Unable to submit student details.";
      editError.classList.remove("hidden");
    } finally {
      hideLoading();
    }
  });
};

const setFormField = (name, value) => {
  const field = editForm?.elements?.namedItem(name);
  if (field) {
    field.value = value || "";
  }
};

const clearFileField = (name) => {
  const field = editForm?.elements?.namedItem(name);
  if (field) {
    field.value = "";
  }
};

const setClassOptions = (classes, selectedClassId) => {
  if (!editClassSelect) return;
  const availableClasses = classes || [];
  editClassSelect.innerHTML = availableClasses
    .map(
      (item) =>
        `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`
    )
    .join("");

  if (selectedClassId && availableClasses.some((item) => String(item.id) === String(selectedClassId))) {
    editClassSelect.value = String(selectedClassId);
  }
};

const openEditDetailModal = (order, detail, classes) => {
  ensureEditModal();
  currentEditContext = {
    order,
    detail,
    classes,
    schoolId: order?.school_id || detail?.schoolId || "",
    requiresCurrentAddress: Boolean(String(detail?.currentAddress || "").trim()),
  };
  editModalTitle.textContent = `Edit details - ${detail.studentName || detail.studentId}`;
  editError.classList.add("hidden");
  editError.textContent = "";

  setFormField("student_id", detail.studentId);
  setFormField("student_name", detail.studentName);
  setClassOptions(classes, detail.classId || detail.grade);
  setFormField("dob", detail.dob);
  setFormField("current_address", detail.currentAddress);
  if (editCurrentAddressInput) {
    editCurrentAddressInput.required = currentEditContext.requiresCurrentAddress;
  }
  clearFileField("photo_file");
  editBackdrop.classList.remove("hidden");
};

export const showModal = ({ title, message, table }) => {
  modalTitle.textContent = title;
  modalMessage.textContent = message || "";

  if (table && table.headers && table.rows) {
    const tableHtml = `
      <table>
        <thead>
          <tr>${table.headers.map((header) => `<th>${header}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${table.rows
            .map(
              (row) =>
                `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;
    modalTable.innerHTML = tableHtml;
    modalTable.classList.remove("hidden");
  } else {
    modalTable.innerHTML = "";
    modalTable.classList.add("hidden");
  }

  modalBackdrop.classList.remove("hidden");
};

export const showLoading = () => {
  loadingBackdrop.classList.remove("hidden");
};

export const hideLoading = () => {
  loadingBackdrop.classList.add("hidden");
};

const closeModal = () => {
  modalBackdrop.classList.add("hidden");
};

const ensureBatchPickerModal = () => {
  if (batchPickerBackdrop) return;

  const wrapper = document.createElement("div");
  wrapper.id = "batch-picker-backdrop";
  wrapper.className = "modal-backdrop hidden";
  wrapper.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3 id="batch-picker-title">Add to batch</h3>
        <button class="ghost-button" id="batch-picker-cancel" type="button">Close</button>
      </div>
      <div class="modal-body">
        <p id="batch-picker-message"></p>
        <input id="batch-picker-filter" class="text-input" type="text" placeholder="Type batch name" autocomplete="off" />
        <select id="batch-picker-select" class="text-input"></select>
        <div class="form-row">
          <button id="batch-picker-confirm" class="primary-button" type="button">Add order</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(wrapper);
  batchPickerBackdrop = document.getElementById("batch-picker-backdrop");
  batchPickerTitle = document.getElementById("batch-picker-title");
  batchPickerMessage = document.getElementById("batch-picker-message");
  batchPickerFilterInput = document.getElementById("batch-picker-filter");
  batchPickerSelect = document.getElementById("batch-picker-select");
  batchPickerConfirm = document.getElementById("batch-picker-confirm");
  batchPickerCancel = document.getElementById("batch-picker-cancel");

  const close = (value = null) => {
    batchPickerBackdrop.classList.add("hidden");
    if (batchPickerResolve) {
      const resolve = batchPickerResolve;
      batchPickerResolve = null;
      resolve(value);
    }
  };

  batchPickerCancel.addEventListener("click", () => close(null));
  batchPickerBackdrop.addEventListener("click", (event) => {
    if (event.target === batchPickerBackdrop) {
      close(null);
    }
  });
  batchPickerFilterInput?.addEventListener("input", () => {
    const keyword = String(batchPickerFilterInput?.value || "").trim().toLowerCase();
    const filteredOptions = !keyword
      ? batchPickerOptions
      : batchPickerOptions.filter((item) => item.label.toLowerCase().includes(keyword));
    batchPickerSelect.innerHTML = filteredOptions
      .map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`)
      .join("");
  });
  batchPickerConfirm.addEventListener("click", () => {
    close(batchPickerSelect?.value || null);
  });
};

const pickBatchForOrder = async (order, batches) => {
  ensureBatchPickerModal();

  batchPickerTitle.textContent = `Add order ${order.order_number} to batch`;
  batchPickerMessage.textContent = `Choose a batch for ${order.school_name || "this order"}.`;
  batchPickerOptions = batches.map((batch) => ({
    value: String(batch.id),
    label: `${batch.batch_name} (${formatDate(batch.created_at)})`,
  }));
  if (batchPickerFilterInput) {
    batchPickerFilterInput.value = "";
  }
  batchPickerSelect.innerHTML = batchPickerOptions
    .map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`)
    .join("");
  batchPickerBackdrop.classList.remove("hidden");

  return new Promise((resolve) => {
    batchPickerResolve = resolve;
  });
};

const ensureAssigneePickerModal = () => {
  if (assigneePickerBackdrop) return;

  const wrapper = document.createElement("div");
  wrapper.id = "assignee-picker-backdrop";
  wrapper.className = "modal-backdrop hidden";
  wrapper.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3 id="assignee-picker-title">Change assignee</h3>
        <button class="ghost-button" id="assignee-picker-cancel" type="button">Close</button>
      </div>
      <div class="modal-body">
        <p id="assignee-picker-message"></p>
        <select id="assignee-picker-select" class="text-input"></select>
        <div class="form-row">
          <button id="assignee-picker-confirm" class="primary-button" type="button">Save assignee</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(wrapper);
  assigneePickerBackdrop = document.getElementById("assignee-picker-backdrop");
  assigneePickerTitle = document.getElementById("assignee-picker-title");
  assigneePickerMessage = document.getElementById("assignee-picker-message");
  assigneePickerSelect = document.getElementById("assignee-picker-select");
  assigneePickerConfirm = document.getElementById("assignee-picker-confirm");
  assigneePickerCancel = document.getElementById("assignee-picker-cancel");

  const close = (value = null) => {
    assigneePickerBackdrop.classList.add("hidden");
    if (assigneePickerResolve) {
      const resolve = assigneePickerResolve;
      assigneePickerResolve = null;
      resolve(value);
    }
  };

  assigneePickerCancel.addEventListener("click", () => close(null));
  assigneePickerBackdrop.addEventListener("click", (event) => {
    if (event.target === assigneePickerBackdrop) {
      close(null);
    }
  });
  assigneePickerConfirm.addEventListener("click", () => {
    close(assigneePickerSelect?.value || null);
  });
};

const pickAssigneeForOrder = async (order) => {
  ensureAssigneePickerModal();

  assigneePickerTitle.textContent = `Set assignee for order ${order.order_number}`;
  assigneePickerMessage.textContent = `Choose who is assigned to ${order.school_name || "this order"}.`;
  assigneePickerSelect.innerHTML = ASSIGNEE_OPTIONS
    .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
    .join("");
  assigneePickerSelect.value = ASSIGNEE_OPTIONS.includes(order.assigned_to) ? order.assigned_to : "other";
  assigneePickerBackdrop.classList.remove("hidden");

  return new Promise((resolve) => {
    assigneePickerResolve = resolve;
  });
};

modalClose.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", (event) => {
  if (event.target === modalBackdrop) {
    closeModal();
  }
});

export const setLastRefresh = (text) => {
  lastRefresh.textContent = text;
};

const renderTabs = (activeStatus, onStatusChange) => {
  tabsContainer.innerHTML = "";
  STATUS_LABELS.forEach((status) => {
    const button = document.createElement("button");
    button.className = "tab-button";
    button.textContent = status.label;
    button.dataset.status = status.key;
    if (status.key === activeStatus) {
      button.classList.add("active");
    }
    button.addEventListener("click", () => {
      setActiveStatus(status.key);
      if (onStatusChange) {
        onStatusChange(status.key);
      }
    });
    tabsContainer.appendChild(button);
  });
};

const renderStatusChip = (status) => {
  const chip = document.createElement("span");
  const chipClass = STATUS_CHIPS[status] || "chip-freeze";
  chip.className = `status-chip ${chipClass}`;
  chip.textContent = status.replace("_", " ");
  return chip;
};

const renderBatchChip = (order) => {
  const chip = document.createElement("span");
  chip.className = "status-chip";
  const batchName = String(order?.batch_name || "").trim();
  const batchId = String(order?.batch_id || "").trim();
  chip.textContent = batchName
    ? batchId
      ? `${batchName} (${batchId})`
      : batchName
    : "-";
  if (!batchName) {
    chip.classList.add("chip-freeze");
    return chip;
  }

  chip.classList.add(
    order.batch_status === "completed"
      ? "chip-delivered"
      : order.batch_status === "building"
        ? "chip-building"
      : order.batch_status === "processing"
        ? "chip-processing"
        : "chip-new"
  );
  return chip;
};

const renderAssignedChip = (assignedTo) => {
  const chip = document.createElement("span");
  chip.className = "status-chip chip-building";
  chip.textContent = assignedTo || "";
  return chip;
};

const saveOrderAssignee = async (order, selectedAssignee, { showSuccess = false } = {}) => {
  showLoading();
  try {
    const result = await window.appBridge?.setOrderAssignee?.({
      orderNumber: order.order_number,
      assignee: selectedAssignee,
      currentStatus: order.status,
      schoolName: order.school_name,
    });
    if (!result?.ok) {
      showModal({
        title: "Change assignee",
        message: result?.message || "Unable to update assignee.",
      });
      return { ok: false };
    }

    updateOrder(order.order_number, {
      assigned_to: result.data?.assigned_to || selectedAssignee,
    });

    if (showSuccess) {
      showModal({
        title: "Success",
        message: `Assignee updated to ${result.data?.assigned_to || selectedAssignee}.`,
      });
    }

    return { ok: true, data: result.data };
  } finally {
    hideLoading();
  }
};

const renderAssignedControl = (order) => {
  if (order.status !== "new" && order.status !== "freeze") {
    return renderAssignedChip(order.assigned_to || "");
  }

  const select = document.createElement("select");
  select.className = "text-input";
  select.style.minWidth = "120px";
  select.style.maxWidth = "140px";
  select.innerHTML = ['<option value=""></option>', ...ASSIGNEE_OPTIONS
    .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)]
    .join("");
  select.value = ASSIGNEE_OPTIONS.includes(order.assigned_to) ? order.assigned_to : "";
  select.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  select.addEventListener("change", async () => {
    const previousValue = ASSIGNEE_OPTIONS.includes(order.assigned_to) ? order.assigned_to : "";
    const nextValue = String(select.value || "").trim();
    const saveResult = await saveOrderAssignee(order, nextValue);
    if (!saveResult?.ok) {
      select.value = previousValue;
    }
  });

  return select;
};

const performAction = async (order, nextStatus, endpoint, apiStatus) => {
  showLoading();
  try {
    const payload = {
      order_id: order.order_number,
      school_id : order.school_id,
      status: apiStatus || toApiStatus(nextStatus),
    };
    const result = await callApi(endpoint, payload);

    if (result.ok) {
      updateOrderStatus(order.order_number, nextStatus);
      showModal({
        title: "Success",
        message: result.data?.message || "Order updated successfully.",
        table: result.data?.table,
      });
      return;
    }

    showModal({
      title: "Error",
      message: result.data?.message || "Unable to update order.",
      table: result.data?.table,
    });
  } finally {
    hideLoading();
  }
};

const normalizeResyncItems = (value) => (Array.isArray(value) ? value : []);

const buildResyncRows = (label, items) => {
  if (!items.length) {
    return [[label, "-"]];
  }
  return items.map((item, index) => {
    const rendered =
      typeof item === "string" ? item : JSON.stringify(item, null, 2);
    return [index === 0 ? label : "", `<pre>${escapeHtml(rendered)}</pre>`];
  });
};

const buildResponseDataRows = (data) => {
  if (!data || typeof data !== "object") {
    return [["data", "-"]];
  }

  const entries = Object.entries(data);
  if (!entries.length) {
    return [["data", "-"]];
  }

  return entries.map(([key, value]) => {
    const rendered =
      typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return [key, `<pre>${escapeHtml(rendered || "-")}</pre>`];
  });
};

const normalizeBulkApprovalList = (value) =>
  Array.isArray(value) ? value : [];

const pickFirstNonEmptyList = (...values) => {
  for (const value of values) {
    const normalized = normalizeBulkApprovalList(value);
    if (normalized.length > 0) {
      return normalized;
    }
  }
  return [];
};

const findBulkApprovalLists = (data) => {
  if (!data || typeof data !== "object") {
    return { updated: [], unchanged: [] };
  }

  const updated = pickFirstNonEmptyList(
    data.pending_approval,
    data.updated_schools,
    data.schools_with_status_change,
    data.updated
  );
  const unchanged = pickFirstNonEmptyList(
    data.not_updated,
    data.unchanged_schools,
    data.schools_without_status_change,
    data.no_status_change
  );

  return { updated, unchanged };
};

const renderBulkApprovalList = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    return "-";
  }

  return items
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const orderId = item.order_id ?? "-";
        const schoolId = item.school_id ?? "-";
        const schoolName =
          item.school_name || item.name || item.school || "-";
        const status = item.status ? ` status=${item.status}` : "";
        const reason = item.reason ? ` reason=${item.reason}` : "";
        return `order=${orderId} school_id=${schoolId} school=${schoolName}${status}${reason}`;
      }
      return String(item);
    })
    .join("\n");
};

const handleBulkSendForApproval = async (onRefresh) => {
  const selected = Array.from(getSelectedOrdersForStatus("freeze"))
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (selected.length === 0) {
    showModal({
      title: "Bulk send for approval",
      message: "Select at least one freeze order.",
    });
    return;
  }

  showLoading();
  try {
    const result = await callApi(API_ENDPOINTS.sendForApproval, {
      order_ids: selected,
    });

    const responseData = result?.data?.data && typeof result.data.data === "object"
      ? result.data.data
      : result?.data || {};
    const lists = findBulkApprovalLists(responseData);
    const requestedCount =
      result?.data?.requested_count ?? selected.length;
    const pendingApprovalCount =
      result?.data?.pending_approval_count ?? lists.updated.length;
    const notUpdatedCount =
      result?.data?.not_updated_count ?? lists.unchanged.length;

    showModal({
      title: result.ok ? "Bulk send for approval result" : "Bulk send for approval failed",
      message:
        result?.data?.message ||
        (result.ok
          ? "Bulk send for approval completed."
          : "Unable to send selected orders for approval."),
      table: {
        headers: ["Field", "Value"],
        rows: [
          ["Requested count", `<pre>${escapeHtml(String(requestedCount))}</pre>`],
          ["Pending approval count", `<pre>${escapeHtml(String(pendingApprovalCount))}</pre>`],
          ["Not updated count", `<pre>${escapeHtml(String(notUpdatedCount))}</pre>`],
          ["Updated status", `<pre>${escapeHtml(renderBulkApprovalList(lists.updated))}</pre>`],
          ["No status change", `<pre>${escapeHtml(renderBulkApprovalList(lists.unchanged))}</pre>`],
        ],
      },
    });

    if (result.ok) {
      const freezeSelected = getSelectedOrdersForStatus("freeze");
      selected.forEach((orderId) => {
        freezeSelected.delete(orderId);
        freezeSelected.delete(String(orderId));
      });
      await onRefresh?.();
    }
  } finally {
    hideLoading();
  }
};

const handleResyncOrder = async (order) => {
  showLoading();
  try {
    const result = await callApi(API_ENDPOINTS.resyncOrder, {
      school_id: order.school_id,
      order_id: order.order_number,
    });

    const responseData = result?.data?.data && typeof result.data.data === "object"
      ? result.data.data
      : result?.data || {};
    const pendingPhotoCroppeds = normalizeResyncItems(responseData?.pending_photo_croppeds);
    const pendingStudentProductDetails = normalizeResyncItems(
      responseData?.pending_student_product_details
    );

    if (result.ok) {
      const rows = [
        ...buildResyncRows("pending_photo_croppeds", pendingPhotoCroppeds),
        ...buildResyncRows(
          "pending_student_product_details",
          pendingStudentProductDetails
        ),
      ];

      showModal({
        title: "Resync order result",
        message: result.data?.message || "Resync completed.",
        table: {
          headers: ["Field", "Value"],
          rows,
        },
      });
      return;
    }

    showModal({
      title: "Resync order failed",
      message: result?.data?.message || "Unable to resync this order.",
      table: result?.data?.table,
    });
  } finally {
    hideLoading();
  }
};

const handleResyncAfterApproval = async (order) => {
  showLoading();
  try {
    const result = await callApi(API_ENDPOINTS.resyncAfterApproval, {
      school_id: order.school_id,
      order_id: order.order_number,
    });

    const responseData = result?.data?.data && typeof result.data.data === "object"
      ? result.data.data
      : result?.data || {};

    if (result.ok) {
      showModal({
        title: "Resync after approval result",
        message: result.data?.message || "Resync after approval completed.",
        table: {
          headers: ["Field", "Value"],
          rows: buildResponseDataRows(responseData),
        },
      });
      return;
    }

    showModal({
      title: "Resync after approval failed",
      message: result?.data?.message || "Unable to resync after approval.",
      table:
        result?.data?.table ||
        {
          headers: ["Field", "Value"],
          rows: buildResponseDataRows(responseData),
        },
    });
  } finally {
    hideLoading();
  }
};

const handleDirectApprove = async (order) => {
  const directApproveEndpoint =
    API_ENDPOINTS.dirctApprove || API_ENDPOINTS.directApprove;
  if (!directApproveEndpoint) {
    showModal({
      title: "Direct approve",
      message: "Direct approve endpoint is not configured.",
    });
    return;
  }

  showLoading();
  try {
    const result = await callApi(directApproveEndpoint, {
      school_id: order.school_id,
      order_id: order.order_number,
    });

    const statusValue =
      typeof result?.data?.data?.status !== "undefined"
        ? result.data.data.status
        : result?.data?.status;

    const statusText =
      typeof statusValue === "undefined" ? "-" : String(statusValue);

    if (result.ok && (statusValue === true || String(statusValue).toLowerCase() === "true")) {
      updateOrderStatus(order.order_number, "processing");
    }

    showModal({
      title: "Direct approve",
      message: `Status: ${statusText}`,
    });
  } finally {
    hideLoading();
  }
};

const showOrderDetails = async (order) => {
  showLoading();
  try {
    const result = await callApi(API_ENDPOINTS.showDetails, {
      order_number: order.order_number,
    });

    if (result.ok) {
      const details = getOrderDetailItems(result.data).map(normalizeOrderDetail);
      const classes = getClassesFromResponse(result.data)
        .map(normalizeClassOption)
        .filter(Boolean);
      if (details.length === 0 && result.data?.table) {
        showModal({
          title: "Order details",
          message: result.data?.message || "Details loaded.",
          table: result.data?.table,
        });
        return;
      }

      const hasDetails = details.length > 0;
      const detailHtml = hasDetails
        ? `
          <div class="form-row">
            <input id="order-details-name-filter" class="text-input" placeholder="Filter by student name" />
          </div>
          <div class="detail-cards" id="order-details-card-list"></div>
        `
        : `<p class="helper-text">No student details found for this order.</p>`;

      modalTitle.textContent = "Order details";
      modalMessage.textContent = result.data?.message || "Details loaded.";
      modalTable.innerHTML = detailHtml;
      modalTable.classList.remove("hidden");
      modalBackdrop.classList.remove("hidden");

      if (hasDetails) {
        const filterInput = document.getElementById("order-details-name-filter");
        const cardList = document.getElementById("order-details-card-list");

        const renderFilteredDetails = () => {
          const keyword = String(filterInput?.value || "").trim().toLowerCase();
          const filtered = details
            .map((detail, originalIndex) => ({ detail, originalIndex }))
            .filter(({ detail }) => {
              if (!keyword) return true;
              return String(detail.studentName || "").toLowerCase().includes(keyword);
            });

          cardList.innerHTML =
            filtered.length > 0
              ? filtered
                  .map(({ detail, originalIndex }) => buildStudentCard(detail, originalIndex))
                  .join("")
              : `<p class="helper-text">No students match this name filter.</p>`;

          cardList.querySelectorAll(".detail-edit-btn").forEach((button) => {
            button.addEventListener("click", () => {
              const index = Number(button.dataset.editIndex);
              if (Number.isInteger(index) && details[index]) {
                openEditDetailModal(order, details[index], classes);
              }
            });
          });
        };

        filterInput?.addEventListener("input", renderFilteredDetails);
        renderFilteredDetails();
      }
      return;
    }

    showModal({
      title: "Error",
      message: result.data?.message || "Unable to load order details.",
      table: result.data?.table,
    });
  } finally {
    hideLoading();
  }
};

const preflightCheck = async (order) => {
  if (order.status !== "freeze" && order.status !== "pending_approval") {
    return { ok: false, message: "Only frozen or pending approval orders can be added to a batch." };
  }
  if (order.batch_id || order.batch_name) {
    return {
      ok: false,
      message: `Order already belongs to batch ${order.batch_name || order.batch_id}.`,
    };
  }

  const result = await window.appBridge?.listAvailableBatches?.();
  if (!result?.ok) {
    return {
      ok: false,
      message: result?.message || "Unable to load available batches.",
    };
  }

  const batches = Array.isArray(result.data) ? result.data : [];
  if (batches.length === 0) {
    return { ok: false, message: "Create a batch before assigning frozen orders." };
  }

  return { ok: true, batches };
};

const addOrderToBatch = async (order, selectedBatchId) =>
  window.appBridge?.addOrderToBatch?.({
    batchId: Number(selectedBatchId),
    orderNumber: order.order_number,
    schoolId: order.school_id,
    schoolName: order.school_name,
    personalized: order.personalized,
    productId: order.product_id,
    productType: order.product_type,
    orderDate: order.order_date,
  });

const moveOrderToBatch = async (order, selectedBatchId) =>
  window.appBridge?.moveOrderToBatch?.({
    orderNumber: order.order_number,
    fromBatchId: order.batch_id,
    toBatchId: Number(selectedBatchId),
  });

const removeOrderFromBatch = async (order) =>
  window.appBridge?.removeOrderFromBatch?.({
    batchId: order.batch_id,
    orderNumber: order.order_number,
  });

const isPersonalizedOrder = (order) => {
  const value = order?.personalized;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const normalized = String(value || "").trim().toLowerCase();
  return [
    "1",
    "true",
    "yes",
    "y",
    "personalized",
    "personalised",
  ].includes(normalized);
};

const isOrderAssignedToBatch = (order) => Boolean(order?.batch_id || order?.batch_name);

const handleGetApprovalLink = async (order) => {
  if (isPersonalizedOrder(order) && !isOrderAssignedToBatch(order)) {
    showModal({
      title: "Approval link",
      message: "Personalized orders must be assigned to a batch before getting an approval link.",
    });
    return;
  }

  showLoading();
  try {
    const result = await callApi(API_ENDPOINTS.orderForapprovals, {
      order_id: order.order_number,
      school_id: order.school_id,
    });

    const responseData = result?.data?.data && typeof result.data.data === "object"
      ? result.data.data
      : result?.data || {};
    const apiSuccess =
      result?.ok && (typeof result?.data?.success === "undefined" || result?.data?.success === true);
    const secretKey = String(responseData?.secret_key || "").trim();
    const schoolId = String(responseData?.school_id || order?.school_id || "").trim();
    const approvalLink =
      schoolId && secretKey
        ? `https://eshiksavikas.in/order-approval-access/${encodeURIComponent(
            schoolId
          )}?secret=${encodeURIComponent(secretKey)}`
        : "";

    if (apiSuccess && approvalLink) {
      const safeLink = escapeHtml(approvalLink);
      showModal({
        title: "Approval link",
        message: result.data?.message || "Approval link generated successfully.",
        table: {
          headers: [`Order Id - ${escapeHtml(String(order.order_number || "-"))}`],
          rows: [[`<a href="${safeLink}" target="_blank" rel="noopener noreferrer">${safeLink}</a>`]],
        },
      });
      return;
    }

    showModal({
      title: "Approval link",
      message: result?.data?.message || "Unable to get approval link.",
    });
  } finally {
    hideLoading();
  }
};

const handleAddToBatch = async (order) => {
  try {
    const preflight = await preflightCheck(order);
    if (!preflight?.ok) {
      showModal({
        title: "Preflight failed",
        message: preflight?.message || "Preflight check failed.",
      });
      return;
    }

    const selectedBatchId = await pickBatchForOrder(order, preflight.batches || []);
    if (!selectedBatchId) {
      return;
    }

    showLoading();
    const addResult = await addOrderToBatch(order, selectedBatchId);
    if (!addResult?.ok) {
      showModal({
        title: "Batch add failed",
        message: addResult?.message || "Unable to add order to batch.",
      });
      return;
    }

    updateOrder(order.order_number, {
      batch_id: addResult.data?.batch_id,
      batch_name: addResult.data?.batch_name,
      batch_status: "new",
      batch_added_at: addResult.data?.added_at,
    });
    showModal({
      title: "Success",
      message: `Order added to batch ${addResult.data?.batch_name || addResult.data?.batch_id}.`,
    });
  } finally {
    hideLoading();
  }
};

const handleRemoveFromBatch = async (order) => {
  if (!order.batch_id || !order.batch_name) {
    showModal({
      title: "Remove from batch",
      message: "This order is not assigned to a batch.",
    });
    return;
  }

  if (order.batch_status !== "new") {
    showModal({
      title: "Remove from batch",
      message: "Orders can only be removed from batches with status 'new'.",
    });
    return;
  }

  showLoading();
  try {
    const result = await removeOrderFromBatch(order);
    if (!result?.ok) {
      showModal({
        title: "Remove from batch failed",
        message: result?.message || "Unable to remove order from batch.",
      });
      return;
    }

    updateOrder(order.order_number, {
      batch_id: null,
      batch_name: "",
      batch_status: "",
      batch_added_at: null,
    });
    showModal({
      title: "Success",
      message: `Order removed from batch ${order.batch_name}.`,
    });
  } finally {
    hideLoading();
  }
};

const handleChangeBatch = async (order) => {
  if (!order.batch_id || !order.batch_name) {
    showModal({
      title: "Change batch",
      message: "This order is not assigned to any batch.",
    });
    return;
  }

  if (order.status !== "processing" && order.batch_status !== "building" && order.batch_status !== "processing") {
    showModal({
      title: "Change batch",
      message: "Batch can be changed only when the order status is 'processing' or the current batch status is 'building' or 'processing'.",
    });
    return;
  }

  const result = await window.appBridge?.listAvailableBatches?.();
  if (!result?.ok) {
    showModal({
      title: "Change batch",
      message: result?.message || "Unable to load available batches.",
    });
    return;
  }

  const candidates = (Array.isArray(result.data) ? result.data : [])
    .filter((batch) => Number(batch.id) !== Number(order.batch_id) && batch.status === "new");
  if (!candidates.length) {
    showModal({
      title: "Change batch",
      message: "No target batch with status 'new' is available.",
    });
    return;
  }

  const selectedBatchId = await pickBatchForOrder(order, candidates);
  if (!selectedBatchId) {
    return;
  }

  showLoading();
  try {
    const moveResult = await moveOrderToBatch(order, selectedBatchId);
    if (!moveResult?.ok) {
      showModal({
        title: "Change batch failed",
        message: moveResult?.message || "Unable to move order to another batch.",
      });
      return;
    }

    updateOrder(order.order_number, {
      batch_id: moveResult.data?.target_batch_id,
      batch_name: moveResult.data?.target_batch_name,
      batch_status: "new",
      batch_added_at: moveResult.data?.moved_at,
    });
    showModal({
      title: "Success",
      message: `Order moved to batch ${moveResult.data?.target_batch_name || moveResult.data?.target_batch_id}.`,
    });
  } finally {
    hideLoading();
  }
};

const handleChangeAssignee = async (order) => {
  if (order.status !== "new" && order.status !== "freeze") {
    showModal({
      title: "Change assignee",
      message: "Assignee can change only for orders with status 'new' or 'freeze'.",
    });
    return;
  }

  const selectedAssignee = await pickAssigneeForOrder(order);
  if (!selectedAssignee) {
    return;
  }

  await saveOrderAssignee(order, selectedAssignee, { showSuccess: true });
};

const renderActions = (order) => {
  const menu = document.createElement("div");
  menu.className = "action-menu";

  const trigger = document.createElement("button");
  trigger.className = "menu-trigger";
  trigger.type = "button";
  trigger.textContent = "⋯";
  trigger.setAttribute("aria-label", `Open actions for order ${order.order_number}`);
  trigger.setAttribute("aria-expanded", "false");

  const panel = document.createElement("div");
  panel.className = "menu-panel";

  const closeMenu = () => {
    panel.classList.remove("open");
    trigger.setAttribute("aria-expanded", "false");
    if (activeActionMenuCloser === closeMenu) {
      activeActionMenuCloser = null;
    }
  };

  const toggleMenu = (event) => {
    event.stopPropagation();
    const nextOpen = !panel.classList.contains("open");
    if (nextOpen) {
      closeActiveActionMenu();
      activeActionMenuCloser = closeMenu;
    }
    panel.classList.toggle("open", nextOpen);
    trigger.setAttribute("aria-expanded", String(nextOpen));
  };

  const addMenuButton = (label, className, onClick) => {
    const button = document.createElement("button");
    button.className = `${className} menu-item`;
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      closeMenu();
      onClick();
    });
    panel.appendChild(button);
  };

  const canChangeBatch =
    isOrderAssignedToBatch(order) &&
    (order.status === "processing" ||
      order.batch_status === "building" ||
      order.batch_status === "New");

  if (order.status === "new") {
    addMenuButton("Change assignee", "ghost-button", () => {
      handleChangeAssignee(order);
    });

    addMenuButton("Freeze order", "danger-button", () => {
      performAction(order, "freeze", API_ENDPOINTS.statusChange, "freeze");
    });
  }

  if (order.status === "freeze") {
    addMenuButton("Change assignee", "ghost-button", () => {
      handleChangeAssignee(order);
    });

    addMenuButton("Unfreeze order", "primary-button", () => {
      performAction(order, "new", API_ENDPOINTS.statusChange, "new");
    });

    addMenuButton("Resync order", "ghost-button", () => {
      handleResyncOrder(order);
    });

    if (isPersonalizedOrder(order) && isOrderAssignedToBatch(order)) {
      addMenuButton("Get Approval Link", "primary-button", () => {
        handleGetApprovalLink(order);
      });
    }

    if (!order.batch_id && !order.batch_name) {
      addMenuButton("Add to batch", "ghost-button", () => {
        handleAddToBatch(order);
      });
    } else if (order.batch_status === "new") {
      addMenuButton("Remove from batch", "danger-button", () => {
        handleRemoveFromBatch(order);
      });
    }
  }

  if (
    order.status === "pending_approval" &&
    isPersonalizedOrder(order) &&
    isOrderAssignedToBatch(order)
  ) {
    addMenuButton("Get Approval Link", "primary-button", () => {
      handleGetApprovalLink(order);
    });
  }

  if (order.status === "pending_approval") {
    addMenuButton("Direct Approve", "primary-button", () => {
      handleDirectApprove(order);
    });

    if (!order.batch_id && !order.batch_name) {
      addMenuButton("Add to batch", "ghost-button", () => {
        handleAddToBatch(order);
      });
    } else if (order.batch_status === "new") {
      addMenuButton("Remove from batch", "danger-button", () => {
        handleRemoveFromBatch(order);
      });
    }
  }

  if (order.status === "processing") {
    if (isPersonalizedOrder(order)) {
      addMenuButton("Resync After Approval", "ghost-button", () => {
        handleResyncAfterApproval(order);
      });
    }
    addMenuButton("Provide invoice", "primary-button", () => {
      performAction(order, "invoice", API_ENDPOINTS.provideInvoice, "invoice");
    });

  }

  if (canChangeBatch) {
    addMenuButton("Change batch", "ghost-button", () => {
      handleChangeBatch(order);
    });
  }

  addMenuButton("Show details", "ghost-button", () => {
    showOrderDetails(order);
  });

  trigger.addEventListener("click", toggleMenu);
  menu.appendChild(trigger);
  menu.appendChild(panel);
  return menu;
};

const renderTable = (state) => {
  closeActiveActionMenu();
  ordersBody.innerHTML = "";
  syncBatchFilterOptions(state.orders);
  syncStatusFilterVisibility(state.activeStatus);
  const filtered = getVisibleOrders(state);
  const schoolOrderCounts = getSchoolOrderCountsForActiveProductType(state.orders);
  currentVisibleOrders = filtered;
  const selected = getSelectedOrdersForStatus(state.activeStatus);

  tableTitle.textContent =
    STATUS_LABELS.find((status) => status.key === state.activeStatus)?.label ||
    "Orders";
  if (tableCount) {
    tableCount.textContent = `${filtered.length} total`;
  }
  nameFilterInput.value = nameFiltersByStatus.get(state.activeStatus) || "";
  statusFilterSelect.value = state.activeStatus === "all" ? activeStatusFilter : "all";
  orderTypeFilterSelect.value = activeOrderTypeFilter;
  assigneeFilterSelect.value = activeAssigneeFilter;
  batchFilterInput.value = activeBatchFilter;

  if (filtered.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 11;
    cell.textContent = "No orders to display.";
    cell.style.color = "var(--muted)";
    row.appendChild(cell);
    ordersBody.appendChild(row);
    syncSelectionControls(state, filtered);
    return;
  }

  const fragment = document.createDocumentFragment();
  filtered.forEach((order) => {
    const row = document.createElement("tr");

    const selectCell = document.createElement("td");
    const selectInput = document.createElement("input");
    selectInput.type = "checkbox";
    selectInput.checked = selected.has(order.order_number);
    selectInput.setAttribute("aria-label", `Select order ${order.order_number}`);
    selectInput.addEventListener("change", () => {
      const activeSelected = getSelectedOrdersForStatus(getState().activeStatus);
      if (selectInput.checked) {
        activeSelected.add(order.order_number);
      } else {
        activeSelected.delete(order.order_number);
      }
      syncSelectionControls(getState(), currentVisibleOrders);
    });
    
    selectCell.appendChild(selectInput);
    row.appendChild(selectCell);

    const orderCell = document.createElement("td");
    orderCell.textContent = order.order_number;
    row.appendChild(orderCell);

    const schoolCell = document.createElement("td");
    schoolCell.textContent = order.school_name;
    row.appendChild(schoolCell);

    const schoolIdCell = document.createElement("td");
    schoolIdCell.textContent = order.school_id || "-";
    row.appendChild(schoolIdCell);

    const repeatCountCell = document.createElement("td");
    const repeatKey =
      String(order?.school_id || "").trim() || String(order?.school_name || "").trim().toLowerCase();
    repeatCountCell.textContent = String(schoolOrderCounts.get(repeatKey) || 0);
    row.appendChild(repeatCountCell);

    const dateCell = document.createElement("td");
    dateCell.textContent = formatCompactDate(order.order_date);
    row.appendChild(dateCell);

    const updatedDateCell = document.createElement("td");
    updatedDateCell.textContent = formatCompactDate(order.updated_at);
    row.appendChild(updatedDateCell);

    const statusCell = document.createElement("td");
    statusCell.appendChild(renderStatusChip(order.status));
    row.appendChild(statusCell);

    const assignedCell = document.createElement("td");
    assignedCell.appendChild(renderAssignedControl(order));
    row.appendChild(assignedCell);

    const batchCell = document.createElement("td");
    batchCell.appendChild(renderBatchChip(order));
    row.appendChild(batchCell);

    const actionCell = document.createElement("td");
    actionCell.appendChild(renderActions(order));
    row.appendChild(actionCell);

    fragment.appendChild(row);
  });
  ordersBody.appendChild(fragment);
  syncSelectionControls(state, filtered);
};

const scheduleRenderTable = (state = getState()) => {
  if (pendingTableRenderFrame) {
    window.cancelAnimationFrame(pendingTableRenderFrame);
  }
  pendingTableRenderFrame = window.requestAnimationFrame(() => {
    pendingTableRenderFrame = null;
    renderTable(state);
  });
};

const getOrdersForActiveStatusExport = (state) => {
  return [...getVisibleOrders(state)];
};

export const initUI = ({ onRefresh, onStatusChange }) => {
  statusFilterSelect.id = "status-filter";
  statusFilterSelect.className = "text-input hidden";
  statusFilterSelect.style.maxWidth = "200px";
  statusFilterSelect.style.minWidth = "170px";
  statusFilterSelect.innerHTML = `
    <option value="all">All statuses</option>
    ${STATUS_LABELS.filter((status) => status.key !== "all")
      .map((status) => `<option value="${status.key}">${status.label}</option>`)
      .join("")}
  `;
  orderTypeFilterSelect.id = "order-type-filter";
  orderTypeFilterSelect.className = "text-input";
  orderTypeFilterSelect.style.maxWidth = "220px";
  orderTypeFilterSelect.style.minWidth = "180px";
  orderTypeFilterSelect.innerHTML = `
    <option value="all">All</option>
    <option value="curriculum_books">Curriculum Books</option>
    <option value="non_personalized_order">Non Personalized Order</option>
    <option value="id_card">ID Card</option>
    <option value="report_card">Report Card</option>
    <option value="certificate">Certificate</option>
    <option value="other">Other</option>
  `;
  assigneeFilterSelect.id = "assignee-filter";
  assigneeFilterSelect.className = "text-input";
  assigneeFilterSelect.style.maxWidth = "200px";
  assigneeFilterSelect.style.minWidth = "180px";
  assigneeFilterSelect.innerHTML = `
    <option value="all">All assignees</option>
    ${ASSIGNEE_OPTIONS.map((name) => `<option value="${name}">${name}</option>`).join("")}
  `;
  batchFilterInput.id = "batch-filter";
  batchFilterInput.className = "text-input";
  batchFilterInput.style.maxWidth = "240px";
  batchFilterInput.style.minWidth = "180px";
  batchFilterInput.placeholder = "Filter by batch name";
  batchFilterInput.setAttribute("list", "batch-filter-options");
  batchFilterOptions.id = "batch-filter-options";
  nameFilterInput.id = "name-filter";
  nameFilterInput.className = "text-input";
  nameFilterInput.placeholder = "Filter by name";
  nameFilterInput.style.maxWidth = "240px";
  nameFilterInput.style.minWidth = "180px";
  refreshBtn.insertAdjacentElement("beforebegin", statusFilterSelect);
  refreshBtn.insertAdjacentElement("beforebegin", batchFilterOptions);
  refreshBtn.insertAdjacentElement("beforebegin", batchFilterInput);
  refreshBtn.insertAdjacentElement("beforebegin", assigneeFilterSelect);
  refreshBtn.insertAdjacentElement("beforebegin", orderTypeFilterSelect);
  refreshBtn.insertAdjacentElement("beforebegin", nameFilterInput);
  bulkPdfButton.className = "primary-button hidden";
  bulkPdfButton.textContent = "Get Student Details PDF";
  bulkPdfButton.style.marginRight = "8px";
  bulkSendForApprovalButton.className = "primary-button hidden";
  bulkSendForApprovalButton.textContent = "Bulk Send For Approval";
  bulkSendForApprovalButton.style.marginRight = "8px";
  downloadCsvButton.className = "ghost-button";
  downloadCsvButton.textContent = "Download CSV";
  downloadCsvButton.style.marginRight = "8px";
  refreshBtn.insertAdjacentElement("beforebegin", downloadCsvButton);
  refreshBtn.insertAdjacentElement("beforebegin", bulkSendForApprovalButton);
  refreshBtn.insertAdjacentElement("beforebegin", bulkPdfButton);

  const debouncedFilterRender = debounce(() => {
    scheduleRenderTable(getState());
  });

  nameFilterInput.addEventListener("input", (event) => {
    const activeStatus = getState().activeStatus;
    nameFiltersByStatus.set(activeStatus, event.target.value || "");
    debouncedFilterRender();
  });

  statusFilterSelect.addEventListener("change", (event) => {
    activeStatusFilter = String(event.target.value || "all");
    scheduleRenderTable(getState());
  });

  orderTypeFilterSelect.addEventListener("change", (event) => {
    activeOrderTypeFilter = String(event.target.value || "all");
    scheduleRenderTable(getState());
  });

  assigneeFilterSelect.addEventListener("change", (event) => {
    activeAssigneeFilter = String(event.target.value || "all");
    scheduleRenderTable(getState());
  });

  batchFilterInput.addEventListener("input", (event) => {
    activeBatchFilter = String(event.target.value || "").trim();
    debouncedFilterRender();
  });

  if (selectAllOrdersInput) {
    selectAllOrdersInput.addEventListener("change", () => {
      const activeStatus = getState().activeStatus;
      const selected = getSelectedOrdersForStatus(activeStatus);
      if (selectAllOrdersInput.checked) {
        currentVisibleOrders.forEach((order) => selected.add(order.order_number));
      } else {
        currentVisibleOrders.forEach((order) => selected.delete(order.order_number));
      }
      scheduleRenderTable(getState());
    });
  }

  bulkPdfButton.addEventListener("click", async () => {
    const activeStatus = getState().activeStatus;
    const selected = Array.from(getSelectedOrdersForStatus(activeStatus))
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0);
    if (selected.length === 0) return;

    showLoading();
    try {
      const result = await callApi(API_ENDPOINTS.studentDetailsByOrders, {
        order_ids: selected,
      });

      if (!result.ok) {
        showModal({
          title: "Error",
          message: result.data?.message || "Unable to fetch student details for PDF.",
        });
        return;
      }

      const schools = normalizePdfResponseSchools(result.data);
      if (schools.length === 0) {
        showModal({
          title: "No data",
          message: "No school-wise student details found for selected orders.",
        });
        return;
      }

      try {
        for (const school of schools) {
          await generateSchoolPdf(school);
        }
      } catch (error) {
        showModal({
          title: "PDF Error",
          message: error?.message || "Unable to generate student details PDF.",
        });
        return;
      }

      showModal({
        title: "Success",
        message: `Generated ${schools.length} school PDF file(s).`,
      });
    } finally {
      hideLoading();
    }
  });

  bulkSendForApprovalButton.addEventListener("click", async () => {
    await handleBulkSendForApproval(onRefresh);
  });

  downloadCsvButton.addEventListener("click", async () => {
    const state = getState();
    const ordersToExport = getOrdersForActiveStatusExport(state);
    if (!ordersToExport.length) {
      showModal({
        title: "No data",
        message: "No orders are available for this status.",
      });
      return;
    }

    showLoading();
    try {
      const enrichedOrders = await enrichOrdersForCsvExport(ordersToExport);
      const result = await window.appBridge?.exportOrdersStatusCsv?.({
        status: state.activeStatus,
        orders: enrichedOrders,
      });

      if (!result?.ok) {
        showModal({
          title: "CSV export",
          message: result?.message || "Unable to export orders CSV.",
        });
        return;
      }

      const label =
        STATUS_LABELS.find((status) => status.key === state.activeStatus)?.label || "Orders";
      showModal({
        title: "CSV export",
        message: `${label} CSV exported successfully. Rows: ${result.data?.row_count || 0}.`,
      });
    } finally {
      hideLoading();
    }
  });

  refreshBtn.addEventListener("click", onRefresh);
  renderTabs(getState().activeStatus, onStatusChange);
  renderTable(getState());

  subscribe((state) => {
    renderTabs(state.activeStatus, onStatusChange);
    batchFilterOptionsSource = null;
    scheduleRenderTable(state);
  });
};
