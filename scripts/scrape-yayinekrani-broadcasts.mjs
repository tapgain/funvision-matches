import { execFileSync } from 'node:child_process'

export const YAYIN_EKRANI_URL = 'https://www.yayinekrani.com/spor/futbol'

const clean = (value, max = 120) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
const normalize = (value) => clean(value, 200).toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

function jsonLd(html) {
  const values = []
  const pattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  for (const match of html.matchAll(pattern)) {
    try { values.push(JSON.parse(match[1].trim())) } catch { /* unrelated block */ }
  }
  return values.flatMap((value) => Array.isArray(value) ? value : [value])
}

function broadcastNames(value, result = []) {
  if (Array.isArray(value)) { value.forEach((entry) => broadcastNames(entry, result)); return result }
  if (!value || typeof value !== 'object') return result
  if (/BroadcastService/i.test(String(value['@type'] ?? ''))) {
    const name = clean(value.name, 80)
    if (name) result.push(name)
  }
  return result
}

function eventId(home, away, startsAt) {
  return `yayin:${Buffer.from(`${home}|${away}|${startsAt}`).toString('base64url').slice(0, 40)}`
}

export function parseYayinEkraniHtml(html, options = {}) {
  const now = options.now instanceof Date ? options.now.getTime() : Number(options.now ?? Date.now())
  const hours = Math.max(12, Math.min(168, Number(options.lookAheadHours ?? 168)))
  const end = now + hours * 60 * 60 * 1000
  const seen = new Set()
  const matches = []
  for (const event of jsonLd(html)) {
    if (!event || typeof event !== 'object' || event['@type'] !== 'BroadcastEvent') continue
    const fixture = event.broadcastOfEvent
    const homeTeam = clean(fixture?.homeTeam?.name, 80)
    const awayTeam = clean(fixture?.awayTeam?.name, 80)
    const startsAtMs = Date.parse(fixture?.startDate ?? '')
    if (!homeTeam || !awayTeam || !Number.isFinite(startsAtMs) || startsAtMs < now - 6 * 60 * 60 * 1000 || startsAtMs > end) continue
    const startsAt = new Date(startsAtMs).toISOString()
    const id = eventId(homeTeam, awayTeam, startsAt)
    if (seen.has(id)) continue
    seen.add(id)
    const channelName = [...new Set(broadcastNames(fixture.recordedAt))]
      .filter((name) => !/^(yayın yok|yayıncı belli değil)$/i.test(name)).join(' / ').slice(0, 100)
    const fixtureName = clean(fixture.name, 180) || `${homeTeam} - ${awayTeam}`
    const sentence = clean(event.name || event.description, 500)
    const competition = (sentence.startsWith(fixtureName) ? sentence.slice(fixtureName.length) : sentence)
      .replace(/\s+maç[ıi],?[\s\S]*$/i, '').trim() || 'Futbol'
    matches.push({ id, homeTeam, awayTeam, competition, startsAt, channelName, isFriendly: /hazırlık|friendly|dostluk/i.test(competition) })
  }
  return matches.sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))
}

export function fetchYayinEkraniBroadcasts(options = {}) {
  const html = execFileSync('curl', ['-s', '-L', '--max-time', '30', '--compressed', '-A', 'Mozilla/5.0', options.url || YAYIN_EKRANI_URL], { encoding: 'utf8', maxBuffer: 24 * 1024 * 1024 })
  if (!html.includes('BroadcastEvent')) throw new Error('Yayın Ekranı maç verisi bulunamadı')
  return parseYayinEkraniHtml(html, options)
}
