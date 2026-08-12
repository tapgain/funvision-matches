/**
 * Sahadan "TV Programı" sayfasından maç yayın akışı çekici.
 *
 * Kaynak: https://www.sahadan.com/tv-programi  (Nuxt __NUXT_DATA__ JSON)
 * Kanallar Sporx'e göre daha spesifiktir: "beIN SPORTS MAX 1", "S Sport Plus" vb.
 * Sayfa yalnızca bugünün programını içerir (kanallar maç günü dolmaya başlar).
 */
import { execFileSync } from 'node:child_process'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const PAGE_URL = 'https://www.sahadan.com/tv-programi'

function normalize(value) {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function splitFixture(title) {
  const parts = title
    .split(/\s*(?:[-–—]|\bvs?\.?\b|\bversus\b)\s*/i)
    .map((part) => part.replace(/\([^)]*\)/g, '').trim())
    .filter(Boolean)
  if (parts.length < 2) return undefined
  return { homeTeam: parts[0].slice(0, 80), awayTeam: parts[1].slice(0, 80) }
}

/** Nuxt __NUXT_DATA__ deflate çözücüsü: dizi içindeki sayılar paylaşılan değerlere referanstır. */
function resolveNuxtPayload(payload) {
  const seen = new Set()
  const resolve = (ref) => {
    if (seen.has(ref)) return undefined
    seen.add(ref)
    const value = payload[ref]
    if (typeof value === 'number') return resolve(value)
    if (Array.isArray(value)) {
      if (
        value.length === 2 &&
        typeof value[0] === 'string' &&
        typeof value[1] === 'number' &&
        value[0] !== 'uuid' &&
        !/^\$|^#/.test(value[0])
      ) {
        return resolve(value[1])
      }
      return value.map((item) => (typeof item === 'number' ? resolve(item) : item))
    }
    if (value && typeof value === 'object') {
      const out = {}
      for (const [key, val] of Object.entries(value)) {
        out[key] = typeof val === 'number' ? resolve(val) : val
      }
      return out
    }
    return value
  }
  return resolve(0)
}

function collectChannels(node, entries) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) collectChannels(item, entries)
    return
  }
  // Yayın girdisi: { date_time_utc, match: { name, sport_name }, channels: [{ name }] }
  if (node.date_time_utc && node.channels && Array.isArray(node.channels) && node.match?.name) {
    const channel = node.channels.map((ch) => ch?.name).filter(Boolean).join(', ')
    if (channel) {
      entries.push({ date: String(node.date_time_utc), channel, title: String(node.match.name) })
      return
    }
  }
  for (const value of Object.values(node)) collectChannels(value, entries)
}

export async function fetchSahadanBroadcasts(trackedTeams = [], now = new Date()) {
  const html = execFileSync('curl', ['-s', '-m', '20', '-L', '-H', `User-Agent: ${UA}`, PAGE_URL], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  const blob = html.match(/id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!blob) return []
  const payload = JSON.parse(blob[1])
  const root = resolveNuxtPayload(payload)

  const raw = []
  collectChannels(root, raw)

  const entries = []
  for (const item of raw) {
    const fixture = splitFixture(item.title)
    if (!fixture) continue
    const startsAt = startsAtForLocalTime(item.date, now)
    if (!startsAt) continue
    entries.push({
      id: `sahadan:${Buffer.from(`${fixture.homeTeam}|${fixture.awayTeam}|${startsAt}`).toString('base64url').slice(0, 24)}`,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      competition: 'Futbol',
      startsAt,
      channelName: item.channel,
      isFriendly: false,
    })
  }

  if (trackedTeams.length > 0) {
    const needles = trackedTeams.map(normalize).filter(Boolean)
    return entries.filter((entry) => {
      const hay = normalize(`${entry.homeTeam} ${entry.awayTeam}`)
      return needles.some((needle) => needle.length >= 2 && (` ${hay} `).includes(` ${needle} `))
    })
  }
  return entries
}

function startsAtForLocalTime(dateText, now = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(dateText)
  if (!match) return undefined
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), 0, 0)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}
