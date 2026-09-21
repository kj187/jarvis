import { describe, expect, it } from 'vitest'
import { LoginError, loginErrorMessage } from './loginError'

describe('loginErrorMessage', () => {
  it('explains rate limiting on 429 instead of blaming the credentials', () => {
    expect(loginErrorMessage(new LoginError(429))).toBe(
      'Too many login attempts. Please try again in a moment.',
    )
  })

  it('reports invalid credentials for a 401', () => {
    expect(loginErrorMessage(new LoginError(401))).toBe('Invalid username or password.')
  })

  it('reports invalid credentials for any other failure', () => {
    expect(loginErrorMessage(new LoginError(500))).toBe('Invalid username or password.')
    expect(loginErrorMessage(new TypeError('Failed to fetch'))).toBe('Invalid username or password.')
    expect(loginErrorMessage(undefined)).toBe('Invalid username or password.')
  })

  it('keeps the HTTP status on the error', () => {
    expect(new LoginError(429).status).toBe(429)
  })
})
