/**
 * PlanAI Field — mobile-safe interactive replay (file:// / content:// compatible).
 * Classic scripts only; no ES modules, no external resources, no MapLibre workers.
 */
(function (global) {
  'use strict';

  const SAFE_CSS = [
    '*{box-sizing:border-box}',
    'body{margin:0;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f1a28;color:#e8eef4}',
    '.psr-head{padding:12px 14px;background:#152536;border-bottom:1px solid #2a3f55;display:flex;gap:10px;align-items:center;flex-wrap:wrap}',
    '.psr-head h1{margin:0;font-size:17px;font-weight:700;flex:1;color:#fff}',
    '.psr-head .psr-meta{font-size:11px;color:#9ab0c8;width:100%}',
    '.psr-stats{display:flex;flex-wrap:wrap;gap:8px;padding:10px 14px;background:#1a2d42;border-bottom:1px solid #2a3f55}',
    '.psr-stat{font-size:11px;background:#243a52;padding:6px 10px;border-radius:8px;color:#c5d4e8}',
    '.psr-layout{display:grid;grid-template-columns:1fr;min-height:calc(100vh - 120px)}',
    '@media(min-width:900px){.psr-layout{grid-template-columns:minmax(280px,340px) 1fr}}',
    '.psr-side{background:#152536;border-right:1px solid #2a3f55;overflow-y:auto;max-height:calc(100vh - 120px);-webkit-overflow-scrolling:touch}',
    '.psr-detail{padding:12px 14px;font-size:13px;line-height:1.45;border-bottom:1px solid #2a3f55;min-height:48px}',
    '.psr-item{display:block;width:100%;text-align:left;padding:12px 14px;border:none;border-bottom:1px solid #1e3248;background:#152536;color:#e8eef4;cursor:pointer;touch-action:manipulation;min-height:48px}',
    '.psr-item:active,.psr-item.active{background:#1e3a5f}',
    '.psr-item small{display:block;color:#8fa3bc;margin-top:4px;font-size:11px}',
    '.psr-item .psr-voice{color:#ce93d8}',
    '.psr-replay{float:right;color:#4fc3f7;font-size:15px;padding:2px 6px}',
    '.psr-map{background:#0d1824;position:relative;min-height:min(72vh,520px)}',
    '.psr-map img.psr-basemap{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.92;pointer-events:none}',
    '.psr-map svg{width:100%;height:auto;display:block;position:relative;z-index:1}',
    '.psr-highlight{stroke:#ffeb3b!important;stroke-width:6!important;filter:drop-shadow(0 0 4px rgba(255,235,59,.6))}',
    '.psr-replay-active{stroke:#27ae60!important;stroke-width:6!important}',
    '.psr-replay-near{background:#1e3a5f!important;border-left:3px solid #f9a825}',
    '.psr-media{padding:10px 14px;border-top:1px solid #2a3f55}',
    '.psr-media img{max-width:100%;border-radius:8px;display:block}',
    '.psr-media audio{width:100%;margin-top:8px;min-height:40px}',
    '.psr-badge{font-size:10px;background:#2e7d32;color:#fff;padding:2px 8px;border-radius:99px;margin-left:6px}',
    '.psr-fallback-note{font-size:11px;color:#9ab0c8;padding:8px 14px;background:#1a2d42}',
    '#psr-replay-dot{filter:drop-shadow(0 2px 6px rgba(0,0,0,.45))}',
    '.psr-logo{height:28px;width:auto;max-width:80px;object-fit:contain}',
  ].join('');

  /** Runtime capability probe (also used in exported HTML). */
  function detectReplayCapabilities() {
    const protocol = (global.location && global.location.protocol) || '';
    const fileLike = protocol === 'file:' || protocol === 'content:' || protocol === 'capacitor-file:';
    let blobWorkers = false;
    try {
      if (typeof URL !== 'undefined' && URL.createObjectURL) {
        const u = URL.createObjectURL(new Blob([''], { type: 'text/javascript' }));
        blobWorkers = !!u;
        URL.revokeObjectURL(u);
      }
    } catch (e) { /* ignore */ }
    const canCinematic = !fileLike && blobWorkers && (
      protocol === 'https:' || protocol === 'http:' || protocol === 'blob:' || protocol === 'capacitor:'
    );
    return { fileLike, blobWorkers, canCinematic, protocol };
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  /**
   * Inline boot script — classic JS, no imports. Duplicated into exported HTML.
   * Must stay ES5-friendly for older WebViews.
   */
  const BOOT_SCRIPT = [
    '(function(){',
    '"use strict";',
    'var R=window.__PLANAI_REPORT__;',
    'if(!R){document.body.innerHTML="<p style=\\"padding:16px\\">Report data missing.</p>";return;}',
    'var caps=(function(){var p=location.protocol||"";var fileLike=p==="file:"||p==="content:"||p==="capacitor-file:";var bw=false;try{if(URL&&URL.createObjectURL){var u=URL.createObjectURL(new Blob([""],{type:"text/javascript"}));bw=!!u;URL.revokeObjectURL(u);}}catch(e){}return{fileLike:fileLike,canCinematic:!fileLike&&bw&&(p==="https:"||p==="http:"||p==="blob:"||p==="capacitor:")};})();',
    'if(caps.canCinematic&&window.__PLANAI_CINEMATIC_JS__){try{var s=document.createElement("script");s.type="module";s.textContent=window.__PLANAI_CINEMATIC_JS__;document.body.appendChild(s);var root=document.getElementById("psr-app");if(root)root.style.display="none";return;}catch(e){console.warn("[PlanAI] cinematic upgrade failed",e);}}',
    'var B=R.bounds||R.geoBounds||{};',
    'var minLat=B.minLat,maxLat=B.maxLat,minLon=B.minLon,maxLon=B.maxLon;',
    'if(minLat==null||maxLat==null){minLat=41;maxLat=41.01;minLon=29;maxLon=29.01;}',
    'var pad=0.12,dLat=(maxLat-minLat)*pad||0.004,dLon=(maxLon-minLon)*pad||0.004;',
    'minLat-=dLat;maxLat+=dLat;minLon-=dLon;maxLon+=dLon;',
    'function proj(lat,lon){return{x:((lon-minLon)/(maxLon-minLon||1))*1000,y:((maxLat-lat)/(maxLat-minLat||1))*700};}',
    'var FEATS=[];',
    'var evs=R.events||[];',
    'for(var ei=0;ei<evs.length;ei++){var e=evs[ei];if(!e)continue;',
    'if(e.kind==="track"&&e.path&&e.path.length>=2){FEATS.push(e);continue;}',
    'if(e.kind==="note"||e.kind==="photo"||e.kind==="audio"){FEATS.push(e);}}',
    'if(!FEATS.some(function(f){return f.kind==="track";})&&R.track&&R.track.path&&R.track.path.length>=2){FEATS.unshift(R.track);}',
    'function esc(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}',
    'function fmtTs(ts){if(!ts)return"";try{var d=new Date(ts);if(isNaN(d))return String(ts);return d.toLocaleString(R.lang==="tr"?"tr-TR":"en-GB",{dateStyle:"short",timeStyle:"short"});}catch(x){return String(ts);}}',
    'var app=document.getElementById("psr-app");',
    'var head="<header class=\\"psr-head\\"><h1>"+esc(R.projectName||"PlanAI Field")+"</h1>";',
    'if(R.brandLogoUrl&&/^data:image\\//i.test(R.brandLogoUrl)){head+="<img class=\\"psr-logo\\" src=\\""+R.brandLogoUrl.replace(/"/g,"")+"\\" alt=\\"\\"/>";}',
    'head+="<div class=\\"psr-meta\\">"+esc(R.inspectorName||"")+(R.generatedAt?" · "+fmtTs(R.generatedAt):"")+"<span class=\\"psr-badge\\">Safe Replay</span></div></header>";',
    'var st=R.stats||{};',
    'var stats="<div class=\\"psr-stats\\">";',
    'if(st.routeKm!=null)stats+="<span class=\\"psr-stat\\">"+(R.lang==="tr"?"Rota":"Route")+": "+Number(st.routeKm).toFixed(2)+" km</span>";',
    'if(st.durationMin!=null)stats+="<span class=\\"psr-stat\\">"+(R.lang==="tr"?"Süre":"Duration")+": "+Math.round(st.durationMin)+" min</span>";',
    'if(st.photoCount!=null)stats+="<span class=\\"psr-stat\\">"+(R.lang==="tr"?"Foto":"Photos")+": "+st.photoCount+"</span>";',
    'if(st.noteCount!=null)stats+="<span class=\\"psr-stat\\">"+(R.lang==="tr"?"Not":"Notes")+": "+st.noteCount+"</span>";',
    'if(st.audioCount!=null&&st.audioCount>0)stats+="<span class=\\"psr-stat\\">"+(R.lang==="tr"?"Ses":"Voice")+": "+st.audioCount+"</span>";',
    'stats+="</div>";',
    'var svgMarks="";',
    'for(var i=0;i<FEATS.length;i++){var f=FEATS[i];',
    'if(f.kind==="track"&&f.path){var pts=f.path.map(function(p){var q=proj(p.lat,p.lon||p.lng);return q.x+","+q.y;}).join(" ");',
    'svgMarks+="<polyline data-idx=\\""+i+"\\" points=\\""+pts+"\\" fill=\\"none\\" stroke=\\"#fff\\" stroke-width=\\"5\\" opacity=\\".95\\" stroke-linecap=\\"round\\"/>";',
    'svgMarks+="<polyline data-idx=\\""+i+"\\" points=\\""+pts+"\\" fill=\\"none\\" stroke=\\"#1565c0\\" stroke-width=\\"3\\" opacity=\\".9\\" stroke-linecap=\\"round\\"/>";',
    '}else if(f.lat!=null){var q=proj(f.lat,f.lon||f.lng);var col=f.kind==="photo"||f.kind==="audio"?"#e67e22":"#1a73e8";',
    'if(f.hasVoice||f.kind==="audio")svgMarks+="<text x=\\""+q.x+"\\" y=\\""+(q.y-16)+"\\" text-anchor=\\"middle\\" font-size=\\"14\\">🎤</text>";',
    'svgMarks+="<circle data-idx=\\""+i+"\\" cx=\\""+q.x+"\\" cy=\\""+q.y+"\\" r=\\"12\\" fill=\\""+col+"\\" stroke=\\"#fff\\" stroke-width=\\"3\\"/>";}}',
    'var list="";',
    'for(var j=0;j<FEATS.length;j++){var g=FEATS[j];',
    'var replay=g.kind==="track"?"<span class=\\"psr-replay\\" data-replay=\\""+j+"\\">▶</span>":"";',
    'var voice=(g.hasVoice||g.kind==="audio")?" <span class=\\"psr-voice\\">🎤</span>":"";',
    'list+="<button type=\\"button\\" class=\\"psr-item\\" data-idx=\\""+j+"\\">"+replay+esc(g.label||g.kind)+voice+(g.ts?"<small>"+fmtTs(g.ts)+"</small>":"")+(g.text?"<small>"+esc(String(g.text).slice(0,100))+"</small>":"")+"</button>";}',
    'var basemap="";',
    'if(R.basemapUrl&&/^data:image\\//i.test(R.basemapUrl)){basemap="<img class=\\"psr-basemap\\" src=\\""+R.basemapUrl.replace(/"/g,"")+"\\" alt=\\"\\"/>";}',
    'else{basemap="<div class=\\"psr-fallback-note\\">"+(R.lang==="tr"?"Uydu görüntüsü gömülmedi — rota ve noktalar görünür.":"Satellite not embedded — route and points shown.")+"</div>";}',
    'app.innerHTML=head+stats+"<div class=\\"psr-layout\\"><aside class=\\"psr-side\\"><div class=\\"psr-detail\\" id=\\"psr-detail\\">"+(R.lang==="tr"?"Öğeye dokunun":"Tap an item")+"</div>"+list+"</aside><main class=\\"psr-map\\">"+basemap+"<svg viewBox=\\"0 0 1000 700\\" preserveAspectRatio=\\"xMidYMid meet\\">"+svgMarks+"</svg></main></div><div class=\\"psr-media\\" id=\\"psr-media\\"></div>";',
    'var DET=document.getElementById("psr-detail");',
    'var MEDIA=document.getElementById("psr-media");',
    'var SVG=document.querySelector(".psr-map svg");',
    'var replayRaf=null;',
    'function focusIdx(i){',
    'document.querySelectorAll(".psr-item").forEach(function(b){b.classList.toggle("active",+b.dataset.idx===i);});',
    'document.querySelectorAll("svg [data-idx]").forEach(function(el){el.classList.remove("psr-highlight");});',
    'var f=FEATS[i];if(!f)return;',
    'DET.textContent=(f.label||f.kind)+(f.text?" — "+f.text:"");',
    'document.querySelectorAll(\'svg [data-idx="\'+i+\'"]\').forEach(function(el){el.classList.add("psr-highlight");});',
    'MEDIA.innerHTML="";',
    'if(f.imageDataUrl&&/^data:image\\//i.test(f.imageDataUrl)){MEDIA.innerHTML="<img src=\\""+f.imageDataUrl.replace(/"/g,"")+"\\" alt=\\"\\"/>";}',
    'if(f.audioDataUrl&&/^data:audio\\//i.test(f.audioDataUrl)){var aud=document.createElement("audio");aud.controls=true;aud.src=f.audioDataUrl;aud.preload="metadata";MEDIA.appendChild(aud);}',
    'else if(f.hasVoice&&!f.audioDataUrl){MEDIA.innerHTML+="<p class=\\"psr-fallback-note\\">"+(R.lang==="tr"?"Ses kaydı bu dışa aktarımda yok.":"Voice not embedded in this export.")+"</p>";}',
    '}',
    'function stopReplay(){if(replayRaf)cancelAnimationFrame(replayRaf);replayRaf=null;var dot=document.getElementById("psr-replay-dot");if(dot)dot.style.display="none";document.querySelectorAll(".psr-replay-active").forEach(function(el){el.classList.remove("psr-replay-active");});document.querySelectorAll(".psr-replay-near").forEach(function(el){el.classList.remove("psr-replay-near");});}',
    'function pathTs(ts){if(!ts)return 0;var n=Date.parse(ts);return Number.isFinite(n)?n:0;}',
    'function lerpAlongPath(path,t){var pts=path.map(function(p){return proj(p.lat,p.lon||p.lng);});if(pts.length<2)return pts[0]||{x:500,y:350};var total=0,segs=[];for(var i=1;i<pts.length;i++){var d=Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y);segs.push(d);total+=d;}if(total<1)return pts[0];var target=total*t,acc=0;for(var k=0;k<segs.length;k++){if(acc+segs[k]>=target){var u=(target-acc)/segs[k];return{x:pts[k].x+u*(pts[k+1].x-pts[k].x),y:pts[k].y+u*(pts[k+1].y-pts[k].y)};}acc+=segs[k];}return pts[pts.length-1];}',
    'function syncReplayObs(pos){FEATS.forEach(function(f,j){if(f.kind==="track"||f.lat==null)return;var q=proj(f.lat,f.lon||f.lng);var near=Math.hypot(q.x-pos.x,q.y-pos.y)<42;var it=document.querySelector(\'.psr-item[data-idx="\'+j+\'"]\');if(it)it.classList.toggle("psr-replay-near",near);});}',
    'function startReplay(i){stopReplay();var f=FEATS[i];if(!f||!f.path||f.path.length<2)return;focusIdx(i);document.querySelectorAll(\'svg [data-idx="\'+i+\'"]\').forEach(function(el){el.classList.add("psr-replay-active");});var dot=document.getElementById("psr-replay-dot");if(!dot){dot=document.createElementNS("http://www.w3.org/2000/svg","circle");dot.id="psr-replay-dot";dot.setAttribute("r","11");dot.setAttribute("fill","#27ae60");dot.setAttribute("stroke","#fff");dot.setAttribute("stroke-width","3");SVG.appendChild(dot);}dot.style.display="block";var t0=pathTs(f.path[0].ts),t1=pathTs(f.path[f.path.length-1].ts);var dur=Math.max(4500,Math.min(90000,t1>t0?t1-t0:f.path.length*700));var tStart=performance.now();function step(now){var u=Math.min(1,(now-tStart)/dur);var p=lerpAlongPath(f.path,u);dot.setAttribute("cx",p.x);dot.setAttribute("cy",p.y);syncReplayObs(p);DET.textContent=(f.label||"Route")+" — "+Math.round(u*100)+"%";if(u<1)replayRaf=requestAnimationFrame(step);else replayRaf=null;}replayRaf=requestAnimationFrame(step);}',
    'document.querySelectorAll(".psr-item").forEach(function(b){b.onclick=function(){stopReplay();focusIdx(+b.dataset.idx);};});',
    'document.querySelectorAll("svg [data-idx]").forEach(function(el){el.onclick=function(){stopReplay();focusIdx(+el.dataset.idx);};});',
    'document.querySelectorAll(".psr-replay").forEach(function(b){b.onclick=function(e){e.stopPropagation();startReplay(+b.dataset.replay);};});',
    'var trackIdx=FEATS.findIndex(function(f){return f.kind==="track";});',
    'if(trackIdx>=0){setTimeout(function(){startReplay(trackIdx);},1200);}',
    '})();',
  ].join('');

  function sanitizeShell(html) {
    if (!html) return html;
    return html
      .replace(/<link[^>]*fonts\.googleapis[^>]*>/gi, '')
      .replace(/<link[^>]*rel=["']preconnect["'][^>]*fonts\.googleapis[^>]*>/gi, '')
      .replace(/<script type=["']module["'][^>]*>[\s\S]*?<\/script>/gi, '');
  }

  /**
   * @param {object} prepared — replay payload
   * @param {string} safePayload — JSON string safe for HTML embedding
   * @param {{ cinematicJs?: string }} [opts]
   */
  function buildSafeReplayHtml(prepared, safePayload, opts) {
    const lang = prepared.lang || 'en';
    const title = escapeAttr((prepared.projectName || 'PlanAI Field') + ' — Inspection Replay');
    const cinematicJs = opts?.cinematicJs || '';
    let extra = '';
    if (cinematicJs) {
      extra = '<script>window.__PLANAI_CINEMATIC_JS__=' + JSON.stringify(cinematicJs) + ';<\/script>';
    }
    return '<!DOCTYPE html><html lang="' + lang + '"><head><meta charset="UTF-8"/>' +
      '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>' +
      '<meta name="color-scheme" content="dark light"/>' +
      '<title>' + title + '</title>' +
      '<style>' + SAFE_CSS + '</style></head><body>' +
      '<div id="psr-app"></div>' +
      '<script>window.__PLANAI_REPORT__=' + safePayload + ';window.__PLANAI_REPLAY_MODE__="safe";<\/script>' +
      extra +
      '<script>' + BOOT_SCRIPT + '<\/script>' +
      '</body></html>';
  }

  global.FieldSafeReplay = {
    detectReplayCapabilities,
    buildSafeReplayHtml,
    sanitizeShell,
    BOOT_SCRIPT,
  };
})(typeof window !== 'undefined' ? window : globalThis);
