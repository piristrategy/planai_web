# Frontend — kök taşıma özeti

## Yapı

```
planai-poland-intelligence/
├── index.html          ← çift tıklama
├── login.html
├── START_UI.bat
├── assets/
│   ├── css/
│   ├── js/
│   └── partials/       ← düzenle, sonra build_index
└── app/backend/        ← değişmedi
```

## Partial güncelleme

```powershell
.\.venv\Scripts\python.exe scripts\build_index.py
```

## Rollback

`index.monolith.bak.html` yedek monolit.
