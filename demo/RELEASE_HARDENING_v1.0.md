# PlanAI Field v1.0 — Release Hardening Report

**Date:** 2026-06-17  
**Scope:** `D:\planai\field` (canonical web) + mobile shell scripts  
**PIN/Biometric:** Unchanged (SEC-02, SEC-03 deferred per instruction)

---

## 1. Integrity Manifest (SEC-01)

| Check | Result |
|-------|--------|
| `node scripts/generate-integrity-manifest.js` | **PASS** |
| `node scripts/verify-integrity-manifest.js` | **PASS** |
| Manifest version | `1.0.0` |
| Modules hashed | 6 (app.js, SpatialSecurity, DeviceSecurity, SecurityOrchestrator, ImportSandbox, SpatialLimitsCore) |
| RuntimeIntegrity fail on production | **FIXED** — hashes match |

---

## 2. ZIP Bomb Protection

| Entry point | MAX_ZIP_ENTRIES (1000) | MAX_UNCOMPRESSED (500MB) | Path traversal |
|-------------|------------------------|--------------------------|----------------|
| KMZ | **FIXED** | **FIXED** | **FIXED** |
| Shapefile ZIP | **FIXED** | **FIXED** | **FIXED** |
| Generic ZIP (importFieldFile) | **FIXED** | **FIXED** | **FIXED** |
| Project ZIP | **FIXED** | **FIXED** | **FIXED** |

Implementation: `SpatialSecurity.assertZipArchive()`, `loadZipFromFile()`  
User message on limit: `Dataset exceeds safe import limits.`

---

## 3. Import File Security (`assertImportFile`)

| Path | Status |
|------|--------|
| GeoJSON/KML/GML/KMZ | **FIXED** (existing + ZIP wrapper) |
| GeoTIFF | **FIXED** |
| Project ZIP | **FIXED** |
| Shapefile ZIP | **FIXED** |

---

## 4. GML / PlanGML Sanitization

| Area | Status |
|------|--------|
| `planGmlMergeAttributes` → `sanitizeProperties` | **FIXED** |
| CityGML/GML meta.attributes | **FIXED** |
| ContentSanitizer SCRIPTISH patterns | **FIXED** (existing) |

---

## 5. CRS Whitelist

| Rule | Status |
|------|--------|
| EPSG:4326, EPSG:3857 | **FIXED** |
| TUREF (793x, 525x, TUREF string) | **FIXED** |
| GeoTIFF EPSG assert | **FIXED** |
| GML document + per-feature SRS | **FIXED** |
| Reject message | `Unsupported coordinate reference system.` |

---

## 6. Debug Cleanup (Production)

| Item | Status |
|------|--------|
| `?debug=1` GPS debug | **FIXED** — blocked when `walk-production` |
| `localStorage planai_gps_debug` | **FIXED** |
| `window.enableSecureMode` | **FIXED** — not exposed in production |
| `window.isCompromisedDevice` | **FIXED** |
| `window.getSecurityRiskLevel` | **FIXED** |

---

## 7. Code Obfuscation (Android R8/ProGuard)

| Item | Status |
|------|--------|
| `scripts/android/proguard-rules.pro` | **FIXED** (template added) |
| `release-buildtype.gradle.snippet` | **FIXED** (template added) |
| Mobile shell `build.gradle` verified | **NOT FIXED** — shell source absent on disk |
| R8 enabled in actual build | **NOT FIXED** — requires mobile shell restore |

---

## 8. Release APK / AAB (SEC-12)

| Item | Status |
|------|--------|
| `scripts/build-apk-release.ps1` | **FIXED** (script added) |
| Signed release APK produced | **NOT FIXED** — mobile shell + keystore required |
| Signed release AAB produced | **NOT FIXED** |
| `android:debuggable=false` verified | **NOT FIXED** |

Existing `build-apk.ps1` remains **debug-only** (documented).

---

## 9. Tablet + Phone QA (CSS)

| Resolution target | Status |
|-------------------|--------|
| 360×640, 412×915 | **FIXED** — overflow-x hidden, 48px targets |
| 768×1024, 800×1280, 1024×1366 | **FIXED** — tablet sheet widths |
| Horizontal scroll | **FIXED** (CSS) |
| 48px touch targets (dock, permissions, GPS chip) | **FIXED** |
| Physical device matrix test | **N/A** — static CSS only; manual QA recommended |

---

## 10. Sunlight Mode

| Check | Result |
|-------|--------|
| Muted text contrast (`--muted` darker in production) | **PASS** |
| Green active dock border emphasis | **PASS** |
| Small label font bump (12px) | **WARNING** — improved, not measured outdoors |
| Full AA audit outdoors | **N/A** — requires field test |

---

## 11. Final Security Audit (static scan)

Run: `node scripts/audit-security-release.js`

| Category | Finding |
|----------|---------|
| Hardcoded API keys | **PASS** — none detected |
| `eval()` in app path | **PASS** |
| `Function()` constructor | Review libs (bundled); app path clean |
| `innerHTML` | **MEDIUM** — present with `escapeHtml` on field panels |
| CSP in index.html | **PASS** |
| Import chain guards | **PASS** |
| Export CSP (cinematic replay) | **MEDIUM** — intentional no CSP for MapLibre (known) |

---

## 12. Summary Table

### BLOCKER

| ID | Item | Status |
|----|------|--------|
| B1 | Integrity manifest drift | **FIXED** |
| B2 | ZIP bomb on KMZ/project ZIP | **FIXED** |
| B3 | Project ZIP unvalidated import | **FIXED** |
| B4 | Signed release AAB/APK | **NOT FIXED** |
| B5 | Mobile shell audit (Gradle/manifest) | **NOT FIXED** |
| B6 | Privacy policy URL (store) | **NOT FIXED** (out of hardening scope) |

### HIGH

| ID | Item | Status |
|----|------|--------|
| H1 | GeoTIFF assertImportFile bypass | **FIXED** |
| H2 | GML property sanitization | **FIXED** |
| H3 | CRS whitelist | **FIXED** |
| H4 | Production debug APIs | **FIXED** |
| H5 | R8/ProGuard in release build | **NOT FIXED** (shell) |
| H6 | SEC-02 deferPin | **N/A** (deferred) |
| H7 | SEC-03 encryption opt-out | **N/A** (deferred) |

### MEDIUM

| ID | Item | Status |
|----|------|--------|
| M1 | Cinematic replay no CSP | **N/A** (by design) |
| M2 | Physical device QA matrix | **NOT FIXED** |
| M3 | Background GPS/voice native service | **NOT FIXED** |

### LOW

| ID | Item | Status |
|----|------|--------|
| L1 | `user-scalable=no` accessibility | **N/A** |
| L2 | 512px store icon | **NOT FIXED** |

---

## Release Decision

### **READY FOR CLOSED BETA** (web + debug APK pilot)

Web layer hardening complete: integrity PASS, import/ZIP/CRS/debug fixes applied.

### **NOT READY FOR RELEASE** (Google Play / App Store production)

Requires: signed release AAB, mobile shell restore, ProGuard verification, privacy policy, store disclosures.

---

## Commands

```powershell
# Integrity
node scripts/generate-integrity-manifest.js
node scripts/verify-integrity-manifest.js

# Security audit
node scripts/audit-security-release.js

# Debug APK (existing)
D:\planai\field\scripts\build-apk.ps1

# Release APK/AAB (when mobile shell ready)
D:\planai\field\scripts\build-apk-release.ps1
```
