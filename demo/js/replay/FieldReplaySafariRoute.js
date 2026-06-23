/**
 * Cinematic replay HTML fixes — route line on mobile WebViews + centered playback controls.
 */
(function (global) {
  'use strict';

  const ROUTE_BOOT = [
    '(function(){',
    '"use strict";',
    'var R=window.__PLANAI_REPORT__;',
    'if(!R)return;',
    'function normLon(p){return p&&(p.lon!=null?p.lon:p.lng);}',
    'function normPath(path){',
    'return(path||[]).map(function(p){return{lat:p.lat,lon:normLon(p),ts:p.ts||""};})',
    '.filter(function(p){return Number.isFinite(p.lat)&&Number.isFinite(p.lon);});',
    '}',
    'if(R.track&&R.track.path)R.track.path=normPath(R.track.path);',
    '(R.events||[]).forEach(function(e){if(e&&e.kind==="track"&&e.path)e.path=normPath(e.path);});',
    'function trackFeat(){',
    'if(R.track&&R.track.path&&R.track.path.length>=2)return R.track;',
    'var evs=R.events||[];',
    'for(var i=0;i<evs.length;i++){if(evs[i]&&evs[i].kind==="track"&&evs[i].path&&evs[i].path.length>=2)return evs[i];}',
    'return null;',
    '}',
    'function findMap(){',
    'var nodes=document.querySelectorAll(".maplibregl-map");',
    'for(var i=0;i<nodes.length;i++){',
    'var el=nodes[i];',
    'for(var k in el){',
    'if(!Object.prototype.hasOwnProperty.call(el,k))continue;',
    'var v=el[k];',
    'if(v&&typeof v.getSource==="function"&&typeof v.addLayer==="function")return v;',
    '}',
    '}',
    'return null;',
    '}',
    'function coords(track){',
    'return track.path.map(function(p){return[p.lon,p.lat];});',
    '}',
    'function ensureRoute(map){',
    'var track=trackFeat();',
    'if(!track)return;',
    'var c=coords(track);',
    'if(c.length<2)return;',
    'var feat={type:"Feature",properties:{},geometry:{type:"LineString",coordinates:c}};',
    'try{',
    'var src=map.getSource("planai-route-safari");',
    'if(src){src.setData(feat);return;}',
    'map.addSource("planai-route-safari",{type:"geojson",data:feat});',
    'if(!map.getLayer("planai-route-safari-glow")){',
    'map.addLayer({id:"planai-route-safari-glow",type:"line",source:"planai-route-safari",',
    'layout:{"line-cap":"round","line-join":"round"},',
    'paint:{"line-color":"#ffffff","line-width":8,"line-opacity":0.55}});',
    '}',
    'if(!map.getLayer("planai-route-safari-line")){',
    'map.addLayer({id:"planai-route-safari-line",type:"line",source:"planai-route-safari",',
    'layout:{"line-cap":"round","line-join":"round"},',
    'paint:{"line-color":"#27ae60","line-width":5,"line-opacity":1}});',
    '}',
    '}catch(e){}',
    '}',
    'function tick(){',
    'var map=findMap();',
    'if(!map)return;',
    'if(typeof map.isStyleLoaded==="function"&&!map.isStyleLoaded()){',
    'map.once("load",function(){ensureRoute(map);});',
    'map.once("styledata",function(){ensureRoute(map);});',
    '}else{ensureRoute(map);}',
    '}',
    'var n=0;var iv=setInterval(function(){n++;tick();if(n>60)clearInterval(iv);},400);',
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",tick);',
    'else tick();',
    '})();',
  ].join('');

  const CONTROLS_BOOT = [
    '(function(){',
    '"use strict";',
    'function centerBar(el){',
    'if(!el||el.getAttribute("data-planai-centered"))return;',
    'var w="min(560px, calc(100vw - 2rem))";',
    'el.style.setProperty("left","50%","important");',
    'el.style.setProperty("right","auto","important");',
    'el.style.setProperty("transform","none","important");',
    'el.style.setProperty("margin-left","calc(-1 * min(280px, 50vw - 1rem))","important");',
    'el.style.setProperty("width",w,"important");',
    'el.style.setProperty("max-width",w,"important");',
    'el.setAttribute("data-planai-centered","1");',
    '}',
    'function center(){',
    'var root=document.getElementById("root");',
    'if(!root)return;',
    'var seen=new Set();',
    'function tryCenter(el){if(!el||seen.has(el))return;seen.add(el);centerBar(el);}',
    'root.querySelectorAll("input[type=range]").forEach(function(inp){',
    'var el=inp.parentElement;',
    'while(el&&el!==document.body){',
    'var st=window.getComputedStyle(el);',
    'if(st.position==="fixed"&&parseFloat(st.bottom||0)>=0&&parseFloat(st.bottom||0)<200){tryCenter(el);break;}',
    'el=el.parentElement;',
    '}',
    '});',
    'root.querySelectorAll("*").forEach(function(el){',
    'if(el.querySelectorAll("button").length<3)return;',
    'var st=window.getComputedStyle(el);',
    'if(st.position!=="fixed")return;',
    'var b=parseFloat(st.bottom);',
    'if(!(b>=0&&b<140))return;',
    'var txt=(el.textContent||"").toLowerCase();',
    'if(txt.indexOf("duraklat")>=0||txt.indexOf("oynat")>=0||txt.indexOf("pause")>=0||txt.indexOf("play")>=0)tryCenter(el);',
    '});',
    '}',
    'var n=0;var iv=setInterval(function(){center();n++;if(n>80)clearInterval(iv);},400);',
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",center);',
    'else center();',
    'try{new MutationObserver(function(){center();}).observe(document.getElementById("root")||document.body,{childList:true,subtree:true});}catch(e){}',
    '})();',
  ].join('');

  const REPLAY_UI_CSS = [
    '#planai-replay-ui-fix input[type=range]{width:100%;}',
    '#root [data-planai-centered]{left:50%!important;right:auto!important;',
    'transform:none!important;margin-left:calc(-1 * min(280px, 50vw - 1rem))!important;',
    'width:min(560px, calc(100vw - 2rem))!important;max-width:min(560px, calc(100vw - 2rem))!important;}',
    '@media(max-width:1200px){',
    '#root [data-planai-centered]{left:50%!important;right:auto!important;',
    'transform:none!important;margin-left:calc(-1 * min(280px, 50vw - 1rem))!important;}',
    '}',
  ].join('');

  function inject(html) {
    if (!html || typeof html !== 'string') return html;
    if (!html.includes('window.__PLANAI_REPORT__')) return html;
    let out = html;
    if (!out.includes('id="planai-replay-ui-fix"')) {
      const style = '<style id="planai-replay-ui-fix">' + REPLAY_UI_CSS + '</style>';
      if (out.includes('</head>')) out = out.replace('</head>', style + '</head>');
      else out = style + out;
    }
    if (!out.includes('id="planai-safari-route-fix"')) {
      const routeTag = '<script id="planai-safari-route-fix">' + ROUTE_BOOT + '<\/script>';
      const modIdx = out.search(/<script[^>]*type=["']module["']/i);
      if (modIdx >= 0) out = out.slice(0, modIdx) + routeTag + out.slice(modIdx);
      else if (out.includes('</body>')) out = out.replace('</body>', routeTag + '</body>');
      else out += routeTag;
    }
    if (!out.includes('id="planai-replay-controls-fix"')) {
      const ctrlTag = '<script id="planai-replay-controls-fix">' + CONTROLS_BOOT + '<\/script>';
      if (out.includes('</body>')) out = out.replace('</body>', ctrlTag + '</body>');
      else out += ctrlTag;
    }
    return out;
  }

  global.FieldReplaySafariRoute = { inject, ROUTE_BOOT, CONTROLS_BOOT };
})(typeof window !== 'undefined' ? window : globalThis);
