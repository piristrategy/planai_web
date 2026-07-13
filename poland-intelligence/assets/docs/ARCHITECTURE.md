# Frontend Architecture

## Akış

```
Pipeline → API (JSON) → api.js → state.js → render → index.html
```

## Klasörler

| Parça | Yol |
|-------|-----|
| Shell | `index.html` (partial’lar gömülü — çift tıklama) |
| Kaynak partial’lar | `assets/partials/` |
| CSS | `assets/css/` |
| JS | `assets/js/` + `assets/js/modules/` |

## Geliştirme

1. `assets/partials/` veya `assets/js/` düzenle  
2. Partial değiştiyse: `python scripts/build_index.py`  
3. `index.html` çift tıklayın → F5  

API ayrı çalışır: `scripts\start_api.bat`

## Kurallar

- Frontend veri üretmez; yalnızca `/api/*` JSON render eder  
- İş mantığı backend’dedir  
