/** "20 minutes", "1 hour", "90 minutes": how long a recently resolved alert stays in the live view. */
export function formatBufferWindow(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  }
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
}
