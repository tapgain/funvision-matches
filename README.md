# FunVision Match Data

Günde iki kez (06:00 / 12:00 Türkiye saati) GitHub Actions tarafından otomatik
çalıştırılan maç verisi hattı.

**Kaynaklar:**
- Sofascore (fikstür: takımlar, saat, müsabaka) — `scripts/fetch-real-matches.mjs`
- Sporx "TV'de Bugün" (yayın akışı: maç, saat, **kanal**) — `scripts/scrape-sporx-broadcasts.mjs`

**Çıktı:** `data/matches.json` — uygulamanın Maç Takvimi ve Yaklaşan Maçlar
bileşenlerinin okuduğu dosya.

```json
{
  "trackedTeams": ["Galatasaray", "Fenerbahçe", "Beşiktaş", "Trabzonspor", "Türkiye"],
  "lookAheadHours": 96,
  "matches": [
    { "id": "sofa:16483638", "homeTeam": "Galatasaray", "awayTeam": "Çorum FK",
      "competition": "Trendyol Süper Lig", "startsAt": "2026-08-14T18:30:00.000Z",
      "channelName": "beIN SPORTS", "isFriendly": false }
  ]
}
```

**Yerel test:** `node scripts/fetch-real-matches.mjs`
**Ortam değişkenleri:** `MATCH_TEAMS`, `MATCH_LOOKAHEAD_H`

Bu depo yalnızca kazıyıcı ve çıktı verisini içerir; uygulama kaynak kodu burada değildir.
