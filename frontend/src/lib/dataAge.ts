/** "just now", "10 min ago", "3 h ago", "2 d ago": how old a cluster's last successful fetch is. */
export function formatDataAge(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) return 'no data yet'
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.floor(hours / 24)} d ago`
}
