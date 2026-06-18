'use strict';
/**
 * PlanAI Field — Spatial Data Readiness Assessment (presentation layer).
 */
const DatasetHealthUI = (function () {
  let _resolve = null;
  let _lastReport = null;

  const EXAMPLE_DEVICES = [
    'Huawei MatePad 11.5S',
    'Samsung Tab S9',
    'Lenovo Tab P12',
  ];

  function L(key, fallback) {
    if (typeof t === 'function') {
      const v = t(key);
      if (v && v !== key) return v;
    }
    return fallback;
  }

  function complexityLabel(c) {
    const map = {
      low: L('health.complexity.low', 'Low'),
      medium: L('health.complexity.medium', 'Medium'),
      high: L('health.complexity.high', 'High'),
      very_high: L('health.complexity.veryHigh', 'Very High'),
    };
    return map[c] || c;
  }

  function formatLabel(fmt) {
    const map = {
      kml: 'KML', kmz: 'KMZ', gml: 'GML', planGml: 'PlanGML', geojson: 'GeoJSON', geotiff: 'GeoTIFF',
    };
    return map[fmt] || fmt;
  }

  function statusMeta(risk) {
    const map = {
      green: {
        icon: '🟢',
        title: L('health.status.ready', 'Ready'),
        desc: L('health.status.readyDesc', 'This dataset can be opened safely.'),
        cardClass: 'sdr-status-ready',
      },
      yellow: {
        icon: '🟡',
        title: L('health.status.optimize', 'Optimization Recommended'),
        desc: L('health.status.optimizeDesc', 'The dataset is larger than average. Optimized Mode is recommended.'),
        cardClass: 'sdr-status-caution',
      },
      orange: {
        icon: '🟠',
        title: L('health.status.heavy', 'Heavy Dataset'),
        desc: L('health.status.heavyDesc', 'Performance slowdowns are expected.'),
        cardClass: 'sdr-status-heavy',
      },
      red: {
        icon: '🔴',
        title: L('health.status.critical', 'Critical Dataset'),
        desc: L('health.status.criticalDesc', 'Opening may cause instability on some devices.'),
        cardClass: 'sdr-status-critical',
      },
    };
    return map[risk] || map.green;
  }

  function performanceMeta(risk) {
    const map = {
      green: {
        label: L('health.perf.excellent', 'Excellent'),
        hint: L('health.perf.excellentHint', 'Map navigation should remain smooth.'),
        className: 'perf-excellent',
      },
      yellow: {
        label: L('health.perf.good', 'Good'),
        hint: L('health.perf.goodHint', 'Map navigation should remain smooth.'),
        className: 'perf-good',
      },
      orange: {
        label: L('health.perf.moderate', 'Moderate'),
        hint: L('health.perf.moderateHint', 'Pan and zoom may feel slower during heavy layers.'),
        className: 'perf-moderate',
      },
      red: {
        label: L('health.perf.heavy', 'Heavy'),
        hint: L('health.perf.heavyHint', 'Significant slowdowns or instability are possible.'),
        className: 'perf-heavy',
      },
    };
    return map[risk] || map.yellow;
  }

  function deviceCompat(risk) {
    if (risk === 'green') return { high: 'ok', mid: 'ok', low: 'ok' };
    if (risk === 'yellow') return { high: 'ok', mid: 'ok', low: 'warn' };
    if (risk === 'orange') return { high: 'ok', mid: 'warn', low: 'warn' };
    return { high: 'warn', mid: 'warn', low: 'no' };
  }

  function compatIcon(state) {
    if (state === 'ok') return '✓';
    if (state === 'warn') return '⚠';
    return '✕';
  }

  function recommendsOptimized(report) {
    const rec = report.recommendations || [];
    if (report.risk === 'green' && !report.blockRender) return false;
    return rec.includes('optimized_mode') || report.risk !== 'green';
  }

  function optimizedAction(report) {
    const rec = report.recommendations || [];
    if (report.formatKey === 'geotiff' && rec.includes('reduce_resolution')) {
      return { action: 'reduce_resolution', optimized: true, rasterMaxPx: 1024 };
    }
    if (rec.includes('simplify_geometry') && report.risk === 'red') {
      return { action: 'simplify', optimized: true };
    }
    return { action: 'optimized', optimized: true };
  }

  function shortFileName(name) {
    const n = String(name || 'import');
    return n.length > 42 ? n.slice(0, 20) + '…' + n.slice(-18) : n;
  }

  function fillCompatGrid(report) {
    const grid = document.getElementById('dhealth-compat-grid');
    if (!grid) return;
    const levels = deviceCompat(report.risk);
    const current = report.device || 'mid';
    const rows = [
      { key: 'high', label: L('health.compat.high', 'High-End Tablet'), state: levels.high },
      { key: 'mid', label: L('health.compat.mid', 'Mid-Range Tablet'), state: levels.mid },
      { key: 'low', label: L('health.compat.low', 'Entry-Level Tablet'), state: levels.low },
    ];
    grid.innerHTML = rows.map((row) => {
      const isYou = row.key === current;
      return `<div class="sdr-compat-card state-${row.state}${isYou ? ' is-current' : ''}">
        <span class="sdr-compat-icon" aria-hidden="true">${compatIcon(row.state)}</span>
        <div class="sdr-compat-text">
          <span class="sdr-compat-name">${row.label}</span>
          ${isYou ? `<span class="sdr-compat-you">${L('health.compat.thisDevice', 'This device')}</span>` : ''}
        </div>
      </div>`;
    }).join('');

    const examples = document.getElementById('dhealth-device-examples');
    if (!examples) return;
    const showExamples = report.risk === 'green' || report.risk === 'yellow' || report.risk === 'orange';
    examples.innerHTML = showExamples
      ? EXAMPLE_DEVICES.map((d) => `<li><span aria-hidden="true">✓</span> ${d}</li>`).join('')
      : `<li class="sdr-examples-muted">${L('health.compat.examplesLimited', 'Use a high-end tablet or Optimized Mode for best results.')}</li>`;
  }

  function fillReport(report) {
    _lastReport = report;
    const el = (id) => document.getElementById(id);
    const s = report.stats || {};
    const risk = report.risk || 'green';
    const status = statusMeta(risk);
    const perf = performanceMeta(risk);
    const useOptimized = recommendsOptimized(report);

    const statusCard = el('dhealth-status-card');
    if (statusCard) {
      statusCard.className = 'sdr-status-card ' + status.cardClass;
    }
    if (el('dhealth-status-icon')) el('dhealth-status-icon').textContent = status.icon;
    if (el('dhealth-status-title')) el('dhealth-status-title').textContent = status.title;
    if (el('dhealth-status-desc')) el('dhealth-status-desc').textContent = status.desc;

    if (el('dhealth-filename-short')) el('dhealth-filename-short').textContent = shortFileName(report.fileName);
    if (el('dhealth-size')) el('dhealth-size').textContent = report.fileSizeLabel || '—';
    if (el('dhealth-complexity')) el('dhealth-complexity').textContent = complexityLabel(report.complexity);

    const perfEl = el('dhealth-performance');
    if (perfEl) {
      perfEl.textContent = perf.label;
      perfEl.className = 'sdr-metric-value ' + perf.className;
    }
    if (el('dhealth-performance-hint')) el('dhealth-performance-hint').textContent = perf.hint;

    fillCompatGrid(report);

    const modePill = el('dhealth-mode-pill');
    if (modePill) {
      modePill.textContent = useOptimized
        ? L('health.mode.optimized', 'Optimized Mode')
        : L('health.mode.normal', 'Normal Mode');
      modePill.className = 'sdr-mode-pill' + (useOptimized ? ' mode-optimized' : ' mode-normal');
    }

    const optExplainer = el('dhealth-opt-explainer');
    if (optExplainer) {
      if (useOptimized) optExplainer.removeAttribute('hidden');
      else optExplainer.setAttribute('hidden', '');
    }

    const details = el('dhealth-advanced');
    if (details) {
      el('dhealth-filename').textContent = report.fileName || '—';
      el('dhealth-format').textContent = formatLabel(report.formatKey);
      el('dhealth-features').textContent = String(s.features ?? '—');
      el('dhealth-polygons').textContent = String(s.polygons ?? '—');
      el('dhealth-vertices').textContent = (s.vertices ?? 0).toLocaleString();
      el('dhealth-layers').textContent = String(s.layers ?? '—');
      el('dhealth-memory').textContent = '~' + (report.memory?.peakMb ?? 0) + ' MB';
      el('dhealth-render-score').textContent = String(report.renderScore ?? '—');

      const rasterRow = el('dhealth-raster-row');
      const rm = report.rasterMeta;
      if (rasterRow && rm && (rm.width || rm.fileSize)) {
        rasterRow.style.display = '';
        const res = rm.width && rm.height ? rm.width + ' × ' + rm.height + ' px' : '—';
        el('dhealth-raster-res').textContent = res;
        el('dhealth-raster-extra').textContent = rm.isCog
          ? L('health.cog', 'Cloud Optimized GeoTIFF')
          : (rm.compression !== 'unknown' ? 'Compression: ' + rm.compression : '');
      } else if (rasterRow) {
        rasterRow.style.display = 'none';
      }

      const extra = el('dhealth-extra');
      const parts = [];
      if (report.kmlMeta?.placemarks) parts.push(L('health.placemarks', 'Placemarks') + ': ' + report.kmlMeta.placemarks);
      if (report.kmzMeta?.embeddedImages) parts.push(L('health.embeddedImages', 'Embedded images') + ': ' + report.kmzMeta.embeddedImages);
      if (s.hatchPolygons) parts.push(L('health.hatchPolys', 'Hatch polygons') + ': ' + s.hatchPolygons);
      if (extra) {
        extra.textContent = parts.join(' · ');
        extra.style.display = parts.length ? '' : 'none';
      }
    }

    const btnOpt = el('dhealth-btn-optimized');
    const btnContinue = el('dhealth-btn-continue');
    const btnCancel = el('dhealth-btn-cancel');

    const isGreen = risk === 'green';
    const isRed = risk === 'red';

    if (btnOpt) {
      btnOpt.style.display = (isGreen && !report.blockRender) ? 'none' : '';
      btnOpt.textContent = L('health.btn.optimized', 'Open in Optimized Mode');
    }

    if (btnContinue) {
      if (report.blockRender && report.device === 'low') {
        btnContinue.style.display = 'none';
        btnContinue.disabled = true;
      } else if (isRed && report.memory?.peakMb > report.memory?.budgetMb * 1.2) {
        btnContinue.textContent = L('health.btn.proceedRisky', 'Open Normally (not recommended)');
        btnContinue.style.display = '';
        btnContinue.classList.add('sdr-btn-risky');
        btnContinue.disabled = false;
      } else {
        btnContinue.textContent = L('health.btn.continue', 'Open Normally');
        btnContinue.style.display = '';
        btnContinue.classList.remove('sdr-btn-risky');
        btnContinue.disabled = false;
      }
    }

    if (btnCancel) btnCancel.textContent = L('health.btn.cancel', 'Cancel');
  }

  function open(report) {
    const overlay = document.getElementById('dataset-health-overlay');
    if (!overlay) return Promise.resolve({ action: 'continue', optimized: false });
    if (typeof applyFieldI18n === 'function') applyFieldI18n();
    fillReport(report);
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('dataset-health-open');
  }

  function close() {
    const overlay = document.getElementById('dataset-health-overlay');
    if (overlay) {
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('dataset-health-open');
  }

  function finish(result) {
    close();
    const r = _resolve;
    _resolve = null;
    if (r) r(result);
  }

  function bindOnce() {
    const overlay = document.getElementById('dataset-health-overlay');
    if (!overlay || overlay._dhealthBound) return;
    overlay._dhealthBound = true;

    document.getElementById('dhealth-btn-optimized')?.addEventListener('click', () => {
      finish(optimizedAction(_lastReport || {}));
    });
    document.getElementById('dhealth-btn-continue')?.addEventListener('click', () => {
      finish({ action: 'continue', optimized: false });
    });
    document.getElementById('dhealth-btn-cancel')?.addEventListener('click', () => {
      finish({ action: 'cancel' });
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish({ action: 'cancel' });
    });
  }

  function prompt(report) {
    bindOnce();
    if (!report) return Promise.resolve({ action: 'continue', optimized: false });
    if (report.risk === 'green' && !report.blockRender) {
      return Promise.resolve({ action: 'continue', optimized: false });
    }
    return new Promise((resolve) => {
      _resolve = resolve;
      fillReport(report);
      const overlay = document.getElementById('dataset-health-overlay');
      if (!overlay) {
        resolve({ action: 'continue', optimized: false });
        return;
      }
      if (typeof applyFieldI18n === 'function') applyFieldI18n();
      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('dataset-health-open');
    });
  }

  return { prompt, open, close };
})();
