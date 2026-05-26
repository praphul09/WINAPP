import { fetchOrders } from "./api.js";
import {
  hideLoading,
  initUI,
  setLastRefresh,
  showLoading,
  showModal,
} from "./ui.js";
import { getState, setOrders } from "./state.js";

const batchesButton = document.getElementById("open-batches");
if (batchesButton && window.appBridge?.openBatchesWindow) {
  batchesButton.addEventListener("click", () => {
    window.appBridge.openBatchesWindow();
  });
}

const fromApiStatus = (status) => {
  if (status === "pending approval" || status === "approval_pending") {
    return "pending_approval";
  }
  return status;
};

const toClaimStatus = (status) => {
  if (status === "pending_approval") {
    return "pending approval";
  } else if (status === "all") {
    return null;
  }
  return status;
};

const normalizeOrderType = (order) => {
  const rawParts = [
    order?.product_type,
    order?.product?.type,
    order?.product?.name,
    order?.product?.title,
    order?.product_name,
    order?.name,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());
  const normalized = rawParts.join(" ")
    .trim()
    .replace(/[\s-]+/g, "_");
  const personalizedValue = String(
    order?.personalized ?? order?.is_personalized ?? order?.product?.personalized ?? ""
  )
    .trim()
    .toLowerCase();

  if (
    personalizedValue === "0" ||
    personalizedValue === "n" ||
    personalizedValue === "no" ||
    personalizedValue === "false" ||
    normalized.includes("nonp") ||
    normalized.includes("non_personalized") ||
    normalized.includes("nonpersonalized") ||
    normalized.includes("non_persolized") ||
    normalized.includes("nonpersolized") ||
    normalized.includes("shared_book")
  ) {
    return "non_personalized_order";
  }
  if (normalized.includes("curriculum")) {
    return "curriculum_books";
  }
  if (
    normalized.includes("id_card") ||
    normalized.includes("idcard") ||
    normalized.includes("identity_card") ||
    normalized.includes("birthday_card") ||
    normalized.includes("i_card") ||
    normalized.includes("icard")
  ) {
    return "id_card";
  }
  if (
    normalized.includes("report_card") ||
    normalized.includes("reportcard") ||
    (normalized.includes("report") && normalized.includes("card"))
  ) {
    return "report_card";
  }
  if (normalized.includes("certificate") || normalized.includes("cert")) {
    return "certificate";
  }
  if (normalized) {
    return "other";
  }
  return "";
};

const loadBatchAssignments = async () => {
  const result = await window.appBridge?.listOrderBatchLinks?.();
  if (!result?.ok) {
    return new Map();
  }

  const batchLinks = Array.isArray(result.data?.batch_links) ? result.data.batch_links : [];
  const orderAssignments = Array.isArray(result.data?.order_assignments) ? result.data.order_assignments : [];
  const mergedMap = new Map();
  const orderAssignmentMap = new Map(
    orderAssignments.map((item) => [String(item.order_number), String(item.assigned_to || "").trim()])
  );

  batchLinks.forEach((item) => {
    mergedMap.set(String(item.order_number), {
      batch_id: item.batch_id,
      batch_name: item.batch_name,
      batch_status: item.batch_status,
      batch_added_at: item.added_at,
      assigned_to: String(item.assigned_to || orderAssignmentMap.get(String(item.order_number)) || "").trim(),
    });
  });

  orderAssignmentMap.forEach((assignedTo, orderNumber) => {
    if (!mergedMap.has(orderNumber)) {
      mergedMap.set(orderNumber, { assigned_to: String(assignedTo || "").trim() });
    }
  });

  return mergedMap;
};

const loadOrders = async (
  { showLoader, status } = { showLoader: true, status: getState().activeStatus }
) => {
  if (showLoader) {
    showLoading();
  }
  try {
    const [result, batchAssignments] = await Promise.all([
      fetchOrders(toClaimStatus(status)),
      loadBatchAssignments(),
    ]);
    if (!result.ok) {
      throw new Error(result.data?.message || "Unable to load orders.");
    }
    const data = Array.isArray(result.data) ? result.data : [];
    const normalized = data.map((order) => ({
      ...(batchAssignments.get(String(order.id)) || {}),
      order_number: order.id,
      school_id: order.school_id || order?.school?.id || "",
      school_name: order.school_name,
      personalized: order.personalized ?? order.is_personalized ?? "",
      product_id: order.product_id || order?.product?.id || "",
      product_type: order.product_type || "",
      order_date: order.created_at,
      assigned_to: String(batchAssignments.get(String(order.id))?.assigned_to || "").trim(),
      order_type: normalizeOrderType(order),
      status: fromApiStatus(order.status),
    }));
    setOrders(normalized);
    setLastRefresh(`Last refresh: ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    setOrders([]);
    setLastRefresh("Failed to load orders");
    showModal({
      title: "Error",
      message: error.message || "Unable to load orders.",
    });
  } finally {
    if (showLoader) {
      hideLoading();
    }
  }
};

initUI({
  onRefresh: () => loadOrders({ showLoader: true }),
  onStatusChange: (status) => loadOrders({ showLoader: true, status }),
});
loadOrders({ showLoader: true, status: getState().activeStatus });
setInterval(
  () => loadOrders({ showLoader: false, status: getState().activeStatus }),
  180000
);
