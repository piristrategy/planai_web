# PlanAI Field — Production Deploy Checklist

© Taner Piri / PiriStrategy. All rights reserved.

PlanAI Field is a proprietary spatial intelligence and field workflow platform developed by PiriStrategy.

## Pre-build

- [ ] Verify proprietary notices present in README, LICENSE, NOTICE, and export branding

- [ ] Set security tier default for deployment (`SecurityProfile` or build flag)
- [ ] Run `node scripts/generate-integrity-manifest.js`
- [ ] Verify `integrity-manifest.json` committed or copied to deploy root
- [ ] Set Android `EXPECTED_CERT_SHA256` in `DeviceSecurityBridge.java` for release keystore
- [ ] Confirm `body.walk-production` class on production HTML

## Web (Walk / CDN)

- [ ] CSP meta present (no `unsafe-eval`, no inline scripts)
- [ ] All libs bundled locally (no CDN in production index)
- [ ] Source maps disabled / not deployed
- [ ] Console/debug stripped in production JS patch (`build-walk-web.js`)
- [ ] Security script load order verified (see `SECURITY.md`)
- [ ] Workers reachable at `/js/workers/*.worker.js`
- [ ] Cache-Control: `no-store` for `index.html`, `app.js`, manifest

## Android APK

- [ ] `minifyEnabled true` + `shrinkResources true` in release `build.gradle`
- [ ] ProGuard rules keep Capacitor plugin + bridge classes
- [ ] Release signed with production keystore (not test-keys)
- [ ] `sync-www.js` copied full `js/security`, `js/spatial`, `js/import`, `js/workers`, `js/integrity`, `js/sanitize`, `js/mobile`
- [ ] Capacitor sync: `npx cap sync android`

## iOS (when enabled)

- [ ] `PlanAIDeviceSecurityPlugin.swift` in Xcode target
- [ ] Release build, no debug entitlements
- [ ] Keychain storage for encrypted cache keys (future hardening)

## Functional verification

- [ ] Import valid GeoJSON/KML/GML — succeeds
- [ ] Import oversized file — rejected with user message
- [ ] Import XML with `<!ENTITY` — rejected
- [ ] Secure mode: PDF export blocked, map/GPS works
- [ ] Secure mode: plan overlay import blocked
- [ ] Report watermark visible in secure mode
- [ ] Worker timeout falls back to sync validation (UI responsive)

## Municipality deployment

- [ ] Tier set to `MUNICIPALITY` or `SECURE`
- [ ] Telemetry opt-in policy documented for field crews
- [ ] Backend receives only authorized plan packages (client restrictions are not sufficient alone)
- [ ] Incident response contact for integrity/telemetry review

## Post-deploy monitoring

- [ ] Review local telemetry exports from pilot devices (if enabled)
- [ ] Track import rejection rates for false-positive tuning
- [ ] Rotate integrity manifest on each release
