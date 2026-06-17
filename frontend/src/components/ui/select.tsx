import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  placeholder?: string
  selectClassName?: string
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, selectClassName, children, placeholder, ...props }, ref) => {
    return (
      <div className={cn('relative inline-flex h-9 w-full', className)}>
        <select
          className={cn(
            'appearance-none h-full w-full rounded-md border border-border bg-background px-2.5 pr-7 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer',
            selectClassName,
          )}
          ref={ref}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      </div>
    )
  },
)
Select.displayName = 'Select'

export { Select }
