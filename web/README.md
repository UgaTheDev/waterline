# Web (Next.js + MapLibre)

```bash
cp .env.example .env.local      # set NEXT_PUBLIC_API_URL, or NEXT_PUBLIC_USE_MOCK=1 for offline fixtures
npm install
npm run dev                     # http://localhost:3000
```

Backend contract: `../backend/API.md`. Offline fixtures: `lib/mock.ts`.
MapLibre's worker is copied into `public/maplibre/` by `predev`/`prebuild`.

Mock photo `public/mock/harvey-62096633.jpg`: "Harvey flooding (36527844190)" by Chabad Lubavitch, CC BY 2.0, via Wikimedia Commons (https://commons.wikimedia.org/wiki/File:Harvey_flooding_(36527844190).jpg), resized.
