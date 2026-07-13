/** API layer — sole data source (static UI → FastAPI JSON).
 *  Centralized client: timeout, retry, auth cookie/token, structured error logging.
 */
const INJECTED = "__PLANAI_ROOT__";

const DEFAULT_TIMEOUT_MS = 25000;
const DEFAULT_RETRIES = 2;
const RETRY_BASE_MS = 400;

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

/** file:// → omit (CORS); http(s) → include (session cookie). */
export function apiCredentials() {
  return useFileOrigin() ? "omit" : "include";
}

/** Optional bearer token (sessionStorage). Cookie auth remains primary. */
export function getAuthToken() {
  try {
    return sessionStorage.getItem("planai_api_token") || "";
  } catch (_) {
    return "";
  }
}

export function setAuthToken(token) {
  try {
    if (token) sessionStorage.setItem("planai_api_token", String(token));
    else sessionStorage.removeItem("planai_api_token");
  } catch (_) {}
}

export function apiLog(level, message, detail) {
  const payload = { t: new Date().toISOString(), message, detail };
  const line = `[PlanAI API] ${message}`;
  if (level === "error") console.error(line, detail || "");
  else if (level === "warn") console.warn(line, detail || "");
  else console.info(line, detail || "");
  try {
    const key = "planai_api_log";
    const prev = JSON.parse(sessionStorage.getItem(key) || "[]");
    prev.push(payload);
    sessionStorage.setItem(key, JSON.stringify(prev.slice(-40)));
  } catch (_) {}
}

export function getApiDiagnostics() {
  try {
    return {
      base: API_BASE || "(same-origin)",
      origin: typeof location !== "undefined" ? location.origin : "",
      protocol: typeof location !== "undefined" ? location.protocol : "",
      hasToken: Boolean(getAuthToken()),
      recent: JSON.parse(sessionStorage.getItem("planai_api_log") || "[]").slice(-8),
    };
  } catch (_) {
    return { base: API_BASE || "(same-origin)", recent: [] };
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function shouldRetry(status, attempt, maxRetries) {
  if (attempt >= maxRetries) return false;
  if (status === 0) return true; // network
  if (status === 408 || status === 429) return true;
  if (status >= 500) return true;
  return false;
}

/**
 * @param {string} path
 * @param {RequestInit & { timeoutMs?: number, retries?: number, skipRetry?: boolean }} [opts]
 * @returns {Promise<Response|null>} null on 401 redirect
 */
export async function apiFetch(path, opts) {
  opts = opts || {};
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.skipRetry ? 0 : (opts.retries != null ? opts.retries : DEFAULT_RETRIES);
  const method = (opts.method || "GET").toUpperCase();

  const headers = Object.assign({}, opts.headers || {});
  const token = getAuthToken();
  if (token && !headers.Authorization) {
    headers.Authorization = "Bearer " + token;
  }

  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
    try {
      const fetchOpts = Object.assign({}, opts, {
        credentials: opts.credentials || apiCredentials(),
        headers,
        signal: controller ? controller.signal : opts.signal,
      });
      delete fetchOpts.timeoutMs;
      delete fetchOpts.retries;
      delete fetchOpts.skipRetry;

      const url = API_BASE + path;
      const res = await fetch(url, fetchOpts);
      if (timer) clearTimeout(timer);

      if (res.status === 401) {
        apiLog("warn", "401 unauthorized", { path });
        window.location.href = loginUrl();
        return null;
      }

      if (!res.ok && shouldRetry(res.status, attempt, maxRetries) && method === "GET") {
        apiLog("warn", `retry ${attempt + 1}/${maxRetries} after HTTP ${res.status}`, { path });
        await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
        continue;
      }

      if (!res.ok) {
        apiLog("warn", `HTTP ${res.status}`, { path, status: res.status });
      }
      return res;
    } catch (err) {
      if (timer) clearTimeout(timer);
      lastErr = err;
      const aborted = err && (err.name === "AbortError" || /abort/i.test(String(err)));
      apiLog("error", aborted ? "timeout" : "network error", {
        path,
        attempt,
        error: String(err && err.message ? err.message : err),
      });
      if (attempt < maxRetries && method === "GET") {
        await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error("apiFetch failed: " + path);
}

/** JSON helper — returns { ok, data, error, status, diagnostics }. */
export async function apiJson(path, opts) {
  try {
    const res = await apiFetch(path, opts);
    if (res == null) {
      return { ok: false, data: null, error: "unauthorized", status: 401, diagnostics: getApiDiagnostics() };
    }
    const status = res.status;
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
    if (!res.ok) {
      return {
        ok: false,
        data,
        error: (data && (data.detail || data.message || data.error)) || ("HTTP " + status),
        status,
        diagnostics: getApiDiagnostics(),
      };
    }
    return { ok: true, data, error: null, status, diagnostics: getApiDiagnostics() };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: String(err && err.message ? err.message : err),
      status: 0,
      diagnostics: getApiDiagnostics(),
    };
  }
}

export async function probeLive() {
  const r = await apiJson("/api/health/live", { retries: 1, timeoutMs: 8000 });
  return r.ok;
}

/** User-facing diagnostics panel (no BAT instructions). */
export function formatDiagnosticsHtml(extra) {
  const d = getApiDiagnostics();
  const lines = [
    `API base: <code>${escDiag(d.base)}</code>`,
    `Origin: <code>${escDiag(d.origin || "—")}</code>`,
    `Protocol: <code>${escDiag(d.protocol || "—")}</code>`,
    `Auth token: ${d.hasToken ? "present" : "cookie session"}`,
  ];
  if (extra) lines.push(String(extra));
  if (d.recent && d.recent.length) {
    const last = d.recent[d.recent.length - 1];
    lines.push(`Last log: ${escDiag(last.message)}`);
  }
  return `<div class="api-diag" style="margin-top:8px;font-size:12px;color:var(--cream-dim);line-height:1.5">${lines.join("<br>")}</div>`;
}

function escDiag(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderConnectionError(targetEl, opts) {
  opts = opts || {};
  if (!targetEl) return;
  const title = opts.title || "API'ye ulaşılamadı";
  const detail = opts.detail || "Bağlantı yenilenince canlı veri otomatik yüklenecek.";
  const onRetry = opts.onRetry;
  const retryId = "api-retry-" + Math.random().toString(36).slice(2, 8);
  targetEl.innerHTML =
    `<div class="sig-line"><span class="t">!</span><span class="icon" style="background:var(--fall)"></span>` +
    `<p><b>${title}</b> — ${detail}` +
    `<span class="why">Tanılama aşağıda. Sahte veri gösterilmez.</span></p></div>` +
    formatDiagnosticsHtml(opts.error ? "Hata: " + String(opts.error) : "") +
    `<div style="margin-top:10px"><button type="button" class="btn" id="${retryId}">Tekrar dene</button></div>`;
  const btn = document.getElementById(retryId);
  if (btn && typeof onRetry === "function") {
    btn.addEventListener("click", () => onRetry());
  }
}
