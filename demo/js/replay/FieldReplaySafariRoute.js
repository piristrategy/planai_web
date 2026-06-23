/**
 * Safari / iOS cinematic replay — ensure GPS route line renders (MapLibre line-blur workaround).
 */
(function (global) {
  'use strict';

  const BOOT = [
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
    'var ua=navigator.userAgent||"";',
    'var isIOS=/iPad|iPhone|iPod/.test(ua)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);',
    'var isSafari=isIOS||/^((?!chrome|android).)*safari/i.test(ua);',
    'if(!isSafari)return;',
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
    'paint:{"line-color":"#4dd0e1","line-width":10,"line-opacity":0.38}});',
    '}',
    'if(!map.getLayer("planai-route-safari-line")){',
    'map.addLayer({id:"planai-route-safari-line",type:"line",source:"planai-route-safari",',
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
    'var n=0;var iv=setInterval(function(){n++;tick();if(n>50)clearInterval(iv);},400);',
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",tick);',
    'else tick();',
    '})();',
  ].join('');

  function inject(html) {
    if (!html || typeof html !== 'string') return html;
    if (!html.includes('window.__PLANAI_REPORT__')) return html;
    if (html.includes('id="planai-safari-route-fix"')) return html;
    const tag = '<script id="planai-safari-route-fix">' + BOOT + '<\/script>';
    const modIdx = html.search(/<script[^>]*type=["']module["']/i);
    if (modIdx >= 0) return html.slice(0, modIdx) + tag + html.slice(modIdx);
    if (html.includes('</body>')) return html.replace('</body>', tag + '</body>');
    return html + tag;
  }

  global.FieldReplaySafariRoute = { inject, BOOT };
})(typeof window !== 'undefined' ? window : globalThis);
