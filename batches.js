import { callApi } from "./api.js";
import { API_ENDPOINTS } from "./api-config.js";

const tabsContainer = document.getElementById("batch-tabs");
const tableTitle = document.getElementById("batch-table-title");
const countLabel = document.getElementById("batch-count");
const tableBody = document.getElementById("batches-body");
const refreshLabel = document.getElementById("batches-refresh");
const refreshButton = document.getElementById("refresh-batches");
const createForm = document.getElementById("create-batch-form");
const batchNameInput = document.getElementById("batch-name");
const batchStatus = document.getElementById("batch-status");

const BATCH_TABS = [
  { key: "all", label: "All batches" },
  { key: "new", label: "New" },
  { key: "building", label: "Building" },
  { key: "processing", label: "Processing" },
  { key: "completed", label: "Completed batches" },
];

let activeTab = "all";
let expandedBatchId = null;
const batchOrdersCache = new Map();
let productDetailsBackdrop = null;
let productDetailsTitle = null;
let productDetailsBody = null;
let activeProductDetailsBatch = null;
let detailedInfoBackdrop = null;
let detailedInfoTitle = null;
let detailedInfoBody = null;

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString();
};

const getInitialData = () => [];

const normalizeBatch = (batch) => ({
  id: batch.id ?? "-",
  batchName: batch.batch_name ?? batch.name ?? "-",
  created: formatDate(batch.created_at ?? batch.created),
  status: batch.status ?? "new",
  active: Number(batch.active ?? 0),
  path: batch.db_path ?? batch.path ?? "-",
  coverBinderGenerated: Number(batch.cover_binder_generated ?? 0),
  innerBinderGenerated: Number(batch.inner_binder_generated ?? 0),
});

const normalizeBatchOrder = (order) => ({
  id: order.id ?? "-",
  batchId: order.batch_id ?? null,
  orderNumber: order.order_number ?? "-",
  schoolId: order.school_id ?? null,
  schoolName: order.school_name ?? "-",
  orderDate: formatDate(order.order_date),
  addedAt: formatDate(order.added_at),
});

const createActionMenu = (label, items) => {
  const menu = document.createElement("div");
  menu.className = "action-menu";

  const trigger = document.createElement("button");
  trigger.className = "menu-trigger";
  trigger.type = "button";
  trigger.textContent = "⋯";
  trigger.setAttribute("aria-label", label);
  trigger.setAttribute("aria-expanded", "false");

  const panel = document.createElement("div");
  panel.className = "menu-panel";

  const closeMenu = () => {
    panel.classList.remove("open");
    trigger.setAttribute("aria-expanded", "false");
  };

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const nextOpen = !panel.classList.contains("open");
    document.querySelectorAll(".menu-panel.open").forEach((element) => {
      if (element !== panel) {
        element.classList.remove("open");
      }
    });
    document.querySelectorAll(".menu-trigger[aria-expanded='true']").forEach((element) => {
      if (element !== trigger) {
        element.setAttribute("aria-expanded", "false");
      }
    });
    panel.classList.toggle("open", nextOpen);
    trigger.setAttribute("aria-expanded", String(nextOpen));
  });

  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `${item.className} menu-item`;
    button.textContent = item.label;
    button.disabled = Boolean(item.disabled);
    button.addEventListener("click", async () => {
      closeMenu();
      await item.onClick();
    });
    panel.appendChild(button);
  });

  document.addEventListener("click", closeMenu);
  menu.appendChild(trigger);
  menu.appendChild(panel);
  return menu;
};

const ensureProductDetailsModal = () => {
  if (productDetailsBackdrop) return;

  productDetailsBackdrop = document.createElement("div");
  productDetailsBackdrop.className = "modal-backdrop hidden";
  productDetailsBackdrop.innerHTML = `
    <div class="modal" style="max-width: 1080px; width: min(1080px, 92vw);">
      <div class="modal-header">
        <h3 id="product-details-title">Product details</h3>
        <button class="ghost-button" id="product-details-close" type="button">Close</button>
      </div>
      <div class="modal-body" id="product-details-body"></div>
    </div>
  `;

  document.body.appendChild(productDetailsBackdrop);
  productDetailsTitle = document.getElementById("product-details-title");
  productDetailsBody = document.getElementById("product-details-body");
  const closeButton = document.getElementById("product-details-close");

  const closeModal = () => {
    productDetailsBackdrop.classList.add("hidden");
    activeProductDetailsBatch = null;
  };

  closeButton?.addEventListener("click", closeModal);
  productDetailsBackdrop.addEventListener("click", (event) => {
    if (event.target === productDetailsBackdrop) {
      closeModal();
    }
  });
};

const groupPreparedProductDetails = (rows) => {
  const groups = new Map();
  rows.forEach((row) => {
    const schoolKey = row.schoolName || row.schoolId || "-";
    const classKey = row.classId || "-";
    const key = `${schoolKey}::${classKey}`;
    if (!groups.has(key)) {
      groups.set(key, {
        schoolName: row.schoolName || "-",
        schoolId: row.schoolId || "-",
        classId: row.classId || "-",
        rows: [],
      });
    }
    groups.get(key).rows.push(row);
  });
  return Array.from(groups.values());
};

const normalizePreparedProductDetail = (row) => ({
  sourceId: row.source_id ?? "",
  productId: row.product_id ?? "",
  schoolId: row.school_id ?? "",
  schoolName: row.school_name ?? row.school_id ?? "-",
  classId: row.class_id ?? "-",
  name: row.name ?? "-",
  covercode: row.covercode ?? "-",
  innercode: row.innercode ?? "-",
});

const renderPreparedProductDetailsModal = (batch, rows) => {
  ensureProductDetailsModal();
  activeProductDetailsBatch = batch;
  productDetailsTitle.textContent = `Product details - ${batch.batchName}`;
  const groups = groupPreparedProductDetails(rows);

  if (!groups.length) {
    productDetailsBody.innerHTML = `<p class="helper-text">No prepared product details found for this batch.</p>`;
    productDetailsBackdrop.classList.remove("hidden");
    return;
  }

  productDetailsBody.innerHTML = groups
    .map(
      (group) => `
        <section class="table-card" style="margin-bottom: 16px;">
          <div class="table-header">
            <h3>${group.schoolName}</h3>
            <span class="panel-meta">Class: ${group.classId}</span>
          </div>
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Covercode</th>
                  <th>Innercode</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${group.rows
                  .map(
                    (row) => `
                      <tr>
                        <td>${row.name}</td>
                        <td>${row.covercode}</td>
                        <td>${row.innercode}</td>
                        <td>
                          <button
                            class="ghost-button prepared-product-print-later"
                            type="button"
                            data-source-id="${row.sourceId}"
                          >
                            Print later
                          </button>
                        </td>
                      </tr>
                    `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `
    )
    .join("");

  productDetailsBody.querySelectorAll(".prepared-product-print-later").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!activeProductDetailsBatch) return;
      const sourceId = button.dataset.sourceId || "";
      const confirmed = window.confirm("Move this product detail to the print-later batch?");
      if (!confirmed) return;

      setStatus("Moving product detail to print later...", "neutral");
      const result = await window.appBridge?.moveProductDetailToPrintLater?.({
        batchId: activeProductDetailsBatch.id,
        productDetailSourceId: sourceId,
      });

      if (!result?.ok) {
        setStatus(result?.message || "Unable to move product detail to print later.", "error");
        return;
      }

      window.alert(result?.message || `Added to batch ${result.data?.target_batch_name}.`);
      setStatus(result?.message || "Product detail moved to print later.", "success");
      await handleViewPreparedProductDetails(activeProductDetailsBatch);
      await refreshAllBatches();
    });
  });

  productDetailsBackdrop.classList.remove("hidden");
};

const ensureDetailedInfoModal = () => {
  if (detailedInfoBackdrop) return;

  detailedInfoBackdrop = document.createElement("div");
  detailedInfoBackdrop.className = "modal-backdrop hidden";
  detailedInfoBackdrop.innerHTML = `
    <div class="modal" style="max-width: 1200px; width: min(1200px, 94vw);">
      <div class="modal-header">
        <h3 id="detailed-info-title">Detailed batch info</h3>
        <button class="ghost-button" id="detailed-info-close" type="button">Close</button>
      </div>
      <div class="modal-body" id="detailed-info-body"></div>
    </div>
  `;

  document.body.appendChild(detailedInfoBackdrop);
  detailedInfoTitle = document.getElementById("detailed-info-title");
  detailedInfoBody = document.getElementById("detailed-info-body");
  const closeButton = document.getElementById("detailed-info-close");

  const closeModal = () => {
    detailedInfoBackdrop.classList.add("hidden");
  };

  closeButton?.addEventListener("click", closeModal);
  detailedInfoBackdrop.addEventListener("click", (event) => {
    if (event.target === detailedInfoBackdrop) {
      closeModal();
    }
  });
};

const renderDetailedInfoTable = (headers, rows) => {
  if (!rows.length) {
    return `<p class="helper-text">No records found.</p>`;
  }

  return `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>${row.map((cell) => `<td>${cell ?? "-"}</td>`).join("")}</tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
};

const renderDetailedBatchInfoModal = (batch, payload) => {
  ensureDetailedInfoModal();
  detailedInfoTitle.textContent = `Detailed batch info - ${batch.batchName}`;
  const schools = Array.isArray(payload?.schools) ? payload.schools : [];
  const totals = payload?.totals || {};

  if (!schools.length) {
    detailedInfoBody.innerHTML = `<p class="helper-text">No prepared data found for this batch yet.</p>`;
    detailedInfoBackdrop.classList.remove("hidden");
    return;
  }

  detailedInfoBody.innerHTML = `
    <section class="table-card" style="margin-bottom: 16px;">
      <div class="table-header">
        <h3>Summary</h3>
        <span class="panel-meta">Status: ${payload?.status || "-"}</span>
      </div>
      <p class="helper-text">
        Schools: ${totals.school_count || 0},
        Product details: ${totals.product_detail_count || 0},
        Personalized students: ${totals.personalized_student_count || 0},
        Nonp quantity: ${totals.nonp_quantity_count || 0}
      </p>
    </section>
    ${schools
      .map((school) => {
        const schoolLabel = school.school_name || school.school_id || "-";
        const schoolId = school.school_id || "-";

        const productRows = (Array.isArray(school.product_details_by_class) ? school.product_details_by_class : [])
          .flatMap((classGroup) =>
            (Array.isArray(classGroup.products) ? classGroup.products : []).map((product) => [
              classGroup.class_name || classGroup.class_id || "-",
              product.name || "-",
              product.covercode || "-",
              product.innercode || "-",
            ])
          );

        const studentRows = (Array.isArray(school.personalized_students_by_class)
          ? school.personalized_students_by_class
          : []
        ).flatMap((classGroup) =>
          (Array.isArray(classGroup.students) ? classGroup.students : []).map((student) => [
            classGroup.class_name || classGroup.class_id || "-",
            student.student_id || "-",
            student.student_name || "-",
            student.order_details_id || "-",
            student.assigned_number ?? "-",
          ])
        );

        const nonpRows = (Array.isArray(school.nonp_quantity_by_class) ? school.nonp_quantity_by_class : []).map(
          (row) => [row.class_name || row.class_id || "-", row.quantity ?? 0]
        );

        return `
          <section class="table-card" style="margin-bottom: 16px;">
            <div class="table-header">
              <h3>${schoolLabel}</h3>
              <span class="panel-meta">School ID: ${schoolId}</span>
            </div>

            <h4 style="margin: 0 0 8px 0;">Product details class wise</h4>
            ${renderDetailedInfoTable(["Class", "Product", "Covercode", "Innercode"], productRows)}

            <h4 style="margin: 16px 0 8px 0;">Personalized students class wise</h4>
            ${renderDetailedInfoTable(
              ["Class", "Student ID", "Student name", "Order detail ID", "Assigned #"],
              studentRows
            )}

            <h4 style="margin: 16px 0 8px 0;">Nonp quantity by class</h4>
            ${renderDetailedInfoTable(["Class", "Quantity"], nonpRows)}
          </section>
        `;
      })
      .join("")}
  `;

  detailedInfoBackdrop.classList.remove("hidden");
};

const getPreparedStudents = (data) => {
  if (Array.isArray(data?.students)) return data.students;
  if (Array.isArray(data?.data?.students)) return data.data.students;
  return [];
};

const getPreparedProducts = (data) => {
  if (Array.isArray(data?.products)) return data.products;
  if (Array.isArray(data?.data?.products)) return data.data.products;
  return [];
};

const getPreparedClasses = (data) => {
  if (Array.isArray(data?.classes)) return data.classes;
  if (Array.isArray(data?.data?.classes)) return data.data.classes;
  return [];
};

const getPreparedProductDetails = (data) => {
  if (Array.isArray(data?.product_details)) return data.product_details;
  if (Array.isArray(data?.data?.product_details)) return data.data.product_details;
  return [];
};

const getPreparedNonpOrders = (data) => {
  if (Array.isArray(data?.nonp_orders)) return data.nonp_orders;
  if (Array.isArray(data?.data?.nonp_orders)) return data.data.nonp_orders;
  return [];
};

const isPrepareSuccess = (data) => {
  const errorValue = data?.error ?? data?.data?.error;
  if (typeof errorValue === "boolean") {
    return errorValue === false;
  }

  console.log(errorValue);
  
  const statusValue = data?.ispreparestatus ?? data?.data?.ispreparestatus;
  if (typeof statusValue === "boolean") return statusValue;
  return String(statusValue || "").trim().toLowerCase() === "success";
};

const getPrepareMessage = (data, fallback) =>
  data?.message || data?.data?.message || fallback;

const buildBatchOrdersRow = (batch, orders) => {
  const wrapper = document.createElement("div");
  wrapper.className = "modal-table";

  if (!orders.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No orders have been added to this batch yet.";
    wrapper.appendChild(empty);
    return wrapper;
  }

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Order #</th>
        <th>School</th>
        <th>Order date</th>
        <th>Added</th>
        <th>Action</th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement("tbody");

  orders.forEach((order) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${order.orderNumber}</td>
      <td>${order.schoolName}</td>
      <td>${order.orderDate}</td>
      <td>${order.addedAt}</td>`;

    const actionCell = document.createElement("td");
    if (batch.status === "new") {
      actionCell.appendChild(
        createActionMenu(`Open actions for order ${order.orderNumber}`, [
          {
            label: "Remove",
            className: "danger-button",
            onClick: async () => {
              setStatus("Removing order from batch...", "neutral");
              const result = await window.appBridge?.removeOrderFromBatch?.({
                batchId: batch.id,
                orderNumber: order.orderNumber,
              });
              if (result?.ok) {
                setStatus("Order removed from batch.", "success");
                await reloadExpandedBatchOrders(batch.id);
                return;
              }
              setStatus(result?.message || "Unable to remove order from batch.", "error");
            },
          },
        ])
      );
    } else {
      actionCell.textContent = "-";
    }

    row.appendChild(actionCell);
    tbody.appendChild(row);
  });

  table.appendChild(tbody);
  wrapper.appendChild(table);
  return wrapper;
};

const toggleBatchOrders = async (batchId) => {
  if (expandedBatchId === batchId) {
    expandedBatchId = null;
    render(currentData);
    return;
  }

  expandedBatchId = batchId;
  if (!batchOrdersCache.has(batchId)) {
    setStatus("Loading batch orders...", "neutral");
    const result = await window.appBridge?.listBatchOrders?.(batchId);
    if (!result?.ok) {
      expandedBatchId = null;
      setStatus(result?.message || "Unable to load batch orders.", "error");
      render(currentData);
      return;
    }
    batchOrdersCache.set(
      batchId,
      (Array.isArray(result.data) ? result.data : []).map((order) => normalizeBatchOrder(order))
    );
  }

  render(currentData);
};

const reloadExpandedBatchOrders = async (batchId) => {
  expandedBatchId = batchId;
  batchOrdersCache.delete(batchId);
  setStatus("Loading batch orders...", "neutral");
  const result = await window.appBridge?.listBatchOrders?.(batchId);
  if (!result?.ok) {
    expandedBatchId = null;
    setStatus(result?.message || "Unable to load batch orders.", "error");
    render(currentData);
    return;
  }

  batchOrdersCache.set(
    batchId,
    (Array.isArray(result.data) ? result.data : []).map((order) => normalizeBatchOrder(order))
  );
  render(currentData);
};

const handlePrepareBatch = async (batch) => {
  setStatus("Loading batch orders...", "neutral");
  const batchOrdersResult = await window.appBridge?.listBatchOrders?.(batch.id);
  if (!batchOrdersResult?.ok) {
    setStatus(batchOrdersResult?.message || "Unable to load batch orders.", "error");
    return;
  }

  const orders = (Array.isArray(batchOrdersResult.data) ? batchOrdersResult.data : []).map((order) =>
    normalizeBatchOrder(order)
  );
  if (!orders.length) {
    setStatus("Add orders to the batch before preparing it.", "error");
    return;
  }

  setStatus("Preparing batch...", "neutral");
  const prepareResult = await callApi(API_ENDPOINTS.prepareBatch, {
    order_ids: orders.map((order) => order.orderNumber),
  });

  if (!prepareResult?.ok || !isPrepareSuccess(prepareResult.data)) {
    setStatus(
      getPrepareMessage(prepareResult?.data, "Batch preparation failed."),
      "error"
    );
    return;
  }

  
  const finalizeResult = await window.appBridge?.finalizeBatchPreparation?.({
    batchId: batch.id,
    students: getPreparedStudents(prepareResult.data),
    classes: getPreparedClasses(prepareResult.data),
    products: getPreparedProducts(prepareResult.data),
    productDetails: getPreparedProductDetails(prepareResult.data),
    nonpOrders: getPreparedNonpOrders(prepareResult.data),
  });

  if (!finalizeResult?.ok) {
    setStatus(finalizeResult?.message || "Unable to store prepared batch data.", "error");
    return;
  }

  setStatus(
    `Batch prepared and moved to building. Students: ${finalizeResult.data?.students_count || 0}, products: ${finalizeResult.data?.products_count || 0}.`,
    "success"
  );
  
  await refreshAllBatches();
};

const handleFetchAgain = async (batch) => {
  const confirmed = window.confirm(
    `Fetch and prepare again for ${batch.batchName}? All existing prepared and constructed data for this batch will be erased and reset.`
  );
  if (!confirmed) {
    return;
  }

  setStatus("Loading batch orders...", "neutral");
  const batchOrdersResult = await window.appBridge?.listBatchOrders?.(batch.id);
  if (!batchOrdersResult?.ok) {
    setStatus(batchOrdersResult?.message || "Unable to load batch orders.", "error");
    return;
  }

  const orders = (Array.isArray(batchOrdersResult.data) ? batchOrdersResult.data : []).map((order) =>
    normalizeBatchOrder(order)
  );
  if (!orders.length) {
    setStatus("Add orders to the batch before preparing it.", "error");
    return;
  }

  setStatus("Fetching latest data and preparing batch again...", "neutral");
  const prepareResult = await callApi(API_ENDPOINTS.prepareBatch, {
    order_ids: orders.map((order) => order.orderNumber),
  });

  if (!prepareResult?.ok || !isPrepareSuccess(prepareResult.data)) {
    setStatus(
      getPrepareMessage(prepareResult?.data, "Batch fetch and preparation failed."),
      "error"
    );
    return;
  }

  const refetchResult = await window.appBridge?.refetchAndPrepareBatch?.({
    batchId: batch.id,
    students: getPreparedStudents(prepareResult.data),
    classes: getPreparedClasses(prepareResult.data),
    products: getPreparedProducts(prepareResult.data),
    productDetails: getPreparedProductDetails(prepareResult.data),
    nonpOrders: getPreparedNonpOrders(prepareResult.data),
  });

  if (!refetchResult?.ok) {
    setStatus(refetchResult?.message || "Unable to reset and prepare batch again.", "error");
    return;
  }

  setStatus(
    `Batch data reset and prepared again. Students: ${refetchResult.data?.students_count || 0}, products: ${refetchResult.data?.products_count || 0}.`,
    "success"
  );
  await refreshAllBatches();
};

const handleConstructBookDetails = async (batch) => {
  setStatus("Constructing book details...", "neutral");
  const result = await window.appBridge?.constructBookDetails?.({
    batchId: batch.id,
  });

  if (!result?.ok) {
    setStatus(result?.message || "Unable to construct book details.", "error");
    return;
  }

  setStatus(
    `Constructed ${result.data?.rows_count || 0} book detail rows for ${result.data?.batch_name || batch.batchName}.`,
    "success"
  );
  await refreshAllBatches();
};

const handleGenerateBooks = async (batch) => {
  setStatus("Generating books...", "neutral");
  const result = await window.appBridge?.generateBooks?.({
    batchId: batch.id,
  });

  if (!result?.ok) {
    setStatus(result?.message || "Unable to generate books.", "error");
    return;
  }

  setStatus(
    result.data?.message ||
      `Generated books for ${result.data?.batch_name || batch.batchName}.`,
    "success"
  );
  await refreshAllBatches();
};

const handleOpenBatchProcessingFolder = async (batch) => {
  setStatus("Opening batch folder in File Explorer...", "neutral");
  const result = await window.appBridge?.openBatchProcessingFolder?.({
    batchId: batch.id,
  });

  if (!result?.ok) {
    setStatus(result?.message || "Unable to open batch processing folder.", "error");
    return;
  }

  setStatus("Batch folder opened in File Explorer.", "success");
};

const handleRegenerateBooks = async (batch) => {
  const confirmed = window.confirm(
    `Reset generated cover/inner flags and regenerate books for ${batch.batchName}?`
  );
  if (!confirmed) {
    return;
  }

  setStatus("Resetting generation flags and regenerating books...", "neutral");
  const result = await window.appBridge?.regenerateBooks?.({
    batchId: batch.id,
  });

  if (!result?.ok) {
    setStatus(result?.message || "Unable to regenerate books.", "error");
    return;
  }

  setStatus(
    result.data?.message ||
      `Regenerated books for ${result.data?.batch_name || batch.batchName}.`,
    "success"
  );
  await refreshAllBatches();
};

const handleSetBatchProcessing = async (batch) => {
  const result = await window.appBridge?.setBatchProcessing?.({
    batchId: batch.id,
  });

  if (!result?.ok) {
    setStatus(result?.message || "Unable to update batch status.", "error");
    return;
  }

  setStatus(
    `Batch ${result.data?.batch_name || batch.batchName} moved to processing.`,
    "success"
  );
  await refreshAllBatches();
};

const handleSetBatchActive = async (batch) => {
  setStatus("Marking batch as active...", "neutral");
  const result = await window.appBridge?.setBatchActive?.({
    batchId: batch.id,
  });

  if (!result?.ok) {
    setStatus(result?.message || "Unable to update active batch.", "error");
    return;
  }

  setStatus(
    `Batch ${result.data?.batch_name || batch.batchName} marked as active.`,
    "success"
  );
  await refreshAllBatches();
};

const handleViewPreparedProductDetails = async (batch) => {
  setStatus("Loading prepared product details...", "neutral");
  const result = await window.appBridge?.listBatchPreparedProductDetails?.({
    batchId: batch.id,
  });

  if (!result?.ok) {
    setStatus(result?.message || "Unable to load prepared product details.", "error");
    return;
  }

  const rows = (Array.isArray(result.data?.rows) ? result.data.rows : []).map((row) =>
    normalizePreparedProductDetail(row)
  );
  renderPreparedProductDetailsModal(batch, rows);
  setStatus("Prepared product details loaded.", "success");
};

const handleViewDetailedBatchInfo = async (batch) => {
  setStatus("Loading detailed batch info...", "neutral");
  const result = await window.appBridge?.listBatchDetailedInfo?.({
    batchId: batch.id,
  });

  if (!result?.ok) {
    setStatus(result?.message || "Unable to load detailed batch info.", "error");
    return;
  }

  renderDetailedBatchInfoModal(batch, result.data || {});
  setStatus("Detailed batch info loaded.", "success");
};

const handleMarkBatchComplete = async (batch) => {
  setStatus("Checking batch completion status...", "neutral");
  const preflight = await window.appBridge?.prepareBatchCompletion?.({
    batchId: batch.id,
  });

  if (!preflight?.ok) {
    setStatus(preflight?.message || "Unable to prepare batch completion.", "error");
    return;
  }

  const orderIds = Array.isArray(preflight.data?.order_ids) ? preflight.data.order_ids : [];
  if (!orderIds.length) {
    setStatus("No orders found for this batch.", "error");
    return;
  }

  if (!preflight.data?.all_complete) {
    const confirmed = window.confirm(
      `Batch statuses are incomplete. Rows pending: ${preflight.data?.incomplete_rows || 0}. Do you still want to continue?`
    );
    if (!confirmed) {
      setStatus("Batch completion cancelled.", "neutral");
      return;
    }
  }

  setStatus("Marking batch orders as invoiced...", "neutral");
  const batchOrdersResult = await window.appBridge?.listBatchOrders?.(batch.id);
  if (!batchOrdersResult?.ok) {
    setStatus(batchOrdersResult?.message || "Unable to load batch orders.", "error");
    return;
  }

  const invoiceTargets = (Array.isArray(batchOrdersResult.data) ? batchOrdersResult.data : [])
    .map((order) => ({
      orderId: order?.order_number,
      schoolId: order?.school_id,
    }))
    .filter((order) => order.orderId && order.schoolId);

  if (!invoiceTargets.length) {
    setStatus("No valid batch orders found for invoicing.", "error");
    return;
  }

  for (const target of invoiceTargets) {
    const invoiceResult = await callApi(API_ENDPOINTS.statusChange, {
      school_id: target.schoolId,
      order_id: target.orderId,
      status: "invoice",
    });

    if (!invoiceResult?.ok) {
      setStatus(
        invoiceResult?.data?.message ||
          `Unable to set invoice status for order ${target.orderId}.`,
        "error"
      );
      return;
    }
  }

  const completeResult = await window.appBridge?.setBatchCompleted?.({
    batchId: batch.id,
  });

  if (!completeResult?.ok) {
    setStatus(completeResult?.message || "Unable to mark batch as completed.", "error");
    return;
  }

  setStatus(
    `Batch ${completeResult.data?.batch_name || batch.batchName} marked as completed.`,
    "success"
  );
  await refreshAllBatches();
};

const renderTable = (rows, emptyMessage) => {
  tableBody.innerHTML = "";
  if (!rows.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.className = "empty-state";
    cell.textContent = emptyMessage;
    row.appendChild(cell);
    tableBody.appendChild(row);
    return;
  }

  rows.forEach((batch) => {
    const row = document.createElement("tr");

    const nameCell = document.createElement("td");
    nameCell.textContent = batch.batchName;
    row.appendChild(nameCell);

    const dateCell = document.createElement("td");
    dateCell.textContent = batch.created;
    row.appendChild(dateCell);

    const statusCell = document.createElement("td");
    statusCell.textContent = batch.status;
    row.appendChild(statusCell);

    const activeCell = document.createElement("td");
    activeCell.textContent = batch.active ? "Yes" : "No";
    row.appendChild(activeCell);

    const pathCell = document.createElement("td");
    pathCell.textContent = batch.path;
    row.appendChild(pathCell);

    const actionCell = document.createElement("td");
    const menuItems = [
      {
        label: expandedBatchId === batch.id ? "Hide orders" : "View orders",
        className: "ghost-button",
        onClick: async () => {
          await toggleBatchOrders(batch.id);
        },
      },
      {
        label: "Open in File Explorer",
        className: "ghost-button",
        onClick: async () => {
          await handleOpenBatchProcessingFolder(batch);
        },
      },
      {
        label: "View Detailed Batch Info",
        className: "ghost-button",
        onClick: async () => {
          await handleViewDetailedBatchInfo(batch);
        },
      },
    ];

    if (batch.status === "new") {
      menuItems.push({
        label: "Freeze and prepare batch",
        className: "primary-button",
        onClick: async () => {
          await handlePrepareBatch(batch);
        },
      });

      menuItems.push({
        label: "Delete",
        className: "danger-button",
        onClick: async () => {
          setStatus("Deleting batch...", "neutral");
          const result = await window.appBridge?.deleteBatch?.(batch.id);
          if (result?.ok) {
            setStatus("Batch deleted.", "success");
            batchOrdersCache.delete(batch.id);
            if (expandedBatchId === batch.id) {
              expandedBatchId = null;
            }
            await refreshAllBatches();
            return;
          }
          setStatus(result?.message || "Unable to delete batch.", "error");
        },
      });
    }

    if (batch.status === "building") {
      menuItems.push({
        label: "Fetch again",
        className: "ghost-button",
        onClick: async () => {
          await handleFetchAgain(batch);
        },
      });

      menuItems.push({
        label: "View product details",
        className: "ghost-button",
        onClick: async () => {
          await handleViewPreparedProductDetails(batch);
        },
      });

      menuItems.push({
        label: "Construct book detail",
        className: "primary-button",
        onClick: async () => {
          await handleConstructBookDetails(batch);
        },
      });

      menuItems.push({
        label: "Generate books",
        className: "ghost-button",
        onClick: async () => {
          await handleGenerateBooks(batch);
        },
      });

      menuItems.push({
        label: "Regenerate books",
        className: "ghost-button",
        onClick: async () => {
          await handleRegenerateBooks(batch);
        },
      });

      menuItems.push({
        label: "Set to processing",
        className: "ghost-button",
        disabled: !batch.coverBinderGenerated || !batch.innerBinderGenerated,
        onClick: async () => {
          await handleSetBatchProcessing(batch);
        },
      });
    }

    if (batch.status === "processing") {
      menuItems.push({
        label: batch.active ? "Active" : "Mark active",
        className: "ghost-button",
        disabled: Boolean(batch.active),
        onClick: async () => {
          await handleSetBatchActive(batch);
        },
      });

      menuItems.push({
        label: "Mark complete",
        className: "primary-button",
        onClick: async () => {
          await handleMarkBatchComplete(batch);
        },
      });
    }
    actionCell.appendChild(createActionMenu(`Open actions for batch ${batch.batchName}`, menuItems));
    row.appendChild(actionCell);

    tableBody.appendChild(row);

    if (expandedBatchId === batch.id) {
      const detailRow = document.createElement("tr");
      const detailCell = document.createElement("td");
      detailCell.colSpan = 6;
      detailCell.appendChild(buildBatchOrdersRow(batch, batchOrdersCache.get(batch.id) || []));
      detailRow.appendChild(detailCell);
      tableBody.appendChild(detailRow);
    }
  });
};

const renderTabs = (activeKey, counts) => {
  tabsContainer.innerHTML = "";
  BATCH_TABS.forEach((tab) => {
    const button = document.createElement("button");
    button.className = "tab-button";
    const count = counts[tab.key] ?? 0;
    button.textContent = `${tab.label} (${count})`;
    button.dataset.tab = tab.key;
    if (tab.key === activeKey) {
      button.classList.add("active");
    }
    button.addEventListener("click", () => {
      activeTab = tab.key;
      render(currentData);
    });
    tabsContainer.appendChild(button);
  });
};

let currentData = getInitialData();

const render = (data) => {
  currentData = data;
  const all = data.map((batch) => normalizeBatch(batch));
  const filtered = activeTab === "all" ? all : all.filter((batch) => batch.status === activeTab);

  const counts = {
    all: all.length,
    new: all.filter((batch) => batch.status === "new").length,
    building: all.filter((batch) => batch.status === "building").length,
    processing: all.filter((batch) => batch.status === "processing").length,
    completed: all.filter((batch) => batch.status === "completed").length,
  };
  renderTabs(activeTab, counts);
  const activeTabLabel =
    BATCH_TABS.find((tab) => tab.key === activeTab)?.label || "All batches";
  tableTitle.textContent = activeTabLabel;
  countLabel.textContent = `${filtered.length} shown`;

  renderTable(
    filtered,
    `No ${activeTabLabel.toLowerCase()} to display.`
  );
  refreshLabel.textContent = `Last refresh: ${new Date().toLocaleTimeString()}`;
};

const refreshAllBatches = async () => {
  if (!window.appBridge?.listBatches) {
    setStatus("Batch APIs are not available in this build.", "error");
    return;
  }
  const previousExpandedBatchId = expandedBatchId;
  batchOrdersCache.clear();
  setStatus("Refreshing all batches...", "neutral");
  const result = await window.appBridge.listBatches();
  if (result?.ok) {
    const data = Array.isArray(result.data) ? result.data : [];
    const hasExpandedBatch =
      previousExpandedBatchId !== null &&
      data.some((batch) => Number(batch.id) === Number(previousExpandedBatchId));

    if (hasExpandedBatch) {
      currentData = data;
      await reloadExpandedBatchOrders(previousExpandedBatchId);
    } else {
      expandedBatchId = null;
      render(data);
    }
    setStatus("All batches refreshed.", "success");
    return;
  }
  setStatus(result?.message || "Unable to load batches.", "error");
};

render(currentData);
refreshButton.addEventListener("click", refreshAllBatches);

const setStatus = (message, tone) => {
  if (!batchStatus) return;
  batchStatus.textContent = message;
  batchStatus.dataset.tone = tone || "neutral";
};

if (createForm && batchNameInput && window.appBridge?.createBatch) {
  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = batchNameInput.value.trim();
    if (!name) {
      setStatus("Batch name is required.", "error");
      return;
    }
    setStatus("Creating batch...", "neutral");
    const result = await window.appBridge.createBatch(name);
    if (result?.ok) {
      setStatus(
        `Batch created: ${result.fileName}`,
        "success"
      );
      batchNameInput.value = "";
      await refreshAllBatches();
    } else {
      setStatus(result?.message || "Unable to create batch.", "error");
    }
  });
} else if (batchStatus) {
  setStatus("Batch creation is not available in this build.", "error");
}

refreshAllBatches();
