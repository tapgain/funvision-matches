/**
 * Sporx "TV'de Bugün" sayfasından maç yayın akışı çekici.
 *
 * Kaynak: https://www.sporx.com/tvdebugun/  (günlük yayın akışı; kanal adı açık)
 * Çıktı: maç girdileri — homeTeam, awayTeam, startsAt (yerel saat), channelName
 *
 * Sayfa windows-1254 kodludur; bozuk karakterler için küçük eşleme uygulanır.
 */
import { execFileSync } from 'node:child_process'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const PAGE_URL = 'https://www.sporx.com/tvdebugun/'

const WIN1254_TO_UTF8 = {
  '\u00FD': 'ı', '\u00DD': 'İ', '\u00FE': 'ş', '\u00DE': 'Ş',
  '\u00F0': 'ğ', '\u00D0': 'Ğ',
}

function decodeWindows1254(buffer) {
  return buffer
    .toString('latin1')
    .replace(/[\u00FD\u00DD\u00FE\u00DE\u00F0\u00D0]/g, (ch) => WIN1254_TO_UTF8[ch] ?? ch)
}

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

/** Günün tarihini (yerel saat dilimi) verilen HH:MM ile birleştirir. */
function startsAtForLocalTime(timeText, now = new Date()) {
  const match = /(\d{1,2}):(\d{2})/.exec(timeText)
  if (!match) return undefined
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(match[1]), Number(match[2]), 0, 0)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

export async function fetchSporxBroadcasts(trackedTeams = [], now = new Date()) {
  const html = decodeWindows1254(execFileSync('curl', ['-s', '-m', '20', '-L', '-H', `User-Agent: ${UA}`, PAGE_URL], { maxBuffer: 8 * 1024 * 1024 }))

  const entries = []
  const liPattern = /<li[^>]*>\s*<span class="ch-type">([^<]*)<\/span>\s*<span class="ch-time">([^<]*)<\/span>[\s\S]{0,400}?<span class="ch-name[^"]*">\s*([^<]*?)(?:<img[\s\S]{0,200}?alt="([^"]*)"[\s\S]{0,100}?>)?\s*<\/span>\s*<span class="ch-text">([^<]*)<\/span>/g
  for (const m of html.matchAll(liPattern)) {
    const timeText = m[2].trim()
    const channel = (m[4] || m[3] || '').trim().replace(/\s+/g, ' ')
    const program = m[5].trim()
    if (!timeText || !channel || !program) continue
    const fixture = splitFixture(program)
    if (!fixture) continue
    const startsAt = startsAtForLocalTime(timeText, now)
    if (!startsAt) continue
    entries.push({
      id: `sporx:${Buffer.from(`${fixture.homeTeam}|${fixture.awayTeam}|${startsAt}`).toString('base64url').slice(0, 24)}`,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      competition: 'Futbol',
      startsAt,
      channelName: channel,
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
