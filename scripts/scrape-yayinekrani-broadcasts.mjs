/**
 * Yayın Ekranı futbol sayfasındaki schema.org BroadcastEvent verisini okur.
 * Sayfa, maç saati ile yayıncı kanalını JSON-LD içinde birlikte yayımladığı için
 * TV istemcilerinde DOM taraması veya üçüncü taraf API anahtarı gerekmez.
 */
import { execFileSync } from 'node:child_process'

export const YAYIN_EKRANI_URL = 'https://www.yayinekrani.com/spor/futbol'
export const YAYIN_EKRANI_READER_URL = 'https://r.jina.ai/http://yayinekrani.com/spor/futbol'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

function cleanText(value, maxLength = 120) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : ''
}

function normalize(value) {
  return cleanText(value, 200)
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function collectBroadcastNames(value, result = []) {
  if (Array.isArray(value)) {
    for (const entry of value) collectBroadcastNames(entry, result)
    return result
  }
  if (!value || typeof value !== 'object') return result
  const type = String(value['@type'] ?? '')
  const name = cleanText(value.name, 80)
  if (/BroadcastService/i.test(type) && name) result.push(name)
  return result
}

function competitionFromEvent(event, fixtureName) {
  const sentence = cleanText(event.name || event.description, 500)
  if (!sentence) return 'Futbol'
  const withoutFixture = sentence.startsWith(fixtureName)
    ? sentence.slice(fixtureName.length).trim()
    : sentence
  const competition = withoutFixture
    .replace(/\s+ma[çc][ıi],?[\s\S]*$/i, '')
    .replace(/\s+karşılaşması,?[\s\S]*$/i, '')
    .trim()
  return competition || 'Futbol'
}

function parseJsonLdBlocks(html) {
  const values = []
  const pattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  for (const match of html.matchAll(pattern)) {
    try {
      values.push(JSON.parse(match[1].trim()))
    } catch {
      // Reklam veya bozuk bir yardımcı JSON-LD bloğu ana maç listesini engellemez.
    }
  }
  return values.flatMap((value) => Array.isArray(value) ? value : [value])
}

function eventId(event, startsAt, homeTeam, awayTeam) {
  const image = cleanText(event.broadcastOfEvent?.image, 500)
  const imageId = /\/event\/(\d+)/i.exec(image)?.[1]
  if (imageId) return `yayin:${imageId}`
  const raw = `${homeTeam}|${awayTeam}|${startsAt}`
  return `yayin:${Buffer.from(raw).toString('base64url').slice(0, 40)}`
}

const MARKDOWN_COMPETITIONS = [
  'UEFA Avrupa Konferans Ligi Play-Off',
  'UEFA Avrupa Ligi Play-Off',
  'UEFA Şampiyonlar Ligi',
  'Trendyol Süper Lig',
  'Trendyol 1. Lig',
  'İngiltere Premier Lig',
  'İspanya La Liga',
  'İtalya Serie A',
  'Almanya Bundesliga 2',
  'Almanya Bundesliga',
  'Almanya Kupası DFB Pokal',
  'Fransa Ligue 1',
  'Suudi Arabistan Pro Lig',
  'ABD USL Championship',
  'Azerbaycan Premier Ligi',
  'İskoçya Premiership',
]

const MARKDOWN_IMAGE = /!\[Image\s+\d+:\s*([^\]]+)\]\([^)]*\)/gi

function parseMarkdownCompetition(value) {
  const lower = value.toLocaleLowerCase('tr-TR')
  const candidates = MARKDOWN_COMPETITIONS
    .map((name) => ({ name, index: lower.indexOf(name.toLocaleLowerCase('tr-TR')) }))
    .filter((entry) => entry.index >= 0)
    .sort((left, right) => left.index - right.index || right.name.length - left.name.length)
  return candidates[0]
}

/**
 * Jina Reader yedeğinin Markdown çıktısını aynı maç modeline dönüştürür.
 * GitHub Actions IP'si doğrudan Yayın Ekranı JSON-LD'sini alamadığında kullanılır.
 */
export function parseYayinEkraniMarkdown(markdown, options = {}) {
  const now = options.now instanceof Date ? options.now.getTime() : Number(options.now ?? Date.now())
  const lookAheadHours = Math.max(12, Math.min(336, Number(options.lookAheadHours ?? 192)))
  const windowStart = now - 6 * 60 * 60 * 1000
  const windowEnd = now + lookAheadHours * 60 * 60 * 1000
  const tracked = Array.isArray(options.trackedTeams)
    ? options.trackedTeams.map(normalize).filter(Boolean)
    : []
  const includeAll = options.includeAll !== false
  const seen = new Set()
  const matches = []
  const source = String(markdown ?? '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ')
  const eventPattern = /\[!\[Image\s+\d+:\s*Futbol\]\([^)]*\)\s*(\d{1,2}:\d{2})\s+([\s\S]*?)\]\((?:https?:\/\/)?(?:www\.)?yayinekrani\.com\/mac\/(\d+)\/(\d{4})\/(\d{2})\/(\d{2})\/[^)]+\)/gi

  for (const event of source.matchAll(eventPattern)) {
    const time = event[1]
    const body = event[2]
    const imageLabels = [...body.matchAll(MARKDOWN_IMAGE)].map((entry) => cleanText(entry[1], 80))
    const channels = [...new Set(imageLabels)].filter((name) => !/^futbol$/i.test(name) && !/^(yayın yok|yayıncı belli değil)$/i.test(name))
    const text = body.replace(MARKDOWN_IMAGE, '').replace(/\[[^\]]+\]\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
    const competitionMatch = parseMarkdownCompetition(text)
    const competition = competitionMatch?.name || 'Futbol'
    const fixture = (competitionMatch ? text.slice(0, competitionMatch.index) : text).replace(/\s+ertelendi$/i, '').trim()
    const separator = fixture.lastIndexOf(' - ')
    if (separator < 1) continue
    const homeTeam = cleanText(fixture.slice(0, separator), 80)
    const awayTeam = cleanText(fixture.slice(separator + 3), 80)
    if (!homeTeam || !awayTeam) continue
    if (!includeAll && tracked.length > 0) {
      const haystack = normalize(`${homeTeam} ${awayTeam}`)
      if (!tracked.some((team) => (` ${haystack} `).includes(` ${team} `))) continue
    }

    const startsAtMs = Date.parse(`${event[4]}-${event[5]}-${event[6]}T${time}:00+03:00`)
    if (!Number.isFinite(startsAtMs) || startsAtMs < windowStart || startsAtMs > windowEnd) continue
    const startsAt = new Date(startsAtMs).toISOString()
    const id = `yayin:${event[3]}`
    if (seen.has(id)) continue
    seen.add(id)
    matches.push({
      id,
      homeTeam,
      awayTeam,
      competition,
      startsAt,
      channelName: channels.join(' / ').slice(0, 100),
      isFriendly: /haz[ıi]rl[ıi]k|friendly|dostluk/i.test(competition),
    })
  }

  return matches.sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))
}

export function parseYayinEkraniHtml(html, options = {}) {
  const now = options.now instanceof Date ? options.now.getTime() : Number(options.now ?? Date.now())
  const lookAheadHours = Math.max(12, Math.min(336, Number(options.lookAheadHours ?? 192)))
  const windowStart = now - 6 * 60 * 60 * 1000
  const windowEnd = now + lookAheadHours * 60 * 60 * 1000
  const tracked = Array.isArray(options.trackedTeams)
    ? options.trackedTeams.map(normalize).filter(Boolean)
    : []
  const includeAll = options.includeAll !== false
  const seen = new Set()
  const matches = []

  for (const event of parseJsonLdBlocks(html)) {
    if (!event || typeof event !== 'object' || event['@type'] !== 'BroadcastEvent') continue
    const fixture = event.broadcastOfEvent
    if (!fixture || typeof fixture !== 'object') continue
    const homeTeam = cleanText(fixture.homeTeam?.name, 80)
    const awayTeam = cleanText(fixture.awayTeam?.name, 80)
    if (!homeTeam || !awayTeam) continue
    if (!includeAll && tracked.length > 0) {
      const haystack = normalize(`${homeTeam} ${awayTeam}`)
      if (!tracked.some((team) => (` ${haystack} `).includes(` ${team} `))) continue
    }

    const startsAtMs = Date.parse(fixture.startDate)
    if (!Number.isFinite(startsAtMs) || startsAtMs < windowStart || startsAtMs > windowEnd) continue
    const startsAt = new Date(startsAtMs).toISOString()
    const id = eventId(event, startsAt, homeTeam, awayTeam)
    if (seen.has(id)) continue
    seen.add(id)

    const fixtureName = cleanText(fixture.name, 180) || `${homeTeam} - ${awayTeam}`
    const competition = competitionFromEvent(event, fixtureName)
    const channels = [...new Set(collectBroadcastNames(fixture.recordedAt))]
      .filter((name) => !/^(yayın yok|yayıncı belli değil)$/i.test(name))
    matches.push({
      id,
      homeTeam,
      awayTeam,
      competition,
      startsAt,
      channelName: channels.join(' / ').slice(0, 100),
      isFriendly: /haz[ıi]rl[ıi]k|friendly|dostluk/i.test(competition),
    })
  }

  return matches.sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))
}

export function fetchYayinEkraniBroadcasts(options = {}) {
  const url = options.url || YAYIN_EKRANI_URL
  const curl = (target, extra = []) => {
    try {
      return execFileSync(
        'curl',
        ['-fsSL', '--retry', '3', '--retry-delay', '2', '--max-time', '45', '--compressed', '-A', USER_AGENT, ...extra, target],
        { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
      )
    } catch {
      return ''
    }
  }

  const html = curl(url)
  if (html.includes('BroadcastEvent')) return parseYayinEkraniHtml(html, options)

  const reader = curl(YAYIN_EKRANI_READER_URL, ['-H', 'Accept: text/markdown'])
  const markdownMatches = parseYayinEkraniMarkdown(reader, options)
  if (markdownMatches.length > 0) return markdownMatches
  throw new Error('Yayın Ekranı doğrudan ve yedek okuyucu üzerinden veri döndürmedi')
}
