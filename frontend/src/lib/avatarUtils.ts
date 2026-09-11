// Deterministic initials-avatar for the header — same username always maps
// to the same initials and color, so it doesn't flicker across reloads or
// between the desktop/mobile header variants. Kept out of the component file
// (plain exports) so react-refresh doesn't flag mixing components and
// constants in one module, matching the heatmapUtils.ts convention.

export const AVATAR_COLOR_CLASSES = [
  'bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-lime-500', 'bg-green-500',
  'bg-teal-500', 'bg-cyan-500', 'bg-blue-500', 'bg-indigo-500', 'bg-violet-500',
  'bg-purple-500', 'bg-pink-500',
]

export function avatarInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const parts = trimmed.split(/[\s._-]+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return trimmed.slice(0, 2).toUpperCase()
}

export function avatarColorClass(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return AVATAR_COLOR_CLASSES[Math.abs(hash) % AVATAR_COLOR_CLASSES.length]
}
