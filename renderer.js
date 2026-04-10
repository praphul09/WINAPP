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

const normalizeOrderType = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (normalized.includes("curriculum")) {
    return "curriculum";
  }
  if (normalized.includes("single") && normalized.includes("book")) {
    return "single_book";
  }
  if (normalized) {
    return "rest";
  }
  return "";
};

const loadBatchAssignments = async () => {
  const result = await window.appBridge?.listOrderBatchLinks?.();
  if (!result?.ok || !Array.isArray(result.data)) {
    return new Map();
  }

  return new Map(
    result.data.map((item) => [
      String(item.order_number),
      {
        batch_id: item.batch_id,
        batch_name: item.batch_name,
        batch_status: item.batch_status,
        batch_added_at: item.added_at,
      },
    ])
  );
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
      order_type: normalizeOrderType(
        order.product_type 
      ),
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
