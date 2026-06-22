import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { SilenceMatcher } from '@/types'

// = → isEqual:true,  isRegex:false
// !=→ isEqual:false, isRegex:false
// =~→ isEqual:true,  isRegex:true
// !~→ isEqual:false, isRegex:true
type Op = 'eq' | 'neq' | 're' | 'nre'

function toOp(m: SilenceMatcher): Op {
  if (!m.isRegex && m.isEqual) return 'eq'
  if (!m.isRegex && !m.isEqual) return 'neq'
  if (m.isRegex && m.isEqual) return 're'
  return 'nre'
}

function fromOp(op: Op): Pick<SilenceMatcher, 'isEqual' | 'isRegex'> {
  return {
    eq:  { isEqual: true,  isRegex: false },
    neq: { isEqual: false, isRegex: false },
    re:  { isEqual: true,  isRegex: true  },
    nre: { isEqual: false, isRegex: true  },
  }[op]
}

interface MatcherEditorProps {
  matcher: SilenceMatcher
  onChange: (matcher: SilenceMatcher) => void
  onRemove?: () => void
  showRemove?: boolean
}

export function MatcherEditor({
  matcher,
  onChange,
  onRemove,
  showRemove = true,
}: MatcherEditorProps) {
  return (
    <div className="flex gap-2 items-center">
      <Input
        value={matcher.name}
        onChange={(e) => onChange({ ...matcher, name: e.target.value })}
        placeholder="Label name"
        className="text-xs w-36 shrink-0"
      />

      <Select
        value={toOp(matcher)}
        onChange={(e) => onChange({ ...matcher, ...fromOp(e.currentTarget.value as Op) })}
        className="text-xs w-16 shrink-0"
      >
        <option value="eq">=</option>
        <option value="neq">!=</option>
        <option value="re">=~</option>
        <option value="nre">!~</option>
      </Select>

      <Input
        value={matcher.value}
        onChange={(e) => onChange({ ...matcher, value: e.target.value })}
        placeholder="Value"
        className="text-xs flex-1 min-w-0"
      />

      {showRemove && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="h-8 w-8 p-0 shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}
