/**
 * Yayın Ekranı günlük futbol programını FunVision veri biçimine dönüştürür.
 * Yerelde data/matches.json ve APK yedeği public/matches.json güncellenir.
 * --api ve --token verilirse aynı veri uzaktaki kontrol sunucusuna gönderilir.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchYayinEkraniBroadcasts } from './scrape-yayinekrani-broadcasts.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const trackedTeams = (process.env.MATCH_TEAMS?.trim() || 'Galatasaray,Fenerbahçe,Beşiktaş,Trabzonspor,Türkiye')
  .split(',')
  .map((team) => team.trim())
  .filter(Boolean)
  .slice(0, 40)
const lookAheadHours = 168
const matches = fetchYayinEkraniBroadcasts({ trackedTeams, lookAheadHours, includeAll: true })
  .slice(0, 120)

if (matches.length === 0) throw new Error('Yayın Ekranı gelecek maç listesi boş döndü')

const payload = { trackedTeams, lookAheadHours, matches }
const apiArg = process.argv.find((arg) => arg.startsWith('--api='))?.slice(6)
const tokenArg = process.argv.find((arg) => arg.startsWith('--token='))?.slice(8)

if (apiArg) {
  const token = tokenArg || process.env.FUNVISION_ADMIN_TOKEN || ''
  const response = await fetch(`${apiArg.replace(/\/$/, '')}/funvision-api/matches/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`Kontrol API ${response.status}: ${await response.text()}`)
  const result = await response.json()
  console.log(`[yayinekrani] API: ${result.imported} maç aktarıldı`)
} else {
  for (const path of [resolve(root, 'data', 'matches.json'), resolve(root, 'public', 'matches.json')]) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    console.log(`[yayinekrani] ${path}: ${matches.length} maç`)
  }
}
