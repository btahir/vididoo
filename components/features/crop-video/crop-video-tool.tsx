'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { SourceFilePicker } from '@/components/media/source-file-picker'
import { useMediabunny } from '@/hooks/use-mediabunny'
import { createBlobInput, createMp4Output } from '@/lib/mediabunny-loader'
import { cn } from '@/lib/utils'

import type * as MediabunnyModule from 'mediabunny'

type ConversionConstructor = typeof MediabunnyModule.Conversion
type ConversionInstance = Awaited<ReturnType<ConversionConstructor['init']>>

type Status = 'idle' | 'ready' | 'converting' | 'success' | 'error'

type Size = { width: number; height: number }
type NormalizedRect = { x: number; y: number; width: number; height: number }
type Point = { x: number; y: number }
type ResizeHandle =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'right'
  | 'bottom-right'
  | 'bottom'
  | 'bottom-left'
  | 'left'

type Interaction =
  | {
      kind: 'create'
      pointerId: number
      origin: Point
    }
  | {
      kind: 'move'
      pointerId: number
      origin: Point
      initialRect: NormalizedRect
    }
  | {
      kind: 'resize'
      pointerId: number
      origin: Point
      initialRect: NormalizedRect
      handle: ResizeHandle
    }

const MIN_SELECTION_PX = 32

export function CropVideoTool() {
  const [file, setFile] = React.useState<File | null>(null)
  const [videoUrl, setVideoUrl] = React.useState<string | null>(null)
  const [videoDimensions, setVideoDimensions] = React.useState<Size | null>(null)
  const [selection, setSelection] = React.useState<NormalizedRect | null>(null)

  const [status, setStatus] = React.useState<Status>('idle')
  const [progress, setProgress] = React.useState<number>(0)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [downloadName, setDownloadName] = React.useState<string | null>(null)

  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const interactionRef = React.useRef<Interaction | null>(null)
  const conversionRef = React.useRef<ConversionInstance | null>(null)

  const [containerSize, setContainerSize] = React.useState<Size | null>(null)

  const { mediabunny, loading, error, reload } = useMediabunny()

  React.useEffect(() => {
    return () => {
      if (conversionRef.current) {
        void conversionRef.current.cancel()
      }
    }
  }, [])

  React.useEffect(() => {
    return () => {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl)
      }
    }
  }, [videoUrl])

  React.useEffect(() => {
    if (!containerRef.current) return

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      setContainerSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })

    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
    }
  }, [videoUrl])

  const handleFileSelected = React.useCallback((nextFile: File | null) => {
    setFile(nextFile)
    setStatus(nextFile ? 'ready' : 'idle')
    setProgress(0)
    setErrorMessage(null)
    setDownloadName(null)
    setVideoDimensions(null)
    setSelection(null)

    setVideoUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev)
      }
      return nextFile ? URL.createObjectURL(nextFile) : null
    })
  }, [])

  const handleMetadataLoaded = React.useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    const element = event.currentTarget
    const naturalWidth = Math.round(element.videoWidth)
    const naturalHeight = Math.round(element.videoHeight)

    if (!naturalWidth || !naturalHeight) {
    setVideoDimensions(null)
    setSelection(null)
      setErrorMessage('Unable to read video dimensions. Try a different file.')
      setStatus('error')
      return
    }

    setVideoDimensions({ width: naturalWidth, height: naturalHeight })
    setSelection(null)
  }, [])

  const selectionPixels = React.useMemo(() => {
    if (!videoDimensions || !selection) return null

    return {
      x: selection.x * videoDimensions.width,
      y: selection.y * videoDimensions.height,
      width: selection.width * videoDimensions.width,
      height: selection.height * videoDimensions.height,
    }
  }, [selection, videoDimensions])

  const evenSelectionWidth = React.useMemo(() => {
    if (!selectionPixels) return null
    return ensureEven(Math.round(selectionPixels.width))
  }, [selectionPixels])

  const evenSelectionHeight = React.useMemo(() => {
    if (!selectionPixels) return null
    return ensureEven(Math.round(selectionPixels.height))
  }, [selectionPixels])

  const statusMessage = React.useMemo(() => {
    if (status === 'converting') {
      return { text: 'Cropping video…', tone: 'text-amber-200' }
    }
    if (status === 'success' && downloadName) {
      return { text: `Download started: ${downloadName}`, tone: 'text-emerald-200' }
    }
    if (status === 'error' && errorMessage) {
      return { text: errorMessage, tone: 'text-rose-300' }
    }
    if (error && status !== 'error') {
      return {
        text: 'Mediabunny failed to load. Try again.',
        tone: 'text-rose-300',
        action: () => reload().catch(() => undefined),
      }
    }
    return null
  }, [status, downloadName, errorMessage, error, reload])

  const converting = status === 'converting'
  const cropValid = !!selectionPixels && selectionPixels.width > 0 && selectionPixels.height > 0
  const disabled = converting || !file || !cropValid || loading

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!containerRef.current || !videoDimensions) return
      if (event.button !== 0) return

      event.preventDefault()

      const rect = containerRef.current.getBoundingClientRect()
      const point = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }

      const handle = (event.target as HTMLElement).dataset.handle as ResizeHandle | undefined
      const selectionElement = (event.target as HTMLElement).closest('[data-selection="true"]')

      if (handle && selection) {
        interactionRef.current = {
          kind: 'resize',
          pointerId: event.pointerId,
          origin: point,
          initialRect: selection,
          handle,
        }
      } else if (selectionElement && selection) {
        interactionRef.current = {
          kind: 'move',
          pointerId: event.pointerId,
          origin: point,
          initialRect: selection,
        }
      } else {
        interactionRef.current = {
          kind: 'create',
          pointerId: event.pointerId,
          origin: point,
        }
        setSelection({
          x: clampNumber(point.x / rect.width, 0, 1),
          y: clampNumber(point.y / rect.height, 0, 1),
          width: 0,
          height: 0,
        })
      }

      containerRef.current.setPointerCapture(event.pointerId)
      document.body.style.userSelect = 'none'
    },
    [selection, videoDimensions],
  )

  const handlePointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current
    if (!interaction || !containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const width = rect.width || 1
    const height = rect.height || 1
    const point = {
      x: clampNumber(event.clientX - rect.left, 0, width),
      y: clampNumber(event.clientY - rect.top, 0, height),
    }

    event.preventDefault()

    const minWidth = Math.min(MIN_SELECTION_PX / width, 1)
    const minHeight = Math.min(MIN_SELECTION_PX / height, 1)

    if (interaction.kind === 'create') {
      const start = interaction.origin
      const next = buildRectFromPoints(start, point, { width, height }, minWidth, minHeight)
      setSelection(next)
      return
    }

    if (!selection) return

    if (interaction.kind === 'move') {
      const deltaX = (point.x - interaction.origin.x) / width
      const deltaY = (point.y - interaction.origin.y) / height

      const next = clampRect(
        {
          x: interaction.initialRect.x + deltaX,
          y: interaction.initialRect.y + deltaY,
          width: interaction.initialRect.width,
          height: interaction.initialRect.height,
        },
        minWidth,
        minHeight,
      )

      setSelection(next)
      return
    }

    if (interaction.kind === 'resize') {
      const deltaX = (point.x - interaction.origin.x) / width
      const deltaY = (point.y - interaction.origin.y) / height
      const next = applyResize(interaction.initialRect, interaction.handle, deltaX, deltaY, minWidth, minHeight)
      setSelection(next)
    }
  }, [selection])

  const handlePointerUp = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (interactionRef.current && containerRef.current?.hasPointerCapture(event.pointerId)) {
      containerRef.current.releasePointerCapture(event.pointerId)
    }
    interactionRef.current = null
    document.body.style.userSelect = ''
  }, [])

  const convert = React.useCallback(async () => {
    if (!file) {
      setErrorMessage('Select a video file first.')
      setStatus('error')
      return
    }

    if (!videoDimensions || !selectionPixels) {
      setErrorMessage('Choose a valid crop before converting.')
      setStatus('error')
      return
    }

    const runtime = mediabunny ?? (await reload().catch(() => null))

    if (!runtime) {
      setErrorMessage('Unable to load Mediabunny. Please try again.')
      setStatus('error')
      return
    }

    setStatus('converting')
    setProgress(0)
    setErrorMessage(null)
    setDownloadName(null)

    let input: InstanceType<typeof runtime.Input> | null = null

    try {
      input = await createBlobInput(file, runtime)

      const { output, target, format } = createMp4Output(runtime)
      const desiredWidth = evenSelectionWidth ?? ensureEven(Math.round(selectionPixels.width))
      const desiredHeight = evenSelectionHeight ?? ensureEven(Math.round(selectionPixels.height))
      let finalWidthTracked = desiredWidth
      let finalHeightTracked = desiredHeight
      const conversion = await runtime.Conversion.init({
        input,
        output,
        video: {
          forceTranscode: true,
          process: (sample) => {
            const sampleWidth = sample.displayWidth
            const sampleHeight = sample.displayHeight

            const sx = clampNumber(Math.round(selectionPixels.x), 0, Math.max(0, sampleWidth - 1))
            const sy = clampNumber(Math.round(selectionPixels.y), 0, Math.max(0, sampleHeight - 1))
            const maxWidth = Math.max(2, sampleWidth - sx)
            const maxHeight = Math.max(2, sampleHeight - sy)
            const sWidth = ensureEvenWithinBounds(desiredWidth, maxWidth)
            const sHeight = ensureEvenWithinBounds(desiredHeight, maxHeight)

            const canvas = document.createElement('canvas')
            canvas.width = sWidth
            canvas.height = sHeight
            const context = canvas.getContext('2d')
            if (!context) {
              throw new Error('Unable to crop video frame.')
            }

            sample.draw(context, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight)

            finalWidthTracked = sWidth
            finalHeightTracked = sHeight

            return canvas
          },
        },
      })

      if (!conversion.isValid) {
        setStatus('error')
        setErrorMessage('Could not configure the crop for this file. Try a different video.')
        await output.cancel()
        return
      }

      conversionRef.current = conversion
      conversion.onProgress = (value) => {
        setProgress(Math.round(value * 100))
      }

      await conversion.execute()

      const buffer = target.buffer
      if (!buffer) {
        throw new Error('No video data produced.')
      }

      const blob = new Blob([buffer], { type: format.mimeType })
      const url = URL.createObjectURL(blob)
      const finalWidth = finalWidthTracked
      const finalHeight = finalHeightTracked

      const filename = buildOutputName(
        file.name,
        format.fileExtension,
        finalWidth,
        finalHeight,
      )
      triggerBrowserDownload(url, filename)

      setDownloadName(filename)
      setStatus('success')
      setProgress(100)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Cropping failed. Try again.'
      setErrorMessage(message)
      setStatus('error')
      setProgress(0)
    } finally {
      conversionRef.current = null
      if (input) {
        input.dispose()
      }
      document.body.style.userSelect = ''
    }
  }, [evenSelectionHeight, evenSelectionWidth, file, mediabunny, reload, selectionPixels, videoDimensions])

  return (
    <div className="flex flex-col gap-6">
      <SourceFilePicker
        accept="video/*"
        file={file}
        disabled={converting}
        placeholder="Select a video file"
        onFileSelected={handleFileSelected}
      />

      {videoUrl && (
        <div className="space-y-3">
          <div className="mx-auto w-full max-w-[720px]">
            <div
              ref={containerRef}
              className="relative overflow-hidden rounded-xl border border-slate-700/60 bg-black"
              style={{
                aspectRatio: videoDimensions ? `${videoDimensions.width}/${videoDimensions.height}` : '16/9',
                maxHeight: '320px',
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              <video
                src={videoUrl}
                controls
                playsInline
                muted
                className="h-full w-full object-contain"
                onLoadedMetadata={handleMetadataLoaded}
              />

              {selection && containerSize && (
                <SelectionOverlay selection={selection} containerSize={containerSize} />
              )}
            </div>
          </div>
          <p className="text-xs text-slate-300">
            Click and drag anywhere over the video to draw a crop box, then drag the edges or corners to refine it.
          </p>
          {!selection && (
            <p className="text-xs text-orange-300">
              No crop selected yet. Draw a rectangle to choose the portion you want to export.
            </p>
          )}
        </div>
      )}

      {videoDimensions && selectionPixels && (
        <div className="space-y-4 rounded-2xl border border-slate-700/60 bg-slate-900/50 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-200">
                Output size: {evenSelectionWidth ?? Math.round(selectionPixels.width)}px ×{' '}
                {evenSelectionHeight ?? Math.round(selectionPixels.height)}px
              </p>
              <p className="text-xs text-slate-400">
                Original resolution: {videoDimensions.width}px × {videoDimensions.height}px
              </p>
              <p className="text-xs text-slate-500">
                Dimensions snap to the nearest even values required by the AVC encoder.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSelection(null)}
              disabled={converting}
              className="border-slate-600/70 text-slate-600 hover:text-orange-400"
            >
              Clear selection
            </Button>
          </div>

          <div className="rounded-lg border border-slate-700/60 bg-slate-900/80 p-3">
            <p className="text-xs text-slate-300">
              Selection offset: {Math.round(selectionPixels.x)}px (left), {Math.round(selectionPixels.y)}px (top)
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {(status === 'converting' || progress > 0) && (
          <Progress value={progress} className="h-1.5 bg-slate-600" />
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={convert}
            disabled={disabled}
            className="rounded-full bg-linear-to-r from-orange-500 to-orange-600 px-6 text-white shadow-lg shadow-orange-500/30 transition hover:from-orange-400 hover:to-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === 'converting' ? 'Processing…' : 'Crop video'}
          </Button>
          {statusMessage && (
            <span className={cn('text-sm', statusMessage.tone)}>
              {statusMessage.text}
              {statusMessage.action && (
                <button
                  type="button"
                  onClick={statusMessage.action}
                  className="ml-2 text-orange-300 underline-offset-2 hover:underline"
                >
                  Retry
                </button>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

type SelectionOverlayProps = {
  selection: NormalizedRect
  containerSize: Size
}

function SelectionOverlay({ selection, containerSize }: SelectionOverlayProps) {
  const style = React.useMemo(() => {
    const left = selection.x * containerSize.width
    const top = selection.y * containerSize.height
    const width = selection.width * containerSize.width
    const height = selection.height * containerSize.height

    return {
      left,
      top,
      width,
      height,
    }
  }, [selection, containerSize])

  const handles: Array<{ id: ResizeHandle; className: string }> = [
    { id: 'top-left', className: 'top-0 left-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize' },
    { id: 'top', className: 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize' },
    { id: 'top-right', className: 'top-0 right-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize' },
    { id: 'right', className: 'top-1/2 right-0 translate-x-1/2 -translate-y-1/2 cursor-ew-resize' },
    { id: 'bottom-right', className: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize' },
    { id: 'bottom', className: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-ns-resize' },
    { id: 'bottom-left', className: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize' },
    { id: 'left', className: 'top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize' },
  ]

  return (
    <div className="absolute inset-0 pointer-events-none">
      <div
        data-selection="true"
        className="pointer-events-auto absolute rounded-lg border-2 border-orange-400/90 bg-orange-400/10 shadow-[0_0_0_9999px_rgba(15,23,42,0.55)]"
        style={style}
      >
        {handles.map((handle) => (
          <span
            key={handle.id}
            data-handle={handle.id}
            className={cn(
              'absolute h-3 w-3 rounded-full bg-orange-400 shadow-sm',
              'pointer-events-auto',
              handle.className,
            )}
          />
        ))}
      </div>
    </div>
  )
}

function buildRectFromPoints(start: Point, current: Point, container: Size, minWidth: number, minHeight: number) {
  const sx = clampNumber(start.x, 0, container.width)
  const sy = clampNumber(start.y, 0, container.height)
  const cx = clampNumber(current.x, 0, container.width)
  const cy = clampNumber(current.y, 0, container.height)

  let left = Math.min(sx, cx)
  let right = Math.max(sx, cx)
  let top = Math.min(sy, cy)
  let bottom = Math.max(sy, cy)

  const minWidthPx = minWidth * container.width
  const minHeightPx = minHeight * container.height

  if (right - left < minWidthPx) {
    if (sx <= cx) {
      right = clampNumber(left + minWidthPx, 0, container.width)
    } else {
      left = clampNumber(right - minWidthPx, 0, container.width)
    }
  }

  if (bottom - top < minHeightPx) {
    if (sy <= cy) {
      bottom = clampNumber(top + minHeightPx, 0, container.height)
    } else {
      top = clampNumber(bottom - minHeightPx, 0, container.height)
    }
  }

  const normalized = {
    x: left / container.width,
    y: top / container.height,
    width: (right - left) / container.width,
    height: (bottom - top) / container.height,
  }

  return clampRect(normalized, minWidth, minHeight)
}

function applyResize(
  initial: NormalizedRect,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
  minWidth: number,
  minHeight: number,
): NormalizedRect {
  let { x, y, width, height } = initial

  if (handle === 'left' || handle === 'top-left' || handle === 'bottom-left') {
    const maxX = initial.x + initial.width - minWidth
    const nextX = clampNumber(initial.x + deltaX, 0, maxX)
    width = width + (x - nextX)
    x = nextX
  }

  if (handle === 'right' || handle === 'top-right' || handle === 'bottom-right') {
    width = clampNumber(width + deltaX, minWidth, 1 - x)
  }

  if (handle === 'top' || handle === 'top-left' || handle === 'top-right') {
    const maxY = initial.y + initial.height - minHeight
    const nextY = clampNumber(initial.y + deltaY, 0, maxY)
    height = height + (y - nextY)
    y = nextY
  }

  if (handle === 'bottom' || handle === 'bottom-left' || handle === 'bottom-right') {
    height = clampNumber(height + deltaY, minHeight, 1 - y)
  }

  return clampRect({ x, y, width, height }, minWidth, minHeight)
}

function clampRect(rect: NormalizedRect, minWidth: number, minHeight: number): NormalizedRect {
  let { x, y, width, height } = rect

  width = Math.max(width, minWidth)
  height = Math.max(height, minHeight)

  x = clampNumber(x, 0, 1 - width)
  y = clampNumber(y, 0, 1 - height)

  if (x + width > 1) {
    x = Math.max(0, 1 - width)
  }
  if (y + height > 1) {
    y = Math.max(0, 1 - height)
  }

  return {
    x,
    y,
    width: clampNumber(width, minWidth, 1),
    height: clampNumber(height, minHeight, 1),
  }
}

function ensureEven(value: number) {
  let next = Math.max(2, Math.round(value))
  if (next % 2 !== 0) {
    next = next > 2 ? next - 1 : 2
  }
  return next
}

function ensureEvenWithinBounds(value: number, max: number) {
  const maxInt = Math.floor(max)
  if (maxInt < 2) {
    throw new Error('Selected crop is too small for AVC encoding.')
  }

  let next = Math.max(2, Math.round(value))
  if (next > maxInt) {
    next = maxInt
  }

  if (next % 2 !== 0) {
    if (next < maxInt) {
      next += 1
    } else {
      next -= 1
    }
  }

  if (next > maxInt) {
    const evenMax = maxInt - (maxInt % 2)
    next = evenMax >= 2 ? evenMax : 2
  }

  if (next < 2) {
    throw new Error('Selected crop is too small for AVC encoding.')
  }

  if (next % 2 !== 0) {
    next = Math.max(2, next - 1)
  }

  if (next > maxInt) {
    next = Math.max(2, maxInt - (maxInt % 2))
  }

  if (next < 2) {
    throw new Error('Selected crop is too small for AVC encoding.')
  }

  return next
}

function buildOutputName(original: string, extension: string, width: number, height: number) {
  const base = original.replace(/\.[^/.]+$/, '')
  return `${base}-cropped-${width}x${height}${extension}`
}

function triggerBrowserDownload(url: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function clampNumber(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min
  if (min > max) return min
  return Math.min(Math.max(value, min), max)
}
