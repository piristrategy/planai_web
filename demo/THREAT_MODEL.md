# PlanAI Field — Threat Model

© Taner Piri / PiriStrategy. All rights reserved.

PlanAI Field is a proprietary spatial intelligence and field workflow platform developed by PiriStrategy.

This threat model covers protected systems including spatial workflow architecture, GIS/CAD hybrid systems, smart georeferencing logic, spatial synchronization systems, field reporting workflows, AI-assisted planning systems, spatial security architecture, UI/UX concepts, and municipality workflows.

Unauthorized redistribution, commercial reuse, derivative platform cloning, reverse engineering, or unauthorized SaaS deployment is prohibited.

## Assumptions

1. **Client is untrusted** — all JavaScript, WASM, and assets are visible to attackers.
2. **Spatial uploads are hostile** — GeoJSON/GML/KML/ZIP/DEM may be malformed, oversized, or weaponized.
3. **Devices may be compromised** — root, Magisk, Frida, Xposed, jailbreak, emulators.
4. **Offline data is valuable** — routes, municipality overlays, field notes, photos with EXIF.
5. **Exports leave the device** — PDF/HTML must not become XSS or injection vectors.

## Attack surface

### Spatial imports

| Threat | Mitigation |
|--------|------------|
| ZIP bomb | Entry count cap (512), size cap (120 MB uncompressed) |
| Geometry recursion | Nesting depth limit (8), worker pre-validation |
| Polygon bomb | Feature/placemark caps, complexity scoring |
| Coordinate overflow | posList length cap (65536), finite lat/lon checks |
| XXE / XML entities | Dangerous pattern rejection in first 8 KB |
| CRS confusion | Whitelist + length bounds |
| Memory exhaustion | Worker isolation, streaming text size caps |

### Exports

| Threat | Mitigation |
|--------|------------|
| HTML/script injection | ContentSanitizer strips scripts, event handlers, iframes, SVG onload |
| PDF injection | sanitizePdfHtml before html2pdf |
| Report tampering | Integrity metadata + optional watermarks |

### Mobile

| Threat | Mitigation |
|--------|------------|
| APK tampering | Signing cert check (Android), integrity manifest (web assets) |
| Frida/Xposed | Native signal collection, risk score (no hard block) |
| WebView inspection | Logic in modules, not inline HTML; R8/ProGuard on Java |
| Screen capture | Optional FLAG_SECURE styling hook (SECURE tier) |

### Offline storage

| Threat | Mitigation |
|--------|------------|
| Cache tampering | CacheIntegrity fingerprints, encrypted cache in secure tiers |
| Data leakage | AES-GCM wrap for sensitive local blobs |
| Unbounded growth | Storage size assertions (512 MB soft cap) |

## Risk scoring (0–100)

Weighted signals from native bridge + web heuristics + integrity failures.  
Thresholds: 10 low, 30 medium (secure mode), 60 high, 90 critical.

## Out of scope (client-only)

- Server-side validation (recommended for municipality sync backends)
- Hardware security module key provisioning per user
- Certificate pinning to custom API endpoints (foundation in Android release rules)

## Residual risk

A determined attacker with root and patched APK can bypass client checks. Municipality-grade deployments should pair client secure mode with **server-side authorization** and **signed plan distribution**.
