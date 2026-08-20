import assert from 'node:assert/strict'
import test from 'node:test'
import { parseYayinEkraniHtml, parseYayinEkraniMarkdown } from './scrape-yayinekrani-broadcasts.mjs'

const html = `
  <script type="application/ld+json">
  [{
    "@context":"https://schema.org",
    "@type":"BroadcastEvent",
    "broadcastOfEvent":{
      "@type":"SportsEvent",
      "startDate":"2026-08-14T21:30:00+03:00",
      "recordedAt":[[{"@type":"BroadcastService ","name":"Bein Sports 1"}]],
      "name":"Galatasaray - Çorum FK",
      "homeTeam":{"name":"Galatasaray"},
      "awayTeam":{"name":"Çorum FK"}
    },
    "name":"Galatasaray - Çorum FK Trendyol Süper Lig maçı, Bein Sports 1 kanalından canlı yayınlanacak."
  }]
  </script>`

test('Yayın Ekranı JSON-LD maçını kanal ve lig bilgisiyle ayrıştırır', () => {
  const matches = parseYayinEkraniHtml(html, {
    now: new Date('2026-08-13T12:00:00Z'),
    lookAheadHours: 168,
    trackedTeams: ['Galatasaray'],
  })
  assert.equal(matches.length, 1)
  assert.deepEqual(matches[0], {
    id: 'yayin:R2FsYXRhc2FyYXl8w4dvcnVtIEZLfDIwMjYtMDgt',
    homeTeam: 'Galatasaray',
    awayTeam: 'Çorum FK',
    competition: 'Trendyol Süper Lig',
    startsAt: '2026-08-14T18:30:00.000Z',
    channelName: 'Bein Sports 1',
    isFriendly: false,
  })
})

test('seçili takım dışındaki maçı filtreleyebilir', () => {
  const matches = parseYayinEkraniHtml(html, {
    now: new Date('2026-08-13T12:00:00Z'),
    trackedTeams: ['Fenerbahçe'],
    includeAll: false,
  })
  assert.equal(matches.length, 0)
})

test('Jina Markdown yedeğindeki maç ve kanal bilgisini ayrıştırır', () => {
  const markdown = `[![Image 1: Futbol](https://img.yayinekrani.com/sport.svg) 20:00 Beşiktaş - Kauno Zalgiris UEFA Avrupa Ligi Play-Off ![Image 2: S Sport Plus](https://img.yayinekrani.com/channel.png)](http://yayinekrani.com/mac/484616/2026/08/20/besiktas-kauno-zalgiris-hangi-kanalda)`
  const matches = parseYayinEkraniMarkdown(markdown, {
    now: new Date('2026-08-20T00:00:00Z'),
    lookAheadHours: 168,
  })
  assert.equal(matches.length, 1)
  assert.equal(matches[0].homeTeam, 'Beşiktaş')
  assert.equal(matches[0].awayTeam, 'Kauno Zalgiris')
  assert.equal(matches[0].competition, 'UEFA Avrupa Ligi Play-Off')
  assert.equal(matches[0].channelName, 'S Sport Plus')
  assert.equal(matches[0].startsAt, '2026-08-20T17:00:00.000Z')
})
