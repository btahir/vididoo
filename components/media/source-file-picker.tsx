'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

type SourceFilePickerProps = {
  id?: string
  accept?: string
  placeholder?: string
  file?: File | null
  disabled?: boolean
  className?: string
  onFileSelected?: (file: File | null) => void
}

export function SourceFilePicker({
  id,
  accept,
  placeholder = 'Select a file',
  file,
  disabled,
  className,
  onFileSelected,
}: SourceFilePickerProps) {
  const inputId = id ?? React.useId()
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextFile = event.target.files?.[0] ?? null
      onFileSelected?.(nextFile)
    },
    [onFileSelected],
  )

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        onChange={handleChange}
        disabled={disabled}
        className="sr-only"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className={cn(
          'flex flex-1 items-center justify-between gap-3 rounded-lg border border-white/10 bg-slate-900/60 px-4 py-3 text-left text-sm text-slate-200 transition hover:border-orange-400/40 hover:bg-slate-900/80',
          disabled && 'cursor-not-allowed opacity-70',
        )}
      >
        <span className="truncate">
          {file ? `${file.name} • ${formatFileSize(file.size)}` : placeholder}
        </span>
        <span className="shrink-0 rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">
          Browse
        </span>
      </button>
    </div>
  )
}

function formatFileSize(size: number) {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = size
  let index = 0

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index++
  }

  return `${value.toFixed(value < 10 && index > 0 ? 1 : 0)} ${units[index]}`
}
