import { describe, expect, it } from 'vitest'
import { AuthUnavailableError, readAuthMe, ssoCheckOutcome } from './authMe'

const user = { id: 'u1', username: 'alice', role: 'user' }

function respond(status: number, body: unknown = {}) {
  return async () => new Response(JSON.stringify(body), { status })
}

describe('readAuthMe', () => {
  it('returns the user on 200', async () => {
    await expect(readAuthMe(respond(200, user))).resolves.toEqual(user)
  })

  it('treats 401 and 403 as signed out', async () => {
    await expect(readAuthMe(respond(401))).resolves.toBeNull()
    await expect(readAuthMe(respond(403))).resolves.toBeNull()
  })

  it('does not report signed out for a server error', async () => {
    await expect(readAuthMe(respond(503))).rejects.toBeInstanceOf(AuthUnavailableError)
    await expect(readAuthMe(respond(500))).rejects.toBeInstanceOf(AuthUnavailableError)
  })

  it('does not report signed out for a network failure', async () => {
    const failing = async () => {
      throw new TypeError('Failed to fetch')
    }
    await expect(readAuthMe(failing)).rejects.toBeInstanceOf(AuthUnavailableError)
  })
})

describe('ssoCheckOutcome', () => {
  it('keeps waiting while the popup is open and the state is unknown', async () => {
    const fail = async () => {
      throw new AuthUnavailableError()
    }
    await expect(ssoCheckOutcome(fail, () => false)).resolves.toEqual({ settled: false })
  })

  it('ends the flow signed out when the popup is closed and the state is unknown', async () => {
    const fail = async () => {
      throw new AuthUnavailableError()
    }
    await expect(ssoCheckOutcome(fail, () => true)).resolves.toEqual({ settled: true, user: null })
  })

  it('finishes with the user as soon as a session exists', async () => {
    await expect(ssoCheckOutcome(async () => user, () => false)).resolves.toEqual({ settled: true, user })
  })

  it('keeps waiting when signed out and the popup is still open, ends when it closes', async () => {
    await expect(ssoCheckOutcome(async () => null, () => false)).resolves.toEqual({ settled: false })
    await expect(ssoCheckOutcome(async () => null, () => true)).resolves.toEqual({ settled: true, user: null })
  })
})
