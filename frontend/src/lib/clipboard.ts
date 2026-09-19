/**
 * Copies text to the clipboard. Resolves true on success.
 *
 * `navigator.clipboard` only exists in secure contexts (https or localhost) — and Jarvis is
 * often served over plain http inside a cluster — so fall back to a hidden textarea and
 * `execCommand('copy')`, which works everywhere and only needs a user gesture.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Permission denied or not focused — try the fallback below.
    }
  }
  return copyViaSelection(text)
}

function copyViaSelection(text: string): boolean {
  const el = document.createElement('textarea')
  el.value = text
  el.setAttribute('readonly', '')
  el.style.position = 'fixed'
  el.style.top = '0'
  el.style.opacity = '0'
  document.body.appendChild(el)
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
  try {
    el.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(el)
    previouslyFocused?.focus()
  }
}
