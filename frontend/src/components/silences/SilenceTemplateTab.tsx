import { useState } from 'react'
import { Trash2, Loader2, AlertCircle, Edit2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useSilenceTemplates, useCreateSilenceTemplate, useUpdateSilenceTemplate, useDeleteSilenceTemplate } from '@/hooks/useSilenceTemplates'
import { useLoginGuard } from '@/hooks/useLoginGuard'
import { LoginModal } from '@/components/auth/LoginModal'
import { MatcherEditor } from './MatcherEditor'
import type { SilenceMatcher, SilenceTemplate } from '@/types'

export function SilenceTemplateTab() {
  const { data: templates = [], isLoading } = useSilenceTemplates()
  const createMutation = useCreateSilenceTemplate()
  const updateMutation = useUpdateSilenceTemplate()
  const deleteMutation = useDeleteSilenceTemplate()

  const { guard, loginModalOpen, onLoginSuccess, onLoginClose } = useLoginGuard()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    matchers: [] as SilenceMatcher[],
    reason: '',
  })
  const [error, setError] = useState('')

  function handleAddMatcher() {
    setFormData((prev) => ({
      ...prev,
      matchers: [...prev.matchers, { name: '', value: '', isEqual: true, isRegex: false }],
    }))
  }

  function handleUpdateMatcher(index: number, matcher: SilenceMatcher) {
    setFormData((prev) => ({
      ...prev,
      matchers: prev.matchers.map((m, i) => (i === index ? matcher : m)),
    }))
  }

  function handleRemoveMatcher(index: number) {
    setFormData((prev) => ({
      ...prev,
      matchers: prev.matchers.filter((_, i) => i !== index),
    }))
  }

  function handleEditTemplate(template: SilenceTemplate) {
    setEditingId(template.id)
    setFormData({
      name: template.name,
      matchers: template.matchers,
      reason: template.reason,
    })
    setShowForm(true)
    setError('')
  }

  function handleCancelEdit() {
    setEditingId(null)
    setFormData({ name: '', matchers: [], reason: '' })
    setShowForm(false)
    setError('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!formData.name.trim()) {
      setError('Name is required')
      return
    }
    if (formData.matchers.length === 0) {
      setError('At least one matcher is required')
      return
    }
    if (formData.matchers.some((m) => !m.name || !m.value)) {
      setError('All matchers must have name and value')
      return
    }

    guard(async () => {
      try {
        if (editingId) {
          await updateMutation.mutateAsync({
            id: editingId,
            name: formData.name,
            matchers: formData.matchers,
            reason: formData.reason,
          })
        } else {
          await createMutation.mutateAsync({
            name: formData.name,
            matchers: formData.matchers,
            reason: formData.reason,
          })
        }
        handleCancelEdit()
      } catch (err) {
        setError((err as Error).message)
      }
    })
  }

  function handleDeleteTemplate(id: string) {
    guard(() => {
      if (confirm('Delete this template?')) {
        deleteMutation.mutate(id)
      }
    })
  }

  if (isLoading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading templates…</div>
  }

  return (
    <div className="space-y-4 p-4">
      {/* Template List */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Saved Templates</h3>
        {templates.length === 0 ? (
          <p className="text-xs text-muted-foreground mb-3">No templates yet.</p>
        ) : (
          <div className="space-y-2 mb-4">
            {templates.map((template) => (
              <div
                key={template.id}
                className="flex items-start justify-between gap-2 p-2 rounded border border-border bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{template.name}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{template.reason}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {template.matchers.length} matcher{template.matchers.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEditTemplate(template)}
                    className="h-8 w-8 p-0"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteTemplate(template.id)}
                    disabled={deleteMutation.isPending}
                    className="h-8 w-8 p-0"
                  >
                    {deleteMutation.isPending && deleteMutation.variables === template.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Form Toggle */}
      {!showForm && (
        <Button onClick={() => { setEditingId(null); setShowForm(true) }} className="w-full" size="sm">
          + New Template
        </Button>
      )}

      {/* Template Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="space-y-3 p-3 border rounded bg-muted/30">
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-sm font-medium">{editingId ? 'Edit Template' : 'New Template'}</h4>
            <button
              type="button"
              onClick={handleCancelEdit}
              className="cursor-pointer"
              aria-label="Close"
            >
              <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
            </button>
          </div>

          {error && (
            <div className="flex gap-2 p-2 bg-destructive/10 border border-destructive/30 rounded text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="text-xs font-medium block mb-1">Name</label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., Prod Maintenance"
              className="text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-medium block mb-2">Matchers</label>
            <div className="space-y-2">
              {formData.matchers.map((matcher, idx) => (
                <MatcherEditor
                  key={idx}
                  matcher={matcher}
                  onChange={(m) => handleUpdateMatcher(idx, m)}
                  onRemove={() => handleRemoveMatcher(idx)}
                  showRemove={formData.matchers.length > 1}
                />
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddMatcher}
                className="w-full text-xs"
              >
                + Add Matcher
              </Button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium block mb-1">Reason (optional)</label>
            <Textarea
              value={formData.reason}
              onChange={(e) => setFormData((prev) => ({ ...prev, reason: e.target.value }))}
              placeholder="e.g., Scheduled maintenance window"
              className="text-sm min-h-16"
            />
          </div>

          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              className="flex-1 text-sm"
              size="sm"
            >
              {(createMutation.isPending || updateMutation.isPending) ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                editingId ? 'Update Template' : 'Save Template'
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleCancelEdit}
              className="flex-1 text-sm"
              size="sm"
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      <LoginModal open={loginModalOpen} onSuccess={onLoginSuccess} onClose={onLoginClose} />
    </div>
  )
}
