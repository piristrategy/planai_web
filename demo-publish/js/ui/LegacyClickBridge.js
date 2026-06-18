'use strict';
/**
 * PlanAI Field™ — binds legacy HTML on* attributes via addEventListener.
 * Required when CSP uses script-src 'self' (inline event handlers are blocked).
 * Developed by PiriStrategy. © Taner Piri / PiriStrategy. All rights reserved.
 */
const LegacyClickBridge = (function () {
  const ATTR_SPECS = [
    { attr: 'onclick', event: 'click', flag: 'legacyClickBound' },
    { attr: 'oninput', event: 'input', flag: 'legacyInputBound' },
    { attr: 'onchange', event: 'change', flag: 'legacyChangeBound' },
  ];

  function splitStatements(code) {
    const parts = [];
    let cur = '';
    let q = null;
    for (let i = 0; i < code.length; i++) {
      const c = code[i];
      if (q) {
        cur += c;
        if (c === q && code[i - 1] !== '\\') q = null;
      } else if (c === '"' || c === "'") {
        q = c;
        cur += c;
      } else if (c === ';') {
        parts.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    if (cur.trim()) parts.push(cur);
    return parts;
  }

  function splitCommaArgs(s) {
    const args = [];
    let cur = '';
    let q = null;
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        cur += c;
        if (c === q && s[i - 1] !== '\\') q = null;
      } else if (c === '"' || c === "'") {
        q = c;
        cur += c;
      } else if (c === '(') {
        depth++;
        cur += c;
      } else if (c === ')') {
        depth = Math.max(0, depth - 1);
        cur += c;
      } else if (c === ',' && depth === 0) {
        args.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    if (cur.trim()) args.push(cur);
    return args;
  }

  function resolvePath(path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), window);
  }

  function resolveValue(token, event, el) {
    const t = token.trim();
    if (!t) return undefined;
    if (t === 'event' || t === 'ev') return event;
    if (t === 'this') return el;
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t);

    const unaryPlus = t.match(/^\+\s*(.+)$/);
    if (unaryPlus) {
      const inner = resolveValue(unaryPlus[1], event, el);
      return inner == null || inner === '' ? undefined : +inner;
    }

    const thisProp = t.match(/^this\.(\w+)$/);
    if (thisProp) return el[thisProp[1]];

    const qm = t.match(/^(['"])([\s\S]*)\1$/);
    if (qm) return qm[2];
    if (/^[\w.$]+$/.test(t)) {
      const v = resolvePath(t);
      if (v !== undefined) return v;
    }
    return undefined;
  }

  function runCall(path, argsStr, event, el) {
    const fn = resolvePath(path);
    if (typeof fn !== 'function') {
      console.warn('[LegacyClickBridge] missing function:', path);
      return;
    }
    const argTokens = argsStr.trim() ? splitCommaArgs(argsStr) : [];
    const args = argTokens.map((tok) => resolveValue(tok, event, el));
    fn.apply(el, args);
  }

  function executeStatement(stmt, event, el) {
    const s = stmt.trim();
    if (!s) return;

    if (s === 'event.stopPropagation()') {
      event.stopPropagation();
      return;
    }

    const ifM = s.match(/^if\s*\(\s*event\.target\s*===\s*this\s*\)\s*([\w.]+)\(\s*\)$/);
    if (ifM) {
      if (event.target === el) runCall(ifM[1], '', event, el);
      return;
    }

    const callM = s.match(/^([\w.]+)\(([\s\S]*)\)$/);
    if (callM) {
      runCall(callM[1], callM[2], event, el);
      return;
    }

    console.warn('[LegacyClickBridge] unsupported statement:', s);
  }

  function bindLegacyAttr(el, spec) {
    const raw = el.getAttribute(spec.attr);
    if (!raw || el.dataset[spec.flag]) return;
    el.dataset[spec.flag] = '1';
    el.removeAttribute(spec.attr);
    el.addEventListener(spec.event, function (e) {
      for (const stmt of splitStatements(raw)) executeStatement(stmt, e, el);
    });
  }

  function bindElement(el) {
    for (const spec of ATTR_SPECS) bindLegacyAttr(el, spec);
  }

  function bindTree(root) {
    if (!root || root.nodeType !== 1) return;
    const hasLegacy = ATTR_SPECS.some((spec) => root.hasAttribute?.(spec.attr));
    if (hasLegacy) bindElement(root);
    const selector = ATTR_SPECS.map((spec) => `[${spec.attr}]`).join(',');
    root.querySelectorAll?.(selector).forEach(bindElement);
  }

  function observeDynamic() {
    if (!window.MutationObserver) return;
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) bindTree(node);
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  function init() {
    bindTree(document.documentElement);
    observeDynamic();
  }

  return { init, bindElement, bindTree };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => LegacyClickBridge.init(), { once: true });
} else {
  LegacyClickBridge.init();
}
