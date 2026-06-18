# PlanAI Field — İnteraktif Saha Tekrar Platformu

Mekânsal hikâye anlatımı ve saha denetimi tekrar deneyimi. React + Vite + Mapbox GL + Deck.gl.

## Kurulum

```bash
cd D:\planai\field\interaktif-replay
npm install
cp .env.example .env
# .env içine Mapbox token ekleyin:
# VITE_MAPBOX_TOKEN=pk....
```

## Demo verisi

Mevcut `*_interaktif.html` dosyasından JSON çıkarmak için:

```bash
npm run extract -- "D:\planai\field\interaktif\Proje_7.06.2026_interaktif.html"
```

Çıktı: `public/demo/report.json`

## Geliştirme

```bash
npm run dev
```

## Özellikler

- Sinematik giriş ekranı (hero, istatistikler, animasyonlu rota)
- Tam ekran Mapbox haritası + Deck.gl GPS rotası
- Oynatma motoru (play/pause, hız, sinematik/manuel mod)
- Sol panel zaman çizelgesi (görev günlüğü)
- Sağ panel detay kartları (fotoğraf, AI özeti, koordinatlar)
- AI özet kartları
- Tablet/mobil uyumlu (dar ekranda katlanabilir timeline)

## Teknoloji

- React 19, TypeScript, Vite
- Tailwind CSS 4, Framer Motion
- Mapbox GL JS, Deck.gl
