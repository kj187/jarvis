import { useState } from 'react'
import { format, addHours } from 'date-fns'
import { Plus, Minus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { useUpsertSilence } from '@/hooks/useSilences'
import type { Silence } from '@/types'

const USERNAME_KEY = 'jarvis-username'

interface SilenceFormProps {
  clusters: string[]
  defaultCluster?: string
  prefillSilence?: Silence
  onSuccess: () => void
  onCancel: () => void
}

type SilenceMatcher = {
  id: number
  name: string
  operator: '=' | '!=' | '=~' | '!~'
  value: string
}

function toISO(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm")
}

let _id = 1
const nextId = () => _id++

export function SilenceForm({
  clusters,
  defaultCluster,
  prefillSilence,
  onSuccess,
  onCancel,
}: SilenceFormProps) {
  const now = new Date()

  const [cluster, setCluster] = useState(defaultCluster ?? clusters[0] ?? '')
  const [createdBy, setCreatedBy] = useState(() => localStorage.getItem(USERNAME_KEY) ?? '')
  const [comment, setComment] = useState(prefillSilence?.comment ?? '')
  const [startsAt, setStartsAt] = useState(() =>
    prefillSilence ? toISO(new Date(prefillSilence.startsAt)) : toISO(now),
  )
  const [endsAt, setEndsAt] = useState(() =>
    prefillSilence ? toISO(new Date(prefillSilence.endsAt)) : toISO(addHours(now, 1)),
  )
  const [durationMode, setDurationMode] = useState<'calendar' | 'duration'>('calendar')
  const [durationHours, setDurationHours] = useState(1)

  const [matchers, setMatchers] = useState<SilenceMatcher[]>(() => {
    if (prefillSilence?.matchers) {
      return prefillSilence.matchers.map((m) => ({
        id: nextId(),
        name: m.name,
        operator: m.isRegex ? (m.isEqual ? '=~' : '!~') : m.isEqual ? '=' : '!=',
        value: m.value,
      }))
    }
    return [{ id: nextId(), name: '', operator: '=', value: '' }]
  })

  const upsert = useUpsertSilence()

  function updateDuration(h: number) {
    setDurationHours(h)
    const start = new Date(startsAt)
    setEndsAt(toISO(addHours(start, h)))
  }

  function addMatcher() {
    setMatchers((m) => [...m, { id: nextId(), name: '', operator: '=', value: '' }])
  }

  function removeMatcher(id: number) {
    setMatchers((m) => m.filter((x) => x.id !== id))
  }

  function updateMatcher(id: number, field: keyof SilenceMatcher, value: string) {
    setMatchers((m) =>
      m.map((x) => (x.id === id ? { ...x, [field]: value } : x)),
    )
  }

  function buildAMMatchers() {
    return matchers
      .filter((m) => m.name && m.value)
      .map((m) => ({
        isEqual: m.operator === '=' || m.operator === '=~',
        isRegex: m.operator === '=~' || m.operator === '!~',
        name: m.name,
        value: m.value,
      }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!comment.trim() || !cluster) return
    localStorage.setItem(USERNAME_KEY, createdBy.trim())

    const body = {
      cluster,
      matchers: buildAMMatchers(),
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      createdBy: createdBy.trim(),
      comment: comment.trim(),
      id: prefillSilence?.id,
    }
    upsert.mutate(body, { onSuccess })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Cluster */}
      <div>
        <label className="mb-1 block text-xs font-semibold text-muted-foreground">Cluster</label>
        <Select value={cluster} onChange={(e) => setCluster(e.target.value)} required>
          {clusters.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
      </div>

      {/* Matchers */}
      <div>
        <label className="mb-1 block text-xs font-semibold text-muted-foreground">Matcher</label>
        <div className="space-y-2">
          {matchers.map((m) => (
            <div key={m.id} className="flex items-center gap-1">
              <Input
                value={m.name}
                onChange={(e) => updateMatcher(m.id, 'name', e.target.value)}
                placeholder="label"
                className="h-8 text-xs"
              />
              <Select
                value={m.operator}
                onChange={(e) => updateMatcher(m.id, 'operator', e.target.value)}
                className="h-8 w-16 text-xs px-1"
              >
                <option value="=">=</option>
                <option value="!=">!=</option>
                <option value="=~">=~</option>
                <option value="!~">!~</option>
              </Select>
              <Input
                value={m.value}
                onChange={(e) => updateMatcher(m.id, 'value', e.target.value)}
                placeholder="value"
                className="h-8 text-xs"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => removeMatcher(m.id)}
                disabled={matchers.length === 1}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={addMatcher} className="text-xs">
            <Plus className="mr-1 h-3 w-3" />
            Matcher hinzufügen
          </Button>
        </div>
      </div>

      {/* Time mode toggle */}
      <div className="flex gap-2">
        <Button
          type="button"
          variant={durationMode === 'calendar' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setDurationMode('calendar')}
          className="text-xs"
        >
          Kalender
        </Button>
        <Button
          type="button"
          variant={durationMode === 'duration' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setDurationMode('duration')}
          className="text-xs"
        >
          Dauer
        </Button>
      </div>

      {durationMode === 'calendar' ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">Start</label>
            <Input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="text-xs"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">Ende</label>
            <Input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="text-xs"
            />
          </div>
        </div>
      ) : (
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted-foreground">
            Dauer: {durationHours}h (Ende: {endsAt})
          </label>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => updateDuration(Math.max(1, durationHours - 1))}>
              <Minus className="h-3 w-3" />
            </Button>
            <span className="w-8 text-center text-sm">{durationHours}h</span>
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => updateDuration(durationHours + 1)}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      {/* CreatedBy */}
      <div>
        <label className="mb-1 block text-xs font-semibold text-muted-foreground">Erstellt von</label>
        <Input
          value={createdBy}
          onChange={(e) => setCreatedBy(e.target.value)}
          placeholder="Dein Name"
          className="text-xs"
          required
        />
      </div>

      {/* Comment */}
      <div>
        <label className="mb-1 block text-xs font-semibold text-muted-foreground">Kommentar *</label>
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Grund für die Silence…"
          rows={3}
          required
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          type="submit"
          className="flex-1"
          disabled={!comment.trim() || upsert.isPending}
        >
          {prefillSilence ? 'Aktualisieren' : 'Erstellen'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Abbrechen
        </Button>
      </div>

      {upsert.isError && (
        <p className="text-xs text-destructive">
          Fehler: {upsert.error?.message}
        </p>
      )}
    </form>
  )
}
