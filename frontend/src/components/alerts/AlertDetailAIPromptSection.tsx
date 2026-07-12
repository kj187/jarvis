import { Check, Copy } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'

interface AlertDetailAIPromptSectionProps {
  promptText: string
  promptCopied: boolean
  setPromptCopied: Dispatch<SetStateAction<boolean>>
}

export function AlertDetailAIPromptSection({ promptText, promptCopied, setPromptCopied }: AlertDetailAIPromptSectionProps) {
  return (
    <div className="space-y-3 px-5 py-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Prompt with alert context for AI analysis</p>
        <button
          className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-accent cursor-pointer"
          onClick={() => {
            void navigator.clipboard.writeText(promptText)
            setPromptCopied(true)
            setTimeout(() => setPromptCopied(false), 2000)
          }}
        >
          {promptCopied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
          {promptCopied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="rounded bg-accent/30 p-3 text-[10px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words">
        {promptText}
      </pre>
    </div>
  )
}
