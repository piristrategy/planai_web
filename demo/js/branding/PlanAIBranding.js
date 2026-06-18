'use strict';
/**
 * PlanAI Field™ — proprietary branding & intellectual property notices.
 * Developed by PiriStrategy.
 * © Taner Piri / PiriStrategy. All rights reserved.
 */
const PlanAIBranding = (function () {
  const APP_NAME = 'PlanAI Field';
  const APP_MARK = 'PlanAI Field™';
  const ORGANIZATION = 'PiriStrategy';
  const AUTHOR = 'Taner Piri';
  const COPYRIGHT = '© Taner Piri / PiriStrategy. All rights reserved.';
  const COPYRIGHT_SHORT = '© Taner Piri / PiriStrategy';
  const DEVELOPED_BY = 'Developed by PiriStrategy';
  const ATTRIBUTION = '© ' + DEVELOPED_BY;
  const REPOSITORY_NOTICE = 'PlanAI Field is a proprietary spatial intelligence and field workflow platform developed by PiriStrategy.';
  const EXPORT_TAGLINE = 'Generated with PlanAI Field by PiriStrategy';
  const PROPRIETARY_NOTICE = 'Proprietary software. Unauthorized redistribution, commercial reuse, derivative platform cloning, reverse engineering, or unauthorized SaaS deployment is prohibited.';

  const PROTECTED_IP = [
    'spatial workflow architecture',
    'GIS/CAD hybrid systems',
    'smart georeferencing logic',
    'spatial synchronization systems',
    'field reporting workflows',
    'AI-assisted planning systems',
    'spatial security architecture',
    'UI/UX concepts',
    'municipality workflows',
  ];

  function reportFooterHtml() {
    return '<footer class="rpt-brand-footer">'
      + '<p class="rpt-brand-primary">' + EXPORT_TAGLINE + '</p>'
      + '<p class="rpt-brand-secondary">' + APP_MARK + ' · ' + DEVELOPED_BY + '</p>'
      + '<p class="rpt-brand-copy">' + COPYRIGHT + '</p>'
      + '</footer>';
  }

  function webFooterHtml() {
    return '<span class="planai-brand-line planai-brand-mark">' + APP_MARK + '</span>'
      + '<span class="planai-brand-line planai-brand-org">' + ATTRIBUTION + '</span>';
  }

  function exportIntegrityMeta(projectName) {
    const ts = new Date().toISOString();
    return {
      exportedAt: ts,
      generator: EXPORT_TAGLINE,
      application: APP_MARK,
      organization: ORGANIZATION,
      author: AUTHOR,
      copyright: COPYRIGHT,
      proprietaryNotice: REPOSITORY_NOTICE,
      integrityHint: (ts + '|' + String(projectName || '').slice(0, 64)).slice(0, 48),
    };
  }

  function applyDocumentMeta() {
    const head = document.head;
    if (!head) return;
    const tags = {
      author: AUTHOR,
      copyright: COPYRIGHT_SHORT,
      'application-name': APP_NAME,
      organization: ORGANIZATION,
      creator: ORGANIZATION,
    };
    Object.keys(tags).forEach((name) => {
      let el = head.querySelector('meta[name="' + name + '"]');
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute('name', name);
        head.appendChild(el);
      }
      el.setAttribute('content', tags[name]);
    });
  }

  function initWebFooter() {
    let foot = document.getElementById('planai-brand-footer');
    const host = document.getElementById('canvas-wrap') || document.body;
    if (!foot) {
      foot = document.createElement('footer');
      foot.id = 'planai-brand-footer';
      foot.className = 'planai-brand-footer';
      foot.setAttribute('aria-label', 'PlanAI Field attribution');
      host.appendChild(foot);
    } else if (foot.parentElement !== host) {
      host.appendChild(foot);
    }
    foot.innerHTML = webFooterHtml();
  }

  function initSplash(opts) {
    const onReady = typeof opts?.onReady === 'function' ? opts.onReady : null;
    const durationMs = Math.max(1000, Math.min(2000, opts?.durationMs || 1500));
    let splash = document.getElementById('planai-splash');
    const logoSrc = document.getElementById('field-brand-logo')?.getAttribute('src') || 'assets/planai-field-logo.png';
    if (!splash) {
      splash = document.createElement('div');
      splash.id = 'planai-splash';
      splash.className = 'planai-splash';
      splash.innerHTML = ''
        + '<div class="planai-splash-inner">'
        + '<img class="planai-splash-logo-img" src="' + logoSrc + '" alt="PlanAI Field" width="88" height="88" decoding="async"/>'
        + '<h1 class="planai-splash-title">' + APP_NAME + '</h1>'
        + '<p class="planai-splash-tagline">Spatial Inspection Platform</p>'
        + '</div>';
      document.body.prepend(splash);
    }
    const hide = () => {
      splash.classList.add('planai-splash-hide');
      setTimeout(() => {
        splash.remove();
        if (onReady) onReady();
      }, 480);
    };
    const startHide = () => setTimeout(hide, durationMs);
    if (document.readyState === 'complete') startHide();
    else window.addEventListener('load', startHide, { once: true });
  }

  function init(opts) {
    applyDocumentMeta();
    initWebFooter();
    initSplash(opts);
  }

  return {
    APP_NAME,
    APP_MARK,
    ORGANIZATION,
    AUTHOR,
    COPYRIGHT,
    COPYRIGHT_SHORT,
    ATTRIBUTION,
    DEVELOPED_BY,
    EXPORT_TAGLINE,
    PROPRIETARY_NOTICE,
    PROTECTED_IP,
    reportFooterHtml,
    webFooterHtml,
    exportIntegrityMeta,
    applyDocumentMeta,
    initWebFooter,
    initSplash,
    init,
  };
})();
