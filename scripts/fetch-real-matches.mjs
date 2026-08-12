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

// Sofascore takım kimlikleri — arama uç noktası bulut IP'lerinde tutarsız
// yanıt verdiği için bilinen kimlikler gömülü yedektir (önbellek → bu harita → arama).
const KNOWN_TEAM_IDS = {
  galatasaray: 3061,
  fenerbahce: 3052,
  besiktas: 256017,
  trabzonspor: 3051,
  turkiye: 4700,
}

/** Takım adını Sofascore takım kimliğine çözer (önbellekli). */
async function resolveTeamId(name) {
  const cache = readJson(idCacheFile, {})
  const key = normalizeTeam(name)
  if (cache[key]?.id) return cache[key]
  if (KNOWN_TEAM_IDS[key]) {
    const known = { id: KNOWN_TEAM_IDS[key], name, national: /turkiye|türkiye/i.test(name) }
    mkdirSync(dirname(idCacheFile), { recursive: true })
    writeFileSync(idCacheFile, JSON.stringify({ ...cache, [key]: known }, null, 2))
    return known
  }

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

// TheSportsDB — anahtarsız, anti-bot'suz; Sofascore bulut IP'lerine boş yanıt
// verdiği için bulut çalışmalarında fikstür buradan gelir.
const KNOWN_TSPORTS_IDS = {
  galatasaray: 133804,
  fenerbahce: 133807,
  besiktas: 133794,
  trabzonspor: 133796,
  turkiye: 135985,
}

async function resolveTsportsTeamId(name) {
  const key = normalizeTeam(name)
  if (KNOWN_TSPORTS_IDS[key]) return KNOWN_TSPORTS_IDS[key]
  const data = await sofaJson(`https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(name)}`)
  const team = (data.teams ?? []).find((entry) => normalizeTeam(entry.strTeam) === key)
  if (!team) throw new Error(`TheSportsDB takım bulunamadı: ${name}`)
  return Number(team.idTeam)
}

async function fetchTsportsFixtures(teamIds) {
  const entries = []
  for (const teamId of teamIds) {
    try {
      const data = await sofaJson(`https://www.thesportsdb.com/api/v1/json/3/eventsnext.php?id=${teamId}`)
      for (const event of data.events ?? []) {
        const home = event.strHomeTeam
        const away = event.strAwayTeam
        const startsAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(event.strTimestamp ?? '') ? `${event.strTimestamp}Z` : undefined
        if (!home || !away || !startsAt) continue
        entries.push({
          id: `tsdb:${event.idEvent}`,
          homeTeam: home,
          awayTeam: away,
          competition: event.strLeague || 'Futbol',
          startsAt,
          channelName: '',
          isFriendly: /friendly|hazirlik|hazırlık/i.test(`${event.strLeague ?? ''} ${event.strEvent ?? ''}`),
        })
      }
    } catch (error) {
      console.warn(`[fetch-matches] TheSportsDB (${teamId}): ${error.message}`)
    }
  }
  return entries
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

  // TheSportsDB yedeği: Sofascore boş döndüğünde (bulut IP engeli) fikstür
  // buradan gelir; mevcut kayıtlarla aynı fikstür tekrarlanmaz.
  if (matches.length === 0) {
    const tsportsIds = []
    for (const team of resolved) {
      try {
        tsportsIds.push(await resolveTsportsTeamId(team.name))
      } catch (error) {
        console.warn(`[fetch-matches] TheSportsDB: ${error.message}`)
      }
    }
    const tsports = await fetchTsportsFixtures(tsportsIds)
    const nowMs = now
    const windowEndMs = windowEnd
    for (const entry of tsports) {
      const startMs = Date.parse(entry.startsAt)
      if (!Number.isFinite(startMs) || startMs < nowMs || startMs > windowEndMs) continue
      matches.push(entry)
    }
    console.log(`[fetch-matches] TheSportsDB: ${tsports.length} maç (Sofascore boştu)`)
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
  // Sahadan: Sporx'ten daha spesifik kanal adları (beIN SPORTS MAX 1 vb.).
  try {
    const { fetchSahadanBroadcasts } = await import('./scrape-sahadan-broadcasts.mjs')
    const sahadan = await fetchSahadanBroadcasts(resolved.map((team) => team.name))
    broadcasts = [...sahadan, ...broadcasts]
    console.log(`[fetch-matches] Sahadan: ${sahadan.length} maç yayını`)
  } catch (error) {
    console.warn(`[fetch-matches] Sahadan alınamadı: ${error.message}`)
  }

  const normalizePair = (home, away) =>
    [normalizeTeam(home), normalizeTeam(away)].sort().join('-')
  const mergeWindowMs = 90 * 60 * 1000
  const shareTeam = (left, right) => {
    const leftTeams = new Set([normalizeTeam(left.homeTeam), normalizeTeam(left.awayTeam)])
    const rightTeams = new Set([normalizeTeam(right.homeTeam), normalizeTeam(right.awayTeam)])
    for (const team of leftTeams) {
      if (team && rightTeams.has(team)) return true
    }
    return false
  }
  for (const broadcast of broadcasts) {
    const candidates = matches.filter(
      (candidate) =>
        Math.abs(Date.parse(candidate.startsAt) - Date.parse(broadcast.startsAt)) <= mergeWindowMs &&
        shareTeam(candidate, broadcast),
    )
    // Önce tam fikstür eşleşmesi, yoksa (farklı yazılan takım adlarıyla) ortak takım eşleşmesi.
    const match = candidates.find((candidate) => normalizePair(candidate.homeTeam, candidate.awayTeam) === normalizePair(broadcast.homeTeam, broadcast.awayTeam))
      ?? candidates[0]
    if (match) {
      if (!match.channelName) {
        match.channelName = broadcast.channelName
      }
    } else {
      matches.push(broadcast)
    }
  }

  // Süper Lig beIN ailesinde yayınlanır (beIN'in resmî duyurusu). Kesin alt kanal
  // maç günü Sporx/Sahadan akışından gelir; bilinmiyorsa aile etiketi gösterilir.
  for (const match of matches) {
    if (!match.channelName && /super lig|süper lig|turkish super lig/i.test(match.competition ?? '')) {
      match.channelName = 'beIN SPORTS'
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
