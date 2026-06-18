# PlanAI Field™

**Developed by [PiriStrategy](https://piristrateji.com)**

© Taner Piri / PiriStrategy. All rights reserved.

> PlanAI Field is a proprietary spatial intelligence and field workflow platform developed by PiriStrategy.

PlanAI Field is an AI-native, offline-first GIS/CAD hybrid platform for professional field workflows — GPS routes, spatial annotations, municipality overlays, secure imports, field reporting, and hardened spatial security.

## Ownership

| | |
|---|---|
| **Product** | PlanAI Field™ |
| **Organization** | PiriStrategy |
| **Author** | Taner Piri |
| **License** | Proprietary — see [LICENSE](LICENSE) |

## Repository notice

This repository contains **proprietary software**. Unless you hold a written license agreement with PiriStrategy, you may **not**:

- redistribute, sublicense, or commercially reuse this code or artifacts
- create derivative platforms or clone protected components
- reverse engineer security, spatial sync, georeferencing, or import sandbox modules
- deploy PlanAI Field as an unauthorized SaaS or hosted multi-tenant service

### Protected intellectual property

Protected subject matter includes, without limitation:

- spatial workflow architecture
- GIS/CAD hybrid systems
- smart georeferencing logic
- spatial synchronization systems
- field reporting workflows
- AI-assisted planning systems
- spatial security architecture
- UI/UX concepts
- municipality workflows

See [LICENSE](LICENSE) and [NOTICE](NOTICE) for full terms.

## Documentation

- [SECURITY.md](SECURITY.md) — security architecture
- [THREAT_MODEL.md](THREAT_MODEL.md) — threat model
- [DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md) — production hardening
- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution policy (authorized collaborators only)

## Architecture

```
js/
├── branding/PlanAIBranding.js   Proprietary notices, splash, footer, exports
├── security/                    Device integrity, secure mode, tiers
├── spatial/                     Import sandbox & spatial limits
├── import/                      Worker-isolated validation
├── workers/                     Off-thread parsing
└── integrity/                   Runtime manifest verification
```

## Branding

Exports and reports include: **Generated with PlanAI Field by PiriStrategy**

Application footer:

```
PlanAI Field™
Developed by PiriStrategy
© Taner Piri / PiriStrategy
```

## Contact

Licensing, municipality deployments, and enterprise agreements:

**PiriStrategy** — https://piristrateji.com
