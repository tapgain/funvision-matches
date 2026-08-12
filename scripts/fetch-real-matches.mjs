/**
 * FunVision — gerçek maç verisi çekici.
 *
 * Sofascore'un anahtarsız/ücretsiz API'sinden takip edilen takımların
 * yaklaşan futbol maçlarını çeker ve uygulamanın maç rehberine yazar.
 *
 * Kullanım (yerel — kontrol sunucusunun matches.json'unu doğrudan günceller):
 *   node scripts/fetch-real-matches.mjs
 *
 * Kullanım (uzak — bulut zamanlayıcı vb. için API üzerinden):
 *   node scripts/fetch-real-matches.mjs --api http://127.0.0.1:8787 --token X
 *
 * Ortam değişkenleri:
 *   MATCH_TEAMS        Virgüllü takım listesi (varsayılan: GS, FB, BJK, TS, Türkiye)
 *   MATCH_LOOKAHEAD_H  Bakılacak saat penceresi (varsayılan 96, üst sınır 168)
 *   MATCH_ID_CACHE     Takım-ID önbellek yolu (varsayılan data/match-team-ids.json)
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = resolve(process.env.FUNVISION_DATA_DIR?.trim() || resolve(root, 'data'))
const matchesFile = resolve(dataDir, 'matches.json')
const idCacheFile = process.env.MATCH_ID_CACHE?.trim() || resolve(dataDir, 'match-team-ids.json')

const DEFAULT_TEAMS = ['Galatasaray', 'Fenerbahçe', 'Beşiktaş', 'Trabzonspor', 'Türkiye']
const DEFAULT_LOOKAHEAD_HOURS = 96
const MAX_LOOKAHEAD_HOURS = 168
const SOFA_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json',
}

const teams = (process.env.MATCH_TEAMS?.trim() || DEFAULT_TEAMS.join(','))
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean)
  .slice(0, 40)
const lookaheadHours = Math.max(12, Math.min(MAX_LOOKAHEAD_HOURS, Number(process.env.MATCH_LOOKAHEAD_H) || DEFAULT_LOOKAHEAD_HOURS))

function readJson(path, fallback) {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback
  } catch {
    return fallback
  }
}

function normalizeTeam(value) {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

// Sofascore, Node'un TLS parmak izine 403 veriyor; curl 200 dönüyor.
// (Cloudflare benzeri koruma: TLS fingerprint'e göre engeller.)
function sofaJson(url) {
  const stdout = execFileSync(
    'curl',
    ['-s', '-m', '20', '-H', `User-Agent: ${SOFA_HEADERS['User-Agent']}`, '-H', 'Accept: application/json', url],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  )
  return JSON.parse(stdout)
}

/** Takım adını Sofascore takım kimliğine çözer (önbellekli). */
async function resolveTeamId(name) {
  const cache = readJson(idCacheFile, {})
  const key = normalizeTeam(name)
  if (cache[key]?.id) return cache[key]

  const data = await sofaJson(`https://api.sofascore.com/api/v1/search/all?q=${encodeURIComponent(name)}`)
  const candidates = (data.results ?? [])
    .map((result) => result.entity)
    .filter((entity) => entity && entity.sport?.slug === 'football' && entity.name)
  const isNational = /türkiye|turkiye|milli|national|turkey/i.test(name)
  const match = isNational
    ? candidates.find((entity) => entity.national === true && normalizeTeam(entity.name) === key)
    : candidates.find((entity) => normalizeTeam(entity.name) === key) ?? candidates[0]
  if (!match) throw new Error(`Takım bulunamadı: ${name}`)

  cache[key] = { id: match.id, name: match.name, national: match.national === true }
  mkdirSync(dirname(idCacheFile), { recursive: true })
  writeFileSync(idCacheFile, JSON.stringify(cache, null, 2))
  return cache[key]
}

function isFriendlyTournament(tournamentName) {
  return /hazirlik|hazırlık|friendly|dostluk/i.test(tournamentName ?? '')
}

function fixtureKey(homeTeam, awayTeam, startsAt) {
  return `${[normalizeTeam(homeTeam), normalizeTeam(awayTeam)].sort().join('-')}@${new Date(startsAt).toISOString().slice(0, 13)}`
}

async function fetchUpcomingMatches(teamId) {
  const data = await sofaJson(`https://api.sofascore.com/api/v1/team/${teamId}/events/next/0`)
  return data.events ?? []
}

async function main() {
  const now = Date.now()
  const windowEnd = now + lookaheadHours * 60 * 60 * 1000

  const resolved = []
  for (const name of teams) {
    try {
      const { id } = await resolveTeamId(name)
      resolved.push({ name, id })
    } catch (error) {
      console.warn(`[fetch-matches] ${name}: ${error.message}`)
    }
  }
  if (resolved.length === 0) {
    console.error('[fetch-matches] Hiçbir takım kimliği çözülemedi — çıkılıyor.')
    process.exitCode = 1
    return
  }

  const seen = new Set()
  const matches = []
  for (const team of resolved) {
    let events = []
    try {
      events = await fetchUpcomingMatches(team.id)
    } catch (error) {
      console.warn(`[fetch-matches] ${team.name} etkinlikleri alınamadı: ${error.message}`)
      continue
    }
    for (const event of events) {
      const home = event.homeTeam?.name
      const away = event.awayTeam?.name
      const startMs = Number(event.startTimestamp) * 1000
      if (!home || !away || !Number.isFinite(startMs)) continue
      if (startMs < now || startMs > windowEnd) continue
      const startsAt = new Date(startMs).toISOString()
      const key = fixtureKey(home, away, startsAt)
      if (seen.has(key)) continue
      seen.add(key)
      matches.push({
        id: `sofa:${event.id}`,
        homeTeam: home,
        awayTeam: away,
        competition: event.tournament?.name || 'Futbol',
        startsAt,
        // Yayıncı bilgisi Sofascore temel yanıtında yok; uygulama boş kanalı
        // "Yayıncı bekleniyor" olarak gösterir, EPG eşleşmesi kanalı tamamlar.
        channelName: '',
        isFriendly: isFriendlyTournament(event.tournament?.name),
      })
    }
  }

  // Sporx yayın akışı: günün maçları + KANAL adı (Sofascore'da eksik olan bilgi).
  // Aynı fikstüre denk gelen Sofascore kaydına kanal işlenir; eşleşmeyen ve
  // takip edilen takımları içeren kayıtlar bağımsız eklenir.
  let broadcasts = []
  try {
    const { fetchSporxBroadcasts } = await import('./scrape-sporx-broadcasts.mjs')
    broadcasts = await fetchSporxBroadcasts(resolved.map((team) => team.name))
    console.log(`[fetch-matches] Sporx: ${broadcasts.length} maç yayını`)
  } catch (error) {
    console.warn(`[fetch-matches] Sporx alınamadı: ${error.message}`)
  }

  const normalizePair = (home, away) =>
    [normalizeTeam(home), normalizeTeam(away)].sort().join('-')
  const sofaByPair = new Map()
  for (const match of matches) {
    const pair = normalizePair(match.homeTeam, match.awayTeam)
    if (!sofaByPair.has(pair)) sofaByPair.set(pair, [])
    sofaByPair.get(pair).push(match)
  }
  const mergeWindowMs = 90 * 60 * 1000
  for (const broadcast of broadcasts) {
    const candidates = sofaByPair.get(normalizePair(broadcast.homeTeam, broadcast.awayTeam)) ?? []
    const match = candidates.find(
      (candidate) => Math.abs(Date.parse(candidate.startsAt) - Date.parse(broadcast.startsAt)) <= mergeWindowMs,
    )
    if (match) {
      if (!match.channelName) {
        match.channelName = broadcast.channelName
      }
    } else {
      matches.push(broadcast)
    }
  }

  matches.sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))

  const payload = {
    trackedTeams: resolved.map((team) => team.name),
    lookaheadHours,
    matches,
  }

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
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) {
      console.error(`[fetch-matches] API ${response.status}: ${await response.text()}`)
      process.exitCode = 1
      return
    }
    const result = await response.json()
    console.log(`[fetch-matches] API: ${result.imported} maç aktarıldı (${matches.length} kaynak)`)
  } else {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(matchesFile, JSON.stringify(payload, null, 2))
    console.log(`[fetch-matches] ${matchesFile}: ${matches.length} maç yazıldı (${lookaheadHours}h pencere)`)
  }
}

main().catch((error) => {
  console.error(`[fetch-matches] ${error?.message ?? error}`)
  process.exitCode = 1
})
