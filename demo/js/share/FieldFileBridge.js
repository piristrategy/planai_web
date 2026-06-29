/**
 * PlanAI Field — dosya paylaşım ve içe aktarma köprüsü.
 * Web Share API, Capacitor Share / PlanAIShare ve sistem dosya seçicisi.
 */
(function (global) {
  'use strict';

  const SHARE_TARGETS = {
    any: { id: 'any', android: null, ios: null, dialogTr: 'Gönder', dialogEn: 'Share' },
    whatsapp: { id: 'whatsapp', android: 'com.whatsapp', ios: 'whatsapp://', dialogTr: 'WhatsApp', dialogEn: 'WhatsApp' },
    mail: { id: 'mail', android: null, ios: 'mailto:', mimeHint: 'message/rfc822', dialogTr: 'E-posta', dialogEn: 'Email' },
    drive: { id: 'drive', android: 'com.google.android.apps.docs', ios: 'googledrive://', dialogTr: 'Google Drive', dialogEn: 'Google Drive' },
    onedrive: { id: 'onedrive', android: 'com.microsoft.skydrive', ios: 'ms-onedrive://', dialogTr: 'OneDrive', dialogEn: 'OneDrive' },
    dropbox: { id: 'dropbox', android: 'com.dropbox.android', ios: 'dbapi-8-emm://', dialogTr: 'Dropbox', dialogEn: 'Dropbox' },
  };

  const IMPORT_ACCEPT =
    '.kml,.kmz,.geojson,.json,.dxf,.gml,.xml,.shp,.dbf,.shx,.prj,.zip,.planai.zip,' +
    '.html,.htm,.pdf,.tif,.tiff,.geotiff,.png,.jpg,.jpeg,.webp,' +
    'application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz,' +
    'application/json,application/geo+json,application/xml,text/xml,text/html,text/plain,' +
    'application/pdf,application/zip,application/x-esri-shape,image/tiff,image/png,image/jpeg,image/webp';

  function isCapacitorNative() {
    const cap = global.Capacitor;
    return !!(cap?.isNativePlatform?.() || cap?.getPlatform?.() === 'android' || cap?.getPlatform?.() === 'ios');
  }

  function lang() {
    return global.PA_LANG === 'en' ? 'en' : 'tr';
  }

  function tTarget(target) {
    const rec = SHARE_TARGETS[target] || SHARE_TARGETS.any;
    return lang() === 'en' ? rec.dialogEn : rec.dialogTr;
  }

  function guessMimeFromName(name) {
    const ext = (String(name || '').split('.').pop() || '').toLowerCase();
    const map = {
      kml: 'application/vnd.google-earth.kml+xml',
      kmz: 'application/vnd.google-earth.kmz',
      geojson: 'application/geo+json',
      json: 'application/json',
      xml: 'application/xml',
      gml: 'application/xml',
      zip: 'application/zip',
      html: 'text/html',
      htm: 'text/html',
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      tif: 'image/tiff',
      tiff: 'image/tiff',
    };
    return map[ext] || 'application/octet-stream';
  }

  function blobToBase64Data(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const s = fr.result;
        resolve(typeof s === 'string' && s.includes(',') ? s.split(',')[1] : s);
      };
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  async function writeBlobToCache(blob, filename) {
    const cap = global.Capacitor;
    const Fs = cap?.Plugins?.Filesystem;
    if (!Fs?.writeFile || !Fs?.getUri) throw new Error('Filesystem');
    const safe = String(filename || 'export.bin').replace(/[^\w.\-]+/g, '_');
    const rel = 'planai-share/' + Date.now() + '_' + safe;
    const b64 = await blobToBase64Data(blob);
    await Fs.writeFile({ path: rel, data: b64, directory: 'CACHE' });
    const uriRes = await Fs.getUri({ path: rel, directory: 'CACHE' });
    return { rel, uri: uriRes.uri };
  }

  function getPlanAISharePlugin() {
    const cap = global.Capacitor;
    if (!cap) return null;
    if (cap.Plugins?.PlanAIShare) return cap.Plugins.PlanAIShare;
    try { return cap.registerPlugin?.('PlanAIShare'); } catch (_) { return null; }
  }

  async function shareNativeCached(cached, mimeType, dialogTitle, target) {
    const rec = SHARE_TARGETS[target] || SHARE_TARGETS.any;
    const PlanAIShare = getPlanAISharePlugin();
    if (PlanAIShare?.shareCachedFile) {
      await PlanAIShare.shareCachedFile({
        path: cached.rel,
        mimeType: mimeType || 'application/octet-stream',
        dialogTitle: dialogTitle || tTarget(target),
        packageName: rec.android || undefined,
        target: rec.id,
      });
      return true;
    }
    const Share = global.Capacitor?.Plugins?.Share;
    if (Share?.share && cached.uri) {
      await Share.share({
        title: dialogTitle || tTarget(target),
        dialogTitle: dialogTitle || tTarget(target),
        files: [cached.uri],
      });
      return true;
    }
    return false;
  }

  async function shareViaWebShare(blob, filename, mimeType, title, target) {
    const file = new File([blob], filename || 'export', { type: mimeType || guessMimeFromName(filename) });
    if (navigator.share) {
      const payload = { title: title || filename, files: [file] };
      if (!navigator.canShare || navigator.canShare(payload)) {
        await navigator.share(payload);
        return true;
      }
      if (!navigator.canShare || navigator.canShare({ title: title || filename })) {
        await navigator.share({ title: title || filename, text: filename });
        return true;
      }
    }
    if (target === 'mail') {
      const subj = encodeURIComponent(title || filename || 'PlanAI Field');
      const body = encodeURIComponent(
        lang() === 'en'
          ? 'PlanAI Field export attached separately — use Share if your browser supports file attachments.'
          : 'PlanAI Field dışa aktarımı — tarayıcı dosya eklemeyi desteklemiyorsa önce indirin.'
      );
      global.location.href = 'mailto:?subject=' + subj + '&body=' + body;
      return true;
    }
    if (target === 'whatsapp') {
      const text = encodeURIComponent(title || filename || 'PlanAI Field');
      const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
      const url = mobile ? 'whatsapp://send?text=' + text : 'https://web.whatsapp.com/send?text=' + text;
      try {
        if (mobile) global.location.href = url;
        else global.open(url, '_blank', 'noopener');
      } catch (_) {
        global.open(url, '_blank', 'noopener');
      }
      return true;
    }
    return false;
  }

  function isUserCancel(err) {
    const msg = String(err?.message || err || '');
    return /abort|cancel|dismiss|closed|user denied/i.test(msg);
  }

  /**
   * @param {{ blob: Blob, filename?: string, mimeType?: string, title?: string, target?: string }} opts
   * @returns {Promise<boolean>}
   */
  async function shareFile(opts) {
    const blob = opts?.blob;
    if (!blob) return false;
    const filename = opts.filename || 'export.bin';
    const mimeType = opts.mimeType || guessMimeFromName(filename);
    const target = opts.target || 'any';
    const title = opts.title || filename;
    const dialogTitle = tTarget(target);

    if (isCapacitorNative()) {
      try {
        const cached = await writeBlobToCache(blob, filename);
        const ok = await shareNativeCached(cached, mimeType, dialogTitle, target);
        if (ok) return true;
      } catch (e) {
        if (isUserCancel(e)) return true;
        console.warn('[FieldFileBridge native]', e);
      }
    }

    try {
      const ok = await shareViaWebShare(blob, filename, mimeType, title, target);
      if (ok) return true;
    } catch (e) {
      if (isUserCancel(e)) return true;
      console.warn('[FieldFileBridge web]', e);
    }
    return false;
  }

  /**
   * @param {{ cloud?: boolean, multiple?: boolean }} opts
   * @returns {Promise<File[]|null>}
   */
  async function pickImportFiles(opts) {
    const multiple = opts?.multiple !== false;

    if (global.showOpenFilePicker && !isCapacitorNative()) {
      try {
        const handles = await global.showOpenFilePicker({
          multiple,
          types: [{
            description: 'PlanAI Field',
            accept: {
              'application/octet-stream': ['.kml', '.kmz', '.geojson', '.json', '.dxf', '.gml', '.xml', '.zip', '.planai.zip', '.shp'],
              'text/html': ['.html', '.htm'],
              'application/pdf': ['.pdf'],
              'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.geotiff'],
            },
          }],
        });
        const files = [];
        for (const h of handles) files.push(await h.getFile());
        return files.length ? files : null;
      } catch (e) {
        if (isUserCancel(e)) return null;
      }
    }

    return new Promise((resolve) => {
      let inp = document.getElementById('field-import-bridge-input');
      if (!inp) {
        inp = document.createElement('input');
        inp.type = 'file';
        inp.id = 'field-import-bridge-input';
        inp.className = 'field-photo-file-input';
        document.body.appendChild(inp);
      }
      inp.setAttribute('accept', IMPORT_ACCEPT);
      if (multiple) inp.setAttribute('multiple', '');
      else inp.removeAttribute('multiple');
      inp.value = '';
      const onChange = (e) => {
        inp.removeEventListener('change', onChange);
        const list = e.target.files;
        resolve(list?.length ? Array.from(list) : null);
        inp.value = '';
      };
      inp.addEventListener('change', onChange);
      if (typeof inp.showPicker === 'function') {
        try { inp.showPicker(); return; } catch (_) {}
      }
      inp.click();
    });
  }

  global.FieldFileBridge = {
    SHARE_TARGETS,
    IMPORT_ACCEPT,
    shareFile,
    pickImportFiles,
    guessMimeFromName,
    writeBlobToCache,
    tTarget,
    isCapacitorNative,
  };
})(typeof window !== 'undefined' ? window : globalThis);
