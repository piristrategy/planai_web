/**
 * PlanAI Field — true panorama stitcher (ORB + homography + RANSAC + warp + feather blend).
 */
(function (global) {
  'use strict';

  const MATCH_MAX_W = 720;
  const MIN_GOOD_MATCHES = 12;
  const RANSAC_REPROJ = 4.0;
  const MIN_INLIER_RATIO = 0.35;

  function canvasToMat(cv, canvas) {
    const mat = cv.imread(canvas);
    const rgba = new cv.Mat();
    if (mat.channels() === 4) {
      mat.copyTo(rgba);
    } else {
      cv.cvtColor(mat, rgba, cv.COLOR_RGB2RGBA);
    }
    mat.delete();
    return rgba;
  }

  function matToCanvas(cv, mat) {
    const out = document.createElement('canvas');
    cv.imshow(out, mat);
    return out;
  }

  function createDetector(cv) {
    if (typeof cv.AKAZE_create === 'function') {
      return { detector: cv.AKAZE_create(), norm: cv.NORM_L2 };
    }
    return { detector: new cv.ORB(1800), norm: cv.NORM_HAMMING };
  }

  function detectAndMatch(cv, imgA, imgB, detector, norm) {
    const grayA = new cv.Mat();
    const grayB = new cv.Mat();
    cv.cvtColor(imgA, grayA, cv.COLOR_RGBA2GRAY);
    cv.cvtColor(imgB, grayB, cv.COLOR_RGBA2GRAY);

    const kpA = new cv.KeyPointVector();
    const kpB = new cv.KeyPointVector();
    const desA = new cv.Mat();
    const desB = new cv.Mat();
    const mask = new cv.Mat();
    detector.detectAndCompute(grayA, mask, kpA, desA);
    detector.detectAndCompute(grayB, mask, kpB, desB);

    if (desA.empty() || desB.empty() || kpA.size() < 8 || kpB.size() < 8) {
      grayA.delete(); grayB.delete(); kpA.delete(); kpB.delete();
      desA.delete(); desB.delete(); mask.delete();
      return null;
    }

    const bf = new cv.BFMatcher(norm, true);
    const matches = new cv.DMatchVector();
    bf.match(desA, desB, matches);

    const good = [];
    for (let i = 0; i < matches.size(); i++) {
      const m = matches.get(i);
      if (m.distance < 64) good.push(m);
    }
    good.sort((a, b) => a.distance - b.distance);
    const capped = good.slice(0, 120);

    if (capped.length < MIN_GOOD_MATCHES) {
      grayA.delete(); grayB.delete(); kpA.delete(); kpB.delete();
      desA.delete(); desB.delete(); mask.delete(); matches.delete(); bf.delete();
      return null;
    }

    const srcPts = [];
    const dstPts = [];
    for (let i = 0; i < capped.length; i++) {
      const m = capped[i];
      const pB = kpB.get(m.trainIdx).pt;
      const pA = kpA.get(m.queryIdx).pt;
      srcPts.push(pB.x, pB.y);
      dstPts.push(pA.x, pA.y);
    }

    const src = cv.matFromArray(capped.length, 1, cv.CV_32FC2, srcPts);
    const dst = cv.matFromArray(capped.length, 1, cv.CV_32FC2, dstPts);
    const inlierMask = new cv.Mat();
    const H = cv.findHomography(src, dst, cv.RANSAC, RANSAC_REPROJ, inlierMask);

    let inliers = 0;
    for (let i = 0; i < inlierMask.rows; i++) {
      if (inlierMask.data[i]) inliers++;
    }
    const ratio = inliers / capped.length;

    grayA.delete(); grayB.delete(); kpA.delete(); kpB.delete();
    desA.delete(); desB.delete(); mask.delete(); matches.delete(); bf.delete();
    src.delete(); dst.delete(); inlierMask.delete();

    if (H.empty() || ratio < MIN_INLIER_RATIO) {
      H.delete();
      return null;
    }
    return { H, inlierRatio: ratio, matches: capped.length };
  }

  function resizeMat(cv, mat, maxW) {
    if (mat.cols <= maxW) return { mat: mat.clone(), scale: 1 };
    const scale = maxW / mat.cols;
    const out = new cv.Mat();
    const dsize = new cv.Size(Math.round(mat.cols * scale), Math.round(mat.rows * scale));
    cv.resize(mat, out, dsize, 0, 0, cv.INTER_AREA);
    return { mat: out, scale };
  }

  function multiplyHomography(cv, A, B) {
    const out = new cv.Mat();
    cv.gemm(A, B, 1, new cv.Mat(), 0, out);
    return out;
  }

  function warpCorners(cv, w, h, H) {
    const pts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0, w, 0, w, h, 0, h,
    ]);
    const warped = new cv.Mat();
    cv.perspectiveTransform(pts, warped, H);
    const out = [];
    for (let i = 0; i < 4; i++) {
      const p = warped.data32F;
      out.push({ x: p[i * 2], y: p[i * 2 + 1] });
    }
    pts.delete();
    warped.delete();
    return out;
  }

  function boundsFromCorners(allCorners) {
    let minX = Infinity; let minY = Infinity;
    let maxX = -Infinity; let maxY = -Infinity;
    allCorners.forEach((corners) => {
      corners.forEach((p) => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      });
    });
    return {
      minX: Math.floor(minX),
      minY: Math.floor(minY),
      maxX: Math.ceil(maxX),
      maxY: Math.ceil(maxY),
    };
  }

  function translateHomography(cv, H, tx, ty) {
    const T = cv.Mat.eye(3, 3, cv.CV_64F);
    T.data64F[2] = tx;
    T.data64F[5] = ty;
    const out = multiplyHomography(cv, T, H);
    T.delete();
    return out;
  }

  function featherBlendPanorama(cv, warpedMats) {
    const w = warpedMats[0].canvas.cols;
    const h = warpedMats[0].canvas.rows;
    const acc = new cv.Mat.zeros(h, w, cv.CV_32FC4);
    const weight = new cv.Mat.zeros(h, w, cv.CV_32FC1);

    warpedMats.forEach((item) => {
      const mat = item.canvas;
      const x0 = item.offsetX;
      const y0 = item.offsetY;
      const roiW = mat.cols;
      const roiH = mat.rows;
      const mask = new cv.Mat.zeros(roiH, roiW, cv.CV_32FC1);
      for (let y = 0; y < roiH; y++) {
        for (let x = 0; x < roiW; x++) {
          const px = mat.ucharPtr(y, x);
          if (px[3] < 8) continue;
          const wx = Math.min(x / Math.max(1, roiW - 1), (roiW - 1 - x) / Math.max(1, roiW - 1));
          const wy = Math.min(y / Math.max(1, roiH - 1), (roiH - 1 - y) / Math.max(1, roiH - 1));
          mask.floatPtr(y, x)[0] = Math.max(0.05, Math.min(wx, wy));
        }
      }
      const matF = new cv.Mat();
      mat.convertTo(matF, cv.CV_32FC4, 1 / 255);
      const accRoi = acc.roi(new cv.Rect(x0, y0, roiW, roiH));
      const wRoi = weight.roi(new cv.Rect(x0, y0, roiW, roiH));
      for (let y = 0; y < roiH; y++) {
        for (let x = 0; x < roiW; x++) {
          const a = matF.floatPtr(y, x);
          const m = mask.floatPtr(y, x)[0];
          if (m <= 0) continue;
          const ar = accRoi.floatPtr(y, x);
          ar[0] += a[0] * m;
          ar[1] += a[1] * m;
          ar[2] += a[2] * m;
          ar[3] += a[3] * m;
          wRoi.floatPtr(y, x)[0] += m;
        }
      }
      matF.delete(); mask.delete();
      accRoi.delete(); wRoi.delete();
    });

    const out8 = new cv.Mat.zeros(h, w, cv.CV_8UC4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const wt = weight.floatPtr(y, x)[0];
        const dst = out8.ucharPtr(y, x);
        if (wt < 1e-4) continue;
        const src = acc.floatPtr(y, x);
        dst[0] = Math.min(255, Math.round((src[0] / wt) * 255));
        dst[1] = Math.min(255, Math.round((src[1] / wt) * 255));
        dst[2] = Math.min(255, Math.round((src[2] / wt) * 255));
        dst[3] = 255;
      }
    }
    acc.delete(); weight.delete();
    return out8;
  }

  function cropBlackBorders(cv, mat) {
    const gray = new cv.Mat();
    cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
    const thresh = new cv.Mat();
    cv.threshold(gray, thresh, 8, 255, cv.THRESH_BINARY);
    const rect = cv.boundingRect(thresh);
    gray.delete(); thresh.delete();
    if (rect.width < 8 || rect.height < 8) return mat.clone();
    const roi = mat.roi(rect);
    const cloned = roi.clone();
    roi.delete();
    return cloned;
  }

  async function stitch(canvases, onProgress) {
    if (!canvases || canvases.length < 2) return null;
    const cv = await global.PanoOpenCvLoader.ensure();
    const detPack = createDetector(cv);
    const mats = canvases.map((c) => canvasToMat(cv, c));

    const pairHs = [null];
    let failed = false;
    for (let i = 1; i < mats.length; i++) {
      onProgress?.(Math.round((i / mats.length) * 40), null);
      await new Promise((r) => setTimeout(r, 0));
      const a = resizeMat(cv, mats[i - 1], MATCH_MAX_W);
      const b = resizeMat(cv, mats[i], MATCH_MAX_W);
      const match = detectAndMatch(cv, a.mat, b.mat, detPack.detector, detPack.norm);
      a.mat.delete(); b.mat.delete();
      if (!match) {
        failed = true;
        break;
      }
      const S_A_inv = cv.matFromArray(3, 3, cv.CV_64F, [
        1 / a.scale, 0, 0,
        0, 1 / a.scale, 0,
        0, 0, 1,
      ]);
      const S_B = cv.matFromArray(3, 3, cv.CV_64F, [
        b.scale, 0, 0,
        0, b.scale, 0,
        0, 0, 1,
      ]);
      const Hscaled = multiplyHomography(cv, multiplyHomography(cv, S_A_inv, match.H), S_B);
      S_A_inv.delete(); S_B.delete(); match.H.delete();
      pairHs.push(Hscaled);
    }

    if (failed || pairHs.length < 2) {
      mats.forEach((m) => m.delete());
      if (typeof detPack.detector.delete === 'function') detPack.detector.delete();
      return null;
    }

    const globalHs = [cv.Mat.eye(3, 3, cv.CV_64F)];
    for (let i = 1; i < pairHs.length; i++) {
      globalHs.push(multiplyHomography(cv, globalHs[i - 1], pairHs[i]));
    }

    const allCorners = [];
    for (let i = 0; i < mats.length; i++) {
      allCorners.push(warpCorners(cv, mats[i].cols, mats[i].rows, globalHs[i]));
    }
    const bounds = boundsFromCorners(allCorners);
    const panoW = Math.max(1, bounds.maxX - bounds.minX);
    const panoH = Math.max(1, bounds.maxY - bounds.minY);
    const tx = -bounds.minX;
    const ty = -bounds.minY;

    const warped = [];
    for (let i = 0; i < mats.length; i++) {
      onProgress?.(40 + Math.round((i / mats.length) * 45), null);
      await new Promise((r) => setTimeout(r, 0));
      const Ht = translateHomography(cv, globalHs[i], tx, ty);
      const dst = new cv.Mat.zeros(panoH, panoW, cv.CV_8UC4);
      cv.warpPerspective(mats[i], dst, Ht, new cv.Size(panoW, panoH), cv.INTER_LINEAR, cv.BORDER_CONSTANT, [0, 0, 0, 0]);
      Ht.delete();
      warped.push({ canvas: dst, offsetX: 0, offsetY: 0 });
      const preview = matToCanvas(cv, dst);
      onProgress?.(40 + Math.round((i / mats.length) * 45), preview);
    }

    onProgress?.(88, null);
    await new Promise((r) => setTimeout(r, 0));
    const blended = featherBlendPanorama(cv, warped);
    warped.forEach((w) => w.canvas.delete());
    const cropped = cropBlackBorders(cv, blended);
    blended.delete();

    onProgress?.(96, matToCanvas(cv, cropped));
    const result = matToCanvas(cv, cropped);
    cropped.delete();

    mats.forEach((m) => m.delete());
    globalHs.forEach((h) => h.delete());
    pairHs.forEach((h) => { if (h) h.delete(); });
    if (typeof detPack.detector.delete === 'function') detPack.detector.delete();

    onProgress?.(100, result);
    return result;
  }

  global.PanoStitcher = { stitch };
})(window);
