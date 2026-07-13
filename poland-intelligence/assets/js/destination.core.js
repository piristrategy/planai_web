/**
 * Destination Intelligence — core UI (migrated from monolith).
 * Render only — all intelligence from API JSON.
 */
import { state } from './state.js';
import {
  apiFetch,
  apiJson,
  API_BASE,
  loginUrl,
  formatDiagnosticsHtml,
  renderConnectionError,
  apiLog,
} from './api.js';

let intelligenceCache = state.intelligenceCache;
let somFilter = 'all';
let advisorCache = { recommendations: [], decisions: [], brief: null };

/* ---------- evidence strips ---------- */
export function toggleRec(id){
  const el = document.getElementById(id);
  if(!el) return;
  const opening = !el.classList.contains('open');
  el.classList.toggle('open');
  if(opening){
    const m = id.match(/^rec(\d+)$/);
    if(m){
      const idx = parseInt(m[1],10) - 1;
      const rec = (window._briefRecsCache || [])[idx];
      if(rec && rec.id) trackRecRead(rec.id);
    }
  }
}
export async function trackRecRead(recId){
  try{ await apiFetch('/api/recommendations/' + recId + '/read', { method: 'POST' }); }catch(_){}
}

export function esc(s){
  return String(s??'').replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
export function badgeHtml(badge){
  const css = (badge && badge.css) || 'real';
  const label = (badge && badge.label) || 'Gerçek';
  return `<span class="prov ${css}"><span class="dot"></span>${esc(label)}</span>`;
}

/* ---------- Phase 9 · Executive Mode ---------- */
const VIEW_MODE_KEY = 'planai_view_mode_v1';
export function getViewMode(){
  try{ return localStorage.getItem(VIEW_MODE_KEY) || 'executive'; }catch(_){ return 'executive'; }
}
export function setViewMode(mode){
  const m = mode === 'analyst' ? 'analyst' : 'executive';
  try{ localStorage.setItem(VIEW_MODE_KEY, m); }catch(_){}
  document.body.classList.toggle('mode-executive', m === 'executive');
  document.body.classList.toggle('mode-analyst', m === 'analyst');
  const ex = document.getElementById('modeExecutiveBtn');
  const an = document.getElementById('modeAnalystBtn');
  if(ex) ex.classList.toggle('active', m === 'executive');
  if(an) an.classList.toggle('active', m === 'analyst');
}
export function initViewMode(){
  setViewMode(getViewMode());
}
export function ico(kind, label){
  const map = {
    risk:'alarm', alarm:'alarm', opportunity:'positive', opp:'positive',
    trend:'info', media:'info', ai:'ai', booking:'info', competitor:'warn', comp:'warn',
    search:'info', travel:'positive', government:'info', gov:'info', signal:'ai'
  };
  const tone = map[kind] || 'info';
  const letter = (label || kind || '?').toString().slice(0,1).toUpperCase();
  return `<span class="ico-sm ${tone}" title="${esc(kind||'')}">${esc(letter)}</span>`;
}
export function secEndHtml(title, lines){
  const items = (lines || []).filter(Boolean).slice(0,4);
  if(!items.length) return '';
  return `<div class="sec-end"><div class="k">${esc(title||'Kısa sonuç')}</div><ul>${items.map(l=>`<li>${esc(l)}</li>`).join('')}</ul></div>`;
}

/* ---------- Phase 8 · Executive UX helpers ---------- */
const CIRCLED_NUM = ['①','②','③','④','⑤','⑥','⑦','⑧'];

export function formatTimeShort(iso){
  if(!iso) return '—';
  try{
    const d = new Date(String(iso).replace('Z','+00:00'));
    if(Number.isNaN(d.getTime())) return String(iso).slice(11,16) || '—';
    return d.toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'});
  }catch(_){ return '—'; }
}

export function scrollToBriefTarget(wrapId){
  const el = document.getElementById(wrapId);
  if(!el) return;
  el.scrollIntoView({behavior:'smooth', block:'center'});
  if(!el.classList.contains('open')) toggleSigTrace(wrapId);
}
if(typeof window !== 'undefined'){
  window.scrollToBriefTarget = scrollToBriefTarget;
}

export function toggleDrillPanel(name){
  const map = {articles:'drillArticles', signals:'drillSignals', actions:'drillActions', risks:'drillRisks'};
  const id = map[name];
  if(!id) return;
  const panel = document.getElementById(id);
  if(!panel) return;
  const open = panel.hidden;
  ['drillArticles','drillSignals','drillActions','drillRisks'].forEach(pid=>{
    const p = document.getElementById(pid);
    if(p) p.hidden = true;
  });
  panel.hidden = !open;
  if(!panel.hidden && name === 'articles') loadArticleExplorer();
}
if(typeof window !== 'undefined') window.toggleDrillPanel = toggleDrillPanel;

export function renderSectionFreshness(ts){
  const el = document.getElementById('briefSectionFreshness');
  if(!el || !ts) return;
  const parts = [];
  if(ts.brief_updated) parts.push('Güncellendi '+formatTimeShort(ts.brief_updated));
  if(ts.calculated_at) parts.push('Hesaplandı '+formatTimeShort(ts.calculated_at));
  if(ts.source_scan) parts.push('Kaynak taraması '+formatTimeShort(ts.source_scan));
  el.textContent = parts.join(' · ');
}

export function renderDrillPanels(data){
  const articles = data.articles_panel || [];
  const signals = data.signals || [];
  const recs = data.recommendations || [];
  const risks = signals.filter(s => (s.severity||'').toLowerCase() === 'fall');
  const ab = document.getElementById('drillArticlesBody');
  if(ab && articles.length){
    ab.innerHTML = articles.map(a=>`<div class="drill-row explorer-article">
      <div><b>${esc((a.title||'').slice(0,90))}</b><br>
      <span class="mono" style="font-size:10px;color:var(--muted)">${esc(a.source_name||'')} · ${esc(formatTimeShort(a.published_at||a.fetched_at))}</span>
      ${a.entities ? '<br><span style="font-size:11px">'+esc(a.entities)+'</span>' : ''}
      ${a.topics ? '<br><span style="font-size:11px">'+esc(a.topics)+'</span>' : ''}</div>
      <div>${a.url ? `<a class="pill" href="${esc(a.url)}" target="_blank" rel="noopener">Aç</a>` : ''}</div>
    </div>`).join('');
  }
  const sb = document.getElementById('drillSignalsBody');
  if(sb){
    sb.innerHTML = signals.length ? signals.map(s=>`<div class="drill-row">
      <div><span class="mono" style="font-size:10px;color:var(--gold)">${esc(s.signal_int_id||('#'+s.signal_number))}</span><br>
      <b>${esc((s.title||'').slice(0,80))}</b><br>
      <span style="font-size:11px">${esc(s.importance_label_tr||'—')} · ${esc(s.source_display||'')} · Kanıt ${esc(String((s.explorer&&s.explorer.evidence_count)||'—'))}</span></div>
      <div><button type="button" class="pill" onclick="scrollToBriefTarget('${esc(s.wrap_id||('sig-wrap-'+(s.id||0)))}')">Git</button></div>
    </div>`).join('') : '<div class="drill-row">Sinyal yok.</div>';
  }
  const rb = document.getElementById('drillActionsBody');
  if(rb){
    rb.innerHTML = recs.length ? recs.map((r,i)=>`<div class="drill-row action-row">
      <div><b>${esc((r.what_to_do||r.title||'').slice(0,80))}</b><br>
      <span style="font-size:11px">${esc(r.priority||'—')} · ${esc(r.owner||'—')} · ${esc(r.timing||'—')}</span>
      <div class="exec-actions-row" style="margin-top:6px">
        <button type="button" class="pill" onclick="scrollToBriefTarget('rec${i+1}')">Detay</button>
        ${r.id?`<button type="button" class="pill" onclick="submitRecFeedback(${r.id},'accepted')">Ata</button>`:''}
        ${r.id?`<button type="button" class="pill" onclick="submitRecFeedback(${r.id},'deferred')">Ertele</button>`:''}
        ${r.id?`<button type="button" class="pill" onclick="submitRecFeedback(${r.id},'implemented')">Tamamla</button>`:''}
      </div></div>
    </div>`).join('') : '<div class="drill-row">Aksiyon adayı yok.</div>';
  }
  const riskB = document.getElementById('drillRisksBody');
  if(riskB){
    riskB.innerHTML = risks.length ? risks.map(s=>`<div class="drill-row">
      <div><b>${esc(s.signal_int_id||'')} ${esc((s.title||'').slice(0,80))}</b><br>
      <span style="font-size:11px;color:var(--fall)">${esc(s.importance_label_tr||'Yüksek')} · ${esc(s.why_it_matters||'').slice(0,80)}</span></div>
      <div><button type="button" class="pill" onclick="scrollToBriefTarget('${esc(s.wrap_id||('sig-wrap-'+(s.id||0)))}')">Git</button></div>
    </div>`).join('') : '<div class="drill-row">Kritik risk yok — izleme devam.</div>';
  }
}

export function initBriefUxListeners(){
  document.querySelectorAll('.ds-click[data-drill]:not([data-bound])').forEach(btn=>{
    btn.setAttribute('data-bound','1');
    btn.addEventListener('click', ()=> toggleDrillPanel(btn.getAttribute('data-drill')));
  });
  document.querySelectorAll('[data-close-drill]:not([data-bound])').forEach(btn=>{
    btn.setAttribute('data-bound','1');
    btn.addEventListener('click', ()=>{
      ['drillArticles','drillSignals','drillActions','drillRisks'].forEach(id=>{
        const p = document.getElementById(id);
        if(p) p.hidden = true;
      });
    });
  });
  const capChip = document.getElementById('capabilityChip');
  if(capChip && !capChip.dataset.bound){
    capChip.dataset.bound = '1';
    capChip.addEventListener('click', ()=>{
      const p = document.getElementById('capabilityPanel');
      if(p) p.hidden = !p.hidden;
    });
  }
  document.querySelectorAll('[data-close-cap]').forEach(btn=>{
    if(btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', ()=>{
      const p = document.getElementById('capabilityPanel');
      if(p) p.hidden = true;
    });
  });
  const searchBtn = document.getElementById('intelSearchBtn');
  const searchInput = document.getElementById('intelSearchInput');
  if(searchBtn && !searchBtn.dataset.bound){
    searchBtn.dataset.bound = '1';
    searchBtn.addEventListener('click', ()=> runIntelSearch());
    if(searchInput){
      searchInput.addEventListener('keydown', e=>{
        if(e.key === 'Enter') runIntelSearch();
      });
    }
  }
  document.querySelectorAll('[data-close-search]').forEach(btn=>{
    if(btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', ()=>{
      const p = document.getElementById('intelSearchResults');
      if(p) p.hidden = true;
    });
  });
  const afBtn = document.getElementById('afApplyBtn');
  if(afBtn && !afBtn.dataset.bound){
    afBtn.dataset.bound = '1';
    afBtn.addEventListener('click', ()=> loadArticleExplorer());
  }
  document.querySelectorAll('[data-af-day]').forEach(btn=>{
    if(btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('[data-af-day]').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      btn.dataset.afSelected = btn.getAttribute('data-af-day');
      loadArticleExplorer();
    });
  });
}

let _workstationCache = null;
let _workstationPollTimer = null;

export function renderCapabilityPanel(cap){
  const body = document.getElementById('capabilityBody');
  const chip = document.getElementById('capabilityChip');
  if(!body || !cap) return;
  const liveN = (cap.components || []).filter(c=>c.status === 'live').length;
  if(chip) chip.textContent = 'Yetenekler · '+liveN+' CANLI';
  body.innerHTML = (cap.components || []).map(c=>{
    const dot = c.status === 'live' ? 'cap-live' : 'cap-opt';
    return `<div class="cap-row"><span class="cap-dot ${dot}"></span><span class="cap-label">${esc(c.label)}</span><span class="cap-status">${esc(c.status_label_tr)}</span></div>`;
  }).join('');
}

export function renderLiveClock(clock){
  if(!clock) return;
  const set = (id, txt)=>{ const el = document.getElementById(id); if(el) el.textContent = txt; };
  set('liveClockChip', clock.current_time || '—');
  set('liveClockUpdated', (clock.updated_label_tr || 'Güncellendi')+' · '+(clock.current_time || '—'));
  set('liveClockNext', (clock.next_scan_label_tr || 'Sonraki Tarama')+' · '+(clock.next_scheduled_scan || '—'));
  set('liveClockFeed', 'Son Feed · '+(clock.last_feed || '—'));
  set('liveClockAnalysis', 'Son Analiz · '+(clock.last_analysis || '—'));
  set('liveClockRec', 'Son Öneri · '+(clock.last_recommendation || '—'));
  const fresh = document.getElementById('freshnessChip');
  if(fresh) fresh.textContent = 'Güncellik · '+(clock.current_time ? clock.current_time.split('·').pop().trim() : '—');
}

export function renderLivePipelineStrip(pipeline){
  const el = document.getElementById('livePipelineStrip');
  if(!el || !pipeline) return;
  const stages = pipeline.stages || [];
  el.innerHTML = stages.map((s,i)=>{
    const arrow = i < stages.length-1 ? '<span class="lp-arrow">↓</span>' : '';
    return `<div class="lp-stage state-${esc(s.state)}"><div class="lp-label">${esc(s.label)}</div><div class="lp-state">${esc(s.state_label_tr)}</div><div class="lp-time">${esc(s.last_execution_display || '—')}</div></div>${arrow}`;
  }).join('');
}

export function renderExecutiveSituation(sit){
  if(!sit) return;
  const set = (id,v)=>{ const el=document.getElementById(id); if(el) el.textContent = v || '—'; };
  set('espSituation', sit.todays_situation);
  set('espOpportunity', sit.biggest_opportunity);
  set('espThreat', sit.biggest_threat);
  set('espPending', String(sit.pending_actions_count != null ? sit.pending_actions_count : '—'));
  set('espLatestRec', sit.latest_recommendation);
}

export async function loadWorkstationBundle(force){
  try{
    const res = await apiFetch('/api/intelligence/workstation');
    if(!res || !res.ok) return;
    const data = await res.json();
    if(!force && _workstationCache && _workstationCache.generated_at === data.generated_at) return;
    _workstationCache = data;
    if(data.capabilities) renderCapabilityPanel(data.capabilities);
    if(data.pipeline) renderLivePipelineStrip(data.pipeline);
    if(data.clock) renderLiveClock(data.clock);
    if(data.live_status && window._briefData){
      renderPipelineStatus({live_intelligence_status: data.live_status, status: 'healthy'});
    }
  }catch(_){}
}

export function startWorkstationPolling(){
  if(_workstationPollTimer) return;
  loadWorkstationBundle(true);
  _workstationPollTimer = setInterval(()=> loadWorkstationBundle(false), 60000);
}

export async function runIntelSearch(){
  const input = document.getElementById('intelSearchInput');
  const panel = document.getElementById('intelSearchResults');
  const body = document.getElementById('intelSearchBody');
  if(!input || !panel || !body) return;
  const q = (input.value || '').trim();
  if(q.length < 2) return;
  body.innerHTML = '<div class="drill-row">Aranıyor…</div>';
  panel.hidden = false;
  try{
    const res = await apiFetch('/api/intelligence/search?q='+encodeURIComponent(q));
    if(!res || !res.ok){ body.innerHTML = '<div class="drill-row">Arama başarısız.</div>'; return; }
    const data = await res.json();
    let html = '';
    (data.signals||[]).forEach(s=>{
      html += `<div class="drill-row"><div><b>Sinyal</b> ${esc((s.title||'').slice(0,80))}</div><button type="button" class="pill" onclick="scrollToBriefTarget('sig-wrap-${s.id}')">Git</button></div>`;
    });
    (data.articles||[]).forEach(a=>{
      html += `<div class="drill-row"><div><b>Makale</b> ${esc((a.title||'').slice(0,80))}<br><span style="font-size:11px;color:var(--muted)">${esc(a.source_name||'')}</span></div>${a.url?`<a class="pill" href="${esc(a.url)}" target="_blank" rel="noopener">Aç</a>`:''}</div>`;
    });
    (data.recommendations||[]).forEach((r,i)=>{
      html += `<div class="drill-row"><div><b>Öneri</b> ${esc((r.what_to_do||r.title||'').slice(0,80))}</div><button type="button" class="pill" onclick="scrollToBriefTarget('rec${i+1}')">Git</button></div>`;
    });
    body.innerHTML = html || '<div class="drill-row">Sonuç yok.</div>';
  }catch(_){
    body.innerHTML = '<div class="drill-row">Bağlantı hatası.</div>';
  }
}

export async function loadArticleExplorer(){
  const body = document.getElementById('drillArticlesBody');
  if(!body) return;
  const dayBtn = document.querySelector('[data-af-day].active');
  const day = dayBtn ? dayBtn.getAttribute('data-af-day') : '';
  const operator = (document.getElementById('afOperator')||{}).value || '';
  const topic = (document.getElementById('afTopic')||{}).value || '';
  const language = (document.getElementById('afLang')||{}).value || '';
  const params = new URLSearchParams();
  if(day) params.set('day', day);
  if(operator) params.set('operator', operator);
  if(topic) params.set('topic', topic);
  if(language) params.set('language', language);
  body.innerHTML = '<div class="drill-row">Yükleniyor…</div>';
  try{
    const res = await apiFetch('/api/intelligence/articles/explore?'+params.toString());
    if(!res || !res.ok){ body.innerHTML = '<div class="drill-row">Makale yüklenemedi.</div>'; return; }
    const data = await res.json();
    const articles = data.articles || [];
    body.innerHTML = articles.length ? articles.map(a=>`<div class="drill-row explorer-article">
      <div><b>${esc((a.title||'').slice(0,100))}</b><br>
      <span class="mono" style="font-size:10px;color:var(--muted)">${esc(a.source_name||'')} · ${esc(a.language||'')} · ${esc(formatTimeShort(a.published_at||a.fetched_at))}</span>
      ${a.entities?'<br><span style="font-size:11px">'+esc(a.entities)+'</span>':''}
      ${a.topics?'<br><span style="font-size:11px">'+esc(a.topics)+'</span>':''}</div>
      <div>${a.url?`<a class="pill" href="${esc(a.url)}" target="_blank" rel="noopener">Aç</a>`:''}</div>
    </div>`).join('') : '<div class="drill-row">Filtreye uygun makale yok.</div>';
  }catch(_){
    body.innerHTML = '<div class="drill-row">Bağlantı hatası.</div>';
  }
}

export function executiveSummaryHtml(ex, opts){
  opts = opts || {};
  if(!ex) return '';
  const devs = (ex.developments || []).slice(0, 5);
  const signalMap = opts.signalMap || [];
  const three = ex.three_questions || {};
  const actions = (ex.todays_actions || []).slice(0, 3);

  if(devs.length){
    const devHtml = devs.map((d, i) => {
      const wrapId = signalMap[i] || d.wrap_id || '';
      const circ = CIRCLED_NUM[i] || (i+1)+'.';
      const click = wrapId ? ` class="exec-dev exec-dev-click" role="button" tabindex="0" onclick="scrollToBriefTarget('${esc(wrapId)}')" onkeydown="if(event.key==='Enter')scrollToBriefTarget('${esc(wrapId)}')"` : ' class="exec-dev"';
      return `<li${click}>
      <div class="exec-dev-head">${circ} ${esc(d.headline_tr || d.what_changed_tr || '')}</div>
      <div class="exec-dev-meta">${d.signal_int_id ? `<span class="meta-pill mono">${esc(d.signal_int_id)}</span>` : ''}
        ${d.importance_label_tr ? `<span class="meta-pill">Önem: ${esc(d.importance_label_tr)}</span>` : ''}
        ${d.affected_destination ? `<span class="meta-pill">${esc(d.affected_destination)}</span>` : ''}
        ${d.source_name ? `<span class="meta-pill">${esc(d.source_name)}</span>` : ''}
        ${d.published_display ? `<span class="meta-pill">${esc(formatTimeShort(d.published_display))}</span>` : ''}
        ${d.confidence ? `<span class="meta-pill">Güven: ${esc(d.confidence)}</span>` : ''}</div>
      ${d.estimated_impact ? `<div class="exec-dev-impact"><span class="exec-dev-label">Tahmini etki</span>${esc(String(d.estimated_impact).slice(0,120))}</div>` : ''}
      <div class="exec-dev-impact"><span class="exec-dev-label">Neden önemli (Türkiye)</span>${esc(d.turkey_impact_tr || d.why_turkey_tr || '')}</div>
      <div class="exec-dev-action"><span class="exec-dev-label">Sonraki adım</span>${esc(d.action_tr || d.what_to_do_tr || '')}</div>
      ${(d.evidence_level_tr || d.evidence_summary_tr) ? `<div class="exec-dev-evidence"><span class="exec-dev-label">Kanıt</span><span class="exec-evidence-level">${esc(d.evidence_level_tr || d.evidence_level || '')}</span>${esc(d.evidence_summary_tr || (d.evidence_summary || []).join(' · '))}</div>` : ''}
      ${d.confidence ? `<div class="exec-dev-confidence"><span class="exec-dev-label">Güven</span>${esc(d.confidence)}</div>` : ''}
      ${wrapId ? '<div class="exec-dev-action" style="font-size:11px;color:var(--gold)">Tıkla → sinyale git</div>' : ''}
    </li>`;
    }).join('');
    const threeHtml = (three.what_changed_tr || three.why_turkey_tr || three.what_to_do_tr)
      ? `<div class="exec-three-q">
        <div><span class="exec-dev-label">Bugün ne değişti?</span>${esc(three.what_changed_tr || '—')}</div>
        <div><span class="exec-dev-label">Türkiye neden ilgilenmeli?</span>${esc(three.why_turkey_tr || '—')}</div>
        <div><span class="exec-dev-label">Bugün ne yapmalıyız?</span>${esc(three.what_to_do_tr || '—')}</div>
      </div>`
      : '';
    return `<div class="exec-summary-inner">
      <div class="exec-kicker">Executive Summary · ${esc(String(ex.read_seconds||30))} sn</div>
      <p class="exec-top5-title">Bugünün En Önemli İstihbaratı</p>
      <p class="exec-intro">${esc(ex.intro_tr||'')}</p>
      <ol class="exec-developments">${devHtml}</ol>
      ${threeHtml}
      ${actions.length ? `<div class="exec-actions"><span class="exec-actions-label">Bugünün önerisi</span>${actions.map(a=>`<span class="exec-chip">✓ ${esc(a)}</span>`).join('')}</div>` : ''}
    </div>`;
  }

  const bullets = (ex.bullets || []).filter(b => b && String(b).trim().length > 3 && !/^\d+$/.test(String(b).trim())).slice(0,5);
  if(!bullets.length && !actions.length) return '';
  return `<div class="exec-summary-inner">
    <div class="exec-kicker">Executive Summary · ${esc(String(ex.read_seconds||30))} sn</div>
    <p class="exec-intro">${esc(ex.intro_tr||'Yönetici özeti')}</p>
    <ul class="exec-bullets">${bullets.map(b=>`<li>${esc(b)}</li>`).join('')}</ul>
    ${actions.length ? `<div class="exec-actions"><span class="exec-actions-label">Bugünün önerisi</span>${actions.map(a=>`<span class="exec-chip">✓ ${esc(a)}</span>`).join('')}</div>` : ''}
  </div>`;
}
export function mountExecutiveSummary(elId, ex, opts){
  const el = document.getElementById(elId);
  if(!el) return;
  const html = executiveSummaryHtml(ex, opts);
  el.innerHTML = html;
  el.style.display = html ? '' : 'none';
}
export function whyMattersHtml(wm){
  if(!wm) return '';
  const rows = [
    ['Neden bugün?', wm.why_today],
    ['Neden Polonya?', wm.why_poland],
    ['Neden Türkiye?', wm.why_turkey],
    ['Kim kazanır?', wm.who_benefits],
    ['Kim kaybeder?', wm.who_loses],
    ['Beklenen etki', wm.expected_impact],
    ['Süre', wm.estimated_duration],
    ['Güven', wm.confidence],
  ].filter(([,v])=>v);
  if(!rows.length) return '';
  return `<div class="why-matters-panel"><div class="f">Neden önemli?</div>${rows.map(([k,v])=>`<div class="x"><b>${esc(k)}</b> ${esc(String(v).slice(0,200))}</div>`).join('')}</div>`;
}

export function sourcePanelHtml(trace){
  const t = trace || {};
  if(!t.article_url && !t.source_name) return '';
  return `<div class="source-panel"><div class="f">Kaynak zinciri</div>
    <div class="x"><b>Yayıncı</b> ${esc(t.source_name||'—')}</div>
    <div class="x"><b>Yayın</b> ${esc(t.published_at_display || formatPubDate(t.published_at))}</div>
    <div class="x"><b>Toplama</b> ${esc(formatPubDate(t.fetched_at) || '—')}</div>
    ${t.article_url ? `<div class="x"><a class="trace-link" href="${esc(t.article_url)}" target="_blank" rel="noopener">${esc(t.article_url)}</a></div>` : ''}
    <div class="x"><b>Alıntı</b> ${esc(t.article_title||'—')}</div>
  </div>`;
}

export async function loadSignalTimeline(signalId){
  const slot = document.getElementById('timeline-'+signalId);
  if(!slot || slot.dataset.loaded) return;
  try{
    const res = await apiFetch('/api/signals/'+signalId+'/timeline');
    if(!res || !res.ok) return;
    const data = await res.json();
    const events = data.timeline || [];
    slot.innerHTML = `<div class="f">Zaman çizelgesi</div><div class="timeline-chain">${events.map((e,i)=>{
      const arrow = i < events.length-1 ? '<span class="tl-arrow">↓</span>' : '';
      return `<div class="tl-step"><span class="tl-label">${esc(e.label_tr||e.stage)}</span><span class="tl-time">${esc(formatTimeShort(e.at))}</span></div>${arrow}`;
    }).join('')}</div>`;
    slot.dataset.loaded = '1';
  }catch(_){}
}

export function exportRecPdf(wrapId){
  const el = document.getElementById(wrapId);
  if(!el) return;
  const w = window.open('', '_blank');
  if(!w) return;
  w.document.write('<html><head><title>PlanAI Brief</title></head><body style="font-family:sans-serif;padding:24px">'+el.innerHTML+'</body></html>');
  w.document.close();
  w.print();
}
if(typeof window !== 'undefined'){
  window.exportRecPdf = exportRecPdf;
}

export function priorityTone(p){
  const l = String(p||'').toLowerCase();
  if(l.includes('critical')||l.includes('kritik')||l.includes('urgent')||l.includes('acil')) return 'critical';
  if(l.includes('high')||l.includes('yüksek')) return 'high';
  if(l.includes('low')||l.includes('düşük')) return 'low';
  return 'medium';
}
export function priorityColor(p){
  const t = priorityTone(p);
  return {critical:'var(--fall)',high:'#E8913A',medium:'var(--amber)',low:'var(--rise)'}[t] || 'var(--amber)';
}
export function trDecisionCardHtml(item, opts){
  opts = opts || {};
  const wrapId = opts.wrapId || ('trcard-' + Math.random().toString(36).slice(2,8));
  const title = item.title || item.headline || '—';
  const original = item.original_title || item.title_pl || item.title_en || '';
  const summary = item.ai_summary_tr || item.summary || item.body || '';
  const impact = item.turkey_impact_tr || (item.turkey_impact && item.turkey_impact.estimated_impact_tr) || item.why_it_matters || '';
  const rec = item.recommendation_tr || (item.recommendation && item.recommendation.action) || item.what_to_do || (item.decision_package && item.decision_package.what_to_do) || '';
  const source = item.source_name || (item.trace && item.trace.source_name) || '';
  const conf = item.confidence_label || item.priority || '—';
  const horizon = item.action_horizon_label_tr || '';
  const engine = item.source_engine_label_tr || '';
  const category = item.category || item.delta_type_label_tr || '';
  const country = item.country || 'PL';
  const risk = item.risk || '';
  const opportunity = item.opportunity || item.expected_impact || '';
  const url = item.url || (item.trace && item.trace.article_url) || '';
  const showOrig = original && original !== title;
  const sigNum = opts.signalNumber;
  const sigIntId = item.signal_int_id || opts.signalIntId || '';
  const sigBadge = sigIntId
    ? `<span class="signal-badge">${esc(sigIntId)}</span>`
    : (sigNum ? `<span class="signal-badge">Signal #${sigNum}</span>` : '');
  const pubAt = item.published_display || (item.trace && (item.trace.published_at_display || item.trace.published_at));
  const imp = item.importance_label || item.importance_label_tr || '';
  const metaRow = (sigNum || imp || source || pubAt) ? `<span class="signal-meta-row">
    ${imp ? `<span class="meta-pill">Önem: ${esc(imp)}</span>` : ''}
    ${source ? `<span class="meta-pill">Kaynak: ${esc(source)}</span>` : ''}
    ${pubAt ? `<span class="meta-pill">Yayın: ${esc(formatTimeShort(pubAt))}</span>` : ''}
    ${conf ? `<span class="meta-pill">Güven: ${esc(conf)}</span>` : ''}
  </span>` : '';
  const actionBtns = opts.executiveActions ? `<div class="exec-actions-row">
    <button type="button" class="pill" onclick="event.stopPropagation();toggleSigTrace('${wrapId}')">Kanıtı Aç</button>
    ${url ? `<a class="pill" href="${esc(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Kaynağı Aç</a>` : ''}
    <button type="button" class="pill" onclick="event.stopPropagation();toggleDrillPanel('articles')">Makaleler</button>
    <button type="button" class="pill" onclick="event.stopPropagation();toggleDrillPanel('signals')">Sinyal</button>
    <button type="button" class="pill" onclick="event.stopPropagation();generateExecBriefing('${wrapId}')">Brifing</button>
    <button type="button" class="pill" onclick="event.stopPropagation();navigateToScreen('media')">Medya Planı</button>
    ${item.id ? `<button type="button" class="pill" onclick="event.stopPropagation();submitRecFeedback(${item.id},'accepted')">Kabul</button>` : ''}
    ${item.id ? `<button type="button" class="pill" onclick="event.stopPropagation();submitRecFeedback(${item.id},'rejected')">Red</button>` : ''}
    <button type="button" class="pill" onclick="event.stopPropagation();navigateToScreen('brief')">Daha Fazla Kanıt</button>
    <button type="button" class="pill" onclick="event.stopPropagation();exportRecPdf('${wrapId}')">PDF</button>
    ${item.id ? `<button type="button" class="pill" onclick="event.stopPropagation();submitRecFeedback(${item.id},'ignored')">Arşivle</button>` : ''}
  </div>` : '';
  const whyBlock = item.why_matters ? whyMattersHtml(item.why_matters) : '';
  const explorerMeta = item.explorer ? `<div class="signal-meta-row">
    <span class="meta-pill">Kanıt: ${esc(String(item.explorer.evidence_count||0))}</span>
    <span class="meta-pill">Kaynak: ${esc(String(item.explorer.source_count||0))}</span>
    ${item.explorer.entities ? `<span class="meta-pill">${esc(String(item.explorer.entities).slice(0,60))}</span>` : ''}
  </div>` : '';
  const sourcePanel = item.trace ? sourcePanelHtml(item.trace) : '';
  const timelineSlot = item.id ? `<div class="sig-timeline-slot" id="timeline-${item.id}"></div>` : '';
  return `<div class="tr-card ${opts.compact!==false?'compact':''} pri-${priorityTone(item.priority||conf)}" id="${wrapId}">
    <button type="button" class="tr-card-head" onclick="toggleSigTrace('${wrapId}')">
      ${sigBadge}
      <span class="tr-card-meta">
        ${horizon ? `<span class="horizon-pill">${esc(horizon)}</span>` : ''}
        ${engine ? `<span class="engine-pill">${esc(engine)}</span>` : ''}
        ${category ? `<span class="meta-pill cat">${esc(category)}</span>` : ''}
        ${source ? `<span class="meta-pill">${esc(source)}</span>` : ''}
        <span class="meta-pill">${esc(country)}</span>
        ${risk ? `<span class="meta-pill risk">${ico('risk','R')} ${esc(String(risk).slice(0,40))}</span>` : ''}
        ${opportunity ? `<span class="meta-pill opp">${ico('opp','F')} ${esc(String(opportunity).slice(0,40))}</span>` : ''}
      </span>
      <span class="tr-card-title">${esc(title)}</span>
      ${showOrig ? `<span class="tr-card-orig" title="${esc(original)}">Orijinal: ${esc(String(original).slice(0,120))}</span>` : ''}
      <span class="tr-card-ai"><b>AI Özeti</b> — ${esc(String(summary).slice(0,160))}</span>
      ${impact ? `<span class="tr-card-line"><b>Türkiye etkisi</b> — ${esc(String(impact).slice(0,120))}</span>` : ''}
      ${rec ? `<span class="tr-card-line gold"><b>Öneri</b> — ${esc(String(rec).slice(0,120))}</span>` : ''}
      <span class="tr-card-foot">Güven: ${esc(conf)}${url ? ' · Kaynak expand\'da' : ''} · Detay ▸</span>
      ${metaRow}
      ${explorerMeta}
    </button>
    <div class="sig-trace evidence">
      ${whyBlock}
      ${opts.extraEvidence || ''}
      ${item.decision_package ? decisionPackageHtml(item.decision_package) : ''}
      ${tracePanelHtml(item.trace || {}, {showRecommendationReasoning:true, recommendationReasoning:item.why||item.evidence, explainScores:item.trace})}
      ${sourcePanel}
      ${timelineSlot}
      ${actionBtns}
      ${item.id && !item.supplement ? `<div class="f">Feedback</div><div class="x" style="display:flex;gap:6px;flex-wrap:wrap">
        <button type="button" class="pill" onclick="event.stopPropagation();submitRecFeedback(${item.id},'accepted')">Kabul</button>
        <button type="button" class="pill" onclick="event.stopPropagation();submitRecFeedback(${item.id},'rejected')">Red</button>
        <button type="button" class="pill" onclick="event.stopPropagation();submitRecFeedback(${item.id},'ignored')">Yok say</button>
        <button type="button" class="pill" onclick="event.stopPropagation();submitRecFeedback(${item.id},'implemented')">Uygulandı</button>
      </div>` : ''}
    </div>
  </div>`;
}
export function formatPubDate(iso){
  if(!iso) return '—';
  try{
    const d = new Date(iso);
    if(Number.isNaN(d.getTime())) return iso.slice(0,10);
    return d.toLocaleDateString('tr-TR',{day:'2-digit',month:'2-digit',year:'numeric'});
  }catch(_){ return iso; }
}

/* ---------- inline translation (Polish → English) ---------- */
const TR_CACHE_KEY = 'planai_tr_pl_en_v1';
export function trHash(text){
  let h = 0;
  for(let i=0;i<text.length;i++) h = ((h<<5)-h) + text.charCodeAt(i) | 0;
  return 'h' + Math.abs(h).toString(36);
}
export function trCacheGet(text){
  try{
    const store = JSON.parse(localStorage.getItem(TR_CACHE_KEY) || '{}');
    return store[trHash(text)] || null;
  }catch(_){ return null; }
}
export function trCacheSet(text, translation){
  try{
    const store = JSON.parse(localStorage.getItem(TR_CACHE_KEY) || '{}');
    store[trHash(text)] = translation;
    localStorage.setItem(TR_CACHE_KEY, JSON.stringify(store));
  }catch(_){}
}
export function polishParagraphBlock(text){
  return `<div class="pl-block">
    <div class="pl-text">${esc(text)}</div>
    <button type="button" class="translate-btn">Translate to English</button>
    <div class="tr-panel"></div>
  </div>`;
}
export function polishParagraphsSection(paragraphs){
  if(!paragraphs || !paragraphs.length) return '';
  return `<div class="f">Orijinal metin (Lehçe)</div>
  <div class="x pl-excerpt" style="grid-column:1/-1">${paragraphs.map(p=>polishParagraphBlock(p)).join('')}</div>`;
}
export function renderTranslationPanel(panel, translation, failed, opts){
  opts = opts || {};
  if(failed || !translation){
    const msg = opts.errorTr || 'Çeviri şu an kullanılamıyor.';
    const retry = opts.retry !== false
      ? `<button type="button" class="tr-retry" data-retry-tr>Tekrar dene</button>`
      : '';
    panel.innerHTML = `<div class="tr-unavail">${esc(msg)}${retry}</div>`;
    const rb = panel.querySelector('[data-retry-tr]');
    if(rb){
      const block = panel.closest('.pl-block');
      const btn = block && block.querySelector('.translate-btn');
      if(btn) rb.addEventListener('click', ()=> toggleInlineTranslation(btn, true));
    }
    return;
  }
  panel.innerHTML = `<div class="tr-label">English Translation</div><div class="tr-body">${esc(translation)}</div>`;
}
export async function toggleInlineTranslation(btn, forceRetry){
  const block = btn.closest('.pl-block');
  if(!block) return;
  const panel = block.querySelector('.tr-panel');
  const textEl = block.querySelector('.pl-text');
  const text = (textEl && textEl.textContent) ? textEl.textContent.trim() : '';
  if(!text) return;

  if(panel.classList.contains('open') && !forceRetry){
    if(panel.querySelector('.tr-loading')) return;
    panel.classList.remove('open');
    btn.textContent = 'Translate to English';
    return;
  }

  if(!forceRetry){
    const cached = trCacheGet(text);
    if(cached){
      renderTranslationPanel(panel, cached, false);
      panel.classList.add('open');
      btn.textContent = 'Hide translation';
      return;
    }
  }

  btn.disabled = true;
  panel.innerHTML = '<div class="tr-loading"><i></i><i></i><i></i></div>';
  panel.classList.add('open');
  try{
    const res = await apiFetch('/api/translate', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({text, source_lang:'pl', target_lang:'en'})
    });
    const data = await res.json();
    if(!data.ok || !data.translation){
      if(data.show_original && data.translation){
        renderTranslationPanel(panel, data.translation, false, {noteTr: data.note_tr});
        btn.textContent = 'Hide translation';
      } else {
        renderTranslationPanel(panel, null, true, {
          errorTr: data.error_tr || data.error,
          retry: data.retry !== false
        });
        btn.textContent = 'Translate to English';
      }
    } else {
      trCacheSet(text, data.translation);
      renderTranslationPanel(panel, data.translation, false);
      btn.textContent = 'Hide translation';
    }
  }catch(_){
    renderTranslationPanel(panel, null, true, {errorTr:'Çeviri şu an kullanılamıyor.', retry:true});
    btn.textContent = 'Translate to English';
  }finally{
    btn.disabled = false;
  }
}
export function confBadge(level){
  const raw = String(level||'Medium');
  const l = raw.toLowerCase();
  const cls = l.includes('high')||l.includes('yüksek')?'high':l.includes('low')||l.includes('düşük')?'low':'medium';
  const label = l.includes('high')||l.includes('yüksek')?'High':l.includes('low')||l.includes('düşük')?'Low':l.includes('medium')||l.includes('orta')?'Medium':raw;
  return `<span class="conf-badge ${cls}">${esc(label)}</span>`;
}
export function priClass(p){
  const l = String(p||'').toLowerCase();
  if(l.includes('high')||l.includes('yüksek')) return 'high';
  if(l.includes('low')||l.includes('düşük')) return 'low';
  return 'medium';
}
export function polishParagraphsHtml(paragraphs){
  if(!paragraphs || !paragraphs.length) return '';
  return paragraphs.map(p=>polishParagraphBlock(p)).join('');
}
export function hasPolishParagraphs(t){
  const paras = t && t.original_paragraphs;
  return Array.isArray(paras) && paras.length > 0;
}
export function polishOriginalSectionHtml(t){
  if(!hasPolishParagraphs(t)) return '';
  return `<div class="intel-sec intel-polish-sec">
    <div class="intel-sec-h">08 · Orijinal Metin (Lehçe)</div>
    <div class="pl-excerpt">${polishParagraphsHtml(t.original_paragraphs)}</div>
  </div>`;
}
export function aiSourcesBodyHtml(t, opts){
  opts = opts || {};
  const url = t.article_url || '';
  const urlLine = url
    ? `<a class="trace-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`
    : '—';
  const lang = t.language || t.source_language || '—';
  const entities = t.entities || (t.article_entities && t.article_entities.join(', ')) || '';
  const topics = t.topics || (t.article_topics && t.article_topics.join(', ')) || '';
  const conf = t.evidence_level || (t.intelligence && t.intelligence.confidence && t.intelligence.confidence.level) || '';
  let html = '';
  html += `<div class="f">Başlık</div><div class="x"><b>${esc(t.article_title || '—')}</b></div>`;
  html += `<div class="f">Orijinal dil</div><div class="x">${esc(lang)}</div>`;
  html += `<div class="f">Orijinal kaynak</div><div class="x"><b>${esc(t.source_name||'—')}</b></div>`;
  html += `<div class="f">Yayın tarihi</div><div class="x">${esc(t.published_at_display || formatPubDate(t.published_at))} ${badgeHtml({css:(t.provenance==='MANUEL'?'est':'real'),label:(t.provenance==='MANUEL'?'Manuel':(t.provenance==='TAHMİNİ'?'Tahmini':'Gerçek'))})}</div>`;
  html += `<div class="f">Kaynak URL</div><div class="x">${urlLine}</div>`;
  html += `<div class="f">AI özeti</div><div class="x">${esc(t.ai_summary||'—')}</div>`;
  if(t.turkey_impact || (t.intelligence && t.intelligence.impact_on_turkey)){
    const imp = t.turkey_impact || Object.values((t.intelligence && t.intelligence.impact_on_turkey) || {})[0] || '';
    html += `<div class="f">Türkiye etkisi</div><div class="x">${esc(imp||'—')}</div>`;
  }
  if(entities) html += `<div class="f">Varlıklar</div><div class="x">${esc(entities)}</div>`;
  if(topics) html += `<div class="f">Konular</div><div class="x">${esc(topics)}</div>`;
  if(conf) html += `<div class="f">Güven</div><div class="x">${confBadge(conf)}</div>`;
  html += `<div class="f">AI gerekçesi</div><div class="x">${esc(t.ai_reasoning||'—')}</div>`;
  if(opts.showRecommendationReasoning){
    html += `<div class="f">Öneri gerekçesi</div><div class="x">${esc(opts.recommendationReasoning||t.recommendation_reasoning||'—')}</div>`;
  }
  if(t.model){
    html += `<div class="f">Model</div><div class="x mono" style="font-size:11px">${esc(t.model)}</div>`;
  }
  if(url || hasPolishParagraphs(t)){
    html += `<div class="f" style="grid-column:1/-1">Eylemler</div><div class="x" style="display:flex;gap:6px;flex-wrap:wrap;grid-column:1/-1">`;
    if(hasPolishParagraphs(t)) html += `<button type="button" class="pill translate-btn">Çevir</button>`;
    if(url) html += `<a class="pill" href="${esc(url)}" target="_blank" rel="noopener">Orijinali Aç</a>`;
    html += `<button type="button" class="pill" onclick="navigator.clipboard.writeText(${JSON.stringify((t.article_title||'')+'\n'+url)})">Kopyala</button>`;
    html += `</div>`;
  }
  return html;
}
export function explainPanelHtml(trace){
  const t = trace || {};
  const intel = t.intelligence || {};
  const conf = intel.confidence || {};
  const lines = [];
  if(conf.rationale) lines.push('<b>Gerekçe:</b> '+esc(conf.rationale));
  const exp = trace.explorer || {};
  if(exp.evidence_count != null) lines.push('<b>Kanıt sayısı:</b> '+esc(String(exp.evidence_count)));
  if(exp.source_count != null) lines.push('<b>Kaynak sayısı:</b> '+esc(String(exp.source_count)));
  if(t.ai_reasoning) lines.push('<b>AI:</b> '+esc(t.ai_reasoning));
  if(t.recommendation_reasoning) lines.push('<b>Öneri:</b> '+esc(t.recommendation_reasoning));
  const ents = t.entities || '';
  if(ents) lines.push('<b>Varlıklar:</b> '+esc(ents));
  const topics = t.topics || '';
  if(topics) lines.push('<b>Konular:</b> '+esc(topics));
  if(t.evidence_level) lines.push('<b>Kanıt seviyesi:</b> '+esc(t.evidence_level));
  if(t.source_name) lines.push('<b>Kaynak:</b> '+esc(t.source_name));
  if(!lines.length) lines.push('Kanıt zinciri: kaynak makale, AI analizi ve kural tabanlı skorlama.');
  return `<div class="explain-panel">${lines.join('<br>')}</div>`;
}
export function toggleExplainPanel(btn){
  const sec = btn.closest('.intel-sec') || btn.closest('.sig-trace');
  if(!sec) return;
  let panel = sec.querySelector('.explain-panel');
  if(panel){
    panel.hidden = !panel.hidden;
    return;
  }
  const wrap = btn.closest('.tr-card');
  let trace = (window._briefData && window._briefData._activeTrace) || {};
  if(wrap && wrap.id){
    const rm = wrap.id.match(/^rec(\d+)$/);
    if(rm){
      const rec = (window._briefRecsCache || [])[parseInt(rm[1],10)-1];
      trace = (rec && rec.trace) || trace;
    }
    const sm = wrap.id.match(/^sig-wrap-(\d+)$/);
    if(sm){
      const sig = (window._briefSignalsCache || []).find(s => String(s.id) === sm[1]);
      trace = (sig && sig.trace) || trace;
    }
  }
  const div = document.createElement('div');
  div.innerHTML = explainPanelHtml(trace);
  panel = div.firstElementChild;
  if(panel){
    panel.hidden = false;
    sec.appendChild(panel);
  }
}
if(typeof window !== 'undefined'){
  window.toggleExplainPanel = toggleExplainPanel;
  window.generateExecBriefing = function(wrapId){
    const el = document.getElementById(wrapId);
    if(!el) return;
    const text = el.innerText.replace(/\s+/g,' ').trim().slice(0,4000);
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).catch(()=>{});
    }
  };
}
export function decisionPackageHtml(dp){
  if(!dp) return '';
  const mem = dp.memory_note ? `<div class="f">Hafıza</div><div class="x">${esc(dp.memory_note)}</div>` : '';
  const corr = dp.corroboration;
  const corrBlock = corr ? `<div class="f">Kanıt gücü</div><div class="x">${esc(String(corr.evidence_count||0))} katman · çeşitlilik ${esc(String(corr.evidence_diversity||0))} · ${esc(corr.confidence_label||'')}</div>` : '';
  const whyNow = dp.why_now;
  const whyBlock = whyNow ? `<div class="f">Neden şimdi?</div><div class="x">${esc(whyNow.why_today||'—')}</div>` : '';
  const evo = dp.evolution;
  const evoBlock = evo && evo.suggested_before ? `<div class="f">Öğrenme</div><div class="x">${esc(evo.note_tr||'Benzer öneri geçmişi var')}</div>` : '';
  return `<div class="intel-sec" style="margin-top:10px;border-top:1px dashed var(--line);padding-top:10px">
    <div class="intel-sec-h">Karar İstihbaratı — Beş Soru</div>
    <div class="f">Ne oldu?</div><div class="x">${esc(dp.what_changed||'—')}</div>
    <div class="f">Neden bugün?</div><div class="x">${esc(dp.why_changed||'—')}</div>
    <div class="f">Neden Türkiye?</div><div class="x">${esc(dp.why_turkey||'—')}</div>
    <div class="f">Ne yapmalı?</div><div class="x"><b style="color:var(--gold)">${esc(dp.what_to_do||'—')}</b></div>
    <div class="f">Yok sayılırsa?</div><div class="x">${esc(dp.if_ignored||'—')}</div>
    <div class="f">Güven</div><div class="x">${esc(dp.confidence_label||'—')}</div>
    ${whyBlock}${corrBlock}${evoBlock}${mem}
  </div>`;
}
export function intelligenceReportHtml(t, opts){
  const intel = t.intelligence || {};
  const impact = intel.impact_on_turkey || {};
  const labels = t.impact_labels || {
    demand:'Talep',tour_operators:'Tur operatörleri',media:'Medya',seasonality:'Sezonluluk',
    airlines:'Havayolları',pricing:'Fiyatlama',destination_image:'Destinasyon imajı',
    competitive_position:'Rekabet konumu',campaign_planning:'Kampanya planlaması',goturkiye:'GoTürkiye'
  };
  const related = t.related_signals || {};
  const comp = intel.competitor_view || {};
  const conf = intel.confidence || {};
  let html = `<div class="intel-report">`;

  if(t.decision) html += decisionPackageHtml(t.decision);
  else if(t.memory_note) html += `<div class="intel-sec"><div class="intel-sec-h">Kurumsal Hafıza</div><p class="intel-p">${esc(t.memory_note)}</p></div>`;

  html += `<div class="intel-sec"><div class="intel-sec-h">01 · Signal</div><div class="intel-signal">${esc(intel.signal || t.ai_summary || '—')}</div></div>`;

  html += `<div class="intel-sec"><div class="intel-sec-h">02 · Why This Matters</div>`;
  const whys = intel.why_this_matters || [t.ai_reasoning||''].filter(Boolean);
  if(!whys.length) html += `<p class="intel-p">${esc(t.ai_reasoning||'—')}</p>`;
  else whys.forEach(p=>{ html += `<p class="intel-p">${esc(p)}</p>`; });
  html += `</div>`;

  html += `<div class="intel-sec"><div class="intel-sec-h">03 · Impact on Türkiye</div><div class="intel-impact-grid">`;
  Object.keys(labels).forEach(key=>{
    const val = impact[key] || 'Varşova masası izleme ve değerlendirme önerir.';
    html += `<div class="intel-impact-item"><div class="k">${esc(labels[key])}</div><div class="v">${esc(val)}</div></div>`;
  });
  html += `</div></div>`;

  const actions = intel.recommended_actions || [];
  html += `<div class="intel-sec"><div class="intel-sec-h">04 · Recommended Action</div><div class="intel-actions">`;
  html += `<div class="intel-action-row h"><div>Action</div><div>Priority</div><div>Owner</div><div>Timing</div><div>Expected benefit</div></div>`;
  if(!actions.length){
    html += `<div class="intel-action-row"><div>${esc(t.recommendation_reasoning || intel.signal || 'İzleme')}</div><div class="pri medium">Medium</div><div>Varşova masası</div><div>Bu hafta</div><div>Erken müdahale</div></div>`;
  } else {
    actions.forEach(a=>{
      html += `<div class="intel-action-row"><div><b style="color:var(--cream)">${esc(a.action||'')}</b></div><div class="pri ${priClass(a.priority)}">${esc(a.priority||'Medium')}</div><div>${esc(a.owner||'—')}</div><div>${esc(a.timing||'—')}</div><div>${esc(a.expected_benefit||'—')}</div></div>`;
    });
  }
  html += `</div></div>`;

  html += `<div class="intel-sec"><div class="intel-sec-h">05 · Competitor View</div><div class="intel-comp-grid">`;
  html += `<div class="intel-comp-item"><div class="k">Greece</div><div class="v">${esc(comp.greece||'—')}</div></div>`;
  html += `<div class="intel-comp-item"><div class="k">Egypt</div><div class="v">${esc(comp.egypt||'—')}</div></div>`;
  html += `<div class="intel-comp-item"><div class="k">Spain</div><div class="v">${esc(comp.spain||'—')}</div></div>`;
  html += `<div class="intel-comp-item" style="grid-column:1/-1"><div class="k">Competitor benefit risk</div><div class="v">${esc(comp.competitor_benefit_risk||'—')}</div></div>`;
  html += `</div></div>`;

  html += `<div class="intel-sec"><div class="intel-sec-h">06 · Confidence <button type="button" class="why-btn" onclick="toggleExplainPanel(this)">Neden?</button></div><div class="conf-row">${confBadge(conf.level)}<span class="intel-p" style="flex:1;margin:0">${esc(conf.rationale||'')}</span></div></div>`;

  html += `<div class="intel-sec"><div class="intel-sec-h">07 · Related Signals</div>`;
  const trendCls = related.trend === 'part_of_trend' ? 'trend-pill trend' : 'trend-pill';
  html += `<span class="${trendCls}">${esc(related.trend_label || 'İlişkili sinyal aranıyor…')}</span>`;
  const items = related.items || [];
  if(!items.length){
    html += `<p class="intel-p">Veritabanında yakın eşleşme yok — izole olay olarak değerlendirin.</p>`;
  } else {
    html += `<ul class="related-list">`;
    items.forEach(r=>{
      const dt = r.published_at ? formatPubDate(r.published_at) : '—';
      const link = r.url ? `<a class="trace-link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title||'')}</a>` : esc(r.title||'');
      html += `<li><span class="rt">${esc(r.match_type||'related')} · ${esc(r.source_name||'')} · ${esc(dt)}</span><br>${link}${r.summary?'<br><span style="color:var(--muted);font-size:12px">'+esc(r.summary)+'</span>':''}</li>`;
    });
    html += `</ul>`;
  }
  html += `</div>`;

  html += polishOriginalSectionHtml(t);

  html += `<details class="sources-fold"><summary>09 · AI Sources</summary><div class="sources-body">${aiSourcesBodyHtml(t, opts)}</div></details>`;
  html += `</div>`;
  return html;
}
export function tracePanelHtml(trace, opts){
  opts = opts || {};
  const t = trace || {};
  if(!t.complete && t.missing && !t.intelligence && !hasPolishParagraphs(t)){
    return `<div class="trace-missing">${esc(t.missing)}</div>`;
  }
  return intelligenceReportHtml(t, opts);
}
export function toggleSigTrace(id){
  const el = document.getElementById(id);
  if(!el) return;
  const opening = !el.classList.contains('open');
  el.classList.toggle('open');
  if(opening){
    const m = String(id).match(/^rec(\d+)$/);
    if(m){
      const idx = parseInt(m[1],10) - 1;
      const rec = (window._briefRecsCache || [])[idx];
      if(rec){
        if(rec.id) trackRecRead(rec.id);
        if(window._briefData) window._briefData._activeTrace = rec.trace || {};
      }
    }
    const sm = String(id).match(/^sig-wrap-(\d+)$/);
    if(sm){
      const sid = parseInt(sm[1],10);
      const sig = (window._briefSignalsCache || []).find(s => s.id === sid);
      if(sig && window._briefData) window._briefData._activeTrace = sig.trace || {};
      loadSignalTimeline(sid);
      loadSignalRelated(sid);
    }
  }
}

export async function loadSignalRelated(signalId){
  const sig = (window._briefSignalsCache || []).find(s => s.id === signalId);
  if(!sig) return;
  const wrap = document.getElementById(sig.wrap_id || ('sig-wrap-'+signalId));
  if(!wrap || wrap.querySelector('.related-grouped')) return;
  try{
    const res = await apiFetch('/api/signals/'+signalId+'/related');
    if(!res || !res.ok) return;
    const data = await res.json();
    const trace = wrap.querySelector('.sig-trace');
    if(!trace) return;
    const div = document.createElement('div');
    div.className = 'related-grouped';
    const groups = [
      ['Aynı operatör', data.same_operator],
      ['Aynı destinasyon', data.same_destination],
      ['Aynı konu', data.same_topic],
      ['Son 7 gün', data.last_7_days],
    ];
    let html = '<div class="f">İlgili sinyaller</div>';
    groups.forEach(([label, items])=>{
      if(!items || !items.length) return;
      html += `<div class="x"><b>${esc(label)}</b><ul class="related-list">${items.map(r=>`<li>${esc((r.title||'').slice(0,70))}</li>`).join('')}</ul></div>`;
    });
    div.innerHTML = html;
    trace.appendChild(div);
  }catch(_){}
}
export function formatTopDate(isoDate){
  try{
    const d = new Date(isoDate + 'T12:00:00');
    return d.toLocaleDateString('tr-TR',{day:'numeric',month:'long',year:'numeric',weekday:'long'});
  }catch(_){ return isoDate; }
}
export function cockpitStatusClass(st){
  if(st==='healthy') return 'ok';
  if(st==='running'||st==='bootstrap'||st==='warning') return 'warn';
  return 'bad';
}
export function confPercentClass(p){
  if(p>=75) return '';
  if(p>=50) return 'mid';
  return 'low';
}
export function healthOverallClass(o){
  if(o==='healthy') return 'ok';
  if(o==='warning'||o==='maintenance') return 'warn';
  return 'bad';
}
export function stageLabelTr(state){
  return {waiting:'Bekliyor',running:'Çalışıyor',completed:'Tamamlandı',failed:'Başarısız'}[state]||state;
}
export function renderCockpit(cockpit){
  if(!cockpit) return;
  const pipe = cockpit.pipeline || {};
  const conf = cockpit.confidence || {};
  const health = cockpit.system_health || {};
  const summary = cockpit.intelligence_summary || {};
  const feed = cockpit.activity_feed || [];
  const progress = cockpit.progress || {};

  const pSt = document.getElementById('cockpitPipelineStatus');
  if(pSt){
    pSt.textContent = pipe.status_label || '—';
    pSt.className = 'cockpit-status ' + cockpitStatusClass(pipe.status);
  }
  const pMet = document.getElementById('cockpitPipelineMetrics');
  if(pMet){
    const items = [
      ['Son çalışma', pipe.last_run_display||'—'],
      ['Süre', pipe.runtime_display||'—'],
      ['Kaynaklar', pipe.sources_display||'—'],
      ['Sinyaller', String(pipe.signals_produced!=null?pipe.signals_produced:'—')],
      ['Öneriler', String(pipe.recommendations_produced!=null?pipe.recommendations_produced:'—')],
      ['Güven', pipe.overall_confidence_percent!=null?pipe.overall_confidence_percent+'%':'—']
    ];
    pMet.innerHTML = items.map(([k,v])=>'<div class="m"><div class="k">'+esc(k)+'</div><div class="v">'+esc(v)+'</div></div>').join('');
  }

  const cEl = document.getElementById('cockpitConfPercent');
  if(cEl){
    const p = conf.percent!=null?conf.percent:'—';
    cEl.textContent = p==='—'?'—':p+'%';
    cEl.className = 'conf-big ' + (p==='—'?'':confPercentClass(conf.percent));
    const title = document.getElementById('cockpitConfTitle');
    if(title) title.textContent = conf.title_tr || 'Bugünkü Güven';
  }
  const cFac = document.getElementById('cockpitConfFactors');
  if(cFac){
    const trans = (conf.transparency && conf.transparency.lines_tr) || conf.explanation_lines_tr || [];
    const transHtml = trans.length
      ? '<div class="conf-transparency">'+trans.map(l=>'<div class="conf-trans-line">'+esc(l)+'</div>').join('')+'</div>'
      : '';
    cFac.innerHTML = transHtml +
      '<div style="margin:8px 0 6px;color:var(--gold);font-size:11px">'+esc(conf.explanation_tr||'')+'</div>' +
      (conf.factors||[]).map(f=>'<div style="display:flex;justify-content:space-between;padding:4px 0"><span>'+esc(f.label_tr)+'</span><span class="mono">'+Math.round((f.score||0)*100)+'%</span></div>').join('');
  }

  const hO = document.getElementById('cockpitHealthOverall');
  if(hO){
    hO.textContent = health.overall_label_tr || '—';
    hO.className = 'health-overall ' + healthOverallClass(health.overall);
  }
  const hR = document.getElementById('cockpitHealthRows');
  if(hR && health.components){
    hR.innerHTML = health.components.map(c=>'<div class="health-row"><span>'+esc(c.label_tr)+'</span><span class="health-dot '+esc(c.status)+'"></span></div>').join('');
  }

  const sumEl = document.getElementById('cockpitSummary');
  if(sumEl){
    const rows = [
      ['İzlenen kaynak', summary.sources_monitored],
      ['Taranan belge', summary.documents_scanned],
      ['Aday sinyal', summary.candidate_signals],
      ['Stratejik sinyal', summary.strategic_signals],
      ['Öneri', summary.recommendations],
      ['Başarısız feed', summary.failed_feeds],
      ['Manuel inceleme', summary.manual_review]
    ];
    sumEl.innerHTML = rows.map(([k,v])=>'<div class="sum-item"><div class="k">'+esc(k)+'</div><div class="v">'+esc(v!=null?String(v):'—')+'</div></div>').join('') +
      '<div class="sum-foot">'+esc(summary.title_tr||"Bugünün İstihbaratı")+' · Otomatik üretim: '+esc(summary.generated_at_display||'—')+'</div>';
  }

  const feedEl = document.getElementById('cockpitFeed');
  if(feedEl){
    if(!feed.length){
      feedEl.innerHTML = '<div class="feed-item"><span class="ft">—</span><span class="fs">Sistem</span><span class="fh">Doğrulanmış sinyal bekleniyor — istihbarat hazırlandığında burada görünür.</span></div>';
    } else {
      feedEl.innerHTML = feed.map(item=>{
        const body = item.article_url
          ? '<a class="fh" href="'+esc(item.article_url)+'" target="_blank" rel="noopener noreferrer">'+esc(item.headline_tr)+'</a>'
          : '<span class="fh">'+esc(item.headline_tr)+'</span>';
        return '<div class="feed-item"><span class="ft">'+esc(item.time||'—')+'</span><span class="fs">'+esc(item.source||'')+'</span>'+body+'</div>';
      }).join('');
    }
  }

  const prog = document.getElementById('cockpitProgress');
  const progMsg = document.getElementById('cockpitProgressMsg');
  const progSt = document.getElementById('cockpitProgressStages');
  if(prog){
    const show = progress.active;
    prog.style.display = show ? 'block' : 'none';
    if(show && progMsg) progMsg.textContent = progress.message_tr || 'Bugünün istihbaratı hazırlanıyor.';
    if(show && progSt && progress.stages){
      progSt.innerHTML = progress.stages.map(s=>'<div class="stage-row"><span class="stage-dot '+esc(s.state)+'"></span><span style="flex:1">'+esc(s.label_tr)+'</span><span class="mono" style="font-size:10px;color:var(--muted)">'+esc(stageLabelTr(s.state))+'</span></div>').join('');
    }
  }

  const chip = document.getElementById('pipelineStatusChip');
  if(chip && pipe.status_label){
    chip.textContent = 'Pipeline · ' + pipe.status_label;
    chip.classList.remove('gold','warn','ok');
    const st = pipe.status;
    if(st==='healthy') chip.classList.add('ok');
    else if(st==='running'||st==='bootstrap') chip.classList.add('gold');
    else chip.classList.add('warn');
  }
  const season = document.getElementById('topSeasonChip');
  if(season && health.overall_label_tr){
    season.textContent = 'Sabah Brifingi · ' + health.overall_label_tr;
  }
}
const confToggle = document.getElementById('cockpitConfToggle');
if(confToggle){
  confToggle.addEventListener('click', ()=>{
    document.getElementById('cockpitConfFactors')?.classList.toggle('open');
  });
  confToggle.addEventListener('keydown', e=>{
    if(e.key==='Enter'||e.key===' '){e.preventDefault();document.getElementById('cockpitConfFactors')?.classList.toggle('open');}
  });
}
export function renderDataHonesty(honesty, counts){
  if(!honesty) return;
  const manual = honesty.manual || (counts && counts.manual) || 0;
  const verified = honesty.verified || (counts && counts.real) || 0;
  const unverified = honesty.unverified || (counts && counts.estimated) || 0;
  const manualBadge = manual > 0
    ? `<span class="prov manual"><span class="dot"></span>Manuel giriş (${manual})</span>`
    : '';
  const note = document.getElementById('briefDataHonestyNote');
  if(!note) return;
  note.innerHTML = `<b>Veri dürüstlüğü:</b>
    <span class="prov verified"><span class="dot"></span>Kaynak doğrulandı (${verified})</span>
    <span class="prov computed"><span class="dot"></span>Hesaplanmış</span>
    <span class="prov stub"><span class="dot"></span>Stub modül</span>
    <span class="prov unverified"><span class="dot"></span>Doğrulanmamış (${unverified})</span>
    ${manualBadge}. Kanıtsız öneri yok.`;
}

export function renderBrief(data){
  window._briefData = data;
  const ps = data.pipeline_status || {};
  const live = data.live_status || ps.live_intelligence_status || {};
  const alert = document.getElementById('pipelineDelayedAlert');
  if(alert){
    const delayed = ps.status === 'delayed' || ps.status === 'failed';
    alert.classList.toggle('show', delayed);
  }
  if(ps.status || live.last_collection) renderPipelineStatus({...ps, live_intelligence_status: live});
  if(data.cockpit) renderCockpit(data.cockpit);
  else if(ps.cockpit) renderCockpit(ps.cockpit);
  renderTrustNote(data.trust, live);
  const signalMap = (data.signals || []).slice(0, 5).map(s => s.wrap_id || ('sig-wrap-'+(s.id||0)));
  mountExecutiveSummary('briefExecSummary', data.executive_summary, {signalMap});
  renderSectionFreshness(data.section_timestamps);
  renderDrillPanels(data);
  renderExecutiveSituation(data.executive_situation);
  initBriefUxListeners();
  startWorkstationPolling();
  renderDataHonesty(data.data_honesty, data.counts);

  // Phase 9 — decision strip (30s)
  const pp0 = data.pipeline_provenance || {};
  const cock = data.cockpit || (ps.cockpit) || {};
  const sum = cock.intelligence_summary || {};
  const setTxt = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v != null && v !== '' ? String(v) : '—'; };
  setTxt('dsNews', pp0.articles_processed != null ? pp0.articles_processed : (sum.documents_scanned != null ? sum.documents_scanned : '—'));
  setTxt('dsSignals', pp0.strategic_signals != null ? pp0.strategic_signals : (sum.strategic_signals != null ? sum.strategic_signals : (data.signals||[]).length));
  const recsEarly = data.recommendations || [];
  setTxt('dsOpps', pp0.recommendations_approved != null ? pp0.recommendations_approved : recsEarly.length);
  const fallN = (data.signals || []).filter(s => (s.severity||'') === 'fall').length;
  setTxt('dsRisks', fallN);
  const rivalEl = document.getElementById('dsRival');
  if(rivalEl){
    const ex = data.executive_summary || {};
    const rivalLine = (ex.bullets || []).find(b => /rakip|Yunan|Greece|Arnavut|Mısır/i.test(b));
    rivalEl.textContent = rivalLine || 'Rakip baskısı — Analyst katmanında haftalık/rakip ekranına bakın';
  }
  const todayRecEl = document.getElementById('dsTodayRec');
  if(todayRecEl){
    const top = recsEarly[0];
    todayRecEl.textContent = (top && (top.what_to_do || top.title)) || ((data.executive_summary||{}).todays_actions||[])[0] || 'Kanıt birikince öneri';
  }
  const endList = document.getElementById('briefSecEndList');
  if(endList){
    const lines = [
      fallN ? (fallN + ' kritik/uyarı sinyali izlenmeli') : 'Kritik risk: 0 — izleme devam',
      recsEarly[0] ? ('Öncelik: ' + (recsEarly[0].what_to_do || recsEarly[0].title)) : null,
      ((data.executive_summary||{}).todays_actions||[])[1] || null,
      'Executive Mode: yalnızca bu viewport — Analyst ile derinleşin'
    ].filter(Boolean);
    endList.innerHTML = lines.map(l => '<li>'+esc(l)+'</li>').join('');
  }

  document.getElementById('briefEyebrow').textContent = data.eyebrow || ('Günlük Sevkiyat · ' + (data.date_display||''));
  let hl = data.headline || '';
  if(/bilmeniz gereken|beş şey|5 şey/i.test(hl)) hl = 'Bugünün En Önemli İstihbaratı';
  document.getElementById('briefHeadline').innerHTML = esc(hl).replace(/\n/g,'<br>');
  document.getElementById('briefMeta').textContent = data.meta_line || '';
  const pp = data.pipeline_provenance;
  if(pp){
    const parts = [
      pp.articles_processed != null ? pp.articles_processed + ' makale işlendi' : null,
      pp.strategic_signals != null ? pp.strategic_signals + ' sinyal' : null,
      pp.recommendations_approved != null ? pp.recommendations_approved + ' onaylı öneri' : null,
      pp.recommendations_rejected ? pp.recommendations_rejected + ' reddedildi (kapı)' : null,
      pp.last_success_at ? 'Son hat: ' + pp.last_success_at : null
    ].filter(Boolean);
    if(parts.length) document.getElementById('briefMeta').textContent = parts.join(' · ');
  }
  document.getElementById('topDateChip').textContent = formatTopDate(data.brief_date);
  document.getElementById('topSeasonChip').textContent = 'Canlı istihbarat · ' + (data.brief_date || '');

  const kpis = data.kpi_cards || [];
  const kpiEl = document.getElementById('briefKpis');
  if(!kpis.length){
    kpiEl.innerHTML = `<div class="card"><div class="k">Durum</div><div class="v" style="font-size:22px;padding-top:8px">KPI yok</div><div class="d">Bugünün brifingi için türetilmiş KPI üretilemedi — platform tahmin etmez.</div></div>`;
  } else {
    kpiEl.innerHTML = kpis.map(k=>{
      const tone = k.tone ? ` ${k.tone}` : '';
      return `<div class="card"><div class="k">${esc(k.label)} ${badgeHtml(k.badge)}</div><div class="v${tone}">${esc(k.value)}</div><div class="d">${esc(k.detail||'')}</div></div>`;
    }).join('');
  }

  const sigEl = document.getElementById('briefSignals');
  const signals = data.signals || [];
  window._briefSignalsCache = signals;
  if(!signals.length){
    sigEl.innerHTML = `<div class="sig-line"><span class="t">—</span><span class="icon" style="background:var(--amber)"></span><p><b>Stratejik sinyaller hazırlanıyor</b> — doğrulanmış kaynaklar işlendikten sonra burada görünür.<span class="why">Neden önemli: yalnızca kanıtlı açık kaynak sinyalleri brifinge girer.</span></p></div>`;
  } else {
    sigEl.innerHTML = signals.map((s,i)=>{
      const wrapId = s.wrap_id || ('sig-wrap-'+(s.id||i));
      const card = {
        title: s.title,
        body: s.body,
        ai_summary_tr: s.body,
        why_it_matters: s.why_it_matters,
        turkey_impact_tr: s.why_it_matters,
        what_to_do: s.decision_package && s.decision_package.what_to_do,
        decision_package: s.decision_package,
        trace: s.trace,
        source_name: s.source_display || (s.trace && s.trace.source_name) || '',
        confidence_label: s.confidence_label || s.severity || '—',
        importance_label_tr: s.importance_label_tr,
        published_display: s.published_display,
        priority: s.severity === 'fall' ? 'high' : (s.severity === 'rise' ? 'low' : 'medium'),
        category: s.severity === 'fall' ? 'Risk' : (s.severity === 'rise' ? 'Fırsat' : 'Sinyal'),
        risk: s.severity === 'fall' ? (s.why_it_matters || 'Uyarı') : '',
        opportunity: s.severity === 'rise' ? (s.decision_package && s.decision_package.what_to_do) || 'Takip' : '',
        country: 'PL',
        original_title: (s.trace && s.trace.article_title) || '',
        url: (s.trace && s.trace.article_url) || '',
        id: s.id,
        signal_int_id: s.signal_int_id,
        why_matters: s.why_matters,
        explorer: s.explorer,
        estimated_impact: s.estimated_impact
      };
      return trDecisionCardHtml(card, {
        wrapId,
        compact:true,
        signalNumber: s.signal_number || (i+1),
        signalIntId: s.signal_int_id
      });
    }).join('');
  }

  const recEl = document.getElementById('briefRecs');
  const recs = data.recommendations || [];
  if(!recs.length){
    const silence = data.recommendation_silence || 'Bugün stratejik öneri yok. Mevcut kanıt aksiyon için yeterli değil.';
    recEl.innerHTML = `<div class="note silence-note"><strong>Stratejik öneri yok</strong>${esc(silence)}</div>`;
  } else {
    window._briefRecsCache = recs;
    recEl.innerHTML = recs.slice(0,3).map((r,i)=>{
      const wrapId = 'rec'+(i+1);
      const extra = `
        ${r.what_to_do ? `<div class="f">Bugün yapılacak</div><div class="x" style="color:var(--gold);font-weight:600">${esc(r.what_to_do)}</div>` : ''}
        ${r.if_ignored ? `<div class="f">Yok sayılırsa</div><div class="x">${esc(r.if_ignored)}</div>` : ''}
        <div class="f">Sahip</div><div class="x">${esc(r.owner||'—')}</div>
        <div class="f">Zamanlama</div><div class="x">${esc(r.timing||'—')}</div>
        <div class="f">Öncelik</div><div class="x">${esc(r.priority||'—')}</div>
        <div class="f">Risk</div><div class="x">${esc(r.risk||'—')}</div>
        <div class="f">Kanıt</div><div class="x">${esc(r.evidence||'')}</div>
        <div class="f">Beklenen etki</div><div class="x">${esc(r.expected_impact||'')}</div>
        <div class="f">Alternatif</div><div class="x">${esc(r.alternative||'')}</div>`;
      return trDecisionCardHtml({
        ...r,
        ai_summary_tr: r.why || r.title,
        turkey_impact_tr: r.expected_impact || r.why,
        recommendation_tr: r.what_to_do || r.title,
        confidence_label: r.confidence_label
      }, {wrapId, extraEvidence: extra, compact:true, executiveActions: true});
    }).join('');
  }
}
export function renderTrustNote(trust, liveStatus){
  const note = document.getElementById('trustHonestyNote');
  const text = document.getElementById('trustHonestyText');
  if(!note || !text || !trust) return;
  const msg = trust.honest_message_tr || '';
  const pipelineOp = (liveStatus && liveStatus.pipeline_operational) || trust.pipeline_operational;
  const stubBanner = trust.llm_stub_mode && !pipelineOp;
  const needsAttention = !trust.todays_brief_ready
    || stubBanner
    || !trust.pipeline_authentic_run_today
    || (trust.collected_today != null && trust.collected_today === 0);
  note.classList.toggle('show', needsAttention && !!msg);
  text.textContent = msg;
}
export function renderPipelineStatus(status){
  const chip = document.getElementById('pipelineStatusChip');
  const panel = document.getElementById('pipelineStatusPanel');
  const grid = document.getElementById('pipelineStatusGrid');
  if(!chip || !status) return;
  const live = status.live_intelligence_status || status.live_status || {};
  const ls = status.last_success || {};
  const cov = status.source_coverage || {};
  const st = status.status || (live.pipeline_operational ? 'healthy' : 'delayed');
  const label = live.intelligence_mode_label_tr || status.status_label || 'Canlı istihbarat';
  chip.textContent = 'Live Intelligence · ' + (live.collector?.status_label_tr || label);
  chip.classList.remove('gold','warn','ok');
  if(st === 'healthy' || live.pipeline_operational) chip.classList.add('ok');
  else if(st === 'running') chip.classList.add('gold');
  else if(st === 'warning') chip.classList.add('gold');
  else chip.classList.add('warn');
  if(grid){
    let html = '';
    if(live.last_collection){
      const items = [
        ['Son Toplama', live.last_collection.display || live.last_collection.time || '—'],
        ['Son Analiz', live.last_analysis?.time || live.last_analysis?.display || '—'],
        ['Öneri', live.last_recommendation?.time || live.last_recommendation?.display || '—'],
        ['Collector', live.collector?.status_label_tr || '—'],
        ['Makaleler', String(live.articles_count != null ? live.articles_count : '—')]
      ];
      html = '<div class="live-status-grid pg">' + items.map(([k,v])=>'<div class="pi"><div class="k">'+esc(k)+'</div><div class="v">'+esc(v)+'</div></div>').join('') + '</div>';
    } else {
      const items = [
        ['Son güncelleme', ls.display_time || '—'],
        ['Kaynaklar', (cov.healthy||0) + ' sağlıklı / ' + (cov.configured||0) + ' yapılandırılmış'],
        ['Kapsama', (cov.coverage_percent != null ? cov.coverage_percent + '%' : '—')],
        ['Makaleler', String(ls.articles_new != null ? ls.articles_new : '—')],
        ['Sinyaller', String(ls.signals != null ? ls.signals : '—')],
        ['Öneriler', String(ls.recommendations != null ? ls.recommendations : '—')],
        ['Bugün toplanan', String(cov.collected_today != null ? cov.collected_today : '—')],
        ['Başarısız kaynak', String(cov.failed != null ? cov.failed : '—')],
        ['Durum', status.status_label || label]
      ];
      html = items.map(([k,v])=>'<div class="pi"><div class="k">'+esc(k)+'</div><div class="v">'+esc(v)+'</div></div>').join('');
    }
    const stages = status.executive_stages || (status.cockpit && status.cockpit.executive_stages) || [];
    if(stages.length){
      html += '<div class="pipeline-stages-head">Hat aşamaları</div>';
      html += '<div class="pipeline-stages">'+stages.map(s=>'<div class="pipeline-stage '+esc(s.state||'waiting')+'"><span class="ps-label">'+esc(s.label_tr)+'</span><span class="ps-state">'+esc(s.state_label_tr||s.state)+'</span></div>').join('')+'</div>';
    }
    grid.innerHTML = html;
  }
}
document.getElementById('pipelineStatusChip').addEventListener('click', ()=>{
  const p = document.getElementById('pipelineStatusPanel');
  if(p) p.style.display = (p.style.display === 'block') ? 'none' : 'block';
});
export async function loadPipelineStatus(){
  try{
    const res = await apiFetch('/api/status');
    if(res && res.ok){
      const data = await res.json();
      renderPipelineStatus(data);
      if(data.cockpit) renderCockpit(data.cockpit);
    }
  }catch(_){}
}
export function renderBriefUnavailable(detail, exhausted){
  const ps = detail.pipeline_status || {};
  const msg = detail.message || 'Bugünün sabah brifingi henüz yayınlanmadı.';
  document.getElementById('briefEyebrow').textContent = exhausted
    ? 'Günlük Sevkiyat · gecikti'
  : 'Günlük Sevkiyat · hazırlanıyor';
  document.getElementById('briefHeadline').innerHTML = exhausted
    ? 'Günaydın. Bugünün brifingi henüz hazır değil.'
    : 'Günaydın. Bugünün istihbaratı hazırlanıyor.';
  document.getElementById('briefMeta').textContent = msg;
  document.getElementById('briefKpis').innerHTML = `<div class="card"><div class="k">Durum</div><div class="v" style="font-size:22px;padding-top:8px">${exhausted ? 'Gecikti' : 'Hazırlanıyor'}</div><div class="d">Platform veri uydurmaz. Otomatik hat 05:30 Varşova.</div></div>`;
  document.getElementById('briefSignals').innerHTML = `<div class="sig-line"><span class="t">—</span><span class="icon" style="background:${exhausted ? 'var(--fall)' : 'var(--amber)'}"></span><p><b>${exhausted ? 'Sabah brifingi gecikti' : 'Sabah brifingi hazırlanıyor'}</b> — ${esc(msg)}<span class="why">Neden önemli: dünkü brifing bugünmüş gibi gösterilmez.</span></p></div>`;
  document.getElementById('briefRecs').innerHTML = `<div class="note silence-note"><strong>Stratejik öneri yok</strong>Bugünün brifingi yayınlanana kadar öneri üretilmez.</div>`;
  if(detail.cockpit) renderCockpit(detail.cockpit);
  if(ps.status) renderPipelineStatus(ps);
  const alert = document.getElementById('pipelineDelayedAlert');
  if(alert) alert.classList.toggle('show', exhausted || ps.status === 'delayed' || ps.status === 'failed');
}
export async function loadMorningBrief(retry){
  retry = retry || 0;
  try{
    let res = await apiFetch('/api/v1/feed/morning-brief');
    if(res && res.ok){
      const feed = await res.json();
      if(feed.ready && feed.data){
        const stamp = feed.data.updated_at || feed.data.brief_date;
        if(window._briefCacheStamp === stamp && window._briefData){
          loadWorkstationBundle(false);
          return;
        }
        window._briefCacheStamp = stamp;
        renderBrief(feed.data);
        loadPipelineStatus();
        loadWeeklyOutlook();
        loadMonthlyReview();
        return;
      }
      if(!feed.ready){
        const exhausted = retry >= 18;
        renderBriefUnavailable({
          message: feed.message_tr,
          pipeline_status: feed.pipeline_status || {},
        }, exhausted);
        if(!exhausted) setTimeout(()=>loadMorningBrief(retry + 1), 10000);
        return;
      }
    }
    res = await apiFetch('/api/brief/today');
    if(!res){
      document.getElementById('briefSignals').innerHTML = `<div class="sig-line"><span class="t">—</span><span class="icon" style="background:var(--fall)"></span><p><b>Oturum gerekli</b> — lütfen giriş yapın.<span class="why">Neden önemli: istihbarat yalnızca yetkili kullanıcıya açıktır.</span></p></div>`;
      return;
    }
    if(res.status === 404){
      let detail = {};
      try{ detail = (await res.json()).detail || {}; }catch(_){}
      const exhausted = retry >= 18;
      renderBriefUnavailable(detail, exhausted);
      if(!exhausted) setTimeout(()=>loadMorningBrief(retry + 1), 10000);
      return;
    }
    if(!res.ok) throw new Error('Geçici bağlantı sorunu');
    const data = await res.json();
    renderBrief(data);
    loadPipelineStatus();
    loadWeeklyOutlook();
    loadMonthlyReview();
  }catch(err){
    apiLog('error', 'loadMorningBrief failed', { error: String(err && err.message ? err.message : err) });
    const sig = document.getElementById('briefSignals');
    document.getElementById('briefEyebrow').textContent = 'Günlük Sevkiyat · bağlantı yok';
    renderConnectionError(sig, {
      title: 'Platforma ulaşılamadı',
      detail: 'Canlı FastAPI yanıt vermiyor. Sahte brifing gösterilmez.',
      error: err && err.message ? err.message : err,
      onRetry: () => loadMorningBrief(0),
    });
    if(retry < 12) setTimeout(()=>loadMorningBrief(retry + 1), 8000);
  }
}
export function renderWeeklyOutlook(data){
  const section = document.getElementById('weeklyOutlookSection');
  const panel = document.getElementById('weeklyOutlookPanel');
  const body = document.getElementById('weeklyOutlookBody');
  const meta = document.getElementById('weeklyOutlookMeta');
  const hint = document.getElementById('weeklyOutlookHint');
  if(!section || !panel || !body) return;
  section.style.display = '';
  panel.style.display = '';
  if(!data || !data.outlook){
    if(meta) meta.textContent = 'Haftalık brifing hazırlanıyor';
    if(hint) hint.textContent = 'SQLite üzerinden 7 günlük derleme bekleniyor';
    body.innerHTML = '<div class="sig-line"><span class="t">—</span><span class="icon" style="background:var(--amber)"></span><p><b>Haftalık Intelligence Brief henüz yok</b> — pipeline ve canlı istihbarat çalıştıkça burada görünür.<span class="why">Neden önemli: haftalık bakış sabah brifinginin 7 günlük uzantısıdır; sahte veri üretilmez.</span></p></div>';
    return;
  }
  const o = data.outlook;
  const glance = o.week_at_glance || {};
  const snapLabel = data.is_live_snapshot
    ? ('Pazartesi anlık görüntü · ' + (data.snapshot_published_at || '').slice(0,16))
    : 'Canlı derleme — Pazartesi anlık görüntüsü bekleniyor';
  if(meta) meta.textContent = 'Hafta ' + esc(data.week_start || '—') + ' · ' + snapLabel;
  if(hint) hint.textContent = data.changes_since_monday_label_tr || 'Haftalık stratejik bakış';

  const comps = (o.competitor_watch || []).filter(c => !c.is_home);
  const topComp = comps[0];
  const opps = o.emerging_opportunities || [];
  const risks = o.strategic_risks || [];
  const actions = o.weekly_action_plan || [];
  const themeRow = (o.market_momentum && o.market_momentum[0]) || null;
  const theme = themeRow ? themeRow.label_tr : ((opps[0] && opps[0].opportunity) || '—');

  let html = '';
  html += executiveSummaryHtml(data.executive_summary || null);
  html += `<div class="dash-strip">
    <div class="dash-cell"><div class="k">Haber</div><div class="v">${esc(String(glance.articles_processed||0))}</div></div>
    <div class="dash-cell"><div class="k">Stratejik sinyal</div><div class="v">${esc(String(glance.strategic_signals||0))}</div></div>
    <div class="dash-cell"><div class="k">Fırsat</div><div class="v">${esc(String(glance.new_opportunities||0))}</div></div>
    <div class="dash-cell"><div class="k">Kritik risk</div><div class="v">${esc(String(glance.new_risks||0))}</div></div>
  </div>`;
  if(themeRow){
    html += `<div class="weekly-topic card">
      <div class="k">Haftanın konusu</div>
      <div class="weekly-topic-grid">
        <div><span class="wk">Konu</span><b>${esc(themeRow.label_tr||theme)}</b></div>
        <div><span class="wk">Pay %</span><b>${esc(String(themeRow.share_pct!=null?themeRow.share_pct:'—'))}</b></div>
        <div><span class="wk">Trend</span><b>${esc(themeRow.trend_tr||themeRow.direction||'—')}</b></div>
        <div><span class="wk">Rakip</span><b>${esc(themeRow.rival_tr||'—')}</b></div>
        <div><span class="wk">Momentum</span><b>${esc(themeRow.momentum_tr||'—')}</b></div>
        <div><span class="wk">Türkiye etkisi</span><b>${esc(themeRow.turkey_impact_tr||'—')}</b></div>
      </div>
    </div>`;
  } else {
    html += `<div class="card"><div class="k">Haftanın konusu</div><div class="d" style="margin-top:8px;font-size:14px">${esc(theme)}</div></div>`;
  }
  html += `<div class="grid g2" style="margin:14px 0">
    <div class="card"><div class="k">En büyük rakip</div><div class="d" style="margin-top:8px;font-size:14px">${topComp ? esc((topComp.flag||'')+' '+topComp.name_tr+' · '+ (topComp.direction||'')) : '—'}</div></div>
    <div class="card"><div class="k">Türkiye fırsatı</div><div class="d" style="margin-top:8px;font-size:14px">${opps[0] ? esc(opps[0].opportunity) : '—'}</div></div>
    <div class="card"><div class="k">Yönetici kararı</div><div class="d" style="margin-top:8px;font-size:14px">${actions[0] ? esc(actions[0].action) : 'Kanıt birikince karar'}</div></div>
  </div>`;
  if(risks.length){
    html += '<div class="sig-line"><span class="t">RISK</span><span class="icon" style="background:var(--fall)"></span><p><b>Riskler</b> — ' + risks.slice(0,2).map(x => esc(x.risk)).join(' · ') + '</p></div>';
  }
  html += secEndHtml('Kısa sonuç — bu hafta', [
    theme !== '—' ? ('Konu: ' + theme) : null,
    topComp ? ('Rakip: ' + (topComp.name_tr||'')) : null,
    actions[0] ? ('Öncelik: ' + actions[0].action) : 'İzleme devam',
    'AI görünürlüğü Analyst katmanında doğrulanmalı'
  ]);
  body.innerHTML = html;
}

export async function loadWeeklyOutlook(){
  try{
    const res = await apiFetch('/api/weekly/outlook');
    if(!res || !res.ok) return;
    const data = await res.json();
    renderWeeklyOutlook(data);
  }catch(_){}
}

export function renderMonthlyReview(data){
  const section = document.getElementById('monthlyReviewSection');
  const panel = document.getElementById('monthlyReviewPanel');
  const body = document.getElementById('monthlyReviewBody');
  const meta = document.getElementById('monthlyReviewMeta');
  const hint = document.getElementById('monthlyReviewHint');
  if(!section || !panel || !body) return;
  section.style.display = '';
  panel.style.display = '';
  if(!data || !data.review){
    if(meta) meta.textContent = 'Aylık review hazırlanıyor';
    if(hint) hint.textContent = 'SQLite üzerinden 30 günlük derleme bekleniyor';
    body.innerHTML = '<div class="sig-line"><span class="t">—</span><span class="icon" style="background:var(--amber)"></span><p><b>Aylık Executive Review henüz yok</b> — ay içi sinyaller biriktikçe burada görünür.<span class="why">Neden önemli: yönetici raporu sahte KPI üretmez; yalnızca SQLite kanıtına dayanır.</span></p></div>';
    return;
  }
  const r = data.review;
  const score = r.intelligence_score || {};
  section.style.display = '';
  panel.style.display = '';
  const snapLabel = data.is_live_snapshot
    ? ('Ay başı anlık görüntü · ' + (data.snapshot_published_at || '').slice(0,16))
    : 'Canlı derleme — ay anlık görüntüsü bekleniyor';
  if(meta) meta.textContent = 'Ay ' + esc(data.month_start || '—') + ' · Skor ' + esc(score.overall_display || '—') + ' · ' + snapLabel;
  if(hint) hint.textContent = data.changes_label_tr || 'Aylık yönetici inceleme';

  html += executiveSummaryHtml(data.executive_summary || null);
  const charts = data.trend_charts || [];
  if(charts.length){
    html += '<div class="sec-30s"><b>30 sn:</b> Önce trend kartları, sonra skor ve öncelikler.</div>';
    html += '<div class="trend-bars">' + charts.map(c =>
      `<div class="trend-bar"><div class="tb-fill" style="height:${esc(String(c.height_pct||40))}%"></div><div class="tb-label">${esc(c.label_tr||'')}</div><div class="tb-dir">${esc(c.direction||'')}</div></div>`
    ).join('') + '</div>';
  }
  html += '<div class="sig-line"><span class="t">1</span><span class="icon" style="background:var(--gold)"></span><p><b>Yönetici Özeti</b> — ' + esc(r.executive_summary || '—') + '</p></div>';
  html += '<div class="sig-line"><span class="t">2</span><span class="icon" style="background:var(--rise)"></span><p><b>İstihbarat Skoru</b> — ' + esc(score.overall_display || '—');
  const dims = (score.dimensions || []).filter(d => d.score != null).slice(0,4);
  if(dims.length) html += '<br>' + dims.map(d => esc(d.label_tr) + ' ' + esc(d.score_display)).join(' · ');
  html += '</p></div>';

  const emerging = (r.market_evolution && r.market_evolution.emerging_themes) || [];
  if(emerging.length){
    html += '<div class="sig-line"><span class="t">3</span><span class="icon" style="background:var(--amber)"></span><p><b>Pazar Evrimi</b> — ' + emerging.slice(0,4).map(t => esc(t.label_tr) + ' ' + esc(t.direction)).join(' · ') + '</p></div>';
  }
  const dests = (r.destination_performance || []).slice(0,4);
  if(dests.length){
    html += '<div class="sig-line"><span class="t">4</span><span class="icon" style="background:var(--gold)"></span><p><b>Destinasyon</b> — ' + dests.map(d => esc(d.label_tr) + ' ' + esc(d.momentum)).join(' · ') + '</p></div>';
  }
  const recPerf = r.recommendation_performance || {};
  if(recPerf.total_feedback){
    html += '<div class="sig-line"><span class="t">10</span><span class="icon" style="background:var(--rise)"></span><p><b>Öneri Performansı</b> — ' + esc(recPerf.patterns_tr || '') + '</p></div>';
  }
  const dqi = r.decision_quality_review || {};
  if(dqi.decision_quality_index != null){
    html += '<div class="sig-line"><span class="t">11</span><span class="icon" style="background:var(--amber)"></span><p><b>Karar Kalitesi</b> — DQI ' + esc(dqi.index_display || '') + '</p></div>';
  }
  const pri = (r.strategic_priorities_next_month && r.strategic_priorities_next_month.top_10_priorities) || [];
  if(pri.length){
    html += '<div class="sig-line"><span class="t">13</span><span class="icon" style="background:var(--gold)"></span><p><b>Gelecek Ay</b><br>' + pri.slice(0,5).map(p => '• ' + esc(p.priority)).join('<br>') + '</p></div>';
  }
  html += secEndHtml('Kısa sonuç — bu ay', [
    r.executive_summary ? String(r.executive_summary).slice(0,140) : null,
    pri[0] ? ('Öncelik: ' + pri[0].priority) : null,
    'Detay ve export Analyst katmanında'
  ]);
  html += '<div class="sig-line"><span class="t">↗</span><span class="icon" style="background:var(--muted)"></span><p><a href="' + API_BASE + '/api/monthly/review/export?format=html" target="_blank" rel="noopener">HTML rapor</a> · <a href="' + API_BASE + '/api/monthly/review/export?format=json" target="_blank" rel="noopener">JSON</a></p></div>';
  body.innerHTML = html;
}

export async function loadMonthlyReview(){
  try{
    const res = await apiFetch('/api/monthly/review');
    if(!res || !res.ok) return;
    const data = await res.json();
    renderMonthlyReview(data);
  }catch(_){}
}

const liveDeltaState = state.liveDeltaState;

export function renderTimelineEvent(ev){
  if(ev.is_anchor || ev.event_type === 'morning_brief'){
    return `<div class="sig-line"><span class="t">${esc(ev.time_display||'—')}</span><span class="icon" style="background:var(--gold)"></span><p><b>${esc(ev.title||'Sabah Brifingi')}</b> — ${esc(ev.summary||'Resmi günlük durum — değişmez.')}<span class="why">${esc(typeof ev.evidence === 'string' ? ev.evidence : '')}</span></p></div>`;
  }
  return renderLiveDelta({
    id: ev.id,
    time_display: ev.time_display,
    delta_type: ev.delta_type,
    delta_type_label_tr: ev.delta_type_label_tr || ev.delta_type || ev.event_type,
    title: ev.title,
    summary: ev.summary,
    evidence: typeof ev.evidence === 'string' ? ev.evidence : '',
    evidence_payload: ev.evidence_payload,
    source_name: ev.source_name,
    source_url: ev.source_url,
    priority: ev.priority,
    turkey_impact: ev.turkey_impact,
    recommendation: ev.recommendation,
    trace: ev.trace
  });
}

export function renderTimeline(events, meta){
  const section = document.getElementById('liveIntelSection');
  const feed = document.getElementById('liveIntelFeed');
  const body = document.getElementById('liveIntelDeltas');
  if(!section || !feed || !body) return;
  if(!events || !events.length){
    section.style.display = 'none';
    feed.style.display = 'none';
    return;
  }
  section.style.display = '';
  feed.style.display = '';
  if(meta && meta.morning_brief_published_time){
    document.getElementById('morningBriefTime').textContent = meta.morning_brief_published_time;
  }
  const deltaCount = events.filter(e => !e.is_anchor && e.event_type !== 'morning_brief').length;
  document.getElementById('liveIntelMeta').textContent =
    deltaCount + ' gün içi olay · Sabah brifingi sabit';
  body.innerHTML = events.map(renderTimelineEvent).join('');
}

export function renderLiveDelta(d){
  const rec = d.recommendation;
  const turkey = d.turkey_impact || {};
  const wrapId = 'live-delta-' + (d.id||'');
  const typeLabel = d.delta_type_label_tr || '';
  const color = priorityColor(d.priority);
  const tone = priorityTone(d.priority);
  const payload = d.evidence_payload && typeof d.evidence_payload === 'object' ? d.evidence_payload : null;
  const isPro = d.delta_type === 'professional_signal' || (payload && payload.source_layer === 'PROFESSIONAL_SOCIAL');
  const proFeedback = isPro && d.id
    ? `<div class="f">Feedback</div><div class="x" style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="pill" onclick="event.stopPropagation();submitProfessionalFeedback(${d.id},'accepted')">Kabul</button>
        <button type="button" class="pill" onclick="event.stopPropagation();submitProfessionalFeedback(${d.id},'irrelevant')">İlgisiz</button>
        <button type="button" class="pill" onclick="event.stopPropagation();submitProfessionalFeedback(${d.id},'ignored')">Yoksay</button>
      </div>`
    : '';
  return `<div class="sig-line-wrap live-pri-${tone}" id="${wrapId}">
    <div class="sig-line clickable" role="button" tabindex="0" onclick="toggleSigTrace('${wrapId}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleSigTrace('${wrapId}')}">
      <span class="t">${esc(d.time_display||'—')}</span>
      <span class="icon" style="background:${color}"></span>
      <p><span class="live-delta-type pri-${tone}">${esc(typeLabel || tone.toUpperCase())}</span>
        <b>${esc(d.title||'')}</b> — ${esc(String(d.summary_executive_tr || d.summary||'').slice(0,140))}
        <span class="why">Türkiye: ${esc((turkey.estimated_impact_tr||'—').slice(0,100))} · Öneri: ${esc((rec && rec.action) || 'İzle')}</span>
        <span class="why" style="color:var(--gold)">Detay ▸ kanıt zinciri</span></p>
    </div>
    <div class="sig-trace evidence">${proFeedback}${tracePanelHtml(d.trace || {})}</div>
  </div>`;
}

export function renderLiveDeltas(deltas, meta){
  const section = document.getElementById('liveIntelSection');
  const feed = document.getElementById('liveIntelFeed');
  const body = document.getElementById('liveIntelDeltas');
  if(!section || !feed || !body) return;
  if(!deltas.length){
    section.style.display = 'none';
    feed.style.display = 'none';
    return;
  }
  section.style.display = '';
  feed.style.display = '';
  if(meta && meta.morning_brief_published_time){
    document.getElementById('morningBriefTime').textContent = meta.morning_brief_published_time;
  }
  document.getElementById('liveIntelMeta').textContent =
    deltas.length + ' gün içi delta · Sabah brifingi değiştirilmez';
  body.innerHTML = deltas.map(renderLiveDelta).join('');
}

export function updateLiveBanner(summary){
  const banner = document.getElementById('liveIntelBanner');
  const text = document.getElementById('liveIntelBannerText');
  if(!banner || !text || !summary) return;
  const n = summary.new_since_last_visit || 0;
  const b = summary.since_last_visit || {};
  if(n > 0){
    banner.classList.add('show');
    const parts = [];
    if(b.new_articles) parts.push(b.new_articles + ' yeni makale');
    if(b.new_strategic_signals) parts.push(b.new_strategic_signals + ' stratejik sinyal');
    if(b.recommendation_updates) parts.push(b.recommendation_updates + ' öneri güncellemesi');
    if(b.ai_visibility_changes) parts.push(b.ai_visibility_changes + ' AI görünürlük değişimi');
    if(b.competitor_movements) parts.push(b.competitor_movements + ' rakip/operatör hareketi');
    const detail = parts.length ? parts.join(' · ') : (n + ' yeni stratejik sinyal');
    text.innerHTML = '<b>Son ziyaretinizden bu yana:</b> ' + esc(detail);
  } else {
    banner.classList.remove('show');
  }
  if(summary.morning_brief_published_time){
    const mt = document.getElementById('morningBriefTime');
    if(mt) mt.textContent = summary.morning_brief_published_time;
  }
  const op = summary.operational;
  if(op && op.status === 'delayed' && op.delay_reason_tr){
    banner.classList.add('show');
    text.innerHTML = '<b>Canlı istihbarat gecikti.</b> ' + esc(op.delay_reason_tr) +
      ' · Son başarılı: ' + esc(op.last_success_age_tr || '—') +
      ' · Sonraki deneme ~' + esc(String(op.next_retry_minutes||15)) + ' dk';
  }
  applyFreshnessChip(summary.freshness);
}

export function applyFreshnessChip(surfaces){
  const chip = document.getElementById('freshnessChip');
  if(!chip || !surfaces) return;
  const live = surfaces.live_intelligence || {};
  const brief = surfaces.morning_brief || {};
  chip.textContent = 'Canlı · ' + (live.age_label_tr || brief.age_label_tr || '—');
  chip.classList.toggle('warn', !!live.is_stale || live.status === 'delayed');
}

export function applySectionFreshness(section){
  const f = state.intelligenceCache?.freshness?.surfaces;
  if(!f) return;
  const map = {
    market: ['marketSeasonHint', 'market_pulse'],
    comp: ['marketSeasonHint', 'competitor_intelligence'],
    aivis: ['marketSeasonHint', 'ai_visibility'],
    cite: ['marketSeasonHint', 'citation_intelligence'],
    playbook: ['marketSeasonHint', 'playbook']
  };
  const cfg = map[section];
  if(!cfg) return;
  const el = document.getElementById(cfg[0]);
  const surf = f[cfg[1]];
  if(el && surf) el.textContent = surf.freshness_line_tr || surf.age_label_tr || '—';
}

export async function submitRecFeedback(recId, action){
  try{
    const res = await apiFetch('/api/recommendations/' + recId + '/feedback', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({action: action})
    });
    if(res && res.ok){
      const el = document.getElementById('recFeedbackMsg');
      if(el) el.textContent = 'Geri bildirim kaydedildi.';
    } else {
      alert('Geri bildirim kaydedilemedi — lütfen tekrar deneyin.');
    }
  }catch(_){
    alert('Geri bildirim bağlantı hatası.');
  }
}

export async function submitProfessionalFeedback(deltaId, action){
  try{
    const res = await apiFetch('/api/professional/signals/' + deltaId + '/feedback', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({action: action})
    });
    if(res && res.ok){
      const wrap = document.getElementById('live-delta-' + deltaId);
      if(wrap){
        const bar = wrap.querySelector('.rec-feedback') || wrap.querySelector('.sig-trace');
        if(bar){
          const note = document.createElement('div');
          note.className = 'x';
          note.style.gridColumn = '1 / -1';
          note.innerHTML = '<span class="why" style="color:var(--rise)">Professional sinyal geri bildirimi kaydedildi (' + esc(action) + ').</span>';
          bar.appendChild(note);
        }
      }
    } else {
      alert('Professional sinyal geri bildirimi kaydedilemedi.');
    }
  }catch(_){
    alert('Professional sinyal bağlantı hatası.');
  }
}

export async function ackLiveVisit(){
  try{
    await apiFetch('/api/live/intelligence/ack', { method: 'POST' });
    document.getElementById('liveIntelBanner')?.classList.remove('show');
  }catch(_){}
}

export async function pollLiveIntelligence(){
  try{
    const sumRes = await apiFetch('/api/live/intelligence/summary');
    if(!sumRes || !sumRes.ok) return;
    const summary = await sumRes.json();
    updateLiveBanner(summary);

    const tlRes = await apiFetch('/api/live/intelligence/timeline');
    if(!tlRes || !tlRes.ok) return;
    const tl = await tlRes.json();
    const events = tl.events || [];
    const prevLen = liveDeltaState.timeline.length;
    liveDeltaState.timeline = events;
    renderTimeline(events, summary);
    if(events.length > prevLen && prevLen > 0) loadIntelligenceHub();
    loadWeeklyOutlook();
    loadMonthlyReview();
  }catch(_){}
}

export function initLiveIntelligence(){
  document.getElementById('liveIntelAckBtn')?.addEventListener('click', ackLiveVisit);
  pollLiveIntelligence();
  setInterval(pollLiveIntelligence, 90000);
}

export function provBadge(b){
  if(!b) return '<span class="prov est"><span class="dot"></span>—</span>';
  const css = b.css || 'est';
  return `<span class="prov ${css}"><span class="dot"></span>${esc(b.label||'')}</span>`;
}

async function fetchIntelligencePart(path){
  try{
    const res = await apiFetch(path);
    if(!res || !res.ok) return null;
    return await res.json();
  }catch(_){
    return null;
  }
}

export async function loadIntelligenceHub(){
  try{
    const res = await apiFetch('/api/intelligence/hub');
    if(res && res.ok){
      intelligenceCache = state.intelligenceCache = await res.json();
    } else {
      // Hub düşerse ekranları tek tek doldur (Pazar Nabzı / Playbook / Rakip / Kaynak / AI)
      const [market_pulse, competitors, playbook, citations, ai_visibility] = await Promise.all([
        fetchIntelligencePart('/api/intelligence/market-pulse'),
        fetchIntelligencePart('/api/intelligence/competitors'),
        fetchIntelligencePart('/api/intelligence/playbook'),
        fetchIntelligencePart('/api/intelligence/citations'),
        fetchIntelligencePart('/api/intelligence/ai-intelligence'),
      ]);
      intelligenceCache = state.intelligenceCache = {
        market_pulse, competitors, playbook, citations, ai_visibility,
      };
      if(ai_visibility) window._aiVisCache = ai_visibility;
    }
    const active = document.querySelector('.nav-item.active');
    if(active) loadIntelligenceSection(active.dataset.s);
  }catch(_){}
}

export async function loadIntelligenceSection(section){
  if(!intelligenceCache) intelligenceCache = state.intelligenceCache = {};
  applySectionFreshness(section);

  const ensure = async (key, path) => {
    if(intelligenceCache[key]) return intelligenceCache[key];
    const data = await fetchIntelligencePart(path);
    if(data){
      intelligenceCache[key] = data;
      state.intelligenceCache = intelligenceCache;
    }
    return data;
  };

  if(section === 'market') renderMarketPulse(await ensure('market_pulse', '/api/intelligence/market-pulse'));
  if(section === 'comp') renderCompetitors(await ensure('competitors', '/api/intelligence/competitors'));
  if(section === 'playbook') renderPlaybook(await ensure('playbook', '/api/intelligence/playbook'));
  if(section === 'cite') renderCitations(await ensure('citations', '/api/intelligence/citations'));
  if(section === 'aivis'){
    const av = await ensure('ai_visibility', '/api/intelligence/ai-intelligence') || window._aiVisCache;
    if(av) window._aiVisCache = av;
    renderAiVisibility(av);
  }
  if(section === 'media' || section === 'strategy' || section === 'gotr' || section === 'report'){
    loadDecisionMediaStrategy();
  }
  if(section === 'report') loadAnkaraReport();
  if(section === 'advisor') loadAdvisorLive();
  if(section === 'gotr') loadGoTurkiyeLive();
  if(section === 'market' || section === 'brief') loadMarketIntelligenceBundle();
}

export async function loadAiVisibility(){
  try{
    const res = await apiFetch('/api/intelligence/ai-intelligence');
    if(res && res.ok){
      window._aiVisCache = await res.json();
      if(intelligenceCache) state.intelligenceCache.ai_visibility = window._aiVisCache;
      renderAiVisibility(window._aiVisCache);
    }
  }catch(_){}
}

export function renderDiosDecisionCard(c, index){
  const m = c.metrics || {};
  const clickable = c.clickable !== false;
  const click = clickable ? ` class="card di-card card-eq dios-decision-card" role="button" tabindex="0" data-dios-idx="${index}" onclick="openDiosDecisionPanel(${index})" onkeydown="if(event.key==='Enter')openDiosDecisionPanel(${index})"` : ` class="card di-card card-eq"`;
  const actions = (c.actions || []).slice(0,3).map(a =>
    `<span class="meta-pill">${esc(a.label)} · ${esc(a.owner)} · ${esc(a.status_label_tr||a.status||'')}</span>`
  ).join('');
  return `<div${click}>
    <div class="k">${ico(c.icon || 'signal', (c.title_tr||'?').slice(0,1))} ${esc(c.title_tr||'')} ${provBadge(c.badge)}</div>
    ${c.signal ? `<div class="dios-signal-line"><b>Sinyal</b> ${esc((c.signal.title||c.what_tr||'').slice(0,80))}</div>` : ''}
    ${c.decision ? `<div class="dios-decision-line"><b>Karar</b> ${esc(c.decision_tr||c.decision||'')}</div>` : ''}
    <div class="signal-meta-row">${actions || `<span class="meta-pill">${esc((c.do_tr||'').slice(0,60))}</span>`}</div>
    <div class="dios-metrics-row">
      <span class="meta-pill">Öncelik ${esc(String(m.priority!=null?m.priority:'—'))}</span>
      <span class="meta-pill">Güven ${esc(String(m.confidence!=null?m.confidence:'—'))}</span>
      <span class="meta-pill">Kanıt ${esc(String(m.evidence_count!=null?m.evidence_count:'—'))}</span>
      <span class="meta-pill">Etki ${esc(m.impact||'—')}</span>
    </div>
    ${clickable ? '<div class="d" style="color:var(--gold);font-size:11px;margin-top:6px">Tıkla → kanıt ve aksiyonlar</div>' : ''}
  </div>`;
}

export function openDiosDecisionPanel(index){
  const cards = (window._marketPulseCache && window._marketPulseCache.decision_cards) || [];
  const c = cards[index];
  if(!c) return;
  const panel = document.getElementById('diosDecisionPanel');
  const body = document.getElementById('diosDecisionPanelBody');
  const title = document.getElementById('diosDecisionPanelTitle');
  if(!panel || !body) return;
  if(title) title.textContent = c.title_tr || 'Karar Detayı';
  const p = c.panel || {};
  const m = c.metrics || {};
  let html = '';
  html += `<div class="dios-chain">${(c.execution_chain||[]).map((s,i,a)=>`<span>${esc(s.label_tr||s.stage)}</span>${i<a.length-1?' → ':''}`).join('')}</div>`;
  html += `<div class="f">Kanıt</div><div class="x">${(p.evidence||[]).map(e=>esc(e)).join('<br>')||'—'}</div>`;
  html += `<div class="f">Gerekçe</div><div class="x">${esc(p.reasoning||c.so_what_tr||'—')}</div>`;
  html += `<div class="f">Güven</div><div class="x">${esc(String(p.confidence!=null?p.confidence:m.confidence||'—'))} · Kanıt ${esc(String(m.evidence_count||'—'))} · Tazelik ${esc(m.freshness_display||'—')}</div>`;
  html += `<div class="f">Aksiyonlar</div><div class="x">${(c.actions||[]).map(a=>`<div class="drill-row"><span>${esc(a.label)} · ${esc(a.owner)} · ${esc(a.status_label_tr||'')}</span></div>`).join('')||'—'}</div>`;
  html += `<div class="exec-actions-row">
    <button type="button" class="pill" onclick="navigateToScreen('media',{decision:'${esc(c.decision||'')}')">Medya Planı Aç</button>
    <button type="button" class="pill" onclick="navigateToScreen('brief')">Brifing</button>
    <button type="button" class="pill" onclick="generateExecBriefing('dios-${index}')">Görev Oluştur</button>
  </div>`;
  body.innerHTML = html;
  panel.hidden = false;
  window._diosActiveCard = c;
}
if(typeof window !== 'undefined') window.openDiosDecisionPanel = openDiosDecisionPanel;

export function initDiosDecisionListeners(){
  document.querySelectorAll('[data-close-dios]').forEach(btn=>{
    if(btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', ()=>{
      const p = document.getElementById('diosDecisionPanel');
      if(p) p.hidden = true;
    });
  });
}

export function renderMarketPulse(mp){
  window._marketPulseCache = mp;
  if(!mp){
    const narr = document.getElementById('marketSeasonNarrative');
    if(narr) narr.textContent = 'Pazar nabzı şu an yüklenemedi — bağlantı düzelince otomatik yenilenir.';
    return;
  }
  mountExecutiveSummary('marketExecSummary', mp.executive_summary);

  // Market Health — score breakdown (not a naked KPI)
  const hbEl = document.getElementById('marketHealthBreakdown');
  const hb = mp.health_breakdown || {};
  if(hbEl){
    const comps = hb.components || [];
    hbEl.innerHTML = `<div class="card health-break">
      <div class="hb-top">
        <div>
          <div class="k">${ico('signal','H')} Market Health</div>
          <div class="v hb-score">${esc(hb.score_display || '—')}</div>
          <div class="d">${esc(hb.method_tr || '')}</div>
        </div>
        <div class="hb-bars">${comps.map(c => {
          const pct = c.max ? Math.round((Number(c.points||0)/Number(c.max))*100) : 0;
          return `<div class="hb-row"><span class="hb-lab">${esc(c.label_tr)}</span>
            <div class="hb-track"><i style="width:${pct}%"></i></div>
            <span class="hb-pts mono">${esc(String(c.points))}/${esc(String(c.max))}</span>
            <div class="hb-what">${esc(c.what_tr||'')}</div></div>`;
        }).join('')}</div>
      </div>
      <div class="di-triple">
        <div><span class="fk">What happened?</span>${esc(hb.score_display || '—')}</div>
        <div><span class="fk">So what?</span>${esc(hb.so_what_tr || '')}</div>
        <div><span class="fk">What should we do?</span>${esc(hb.do_tr || '')}</div>
      </div>
    </div>`;
  }

  // Executive Advice — Immediate / Near Term / Strategic
  const advEl = document.getElementById('marketExecAdvice');
  const adv = mp.executive_advice || {};
  if(advEl){
    const order = [
      ['immediate', 'Immediate', 'alarm'],
      ['near_term', 'Near Term', 'warn'],
      ['strategic', 'Strategic', 'info']
    ];
    advEl.innerHTML = order.map(([key, short, tone]) => {
      const block = adv[key] || {};
      const items = block.items || [];
      return `<div class="card advice-card bg-${tone === 'alarm' ? 'warn' : tone === 'warn' ? 'info' : 'ai'}">
        <div class="k">${ico(tone === 'alarm' ? 'risk' : tone === 'warn' ? 'trend' : 'opp', short.slice(0,1))} ${esc(block.label_tr || short)}</div>
        <ul class="advice-list">${items.map(i => `<li>${esc(i)}</li>`).join('') || '<li>Kanıt birikince dolacak</li>'}</ul>
      </div>`;
    }).join('');
  }

  // Decision cards — DIOS actionable (clickable)
  const dcEl = document.getElementById('marketDecisionCards');
  const cards = mp.decision_cards || [];
  if(dcEl){
    dcEl.innerHTML = cards.length
      ? cards.map((c,i) => renderDiosDecisionCard(c, i)).join('')
      : '<div class="card"><div class="k">Karar kartı</div><div class="d">Kanıtlı karar birikince burada görünür.</div></div>';
  }
  initDiosDecisionListeners();

  // Awaiting Feed — professional, never empty / never technical jargon
  const awGrid = document.getElementById('marketAwaitingGrid');
  const awaiting = mp.awaiting_feeds || [];
  if(awGrid){
    const defaults = [
      {label_tr:'Booking Intelligence', planned_sources:['OTA / operatör'], expected_intelligence:'Fiyat · pencere · popülerlik', business_impact:'Kampanya zamanlaması'},
      {label_tr:'Instagram Intelligence', planned_sources:['Sosyal mention'], expected_intelligence:'Hashtag · reels · creator', business_impact:'Görsel kampanya'},
      {label_tr:'YouTube Intelligence', planned_sources:['Travel vlog'], expected_intelligence:'Büyüme · yorum teması', business_impact:'Video iş birliği'},
      {label_tr:'Influencer Intelligence', planned_sources:['Creator paneli'], expected_intelligence:'Reach · eşleşme', business_impact:'Bütçe dağılımı'},
      {label_tr:'Google AI / AI Search', planned_sources:['AI citation'], expected_intelligence:'Visibility · kayıp niyet', business_impact:'AI anlatısı'},
      {label_tr:'Google Trends', planned_sources:['Arama trendi'], expected_intelligence:'Momentum · mevsim', business_impact:'SEO / medya zamanı'}
    ];
    const rows = awaiting.length ? awaiting : defaults;
    awGrid.innerHTML = rows.map(a => {
      const planned = (a.planned_sources || [a.source].filter(Boolean)).join(' · ') || 'Planlanan kaynak';
      return `<div class="card awaiting-card card-eq">
        <div class="k">${ico('media','A')} ${esc(a.label_tr||'Modül')} <span class="await-badge">Awaiting Feed</span></div>
        <div class="await-grid">
          <div><span class="fk">Planned Sources</span>${esc(planned)}</div>
          <div><span class="fk">Expected Intelligence</span>${esc(a.expected_intelligence || a.reason_tr || 'Doğrulanmış istihbarat bağlandığında dolacak')}</div>
          <div><span class="fk">Business Impact</span>${esc(a.business_impact || 'Karar kalitesi artar — uydurma KPI yok')}</div>
        </div>
      </div>`;
    }).join('');
  }

  // Analyst panel
  const anEl = document.getElementById('marketAnalystPanel');
  const an = mp.analyst_panel || {};
  if(anEl){
    anEl.innerHTML = `<div class="card analyst-path">
      <div class="di-triple">
        <div><span class="fk">Evidence</span>${esc(an.evidence_tr||'—')}</div>
        <div><span class="fk">Confidence</span>${esc(an.confidence_tr||'—')}</div>
        <div><span class="fk">Reasoning</span>${esc(an.reasoning_tr||'—')}</div>
      </div>
      <div class="await-grid" style="margin-top:12px">
        <div><span class="fk">Sources</span>${(an.sources_tr||[]).map(esc).join('<br>')||'—'}</div>
        <div><span class="fk">Decision Tree</span>${(an.decision_tree||[]).map(esc).join('<br>')||'—'}</div>
      </div>
    </div>`;
  }

  const marketEnd = document.getElementById('marketSecEnd');
  if(marketEnd){
    const imm = ((adv.immediate||{}).items||[])[0];
    marketEnd.innerHTML = secEndHtml('Kısa sonuç — pazar nabzı', [
      hb.score_display ? ('Health: ' + hb.score_display) : null,
      imm || null,
      'Öncelik: Immediate Advice + rakip çaprazı'
    ]);
  }

  // Analyst-only legacy detail
  const kpiEl = document.getElementById('marketKpis');
  if(kpiEl){
    kpiEl.innerHTML = (mp.kpis||[]).map(k=>`<div class="card"><div class="k">${esc(k.label_tr)} ${provBadge(k.badge)}</div><div class="v">${esc(k.value)}</div><div class="d">${esc(k.detail_tr||'')}</div></div>`).join('') || '<div class="card"><div class="k">Veri</div><div class="v">—</div><div class="d">Hat henüz çalışmadı</div></div>';
  }
  const sea = mp.seasonality || {};
  const st = document.getElementById('marketSeasonTitle');
  const sh = document.getElementById('marketSeasonHint');
  if(st) st.textContent = sea.title_tr || 'Talep sezonluğu';
  if(sh) sh.innerHTML = esc(sea.subtitle_tr||'') + ' ' + provBadge(_provFromCode(sea.provenance));
  const spark = document.getElementById('marketSpark');
  if(spark && sea.months) spark.innerHTML = sea.months.map(m=>`<i class="${m.hot?'hot':''}" style="height:${m.height_pct||0}%" title="${esc(m.label)}"></i>`).join('');
  const labels = document.getElementById('marketSparkLabels');
  if(labels && sea.months) labels.innerHTML = sea.months.map(m=>`<span>${esc(m.label)}</span>`).join('');
  const narr = document.getElementById('marketSeasonNarrative');
  if(narr) narr.textContent = sea.narrative_tr || '';
  const sigEl = document.getElementById('marketSignals');
  const cs = mp.consumer_signals || {};
  if(sigEl){
    sigEl.innerHTML = ['rising','weak','channels'].map(key=>{
      const block = cs[key] || {};
      const lines = (block.lines||[]).map(l => esc(String(l).replace(/^•\s*/,'')));
      return `<div class="card di-card"><div class="k">${esc(block.title_tr||key)} ${provBadge(_provFromCode(block.provenance))}</div>
        <div class="di-triple">
          <div><span class="fk">What happened?</span>${lines[0]||'—'}</div>
          <div><span class="fk">So what?</span>${lines[1]||'Niyet / kanal sinyali karar zamanlamasını etkiler.'}</div>
          <div><span class="fk">What should we do?</span>${lines[2]||'Brifing Immediate ile çaprazlayın.'}</div>
        </div></div>`;
    }).join('');
  }
}

export function _provFromCode(code){
  if(code === 'GERCEK' || code === 'VERIFIED') return {css:'verified',label:'Kaynak doğrulandı'};
  if(code === 'HESAPLANMIS' || code === 'COMPUTED') return {css:'computed',label:'Hesaplanmış'};
  if(code === 'STUB' || code === 'BEKLENIYOR') return {css:'stub',label:'Stub modül'};
  if(code === 'MANUEL' || code === 'MANUAL') return {css:'manual',label:'Manuel giriş'};
  if(code === 'UNVERIFIED' || code === 'TAHMINI') return {css:'unverified',label:'Doğrulanmamış'};
  return {css:'unverified',label:'Doğrulanmamış'};
}

export function renderCompetitors(comp){
  if(!comp){
    const body = document.getElementById('compDaviBody');
    if(body) body.innerHTML = '<tr><td colspan="5" style="padding:14px;color:var(--cream-dim)">Rakip verisi yüklenemedi — API bağlantısını kontrol edin.</td></tr>';
    return;
  }
  mountExecutiveSummary('compExecSummary', comp.executive_summary);
  const rival = document.getElementById('compRivalDash');
  if(rival){
    const rows = comp.rival_dashboards || [];
    rival.innerHTML = rows.length
      ? rows.map(r => `<div class="card rival-card">
          <div class="k">${esc(r.flag||'')} ${esc(r.name_tr)} ${provBadge(r.badge)}</div>
          <div class="rival-grid">
            <div><span class="rk">Haftalık/30g paylaşım</span><b>${esc(String(r.weekly_share))}</b></div>
            <div><span class="rk">Medya görünürlüğü</span><b>${esc(String(r.media_visibility))}</b></div>
            <div><span class="rk">Arama trendi Δ</span><b>${esc(String(r.search_trend))}</b></div>
            <div><span class="rk">Yeni kampanya</span><b>${esc(String(r.new_campaign).slice(0,80))}</b></div>
            <div><span class="rk">Yeni rota</span><b>${esc(r.new_route)}</b></div>
            <div><span class="rk">Yeni charter</span><b>${esc(r.new_charter)}</b></div>
          </div>
          <div class="d" style="margin-top:10px"><b>Türkiye etkisi:</b> ${esc(r.turkey_impact_tr||'')}</div>
          <div class="d" style="color:var(--gold)"><b>Karşı öneri:</b> ${esc(r.counter_recommendation_tr||'')}</div>
        </div>`).join('')
      : '<div class="card"><div class="k">Rakip</div><div class="d">Dashboard bekleniyor</div></div>';
  }
  const hint = document.getElementById('compMethodHint');
  if(hint) hint.innerHTML = esc(comp.method_tr||'') + ' <span class="prov real"><span class="dot"></span>Gerçek</span>';
  const body = document.getElementById('compDaviBody');
  if(body){
    body.innerHTML = (comp.davi_table||[]).map(r=>{
      const rowStyle = r.is_home ? ' style="background:rgba(201,162,75,.06)"' : '';
      const name = r.is_home ? `<b>${esc(r.name_tr)}</b>` : esc(r.name_tr);
      const barCls = r.code === 'egypt' || r.code === 'albania' ? ' t' : '';
      return `<tr${rowStyle}><td><span class="flag">${r.flag}</span>${name}</td><td class="mono"${r.is_home?' style="color:var(--gold-soft)"':''}>${r.davi}</td><td><div class="bar${barCls}"><i style="width:${r.bar_pct}%"></i></div></td><td class="${r.trend_class}">${r.trend}</td><td>${esc(r.narrative_tr)}</td></tr>`;
    }).join('');
  }
  const moves = document.getElementById('compMoves');
  const mh = document.getElementById('compMovesHint');
  if(mh) mh.innerHTML = provBadge({css:'real',label:'Gerçek'});
  if(moves) moves.innerHTML = (comp.move_cards||[]).map(c=>`<div class="card"><div class="k">${ico('comp','R')} ${c.flag} ${esc(c.name_tr)} ${provBadge(c.badge)}</div><div class="d" style="margin-top:8px;font-size:13.5px">${c.body_html}</div></div>`).join('');
  const topRival = (comp.rival_dashboards||[])[0];
  const compEnd = document.getElementById('compSecEnd');
  if(compEnd){
    compEnd.innerHTML = secEndHtml('Kısa sonuç — rakipler', [
      topRival ? ('En aktif: ' + (topRival.name_tr||'')) : null,
      topRival ? (topRival.counter_recommendation_tr||'').slice(0,120) : null,
      'Türkiye etkisi brifing karar şeridine yansır'
    ]);
  }
}

export function renderPlaybookDecisionCard(c, index){
  const em = c.evidence_meta || {};
  const evidence = (c.evidence || []).map(e =>
    `<span class="pb-ev-item${e.ready ? ' ready' : ''}">${e.ready ? '✓' : '○'} ${esc(e.label)}</span>`
  ).join('');
  const ns = c.next_screen || {};
  return `<div class="card pb pb-decision-card" role="button" tabindex="0" data-tags="${esc(c.tags||'')}" data-pb-idx="${index}"
    onclick="openPlaybookDrawer(${index})" onkeydown="if(event.key==='Enter')openPlaybookDrawer(${index})">
    <div class="k">${ico(c.icon||'signal',(c.title_tr||'?').slice(0,1))} ${esc(c.title_tr||'')} ${provBadge(c.badge)}</div>
    <div class="pb-block"><span class="pb-block-label">Problem</span><p class="pb-block-text">${esc((c.problem_tr||'').slice(0,120))}</p></div>
    <div class="pb-block"><span class="pb-block-label">Evidence</span><div class="pb-ev-row">${evidence||'—'}</div></div>
    <div class="pb-block"><span class="pb-block-label">Recommendation</span><p class="pb-block-text pb-rec">${esc((c.recommendation_tr||'').slice(0,100))}</p></div>
    <div class="pb-block"><span class="pb-block-label">Action</span><p class="pb-block-text">${esc(c.action_tr||'—')}</p></div>
    <div class="pb-evidence-bar">
      <span class="meta-pill">${esc(String(em.live_sources||'—'))} Live Sources</span>
      <span class="meta-pill">${esc(String(em.documents||'—'))} Documents</span>
      <span class="meta-pill">${esc(em.last_update_display||'—')}</span>
      <span class="meta-pill">Güven ${esc(String(Math.round((em.confidence||0)*100)))}%</span>
    </div>
    <div class="pb-next-step">
      <span class="pb-next-label">NEXT STEP</span>
      <span class="pb-next-action">${esc(ns.label_tr||'Modül Aç')} →</span>
    </div>
  </div>`;
}

export function openPlaybookDrawer(index){
  const cards = (window._playbookCache && window._playbookCache.decision_cards) || [];
  const c = cards[index];
  if(!c) return;
  const drawer = document.getElementById('playbookDrawer');
  const backdrop = document.getElementById('playbookDrawerBackdrop');
  const body = document.getElementById('playbookDrawerBody');
  const title = document.getElementById('playbookDrawerTitle');
  if(!drawer || !body) return;
  if(title) title.textContent = c.title_tr || 'Karar';
  const d = c.drawer || {};
  const em = c.evidence_meta || {};
  let html = '';
  html += `<div class="dios-chain">${(c.execution_chain||[]).map((s,i,a)=>`<span>${esc(s.label_tr||s.stage)}</span>${i<a.length-1?' → ':''}`).join('')}</div>`;
  html += `<div class="f">Problem</div><div class="x">${esc(d.problem||c.problem_tr||'—')}</div>`;
  html += `<div class="f">Kanıt</div><div class="x">${(d.evidence||[]).map(e=>`✓ ${esc(e)}`).join('<br>')||'—'}</div>`;
  html += `<div class="f">Makaleler</div><div class="x">${(d.articles||[]).map(a=>`<div class="drill-row"><span>${esc((a.title||'').slice(0,80))}</span><span class="meta-pill">${esc(a.source||'')}</span></div>`).join('')||'—'}</div>`;
  html += `<div class="f">Rakipler</div><div class="x">${(d.competitors||[]).map(r=>`<div>${esc(r.name||'')} — ${esc(r.detail||'')}</div>`).join('')||'—'}</div>`;
  html += `<div class="f">Trend</div><div class="x">${esc(d.trend||'—')}</div>`;
  html += `<div class="f">Doğrulama</div><div class="x">${esc(c.verification_tr||'—')}</div>`;
  html += `<div class="f">Tavsiye</div><div class="x" style="color:var(--gold)">${esc(d.recommendation||c.recommendation_tr||'—')}</div>`;
  html += `<div class="f">Güven</div><div class="x">${esc(String(Math.round((em.confidence||0)*100)))}% · ${esc(String(em.live_sources||'—'))} kaynak · ${esc(em.last_update_display||'—')}</div>`;
  html += `<div class="f">Aksiyonlar</div><div class="x">${(d.actions||[]).map(a=>`<div class="drill-row"><span>${esc(a.label)} · ${esc(a.owner)}</span></div>`).join('')||'—'}</div>`;
  const hist = d.history || {};
  if(hist.memory_note_tr || (hist.prior_outcomes||[]).length || hist.similar_count){
    html += `<div class="f">Geçmiş (Knowledge Memory)</div><div class="x">`;
    if(hist.similar_count) html += `<div class="meta-pill">${esc(String(hist.similar_count))} benzer karar</div> `;
    if(hist.memory_note_tr) html += `<div style="margin-top:6px">${esc(hist.memory_note_tr)}</div>`;
    if((hist.prior_outcomes||[]).length){
      html += (hist.prior_outcomes||[]).map(o=>`<div class="drill-row" style="margin-top:4px"><span>${esc(o.outcome||o.status||'—')}</span></div>`).join('');
    }
    html += `</div>`;
  }
  const btns = c.buttons || [];
  html += `<div class="exec-actions-row pb-drawer-actions">${btns.map(b=>
    `<button type="button" class="pill" onclick="handlePlaybookAction('${esc(c.id)}','${esc(b.action)}','${esc(b.screen||'')}')">${esc(b.label_tr)}</button>`
  ).join('')}</div>`;
  const exports = c.exports || [];
  if(exports.length){
    html += `<div class="f">Exports</div><div class="exec-actions-row">${exports.map(ex=>{
      if(ex.type==='pdf') return `<button type="button" class="pill" onclick="exportPlaybookBrief('pb-${index}','pdf')">PDF</button>`;
      if(ex.type==='brief') return `<button type="button" class="pill" onclick="exportPlaybookBrief('pb-${index}','brief')">Brief</button>`;
      return '';
    }).join('')}</div>`;
  }
  const ns = c.next_screen || {};
  html += `<div class="pb-next-step drawer-next"><span class="pb-next-label">NEXT STEP</span>
    <button type="button" class="pill gold" onclick="handlePlaybookAction('${esc(c.id)}','open_${esc(ns.screen_id||'brief')}','${esc(ns.screen_id||'brief')}')">${esc(ns.label_tr||'Modül Aç')} →</button></div>`;
  body.innerHTML = html;
  drawer.hidden = false;
  drawer.setAttribute('aria-hidden','false');
  if(backdrop){ backdrop.hidden = false; }
  document.body.classList.add('playbook-drawer-open');
  window._playbookActiveCard = c;
}
if(typeof window !== 'undefined') window.openPlaybookDrawer = openPlaybookDrawer;

export function closePlaybookDrawer(){
  const drawer = document.getElementById('playbookDrawer');
  const backdrop = document.getElementById('playbookDrawerBackdrop');
  if(drawer){ drawer.hidden = true; drawer.setAttribute('aria-hidden','true'); }
  if(backdrop) backdrop.hidden = true;
  document.body.classList.remove('playbook-drawer-open');
}
if(typeof window !== 'undefined') window.closePlaybookDrawer = closePlaybookDrawer;

export function handlePlaybookAction(cardId, action, screen){
  if(action.startsWith('open_') && screen){
    closePlaybookDrawer();
    if(typeof window.navigateToScreen === 'function') window.navigateToScreen(screen, {playbookCard: cardId});
    return;
  }
  if(action === 'open_comp'){
    closePlaybookDrawer();
    if(typeof window.navigateToScreen === 'function') window.navigateToScreen('comp', {playbookCard: cardId});
    return;
  }
  if(action === 'open_report'){
    closePlaybookDrawer();
    if(typeof window.navigateToScreen === 'function') window.navigateToScreen('report', {playbookCard: cardId});
    return;
  }
  if(action === 'brief'){
    generateExecBriefing('playbook-'+cardId);
    return;
  }
  if(action === 'assign' || action === 'accept'){
    if(typeof window.submitRecFeedback === 'function') window.submitRecFeedback(0, action === 'assign' ? 'accepted' : 'accepted');
    return;
  }
  if(action === 'reject'){
    if(typeof window.submitRecFeedback === 'function') window.submitRecFeedback(0, 'rejected');
  }
}
if(typeof window !== 'undefined') window.handlePlaybookAction = handlePlaybookAction;

export function exportPlaybookBrief(wrapId, type){
  if(type === 'brief'){
    generateExecBriefing(wrapId);
    return;
  }
  const cards = (window._playbookCache && window._playbookCache.decision_cards) || [];
  const idx = parseInt(String(wrapId).replace('pb-',''), 10);
  const c = cards[idx];
  if(!c) return;
  const w = window.open('', '_blank');
  if(!w) return;
  const html = `<h2>${c.title_tr||''}</h2><p><b>Problem:</b> ${c.problem_tr||''}</p><p><b>Tavsiye:</b> ${c.recommendation_tr||''}</p>`;
  w.document.write('<html><head><title>PlanAI Playbook</title></head><body style="font-family:sans-serif;padding:24px">'+html+'</body></html>');
  w.document.close();
  w.print();
}
if(typeof window !== 'undefined') window.exportPlaybookBrief = exportPlaybookBrief;

export function initPlaybookDrawerListeners(){
  document.querySelectorAll('[data-close-playbook]').forEach(btn=>{
    if(btn.dataset.pbBound) return;
    btn.dataset.pbBound = '1';
    btn.addEventListener('click', closePlaybookDrawer);
  });
}

export function renderPlaybook(pb){
  if(!pb){
    const st = document.getElementById('playbookStatus');
    if(st) st.innerHTML = '<b>Playbook:</b> veri yüklenemedi — API bağlantısını kontrol edin.';
    return;
  }
  window._playbookCache = pb;
  mountExecutiveSummary('playbookExecSummary', pb.executive_summary);
  const grid = document.getElementById('playbookDecisionGrid');
  const cards = pb.decision_cards || [];
  if(grid){
    grid.innerHTML = cards.length
      ? cards.map((c,i) => renderPlaybookDecisionCard(c,i)).join('')
      : '<div class="card"><div class="k">Karar kartı</div><div class="d">Kanıt birikince konu kartları burada görünür.</div></div>';
  }
  const st = document.getElementById('playbookStatus');
  if(st) st.innerHTML = '<b>Playbook:</b> ' + esc(pb.status_tr||'Karar motoru');
  const pbEnd = document.getElementById('playbookSecEnd');
  if(pbEnd){
    const first = cards[0];
    pbEnd.innerHTML = secEndHtml('Kısa sonuç — playbook', [
      first ? ('İlk konu: ' + (first.title_tr||'')) : 'Konu kartlarını tarayın',
      first ? ('Tavsiye: ' + (first.recommendation_tr||'').slice(0,60)) : '—',
      first ? ('Sonraki: ' + ((first.next_screen||{}).label_tr||'Modül')) : 'Drawer ile kanıt açın'
    ]);
  }
  initPlaybookDrawerListeners();
}

export function renderCitations(cite){
  if(!cite){
    const body = document.getElementById('citeTableBody');
    if(body) body.innerHTML = '<tr><td colspan="5" style="padding:14px;color:var(--cream-dim)">Kaynak analizi yüklenemedi — API bağlantısını kontrol edin.</td></tr>';
    return;
  }
  mountExecutiveSummary('citeExecSummary', cite.executive_summary);
  const hint = document.getElementById('citeMethodHint');
  if(hint) hint.innerHTML = esc(cite.method_tr||'') + ' <span class="prov real"><span class="dot"></span>Gerçek</span>';
  const body = document.getElementById('citeTableBody');
  if(body){
    body.innerHTML = (cite.rows||[]).map(r=>{
      const ctrl = r.control === 'up' ? 'up' : (r.control === 'am' ? 'am' : 'dn');
      const rowStyle = (r.name||'').toLowerCase().includes('gotürkiye') ? ' style="background:rgba(227,107,88,.07)"' : '';
      return `<tr${rowStyle}><td><b>${esc(r.name)}</b></td><td>${esc(r.type_tr||'')}</td><td><div class="bar"><i style="width:${r.frequency_pct}%"></i></div></td><td class="${ctrl}">${ctrl==='up'?'Sizin':ctrl==='am'?'Bağımsız':'Dış'}</td><td>${esc(r.opportunity_tr||'')}</td></tr>`;
    }).join('');
  }
  const q = document.getElementById('citeQueue');
  if(q) q.innerHTML = (cite.optimization_queue||[]).map(c=>`<div class="card"><div class="k">${esc(c.title)}</div><div class="d" style="margin-top:8px;font-size:13.5px">${esc(c.body_html||'')}</div></div>`).join('');
}

export function renderAiVisibility(av){
  if(!av){
    const banner = document.getElementById('aivisBanner');
    if(banner) banner.textContent = 'AI Intelligence henüz hazır değil — pipeline toplama sonrası motorlar dolar.';
    return;
  }
  mountExecutiveSummary('aivisExecSummary', av.executive_summary);
  const dest = av.destination || {};
  const visibility = av.visibility_layer || {};
  const citation = av.citation || {};
  const authority = av.authority || {};
  const narrative = av.narrative || {};
  const gap = av.content_gap || {};
  const media = av.media_influence || {};
  const readiness = av.consumer_ai_readiness || {};
  const rec = av.executive_recommendation || {};
  const articleCount = av.article_count ?? 0;

  const scoreRow = document.getElementById('aivisScoreRow');
  if(scoreRow){
    const visLabel = visibility.status === 'measured' && visibility.score != null
      ? `${visibility.score}/100`
      : (visibility.status_label_tr || 'Awaiting AI Measurements');
    scoreRow.innerHTML = `
      <div class="card bg-ai"><div class="k">${ico('ai','I')} AI Intelligence</div>
        <div class="v" style="font-size:22px">${esc(av.status_label_tr || '—')}</div>
        <div class="d">${esc(String(articleCount))} makale · ${esc(av.evidence_window_days || 30)}g pencere</div></div>
      <div class="card"><div class="k">${ico('cite','C')} Citation</div><div class="v" style="font-size:18px">${esc(citation.status_label_tr || 'Awaiting Citation Data')}</div>
        <div class="d">${citation.status === 'ready' ? esc(String(citation.count || 0) + ' haber') : 'Awaiting Citation Data'}</div></div>
      <div class="card"><div class="k">${ico('auth','A')} Authority</div><div class="v" style="font-size:18px">${esc(authority.status_label_tr || '—')}</div>
        <div class="d">High ${esc(String((authority.summary||{}).high||0))} · Med ${esc(String((authority.summary||{}).medium||0))}</div></div>
      <div class="card"><div class="k">${ico('vis','V')} AI Visibility</div><div class="v" style="font-size:18px">${esc(visLabel)}</div>
        <div class="d">Opsiyonel probe · API zorunlu değil</div></div>`;
  }

  const banner = document.getElementById('aivisBanner');
  if(banner) banner.textContent = av.honest_banner_tr || banner.textContent;

  const citeCards = document.getElementById('aivisCitationCards');
  if(citeCards){
    if(citation.status !== 'ready'){
      citeCards.innerHTML = `<div class="card" style="grid-column:1/-1"><div class="k">Citation Engine</div><div class="d">Awaiting Citation Data</div></div>`;
    } else {
      const tops = (citation.top_sources||[]).slice(0,3).map(s=>`${esc(s.source)} (${s.articles})`).join('<br>') || '—';
      const trend = citation.citation_trend || {};
      citeCards.innerHTML = `
        <div class="card"><div class="k">Top Sources</div><div class="d" style="margin-top:8px">${tops}</div></div>
        <div class="card"><div class="k">Citation Trend</div><div class="v" style="font-size:16px">${esc(String(trend.direction||'—'))}</div>
          <div class="d">7g: ${esc(String(trend.current_7d??0))} · önceki: ${esc(String(trend.previous_7d??0))}</div></div>
        <div class="card"><div class="k">Citation Velocity</div><div class="v" style="font-size:16px">${esc(String(citation.citation_velocity??'—'))}</div>
          <div class="d">haber / hafta (30g)</div></div>`;
    }
  }

  const authBody = document.getElementById('aivisAuthorityBody');
  if(authBody){
    const rows = authority.sources || [];
    authBody.innerHTML = rows.length
      ? rows.slice(0,12).map(r=>`<tr><td>${esc(r.source||'')}</td><td>${esc(r.level_label_tr||r.level||'')}</td><td>${esc(String(r.turkey_articles??0))}</td><td>${esc(String(r.continuity_weeks??0))} hf</td></tr>`).join('')
      : `<tr><td colspan="4" style="padding:14px;color:var(--cream-dim)">${esc(authority.message_tr || 'Insufficient Evidence')}</td></tr>`;
  }

  const narrCards = document.getElementById('aivisNarrativeCards');
  if(narrCards){
    const emerging = (narrative.emerging_narratives||[]).slice(0,3).map(n=>esc(n.label_tr)).join('<br>') || '—';
    const risk = (narrative.narrative_risk||[]).slice(0,3).map(n=>esc(n.label_tr)).join('<br>') || '—';
    narrCards.innerHTML = `
      <div class="card"><div class="k">Emerging Narratives</div><div class="d" style="margin-top:8px">${emerging}</div></div>
      <div class="card"><div class="k">Narrative Momentum</div><div class="v" style="font-size:16px">${esc(String(narrative.narrative_momentum??'—'))}</div></div>
      <div class="card bg-warn"><div class="k">Narrative Risk</div><div class="d" style="margin-top:8px">${risk}</div></div>`;
  }

  const gapBody = document.getElementById('aivisGapBody');
  if(gapBody){
    const gaps = (gap.gaps||[]).filter(g=>g.gap_level!=='low').slice(0,10);
    gapBody.innerHTML = gaps.length
      ? gaps.map(g=>`<tr><td>${esc(g.label_tr)}</td><td>${esc(String(g.turkey_articles))}</td><td>${esc(g.leading_destination_tr||'')} (${esc(String(g.leading_count))})</td><td>${esc(g.gap_label_tr)}</td><td>${esc(g.what_to_do || g.recommendation_tr || '—')}</td></tr>`).join('')
      : `<tr><td colspan="5" style="padding:14px;color:var(--cream-dim)">Yüksek/orta boşluk tespit edilmedi veya yetersiz kanıt</td></tr>`;
  }

  const mediaCards = document.getElementById('aivisMediaCards');
  if(mediaCards){
    const top = (media.top_turkey_producers||[]).slice(0,3).map(m=>`${esc(m.source)} (${m.turkey})`).join('<br>') || '—';
    const pro = (media.pro_competitor_media||[]).slice(0,2).map(m=>esc(m.source)).join('<br>') || '—';
    mediaCards.innerHTML = `
      <div class="card"><div class="k">Top Turkey Producers</div><div class="d" style="margin-top:8px">${top}</div></div>
      <div class="card bg-warn"><div class="k">Pro-Competitor Media</div><div class="d" style="margin-top:8px">${pro}</div></div>
      <div class="card"><div class="k">Media Pressure</div><div class="d" style="margin-top:8px">Rakip lehine: ${esc(String((media.media_pressure||{}).pro_competitor_sources??0))} kaynak</div></div>`;
  }

  const readyCards = document.getElementById('aivisReadinessCards');
  if(readyCards){
    const dims = readiness.dimensions || [];
    const dimHtml = dims.slice(0,6).map(d=>`${esc(d.label_tr)}: ${esc(d.status)}`).join('<br>') || readiness.message_tr || '—';
    readyCards.innerHTML = `
      <div class="card"><div class="k">Overall</div><div class="v" style="font-size:16px">${esc(readiness.status_label_tr || 'Needs Improvement')}</div></div>
      <div class="card" style="grid-column:span 2"><div class="k">Dimensions</div><div class="d" style="margin-top:8px">${dimHtml}</div></div>`;
  }

  const visCards = document.getElementById('aivisVisibilityCards');
  if(visCards){
    visCards.innerHTML = `
      <div class="card"><div class="k">Status</div><div class="v" style="font-size:16px">${esc(visibility.status_label_tr || 'Awaiting AI Measurements')}</div></div>
      <div class="card"><div class="k">Last Probe</div><div class="v" style="font-size:16px">${esc(String(visibility.last_probe || dest.last_probe || 'Never'))}</div></div>
      <div class="card"><div class="k">Not</div><div class="d" style="margin-top:8px">${esc(visibility.note_tr || 'Sahte skor üretilmez.')}</div></div>`;
  }

  const measBody = document.getElementById('aivisMeasurementBody');
  if(measBody){
    const rows = av.measurement_status || visibility.measurement_status || [];
    measBody.innerHTML = rows.length
      ? rows.map(r => `<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.status_label_tr || r.status)}</td></tr>`).join('')
      : '<tr><td colspan="2" style="padding:14px;color:var(--cream-dim)">Awaiting AI Measurements</td></tr>';
  }

  const execRec = document.getElementById('aivisExecRec');
  if(execRec){
    execRec.innerHTML = rec.status === 'ready' && rec.text_tr
      ? `<div class="k">Kanıtlı öneri</div><div class="d" style="margin-top:8px">${esc(rec.text_tr)}</div><div class="d" style="margin-top:8px;color:var(--cream-dim)">${esc(rec.reason_tr||'')}</div>`
      : `<div class="k">Recommendation yoktur</div><div class="d" style="margin-top:8px">${esc(rec.reason_tr || 'Citation, Authority, Narrative, Gap veya Media kanıtı yetersiz.')}</div>`;
  }

  const grid = document.getElementById('somGrid');
  if(grid){
    grid.querySelectorAll('.row').forEach(r=>r.remove());
    const engines = av.engines || [];
    const matrix = (av.matrix||[]).filter(r=>somFilter==='all'||r.status===somFilter);
    if(!matrix.length){
      grid.insertAdjacentHTML('beforeend',
        `<div class="row" style="grid-column:1/-1;padding:14px;color:var(--cream-dim)">AI Visibility Layer: Awaiting AI Measurements — probe bağlandığında matris dolar.</div>`
      );
    } else {
      matrix.forEach(r=>{
        const cls = r.status==='win'?'win':r.status==='lose'?'lose':r.status==='awaiting'?'':'mid';
        const cells = [`<div class="row">${esc(r.query_tr||r.query_pl)}</div>`];
        engines.forEach(e=>{
          const n = (r.engines||{})[e.id];
          cells.push(`<div class="row">${n==null?'—':pip(n)}</div>`);
        });
        cells.push(`<div class="row ${cls}">${esc(r.label||'')}</div>`);
        grid.insertAdjacentHTML('beforeend',cells.join(''));
      });
    }
  }

  const narr = document.getElementById('aivisNarratives');
  const nh = document.getElementById('aivisNarrHint');
  if(nh) nh.innerHTML = provBadge(_provFromCode((av.narratives||{}).strong?.provenance));
  if(narr && av.narratives){
    narr.innerHTML = [['strong','up'],['missing','am'],['leak','dn']].map(([k,cls])=>{
      const n = av.narratives[k]||{};
      return `<div class="card"><div class="k ${cls}">${esc(n.title_tr||k)}</div><div class="d" style="margin-top:8px">${(n.lines||[]).map(esc).join('<br>')}</div></div>`;
    }).join('');
  }
  const aivEnd = document.getElementById('aivisSecEnd');
  if(aivEnd){
    aivEnd.innerHTML = secEndHtml('Kısa sonuç — AI Intelligence (Free Core)', [
      `Makale kanıtı: ${articleCount}`,
      `Citation: ${citation.status_label_tr || 'bekleniyor'}`,
      rec.status === 'ready' ? 'Kanıtlı öneri mevcut' : 'Recommendation yoktur (yeterli kanıt yok)'
    ]);
  }
}

export function pip(n){let h='<span class="pip">';for(let i=0;i<3;i++)h+='<s class="'+(i<n?'on':'')+'"></s>';return h+'</span>'}

export function filtSom(btn,f){
  document.querySelectorAll('.pill-row .pill').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  somFilter = f;
  renderAiVisibility(window._aiVisCache || (intelligenceCache && state.intelligenceCache.ai_visibility));
}

/* ---------- report copy ---------- */
export async function copyReport(){
  await loadAnkaraReport();
  const paper = document.getElementById('reportBody');
  if(!paper) return;
  const t = paper.innerText || '';
  (navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).finally(()=>{
    const el=document.getElementById('toast');
    if(el){ el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2200); }
  });
}

/* ---------- discovery feedback (session-only, in-memory) ---------- */
const sessionNotes={};
export function fbSave(mod){
  const ta=document.getElementById('fb-'+mod);
  if(!ta.value.trim()) { ta.focus(); return; }
  sessionNotes[mod]=(sessionNotes[mod]||[]).concat(ta.value.trim());
  document.getElementById('fb-'+mod+'-ok').classList.add('show');
  ta.value='';
  setTimeout(()=>document.getElementById('fb-'+mod+'-ok').classList.remove('show'),3500);
}

/* ---------- playbook search ---------- */
export function pbFilter(){
  const q=document.getElementById('pbSearch').value.toLowerCase().trim();
  document.querySelectorAll('#s-playbook .pb-decision-card').forEach(c=>{
    c.style.display=(!q||c.textContent.toLowerCase().includes(q)||(c.dataset.tags||'').includes(q))?'':'none';
  });
}

/* ---------- strategy builder — live Decision Engine + hub hooks ---------- */
const stSel={aud:'aile',theme:'kis',bud:'orta'};
export function stPick(btn,k,v){stSel[k]=v;btn.parentElement.querySelectorAll('.pill').forEach(p=>p.classList.remove('active'));btn.classList.add('active')}

export async function stBuild(){
  const out = document.getElementById('stOut');
  if(!out) return;
  out.innerHTML = '<div class="note">Canlı strateji motoru yükleniyor…</div>';
  const hub = state.intelligenceCache || intelligenceCache || {};
  const themeMap = { kis: 'kış', gastro: 'gastronomi', kultur: 'kültür' };
  const audMap = { aile: 'aile', cift: 'çift', deneyim: 'deneyim' };
  const themeKey = themeMap[stSel.theme] || stSel.theme;
  const audKey = audMap[stSel.aud] || stSel.aud;

  const [strat, recs, dash] = await Promise.all([
    apiJson('/api/intelligence/decision-media-strategy'),
    apiJson('/api/v1/market-intelligence/recommendations?limit=20'),
    apiJson('/api/v1/market-intelligence/dashboard'),
  ]);

  const decisions = (strat.ok && strat.data && (strat.data.decisions || strat.data.priority_decisions || strat.data.items)) || [];
  const list = (recs.ok && recs.data && recs.data.recommendations) || [];
  const mp = (hub.market_pulse) || (dash.ok && dash.data && dash.data.market_pulse) || {};
  const liveSignals = ((mp.consumer_signals||{}).rising||{}).lines || [];
  const comps = ((hub.competitors||{}).move_cards||[]).slice(0,3);

  const matched = list.filter((r) => {
    const blob = JSON.stringify(r).toLowerCase();
    return blob.includes(themeKey) || blob.includes(audKey) || blob.includes('türk') || blob.includes('turcj');
  }).slice(0, 4);

  const decisionCards = (Array.isArray(decisions) ? decisions : []).slice(0, 3);

  if(!matched.length && !decisionCards.length && !liveSignals.length){
    out.innerHTML =
      `<div class="note"><b>Canlı strateji verisi yok</b> — Decision Engine veya öneri kaydı bulunamadı. Sahte taslak üretilmez.</div>` +
      formatDiagnosticsHtml([strat.error, recs.error].filter(Boolean).join(' · '));
    return;
  }

  let html = `<div class="dispatch"><div class="dispatch-head"><span class="cls">Strateji — canlı Decision Engine</span>
    <span class="mono" style="font-size:10px;color:var(--muted)">kitle: ${esc(stSel.aud)} · tema: ${esc(stSel.theme)} · bütçe: ${esc(stSel.bud)}</span></div>
    <div class="dispatch-body">`;

  matched.forEach((r, i) => {
    html += `<div class="sig-line"><span class="t">Ö${i+1}</span><span class="icon" style="background:var(--gold)"></span>
      <p><b>${esc(r.recommended_action || r.what_changed || 'Öneri')}</b> —
      ${esc(r.why || r.why_important || '')}
      <span class="why">Etki: ${esc(r.impact || '—')} · Öncelik: ${esc(r.priority || '—')} · Sahip: ${esc(r.owner || '—')} · Son: ${esc(r.deadline || '—')}</span></p></div>`;
  });

  decisionCards.forEach((d, i) => {
    const q = d.five_questions || {};
    html += `<div class="sig-line"><span class="t">K${i+1}</span><span class="icon" style="background:var(--rise)"></span>
      <p><b>${esc(d.dios && d.dios.decision || q.do_today || d.recommendation || 'Karar')}</b> —
      ${esc(q.what_happened || d.problem || '')}
      <span class="why">${esc(q.evidence_summary || d.reason || '')}</span></p></div>`;
  });

  if(liveSignals.length){
    html += `<div class="sig-line"><span class="t">CANLI</span><span class="icon" style="background:var(--rise)"></span>
      <p><b>Pazar kancası:</b> ${liveSignals.slice(0,3).map(esc).join(' · ')}
      <span class="why">Kaynak: Pazar Nabzı / consumer_signals</span></p></div>`;
  }
  if(comps.length){
    html += `<div class="sig-line"><span class="t">RAKİP</span><span class="icon" style="background:var(--fall)"></span>
      <p><b>Rakip:</b> ${comps.map(c=>esc(c.name_tr||c.title||'')).join(' · ')}
      <span class="why">Kaynak: Rakip İzleme</span></p></div>`;
  }
  html += `</div></div>
    <div class="note" style="margin-top:14px"><b>Kaynak:</b> yalnızca SQLite/API. Şablon metin kullanılmaz.</div>`;
  out.innerHTML = html;
}

/* ---------- advisor — live recommendations only ---------- */
const ADVISOR_PROMPTS = [
  { key: 'winter', label: 'Kış bütçesi', match: ['kış', 'kis', 'winter', 'zimowe', 'bütçe', 'budget'] },
  { key: 'competitor', label: 'Rakip yanıtı', match: ['arnavut', 'albania', 'rakip', 'competitor', 'egypt', 'mısır', 'greece'] },
  { key: 'ankara', label: 'Ankara raporu', match: ['ankara', 'rapor', 'kpi', 'gösterge', 'merkez'] },
];

function _formatAdvisorAnswer(recs){
  if(!recs || !recs.length){
    return '<b>Canlı öneri bulunamadı.</b><br>Sabah Brifingi veya Decision Engine kaydı yok. Sahte cevap üretilmez.';
  }
  return recs.map((r, i) => {
    return `<b>${i+1}. ${esc(r.recommended_action || r.what_changed || 'Öneri')}</b><br>
      <b>Ne değişti:</b> ${esc(r.what_changed || '—')}<br>
      <b>Neden:</b> ${esc(r.why || '—')}<br>
      <b>Neden önemli:</b> ${esc(r.why_important || '—')}<br>
      <b>Etki:</b> ${esc(r.impact || '—')}<br>
      <b>Öncelik / sahip / son:</b> ${esc(r.priority || '—')} · ${esc(r.owner || '—')} · ${esc(r.deadline || '—')}<br>
      <b>Güven:</b> ${r.confidence != null ? esc(String(r.confidence)) : (r.valid === false ? 'kısmi kayıt' : '—')}`;
  }).join('<br><br>');
}

export async function loadAdvisorLive(){
  const thread = document.getElementById('advThread');
  const alert = document.querySelector('#s-advisor .prototype-alert');
  if(alert){
    alert.innerHTML = '<b>Canlı AI Danışman:</b> cevaplar yalnızca API önerilerinden üretilir. Sabit metin yok.';
  }
  const [recs, brief] = await Promise.all([
    apiJson('/api/v1/market-intelligence/recommendations?limit=30'),
    apiJson('/api/brief/today', { retries: 0 }),
  ]);
  const list = (recs.ok && recs.data && recs.data.recommendations) || [];
  let briefRecs = [];
  if(brief.ok && brief.data && Array.isArray(brief.data.recommendations)){
    briefRecs = brief.data.recommendations.map((r) => ({
      what_changed: r.title || r.what_changed,
      why: r.why,
      why_important: r.evidence || r.why_it_matters,
      impact: r.expected_impact,
      recommended_action: r.title || r.recommended_action,
      priority: r.priority,
      owner: r.owner || 'Warsaw Tourism Counsellor',
      deadline: r.timing || r.deadline,
      confidence: r.confidence_score,
      valid: true,
    }));
  }
  advisorCache = {
    recommendations: list.length ? list : briefRecs,
    brief: brief.ok ? brief.data : null,
  };
  if(thread && !thread.dataset.liveBootstrapped){
    thread.dataset.liveBootstrapped = '1';
    const n = advisorCache.recommendations.length;
    thread.innerHTML = n
      ? `<div class="msg a">Günaydın. ${n} canlı öneri/karar kaydı yüklendi. Yukarıdan bir soru seçin — cevaplar SQLite kayıtlarından üretilecek.</div>`
      : `<div class="msg a">Henüz canlı öneri yok. Pipeline çalıştıkça burada görünecek. Sahte cevap üretilmez.${formatDiagnosticsHtml(recs.error || '')}</div>`;
  }
}

export function ask(i){
  const t = document.getElementById('advThread');
  if(!t) return;
  const prompt = ADVISOR_PROMPTS[i] || ADVISOR_PROMPTS[0];
  t.insertAdjacentHTML('beforeend', `<div class="msg q">${esc(prompt.label)}</div>`);
  const loadingId = 'adv-loading-' + Date.now();
  t.insertAdjacentHTML('beforeend', `<div class="msg a" id="${loadingId}">Canlı kayıtlar taranıyor…</div>`);

  const run = async () => {
    if(!advisorCache.recommendations.length) await loadAdvisorLive();
    const pool = advisorCache.recommendations || [];
    const matched = pool.filter((r) => {
      const blob = JSON.stringify(r).toLowerCase();
      return prompt.match.some((m) => blob.includes(m));
    }).slice(0, 3);
    const use = matched.length ? matched : pool.slice(0, 3);
    const el = document.getElementById(loadingId);
    if(el) el.innerHTML = _formatAdvisorAnswer(use);
    t.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  };
  run().catch((err) => {
    const el = document.getElementById(loadingId);
    if(el) el.innerHTML = 'API hatası: ' + esc(String(err && err.message ? err.message : err)) + formatDiagnosticsHtml();
  });
}

/* ---------- Ankara report — live weekly/monthly/MI ---------- */
export async function loadAnkaraReport(){
  const paper = document.getElementById('reportBody');
  const alert = document.querySelector('#s-report .prototype-alert');
  if(alert){
    alert.innerHTML = '<b>Ankara Raporu:</b> metin canlı Haftalık / Aylık / MI executive API çıktılarından üretilir.';
  }
  if(!paper) return;
  paper.innerHTML = '<p class="rp-mono">Canlı rapor yükleniyor…</p>';

  const [weekly, monthly, daily, recs] = await Promise.all([
    apiJson('/api/weekly/outlook'),
    apiJson('/api/monthly/review'),
    apiJson('/api/v1/market-intelligence/reports/daily'),
    apiJson('/api/v1/market-intelligence/recommendations?limit=8'),
  ]);

  const errors = [weekly, monthly, daily, recs].filter((r) => !r.ok).map((r) => r.error).filter(Boolean);
  const w = weekly.ok ? weekly.data : null;
  const m = monthly.ok ? monthly.data : null;
  const d = daily.ok ? daily.data : null;
  const recommendations = (recs.ok && recs.data && recs.data.recommendations) || [];

  const weekLabel = (w && (w.week_start || (w.outlook && w.outlook.week_label))) || '—';
  const glance = (w && w.outlook && w.outlook.week_at_glance) || {};
  const brief = d && d.brief;
  const signals = (d && d.signals) || [];

  if(!w && !m && !d && !recommendations.length){
    paper.innerHTML =
      `<p class="rp-mono">T.C. · Varşova Turizm Müşavirliği</p>
       <h3>Canlı rapor verisi yok</h3>
       <p>Haftalık/aylık snapshot veya sabah brifingi henüz üretilmemiş. Sahte istatistik gösterilmez.</p>` +
      formatDiagnosticsHtml(errors.join(' · '));
    return;
  }

  let html = `<div class="rp-mono">T.C. Kültür ve Turizm Bakanlığı — TGA · Varşova Turizm Müşavirliği · Canlı Pazar Raporu</div>
    <h3>Polonya Pazarı — ${esc(String(weekLabel))} (canlı derleme)</h3>
    <p><b>Özet:</b> ${esc(
      (brief && (brief.headline || brief.title)) ||
      (glance.summary_tr || glance.headline_tr) ||
      (m && m.executive_summary_tr) ||
      'Sabah brifingi ve haftalık bakıştan derlendi.'
    )}</p>`;

  if(signals.length){
    html += `<p class="rp-h">1. Pazar Sinyalleri</p><ul>`;
    signals.slice(0, 8).forEach((s) => {
      html += `<li><b>${esc(s.title || '')}</b> — ${esc((s.body || s.why_it_matters || '').slice(0, 220))}</li>`;
    });
    html += `</ul>`;
  } else if(w && w.outlook){
    html += `<p class="rp-h">1. Haftalık Bakış</p><p>${esc(JSON.stringify(glance).slice(0, 500))}</p>`;
  }

  const hub = state.intelligenceCache || intelligenceCache || {};
  const comps = ((hub.competitors || {}).move_cards) || [];
  html += `<p class="rp-h">2. Rakip Hareketleri</p>`;
  if(comps.length){
    html += `<ul>` + comps.slice(0, 5).map((c) =>
      `<li><b>${esc(c.name_tr || c.title || '')}</b> — ${esc((c.summary_tr || c.move_tr || '').slice(0, 200))}</li>`
    ).join('') + `</ul>`;
  } else {
    html += `<p>Canlı rakip kartı yok (API boş döndü).</p>`;
  }

  html += `<p class="rp-h">3. Öneriler</p>`;
  if(recommendations.length){
    html += `<ul>` + recommendations.slice(0, 6).map((r) =>
      `<li><b>${esc(r.recommended_action || r.what_changed || '')}</b> — ${esc(r.why || '')} · Öncelik ${esc(r.priority || '—')} · Son ${esc(r.deadline || '—')}</li>`
    ).join('') + `</ul>`;
  } else {
    html += `<p>Canlı öneri kaydı yok.</p>`;
  }

  if(m){
    html += `<p class="rp-h">4. Aylık Executive</p><p>${esc(
      m.executive_summary_tr || m.summary_tr || m.title || 'Aylık review yüklendi.'
    ).slice(0, 600)}</p>`;
  }

  html += `<p style="margin-top:18px;font-size:12px;color:#8A7C57">Üretim: PlanAI live API · ${esc(new Date().toISOString())} · Müşavir onayı beklenir</p>`;
  paper.innerHTML = html;
}

/* ---------- GoTürkiye — live playbook + sources + strategy ---------- */
export async function loadGoTurkiyeLive(){
  const section = document.getElementById('s-gotr');
  if(!section) return;
  let mount = document.getElementById('gotrLiveMount');
  if(!mount){
    mount = document.createElement('div');
    mount.id = 'gotrLiveMount';
    const lede = section.querySelector('.lede');
    if(lede && lede.parentNode) lede.parentNode.insertBefore(mount, lede.nextSibling);
    else section.appendChild(mount);
  }
  mount.innerHTML = '<div class="note">GoTürkiye canlı matris yükleniyor…</div>';

  const [playbook, citeRes, strat, miSources] = await Promise.all([
    apiJson('/api/intelligence/playbook'),
    apiJson('/api/intelligence/citations'),
    apiJson('/api/intelligence/decision-media-strategy'),
    apiJson('/api/v1/market-intelligence/sources'),
  ]);

  const cards = (playbook.ok && playbook.data && (playbook.data.decision_cards || playbook.data.cards)) || [];
  const srcList = (miSources.ok && miSources.data && miSources.data.sources) || [];
  const citeData = (citeRes.ok && citeRes.data) || {};

  const gotrSources = srcList.filter((s) => {
    const blob = JSON.stringify(s).toLowerCase();
    return blob.includes('goturkiye') || blob.includes('tga') || blob.includes('ministry') || blob.includes('turism') || blob.includes('tourism');
  });

  let html = `<div class="sect"><h2 class="disp">Canlı anlatı & kaynak durumu</h2><span class="hint">API · sahte matris yok</span></div>`;
  html += `<div class="grid g2 card-eq">`;
  html += `<div class="card"><div class="k">Playbook kararları</div><div class="v" style="font-size:22px">${cards.length}</div>
    <div class="d">${cards.length ? esc((cards[0].title_tr || cards[0].problem || '').slice(0, 120)) : 'Kayıt yok'}</div></div>`;
  html += `<div class="card"><div class="k">Kurumsal kaynaklar</div><div class="v" style="font-size:22px">${gotrSources.length || srcList.length}</div>
    <div class="d">${gotrSources.slice(0,3).map(s=>esc(s.name||'')).join(' · ') || (srcList.length ? 'Genel kaynak listesi' : 'Kaynak listesi boş')}</div></div>`;
  html += `<div class="card"><div class="k">Citation</div><div class="v" style="font-size:18px">${esc(String(citeData.count != null ? citeData.count : (citeData.status_label_tr || '—')))}</div>
    <div class="d">${esc(citeData.status_label_tr || citeData.status || '')}</div></div>`;
  html += `<div class="card"><div class="k">Decision Media</div><div class="v" style="font-size:18px">${strat.ok ? 'bağlı' : 'yok'}</div>
    <div class="d">${esc(strat.error || 'decision-media-strategy')}</div></div>`;
  html += `</div>`;

  if(cards.length){
    html += `<div class="sect"><h2 class="disp">Aksiyon kartları</h2></div><div class="grid g2 card-eq">`;
    cards.slice(0, 6).forEach((c) => {
      html += `<div class="card"><div class="k">${esc(c.title_tr || c.theme || 'Karar')}</div>
        <div class="d" style="margin-top:8px">${esc((c.recommendation_tr || c.do_tr || c.problem || '').slice(0, 220))}</div></div>`;
    });
    html += `</div>`;
  } else {
    html += `<div class="note"><b>Playbook boş:</b> canlı karar kartı yok. ${formatDiagnosticsHtml(playbook.error || '')}</div>`;
  }

  mount.innerHTML = html;

  const hardcodedTableWrap = section.querySelector('table')?.closest('.card');
  if(hardcodedTableWrap && (cards.length || gotrSources.length || srcList.length)){
    hardcodedTableWrap.style.display = 'none';
    const prevSect = hardcodedTableWrap.previousElementSibling;
    if(prevSect && prevSect.classList.contains('sect')) prevSect.style.display = 'none';
  }
  const landingGrid = section.querySelector('.grid.g3');
  if(landingGrid && cards.length){
    landingGrid.style.display = 'none';
    const prevSect = landingGrid.previousElementSibling;
    if(prevSect && prevSect.classList.contains('sect')) prevSect.style.display = 'none';
  }
}

/* ---------- MI dashboard bundle (feeds brief-adjacent widgets) ---------- */
export async function loadMarketIntelligenceBundle(){
  const [dash, timeline, entities, health, metrics] = await Promise.all([
    apiJson('/api/v1/market-intelligence/dashboard'),
    apiJson('/api/v1/market-intelligence/timeline?limit=30'),
    apiJson('/api/v1/market-intelligence/entities?limit=40'),
    apiJson('/api/v1/market-intelligence/health'),
    apiJson('/api/v1/market-intelligence/metrics'),
  ]);

  window._miCache = {
    dashboard: dash.ok ? dash.data : null,
    timeline: timeline.ok ? timeline.data : null,
    entities: entities.ok ? entities.data : null,
    health: health.ok ? health.data : null,
    metrics: metrics.ok ? metrics.data : null,
  };

  // Enrich competitor alerts strip on market screen if present
  const marketAlert = document.getElementById('marketMiStrip');
  if(marketAlert && dash.ok && dash.data){
    const nSrc = dash.data.sources_active || 0;
    const nSig = dash.data.signals || 0;
    const nArt = dash.data.articles || 0;
    marketAlert.innerHTML = `<div class="note"><b>Market Intelligence:</b> ${nSrc} kaynak · ${nSig} sinyal · ${nArt} makale · enrichment ${esc(String((metrics.ok && metrics.data && metrics.data.enrichment_coverage) || '—'))}</div>`;
  }

  // Inject MI strip into market screen once
  const marketScreen = document.getElementById('s-market');
  if(marketScreen && !document.getElementById('marketMiStrip')){
    const strip = document.createElement('div');
    strip.id = 'marketMiStrip';
    marketScreen.insertBefore(strip, marketScreen.firstChild);
    if(dash.ok && dash.data){
      strip.innerHTML = `<div class="note"><b>Market Intelligence:</b> ${dash.data.sources_active||0} kaynak · ${dash.data.signals||0} sinyal · ${dash.data.articles||0} makale</div>`;
    } else if(!dash.ok){
      strip.innerHTML = `<div class="note"><b>MI dashboard:</b> ${esc(dash.error||'bağlantı yok')}</div>`;
    }
  }

  if(timeline.ok && timeline.data && Array.isArray(timeline.data.signals)){
    window._miTimelineSignals = timeline.data.signals;
  }
  return window._miCache;
}

/* ---------- Phase 7 · Decision & Media Strategy Engine ---------- */
export async function submitStrategyFeedback(decisionId, action){
  try{
    const res = await apiFetch('/api/intelligence/decision-media-strategy/' + encodeURIComponent(decisionId) + '/feedback', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({action: action})
    });
    if(res && res.ok){
      const el = document.getElementById('strategyFb-' + decisionId);
      if(el) el.innerHTML = '<span class="why" style="color:var(--rise)">Geri bildirim kaydedildi (' + esc(action) + ').</span>';
    } else {
      alert('Strateji geri bildirimi kaydedilemedi.');
    }
  }catch(_){
    alert('Strateji geri bildirimi bağlantı hatası.');
  }
}

export function renderDiosPriorityCard(d){
  const q = d.five_questions || {};
  const sc = d.scores || {};
  const dios = d.dios || {};
  const m = dios.metrics || sc;
  const id = d.id || '';
  const actions = dios.actions || [];
  const btns = dios.buttons || [
    {label_tr:'Kabul',action:'accepted'},{label_tr:'Red',action:'rejected'},
    {label_tr:'Daha Fazla Kanıt',action:'need_evidence'},{label_tr:'Kampanya',action:'create_campaign'},
    {label_tr:'Brifing',action:'create_brief'},{label_tr:'Medya Planı',action:'open_media_plan'}
  ];
  return `<div class="dispatch dios-priority-card" style="margin-bottom:14px" id="priority-${esc(id)}">
    <div class="dispatch-head"><span class="cls">${esc(d.layer || 'decision')}</span>
      <span class="mono" style="font-size:10px;color:var(--muted)">öncelik ${esc(String(m.priority||sc.overall_priority||'—'))} · güven ${esc(String(m.confidence||sc.confidence||'—'))} · kanıt ${esc(String(m.evidence_count||'—'))}</span></div>
    <div class="dispatch-body">
      <div class="dios-signal-line"><b>Sinyal</b> ${esc((dios.signal||q.what_happened||'').slice(0,100))}</div>
      <div class="dios-decision-line"><b>Karar</b> ${esc(dios.decision||q.do_today||'')}</div>
      <div class="signal-meta-row">${actions.slice(0,4).map(a=>`<span class="meta-pill">${esc(a.label)} · ${esc(a.owner)} · ${esc(a.status_label_tr||'')}</span>`).join('')}</div>
      <div class="sig-line"><span class="t">5</span><span class="icon" style="background:var(--gold)"></span><p><b>Kanıt</b> — ${esc(q.evidence_summary||'')}</p></div>
      <div class="exec-actions-row" style="margin-top:8px">
        ${btns.map(b=>`<button type="button" class="pill" onclick="handleDiosPriorityAction('${esc(id)}','${esc(b.action)}')">${esc(b.label_tr)}</button>`).join('')}
      </div>
    </div>
  </div>`;
}

export function handleDiosPriorityAction(decisionId, action){
  if(action === 'open_media_plan'){
    if(typeof window.navigateToScreen === 'function') window.navigateToScreen('media', {decisionId});
    return;
  }
  if(action === 'create_brief'){
    generateExecBriefing('priority-'+decisionId);
    return;
  }
  if(action === 'create_campaign'){
    if(typeof window.navigateToScreen === 'function') window.navigateToScreen('media', {decisionId, createCampaign:true});
    return;
  }
  if(action === 'need_evidence'){
    if(typeof window.navigateToScreen === 'function') window.navigateToScreen('brief');
    return;
  }
  if(action === 'assign'){
    submitStrategyFeedback(decisionId, 'accepted');
    return;
  }
  if(['accepted','rejected','implemented','ignored','deferred'].includes(action)){
    submitStrategyFeedback(decisionId, action);
  }
}
if(typeof window !== 'undefined') window.handleDiosPriorityAction = handleDiosPriorityAction;

export function renderCampaignOperations(ops){
  const el = document.getElementById('campaignOperationsPanel');
  if(!el) return;
  if(!ops){
    el.innerHTML = '<div class="card"><div class="k">Kampanya</div><div class="d">Geçerli karar sonrası operasyon paneli açılır.</div></div>';
    return;
  }
  const content = (ops.content_production||[]).map(c=>
    `<div class="drill-row"><span>${esc(c.label)}</span><span class="meta-pill">${esc(c.owner)} · ${esc(c.status)}</span></div>`
  ).join('');
  const dist = (ops.distribution||[]).map(ch=>`<span class="meta-pill">${esc(ch)}</span>`).join('');
  const tl = ops.timeline || {};
  el.innerHTML = `<div class="card campaign-ops">
    <div class="k">${ico('opp','C')} ${esc(ops.campaign_name||'Campaign')}</div>
    <div class="signal-meta-row">
      <span class="meta-pill">Öncelik: ${esc(ops.priority||'—')}</span>
      <span class="meta-pill">Süre: ${esc(ops.duration||'—')}</span>
    </div>
    <div class="d" style="margin-top:8px"><b>Hedef kitle</b> — ${esc(ops.audience||'—')}</div>
    <div class="d"><b>Mesaj</b> — ${esc(ops.core_message||'—')}</div>
    <div class="f" style="margin-top:10px">İçerik Üretimi</div><div class="x">${content||'—'}</div>
    <div class="f">Dağıtım</div><div class="x">${dist||'—'}</div>
    <div class="f">Zaman çizelgesi</div><div class="x">Bugün: ${esc(tl.today||'—')} · 24s: ${esc(tl['24h']||'—')} · 72s: ${esc(tl['72h']||'—')}</div>
    <div class="f">KPI</div><div class="x">${(ops.kpis||[]).map(k=>esc(k)).join(' · ')}</div>
  </div>`;
}

export function renderDecisionMediaStrategy(data){
  if(!data) return;
  window._decisionMediaCache = data;
  const ns = document.getElementById('mediaNorthStar');
  if(ns) ns.textContent = data.north_star_tr || ns.textContent;
  mountExecutiveSummary('mediaExecSummary', data.executive_summary);
  mountExecutiveSummary('strategyExecSummary', build_executive_summary_client(data));

  const agency = document.getElementById('mediaAgencyBrief');
  if(agency){
    const b = data.agency_brief || {};
    const fields = [
      ['opp','Campaign / Fırsat', b.opportunity_tr],
      ['travel','Audience', b.audience_tr],
      ['media','Message', b.key_message_tr],
      ['media','Creative', b.content_idea_tr],
      ['search','SEO', b.seo_tr],
      ['ai','AI Search', b.ai_search_tr],
      ['gov','PR / Basın', b.pr_tr || b.press_tr],
      ['media','LinkedIn', b.linkedin_tr],
      ['media','Facebook', b.facebook_tr],
      ['media','Instagram', b.instagram_tr],
      ['media','YouTube', b.youtube_tr],
      ['media','Blog / Video', b.blog_tr || b.video_tr],
      ['trend','Timeline', b.calendar_tr],
      ['opp','Expected Impact', b.expected_impact_tr],
      ['signal','Evidence', b.evidence_tr],
    ];
    agency.innerHTML = fields.map(([ik,k,v]) =>
      `<div class="card card-eq agency-card"><div class="k">${ico(ik, k)} ${esc(k)}</div><div class="d" style="margin-top:8px">${esc(v||'—')}</div></div>`
    ).join('');
  }
  const mediaEnd = document.getElementById('mediaSecEnd');
  if(mediaEnd){
    const top = (data.todays_strategic_priorities || [])[0];
    const q = (top && top.five_questions) || {};
    mediaEnd.innerHTML = secEndHtml('Kısa sonuç — medya stratejisi', [
      q.do_today || (data.agency_brief && data.agency_brief.opportunity_tr) || null,
      'Media mix + kanıt zinciri yukarıda',
      'Öncelik: bugünün kampanya kartı'
    ]);
  }

  const honesty = document.getElementById('mediaHonestyNote');
  if(honesty){
    if(data.insufficient_global){
      honesty.style.display = 'block';
      honesty.innerHTML = '<b>Dürüstlük:</b> ' + esc(data.message || 'Yeterli doğrulanmış kanıt yok.');
    } else {
      honesty.style.display = 'none';
    }
  }

  const pri = document.getElementById('mediaPriorities');
  if(pri){
    const items = data.todays_strategic_priorities || [];
    if(!items.length){
      pri.innerHTML = '<div class="sig-line"><span class="t">—</span><span class="icon" style="background:var(--amber)"></span><p><b>Stratejik öncelik yok</b> — ' + esc(data.message || 'Kanıt birikince burada görünür.') + '</p></div>';
    } else {
      pri.innerHTML = items.map(d => renderDiosPriorityCard(d)).join('');
    }
  }

  renderCampaignOperations(data.campaign_operations);

  // Strategy screen — real engine structure
  const stEngine = document.getElementById('strategyEngineOut');
  if(stEngine){
    const items = data.todays_strategic_priorities || [];
    if(!items.length){
      stEngine.innerHTML = '<div class="note">Geçerli motor kararı yok — kanıt birikince Situation→Recommendation zinciri burada görünür.</div>';
    } else {
      stEngine.innerHTML = items.slice(0,4).map(d => {
        const q = d.five_questions || {};
        const sc = d.scores || {};
        return `<div class="dispatch" style="margin-bottom:12px">
          <div class="dispatch-head"><span class="cls">Situation → Decision</span>
            <span class="mono" style="font-size:10px;color:var(--muted)">güven ${esc(String(sc.confidence||'—'))}</span></div>
          <div class="dispatch-body">
            <div class="sig-line"><span class="t">SIT</span><span class="icon" style="background:var(--gold)"></span><p><b>Situation</b> — ${esc(q.what_happened||'')}</p></div>
            <div class="sig-line"><span class="t">EVD</span><span class="icon" style="background:var(--rise)"></span><p><b>Evidence</b> — ${esc(q.evidence_summary||'')}</p></div>
            <div class="sig-line"><span class="t">INS</span><span class="icon" style="background:var(--amber)"></span><p><b>Insight</b> — ${esc(q.why_turkey||'')}</p></div>
            <div class="sig-line"><span class="t">OPP</span><span class="icon" style="background:var(--gold)"></span><p><b>Opportunity</b> — ${esc(q.why_poland||'')}</p></div>
            <div class="sig-line"><span class="t">REC</span><span class="icon" style="background:var(--fall)"></span><p><b>Recommendation</b> — ${esc(q.do_today||'')}</p></div>
            <div class="sig-line"><span class="t">IMP</span><span class="icon" style="background:var(--rise)"></span><p><b>Expected Impact / Confidence / Owner</b> — ${esc(String(sc.confidence||'—'))} · Varşova masası · Bugün</p></div>
          </div>
        </div>`;
      }).join('');
    }
  }

  const support = document.getElementById('mediaDecisionSupport');
  if(support){
    const top = (data.todays_strategic_priorities || [])[0];
    const layers = (top && top.action_layers) || {};
    const labels = {
      tourism_counsellor:'Turizm Müşavirliği', goturkiye:'GoTürkiye', ministry:'Ankara',
      media_team:'Medya', digital_team:'Dijital', seo_team:'SEO', pr_team:'PR', campaign_team:'Kampanya'
    };
    const keys = Object.keys(layers);
    if(!keys.length){
      support.innerHTML = '<div class="card"><div class="k">Karar desteği</div><div class="d" style="margin-top:8px">Geçerli karar yok.</div></div>';
    } else {
      support.innerHTML = keys.map(k => `<div class="card"><div class="k">${esc(labels[k]||k)}</div><div class="d" style="margin-top:8px">${esc(layers[k]||'')}</div></div>`).join('');
    }
  }

  const body = document.getElementById('mediaChannelBody');
  const mix = (data.media_plan || {}).channel_weights || [];
  if(body){
    if(!mix.length){
      body.innerHTML = '<tr><td colspan="4" style="padding:14px;color:var(--cream-dim)">Kanal ağırlığı yok — önce geçerli karar gerekir.</td></tr>';
    } else {
      body.innerHTML = mix.map(r =>
        `<tr><td><b>${esc(r.channel)}</b></td><td class="mono">${esc(String(r.share_pct))}%</td><td><div class="bar"><i style="width:${esc(String(r.share_pct))}%"></i></div></td><td>${esc(r.rationale_tr||'')}</td></tr>`
      ).join('');
    }
  }

  const altsEl = document.getElementById('mediaCampaignAlts');
  if(altsEl){
    const blocks = data.campaign_alternatives || [];
    if(!blocks.length){
      altsEl.innerHTML = '<div class="note">Kampanya alternatifleri yalnızca geçerli karardan sonra üretilir.</div>';
    } else {
      altsEl.innerHTML = blocks.map(b => {
        const alts = b.alternatives || [];
        return `<div class="dispatch" style="margin-bottom:12px"><div class="dispatch-head"><span class="cls">Kampanya</span><span class="mono" style="font-size:10px;color:var(--muted)">${esc(b.signal||'')}</span></div>
          <div class="dispatch-body">${alts.map(a =>
            `<div class="sig-line"><span class="t">${esc(a.code||'')}</span><span class="icon" style="background:var(--gold)"></span>
              <p><b>${esc(a.name||'')}</b> — ${esc(a.objective||'')}
              <span class="why">${(a.media_mix||[]).map(m=>esc(m.channel)+': '+esc(m.why)).join(' · ')}</span></p></div>`
          ).join('')}</div></div>`;
      }).join('');
    }
  }

  const creatives = document.getElementById('mediaCreativeGrid');
  if(creatives){
    const cards = (data.media_plan || {}).creative_shortlist || [];
    creatives.innerHTML = cards.length
      ? cards.map(c => `<div class="card"><div class="k">${esc(c.title||'')} ${provBadge(c.badge)}</div><div class="d" style="margin-top:8px">${esc(c.body||'')}<br><span class="why">${esc(c.audience||'')} · ${esc(c.cta||'')}</span></div></div>`).join('')
      : '<div class="card"><div class="k">Yaratıcı brief</div><div class="d" style="margin-top:8px">Kanıtlı karar yok.</div></div>';
  }

  const gotr = document.getElementById('mediaGotrAdvisor');
  if(gotr){
    const items = data.goturkiye_advisor || [];
    gotr.innerHTML = items.length
      ? items.map(g => `<div class="card"><div class="k">${esc(g.signal||'GoTürkiye')}</div><div class="d" style="margin-top:8px">
          Landing: ${esc(g.landing_page||'')}<br>Editorial: ${esc(g.editorial||'')}<br>Video: ${esc(g.video||'')}</div></div>`).join('')
      : '<div class="card"><div class="k">GoTürkiye</div><div class="d" style="margin-top:8px">Öneri yok.</div></div>';
  }

  const ank = document.getElementById('mediaAnkaraBriefs');
  if(ank){
    const items = data.ankara_executive_briefs || [];
    ank.innerHTML = items.length
      ? items.map(a => `<div class="sig-line"><span class="t">TR</span><span class="icon" style="background:var(--fall)"></span>
          <p><b>Aciliyet: ${esc(a.urgency||'—')}</b> — ${esc(a.recommended_ministry_action||'')}
          <span class="why">Risk: ${esc(a.risk||'')} · Beklenen: ${esc(a.expected_result||'')}</span></p></div>`).join('')
      : '<div class="note">Ankara executive brief için geçerli karar gerekir.</div>';
  }

  const cal = document.getElementById('mediaCalendarNote');
  if(cal){
    cal.innerHTML = '<b>Kampanya takvimi:</b> ' + esc((data.media_plan || {}).calendar_logic_tr || '—');
  }
}

function build_executive_summary_client(data){
  if(data && data.executive_summary){
    return Object.assign({}, data.executive_summary, {surface:'strategy', intro_tr:'Strateji — kanıtlı kararlar:'});
  }
  return null;
}

export async function loadDecisionMediaStrategy(){
  try{
    const res = await apiFetch('/api/intelligence/decision-media-strategy');
    if(!res || !res.ok){
      const honesty = document.getElementById('mediaHonestyNote');
      if(honesty){
        honesty.style.display = 'block';
        honesty.innerHTML = '<b>API:</b> Decision & Media Strategy Engine yanıt vermedi.';
      }
      return;
    }
    renderDecisionMediaStrategy(await res.json());
  }catch(_){}
}

export function initTranslationListeners() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.translate-btn');
    if (btn) {
      e.preventDefault();
      toggleInlineTranslation(btn);
    }
  });
}

export function initSession() {
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await apiFetch('/api/auth/logout', { method: 'POST' });
      window.location.href = loginUrl();
    });
  }
  apiFetch('/api/auth/me').then(async (res) => {
    if (!res || !res.ok) return;
    const u = await res.json();
    const el = document.getElementById('userLine');
    if (el && u.display_name) el.textContent = u.display_name + ' · Private Alpha';
  });
}

