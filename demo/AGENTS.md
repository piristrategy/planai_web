# PlanAI Field — Agent / geliştirme kaynağı

## Canonical root

**Tüm web düzenlemeleri ve güncellik kontrolü `D:\planai\field` üzerinden yapılır.**

| Ne | Nerede |
|----|--------|
| Web uygulaması (index, js, css, mpyy) | `D:\planai\field` |
| APK dağıtımı | `D:\planai\field\releases\` |
| Capacitor / Gradle kabuğu | `scripts/mobile-root.txt` (varsayılan: `D:\yazılım çalışmaları\planai_field_web\mobile`) |

## Komutlar (PowerShell)

```powershell
# Web → mobile/www senkron
D:\planai\field\scripts\sync-mobile-www.ps1

# Debug APK derle + releases/ kopyala
D:\planai\field\scripts\build-apk.ps1
```

## Akış

1. Kod değişikliği → doğrudan `D:\planai\field\` altında
2. APK gerekiyorsa → `build-apk.ps1`
3. Web test → `file:///D:/planai/field/index.html` (Ctrl+F5)

Desktop `planai_field_web` yalnızca git yedek / mobil kabuk için kullanılır; web kaynağı değildir.
