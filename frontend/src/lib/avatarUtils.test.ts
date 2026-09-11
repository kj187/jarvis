import { describe, expect, it } from 'vitest'
import { AVATAR_COLOR_CLASSES, avatarColorClass, avatarInitials } from './avatarUtils'

describe('avatarInitials', () => {
  it('takes the first letter of the first two words', () => {
    expect(avatarInitials('Julian Kleinhans')).toBe('JK')
  })

  it('uses the first two letters for a single word', () => {
    expect(avatarInitials('admin')).toBe('AD')
  })

  it('splits on dots, underscores and hyphens like a username', () => {
    expect(avatarInitials('julian.kleinhans')).toBe('JK')
    expect(avatarInitials('julian_kleinhans')).toBe('JK')
    expect(avatarInitials('julian-kleinhans')).toBe('JK')
  })

  it('falls back to "?" for an empty or whitespace-only name', () => {
    expect(avatarInitials('')).toBe('?')
    expect(avatarInitials('   ')).toBe('?')
  })

  it('uppercases the result', () => {
    expect(avatarInitials('bob')).toBe('BO')
  })

  it('handles a single-character name', () => {
    expect(avatarInitials('x')).toBe('X')
  })
})

describe('avatarColorClass', () => {
  it('returns a class from the fixed palette', () => {
    expect(AVATAR_COLOR_CLASSES).toContain(avatarColorClass('julian'))
  })

  it('is deterministic for the same name', () => {
    expect(avatarColorClass('julian')).toBe(avatarColorClass('julian'))
  })

  it('spreads different names across more than one color', () => {
    const names = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'heidi', 'ivan', 'judy', 'mallory', 'niaj', 'olivia', 'peggy']
    const colors = new Set(names.map(avatarColorClass))
    expect(colors.size).toBeGreaterThan(1)
  })

  it('handles an empty name without throwing', () => {
    expect(AVATAR_COLOR_CLASSES).toContain(avatarColorClass(''))
  })
})
