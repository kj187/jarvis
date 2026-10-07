/** /auth/me could not be answered (5xx or network failure): the session state is unknown. */
export class AuthUnavailableError extends Error {
  constructor(message = 'auth/me unavailable') {
    super(message)
    this.name = 'AuthUnavailableError'
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/**
 * Reads the signed-in user. 401/403 (and any other client error) mean signed
 * out and resolve to null; a 5xx or a network failure throws
 * AuthUnavailableError, so a database blip is never mistaken for a logout.
 */
export async function readAuthMe<T>(fetchFn: FetchLike): Promise<T | null> {
  let res: Response
  try {
    res = await fetchFn('/auth/me', { headers: { Accept: 'application/json' } })
  } catch {
    throw new AuthUnavailableError()
  }
  if (res.ok) return (await res.json()) as T
  if (res.status >= 500) throw new AuthUnavailableError(`auth/me: ${res.status}`)
  return null
}
