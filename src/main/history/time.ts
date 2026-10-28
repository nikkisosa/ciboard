const p2 = (n: number): string => String(n).padStart(2, '0')

/** Local date as YYYY-MM-DD (day-folder name). */
export const dateStr = (d: Date): string =>
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`

/** HHmmss, used as the file-name prefix. */
export const fileTime = (d: Date): string =>
  `${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`

export const clock = (d: Date): string =>
  `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`

export const clockMs = (d: Date): string =>
  `${clock(d)}.${String(d.getMilliseconds()).padStart(3, '0')}`

export const dateTime = (d: Date): string => `${dateStr(d)} ${clock(d)}`

/** Safe, short file-name fragment. */
export function slug(s: string, max = 40): string {
  const out = s
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
  return out || 'session'
}
