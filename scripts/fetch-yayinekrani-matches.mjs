import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchYayinEkraniBroadcasts } from './scrape-yayinekrani-broadcasts.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lookAheadHours = 168
const matches = fetchYayinEkraniBroadcasts({ lookAheadHours }).slice(0, 200)
if (matches.length === 0) throw new Error('Yayın Ekranı gelecek maç listesi boş döndü')
const payload = { trackedTeams: ['Galatasaray', 'Fenerbahçe', 'Beşiktaş', 'Trabzonspor', 'Türkiye'], lookAheadHours, matches }
const output = resolve(root, 'data', 'matches.json')
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
console.log(`[yayinekrani] ${output}: ${matches.length} maç`)
