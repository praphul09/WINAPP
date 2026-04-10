let activeStatus = "new";
let orders = [];
const listeners = new Set();

const notify = () => {
  const snapshot = { activeStatus, orders };
  listeners.forEach((listener) => listener(snapshot));
};

export const getState = () => ({ activeStatus, orders });

export const setActiveStatus = (status) => {
  activeStatus = status;
  notify();
};

export const setOrders = (nextOrders) => {
  orders = nextOrders;
  notify();
};

export const updateOrderStatus = (orderNumber, nextStatus) => {
  orders = orders.map((order) =>
    order.order_number === orderNumber
      ? { ...order, status: nextStatus }
      : order
  );
  notify();
};

export const updateOrder = (orderNumber, nextValues) => {
  orders = orders.map((order) =>
    order.order_number === orderNumber
      ? { ...order, ...nextValues }
      : order
  );
  notify();
};

export const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
