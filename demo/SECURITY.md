# PlanAI Field — Security Architecture

© Taner Piri / PiriStrategy. All rights reserved.

PlanAI Field is a proprietary spatial intelligence and field workflow platform developed by PiriStrategy.

This document describes protected spatial security architecture, import sandbox design, offline integrity workflows, and related subsystems. Unauthorized redistribution, commercial reuse, derivative cloning, reverse engineering, or unauthorized SaaS deployment is prohibited.

PlanAI Field is an offline-first spatial intelligence platform. Security assumes a **fully public frontend**: WebView inspection, APK reverse engineering, and hostile spatial uploads are expected.

## Module layout

| Path | Role |
|------|------|
| `js/security/SecurityOrchestrator.js` | Unified facade (`PlanAISecurity`) |
| `js/security/DeviceSecurity.js` | Root/jailbreak/instrumentation risk scoring |
| `js/security/SecurityProfile.js` | Tiers: PUBLIC, PRO, MUNICIPALITY, SECURE |
| `js/security/SecureStorage.js` | AES-GCM offline cache (Web Crypto) |
| `js/security/SecurityTelemetry.js` | Opt-in local threat ring buffer |
| `js/spatial/SpatialLimitsCore.js` | Shared limits (main thread + workers) |
| `js/spatial/SpatialSecurity.js` | Import sandbox API + DEM/GPS caps |
| `js/import/ImportSandbox.js` | Worker-dispatched pre-parse validation |
| `js/sanitize/ContentSanitizer.js` | Notes, PDF/HTML, property sanitization |
| `js/workers/*.worker.js` | Off-thread parsing and validation |
| `js/integrity/RuntimeIntegrity.js` | SHA-256 manifest verification (production) |
| `js/integrity/CacheIntegrity.js` | Offline cache fingerprints |
| `js/mobile/MobileHardening.js` | Native lifecycle hooks |

## Secure mode (no hard block)

When device risk ≥ 30, integrity fails, or tier is SECURE:

**Allowed:** maps, GPS, drawing, notes, photos, basic offline use  
**Restricted:** municipality overlays, secure imports, PDF/ZIP exports, advanced sharing, debug panels  
**Enabled:** report watermarks, encrypted cache (tier-dependent), integrity monitoring

## Security tiers

| Tier | Exports | Overlays | Watermark | Encrypted cache | Telemetry |
|------|---------|----------|-----------|-----------------|-----------|
| PUBLIC | ✓ | ✓ | — | — | — |
| PRO | ✓ | ✓ | — | ✓ | — |
| MUNICIPALITY | ✓ | ✓ | ✓ | ✓ | ✓ |
| SECURE | ✗ | ✗ | ✓ | ✓ | ✓ |

Set tier: `SecurityProfile.setTier('MUNICIPALITY')`

## Spatial import limits

- Max file: 80 MB text / 48 MB parse buffer
- GeoJSON features: 15,000; complexity score cap: 250,000
- KML placemarks: 12,000; GML features: 12,000
- Ring vertices: 8,000; polygon rings: 48; nesting depth: 8
- ZIP entries: 512; CRS whitelist (EPSG:4326, 3857, UTM, TUREF)
- XXE blocked: no `<!ENTITY`, `<!DOCTYPE` in XML imports

## Runtime integrity

Production builds (`body.walk-production`) verify `integrity-manifest.json` at boot. Mismatch adds +25 risk score and enables secure mode.

Generate manifest before deploy:

```bash
node scripts/generate-integrity-manifest.js
```

## Mobile native layer

Android: `DeviceSecurityBridge.java` + `PlanAIDeviceSecurityPlugin.java`  
iOS: `PlanAIDeviceSecurityPlugin.swift`

Set `EXPECTED_CERT_SHA256` in release builds when signing certificate is known.

## Boot sequence

Scripts load in dependency order; `PlanAISecurity.init()` runs at app boot (replaces direct `DeviceSecurity.init()`).

## Privacy

Telemetry is local-only by default. MUNICIPALITY/SECURE tiers or explicit opt-in enable recording. No PII in event payloads.
