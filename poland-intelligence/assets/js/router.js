import { loadIntelligenceSection } from './modules/intelligenceHub.js';

export function initRouter() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  nav.addEventListener('click', (e) => {
    const label = e.target.closest('.nav-label');
    if (label) {
      const group = label.closest('.nav-group');
      if (group) {
        group.classList.toggle('open');
        label.setAttribute('aria-expanded', group.classList.contains('open'));
      }
      return;
    }
    const b = e.target.closest('.nav-item');
    if (!b) return;
    const group = b.closest('.nav-group');
    if (group && !group.classList.contains('open')) {
      group.classList.add('open');
      const lbl = group.querySelector('.nav-label');
      if (lbl) lbl.setAttribute('aria-expanded', 'true');
    }
    document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
    b.classList.add('active');
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    const screen = document.getElementById('s-' + b.dataset.s);
    if (screen) screen.classList.add('active');
    window.scrollTo({ top: 0 });
    loadIntelligenceSection(b.dataset.s);
  });
}

/** DIOS V2 — cross-screen navigation with optional context */
export function navigateToScreen(screenId, context) {
  context = context || {};
  window._diosNavContext = context;
  const btn = document.querySelector('.nav-item[data-s="' + screenId + '"]');
  if (btn) {
    btn.click();
    return;
  }
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById('s-' + screenId);
  if (screen) screen.classList.add('active');
  import('./modules/intelligenceHub.js').then(m => m.loadIntelligenceSection(screenId));
}
if (typeof window !== 'undefined') window.navigateToScreen = navigateToScreen;
