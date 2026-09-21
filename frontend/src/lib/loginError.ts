/** Failed POST /auth/login, carrying the HTTP status of the response. */
export class LoginError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`login failed: ${status}`)
    this.name = 'LoginError'
    this.status = status
  }
}

/**
 * User-facing text for a failed login. The login endpoint has one global rate
 * limit shared by all clients, so a 429 says nothing about the entered
 * credentials and must not be reported as "invalid".
 */
export function loginErrorMessage(err: unknown): string {
  if (err instanceof LoginError && err.status === 429) {
    return 'Too many login attempts. Please try again in a moment.'
  }
  return 'Invalid username or password.'
}
