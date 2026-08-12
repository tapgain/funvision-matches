/**
 * Sahadan TV Programı API kazıyıcısı.
 *
 * Uç nokta: https://www.sahadan.com/api/index/tv-program
 * (Mackolik altyapısı; gün penceresi 21:00 → ertesi gün 20:59, TV günü kuralı)
 * Kanallar Sporx'e göre spesifiktir: "S Sport Plus", "beIN SPORTS MAX 1" vb.
 * date_time_utc alanı UTC'dir (Sofascore/TheSportsDB ile aynı eksen).
 */
import { execFileSync } from 'node:child_process'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const API_URL = 'https://www.sahadan.com/api/index/tv-program'

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

function pad(value) {
  return String(value).padStart(2, '0')
}

/** TV günü penceresi: gün D için başlangıç (D-1 21:00) ve bitiş (D 20:59). */
function dayWindow(day) {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1, 21, 0, 0)
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 20, 59, 0)
  const fmt = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
  const u =
    `${start.getFullYear()}${pad(start.getMonth() + 1)}${pad(start.getDate())}` +
    `${pad(start.getHours())}${pad(start.getMinutes())}00`
  return { start: fmt(start), end: fmt(end), u }
}

async function fetchDay(day) {
  const { start, end, u } = dayWindow(day)
  const url = `${API_URL}?a=bs&e=bsbm&u=${u}&application=mackolik.com&language=tr&country=tr&start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`
  const body = execFileSync('curl', ['-s', '-m', '20', '-H', `User-Agent: ${UA}`, url], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  const parsed = JSON.parse(body)
  return parsed.data?.broadcasts ?? []
}

/**
 * Önümüzdeki `days` günün (bugün dahil) yayınlarını çeker.
 * @param {string[]} trackedTeams
 * @param {Date} [now]
 * @param {number} [days]
 */
export async function fetchSahadanBroadcasts(trackedTeams = [], now = new Date(), days = 4) {
  const entries = []
  for (let offset = 0; offset < days; offset++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
    let broadcasts = []
    try {
      broadcasts = await fetchDay(day)
    } catch (error) {
      console.warn(`[sahadan] ${day.toISOString().slice(0, 10)} alınamadı: ${error.message}`)
      continue
    }
    for (const item of broadcasts) {
      // Yalnızca futbol (sport 1); U16 millî takımları vb. basketbol
      // karşılaşmaları FIBA kanallarıyla karışmasın.
      if (item.match?.sport !== 1) continue
      const fixture = splitFixture(item.match?.name ?? '')
      if (!fixture) continue
      const startsAt = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(item.date_time_utc ?? '')
        ? `${item.date_time_utc}Z`
        : undefined
      if (!startsAt) continue
      const channel = (item.channels ?? []).map((ch) => ch?.name).filter(Boolean).join(', ')
      if (!channel) continue
      entries.push({
        id: `sahadan:${Buffer.from(`${fixture.homeTeam}|${fixture.awayTeam}|${startsAt}`).toString('base64url').slice(0, 24)}`,
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
        competition: 'Futbol',
        startsAt,
        channelName: channel,
        isFriendly: false,
      })
    }
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
