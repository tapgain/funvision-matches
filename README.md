# FunVision Match Data

Günde bir kez GitHub Actions tarafından otomatik
çalıştırılan maç verisi hattı.

**Kaynaklar:**
- Yayın Ekranı futbol programı (maç, saat, müsabaka ve yayıncı kanal) — `scripts/fetch-yayinekrani-matches.mjs`

**Çıktı:** `data/matches.json` — uygulamanın Maç Takvimi ve Yaklaşan Maçlar
bileşenlerinin okuduğu dosya.

```json
{
  "trackedTeams": ["Galatasaray", "Fenerbahçe", "Beşiktaş", "Trabzonspor", "Türkiye"],
  "lookAheadHours": 168,
  "matches": [
    { "id": "yayin:example", "homeTeam": "Galatasaray", "awayTeam": "Çorum FK",
      "competition": "Trendyol Süper Lig", "startsAt": "2026-08-14T18:30:00.000Z",
      "channelName": "beIN SPORTS", "isFriendly": false }
  ]
}
```

**Yerel test:** `node scripts/fetch-yayinekrani-matches.mjs`

Bu depo yalnızca kazıyıcı ve çıktı verisini içerir; uygulama kaynak kodu burada değildir.
