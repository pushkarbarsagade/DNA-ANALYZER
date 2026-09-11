// src/utils/config.js - AUTO-DETECT VERSION

// Automatically detect if running locally or deployed
const isDevelopment = 
  window.location.hostname === 'localhost' || 
  window.location.hostname === '127.0.0.1';

const LOCAL_URL = "http://localhost:5000";
const RENDER_URL = "https://dna-analyzer-1-ipxr.onrender.com";

// Use local backend when on localhost, Render when deployed
export const API_BASE_URL = isDevelopment ? LOCAL_URL : RENDER_URL;

console.log("🔗 API Base URL:", API_BASE_URL);
console.log("📍 Environment:", isDevelopment ? "Local Development" : "Production");

export const API_ENDPOINTS = {
  health: `${API_BASE_URL}/api/health`,
  info: `${API_BASE_URL}/api/info`,
  mutations: `${API_BASE_URL}/api/mutations`,
  align: `${API_BASE_URL}/api/align`,
  crispr: `${API_BASE_URL}/api/crispr`,
  primers: `${API_BASE_URL}/api/primers`,
  explain: `${API_BASE_URL}/api/explain`,
  amrValidation: `${API_BASE_URL}/api/amr/validation-dataset`,
  amrIsolate: `${API_BASE_URL}/api/amr/isolate`,
  amrCompare: `${API_BASE_URL}/api/amr/compare`,
  amrReconcile: `${API_BASE_URL}/api/amr/reconcile`,
  amrExplain: `${API_BASE_URL}/api/amr/explain`,
};

export const API_CONFIG = {
  timeout: 60000,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
};

export default {
  API_BASE_URL,
  API_ENDPOINTS,
  API_CONFIG,
};