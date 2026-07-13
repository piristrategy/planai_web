/** API layer — sole data source (static UI → FastAPI JSON). */
const INJECTED = "__PLANAI_ROOT__";

function resolveApiBase() {
  if (typeof window !== "undefined" && window.PLANAI_API_BASE != null) {
    return String(window.PLANAI_API_BASE).replace(/\/$/, "");
  }
  if (INJECTED && INJECTED !== "__PLANAI_ROOT__") {
    return String(INJECTED).replace(/\/$/, "");
  }
  return "";
}

export const API_BASE = resolveApiBase();

export function loginUrl() {
  if (typeof location !== "undefined" && location.protocol === "file:") {
    return "login.html";
  }
  return API_BASE ? "/login.html" : "/login";
}

function useFileOrigin() {
  return typeof location !== "undefined" && location.protocol === "file:";
}

/** file:// → omit (CORS + Private Network Access); http(s) → include (oturum çerezi). */
export function apiCredentials() {
  return useFileOrigin() ? "omit" : "include";
}

export async function apiFetch(path, opts) {
  opts = opts || {};
  opts.credentials = opts.credentials || apiCredentials();
  const res = await fetch(API_BASE + path, opts);
  if (res.status === 401) {
    window.location.href = loginUrl();
    return null;
  }
  return res;
}
