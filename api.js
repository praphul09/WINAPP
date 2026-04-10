import { API_ENDPOINTS } from "./api-config.js";

const DEFAULT_TIMEOUT_MS = 60000;
const CLIENT_ID = "abcdxyz1234";
const CLIENT_KEY = "abcdxyz1234";

const buildAuthHeaders = (customHeaders) => {
  const headers = new Headers(customHeaders || {});
  headers.set("client-id", CLIENT_ID);
  headers.set("client-key", CLIENT_KEY);
  return headers;
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      headers: buildAuthHeaders(options.headers),
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const fetchOrders = async (status) => {
  try {
    const response = await fetchWithTimeout(API_ENDPOINTS.orders, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: status }),
    });
    const jsonData = await response.json();
    
    const data = jsonData.data;

    console.log("Fetched orders:", data);
    return { ok: response.ok, data };
  } catch (error) {
    const message =
      error.name === "AbortError" ? "Request timed out" : error.message || "Network error";
    return { ok: false, data: { message } };
  }
};

export const callApi = async (url, payload) => {
  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    return { ok: response.ok, data };
  } catch (error) {
    const message =
      error.name === "AbortError" ? "Request timed out" : error.message || "Network error";
    return { ok: false, data: { message } };
  }
};

export const callApiFormData = async (url, formData) => {
  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    return { ok: response.ok, data };
  } catch (error) {
    const message =
      error.name === "AbortError" ? "Request timed out" : error.message || "Network error";
    return { ok: false, data: { message } };
  }
};
