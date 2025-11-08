'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { SourceFilePicker } from '@/components/media/source-file-picker'
import { useMediabunny } from '@/hooks/use-mediabunny'
import { createBlobInput, createMp4Output } from '@/lib/mediabunny-loader'
import { cn } from '@/lib/utils'

import type * as MediabunnyModule from 'mediabunny'

type Mediabunny = typeof MediabunnyModule
type ConversionConstructor = typeof MediabunnyModule.Conversion
type ConversionInstance = Awaited<ReturnType<ConversionConstructor['init']>>

type Status = 'idle' | 'ready' | 'converting' | 'success' | 'error'

type Size = { width: number; height: number }
type NormalizedRect = { x: number; y: number; width: number; height: number }

type Interaction =
  | {
      kind: 'move'
      pointerId: number
      origin: { x: number; y: number }
      initialRect: NormalizedRect
    }
  | {
    kind: 'resize'
    pointerId: number
    origin: { x: number; y: number }
    initialRect: NormalizedRect
    handle: ResizeHandle
  }

type ResizeHandle = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

const MIN_SIZE_RATIO = 0.08

export function AddWatermarkTool() {
  const [videoFile, setVideoFile] = React.useState<File | null>(null)
  const [videoUrl, setVideoUrl] = React.useState<string | null>(null)
  const [videoDimensions, setVideoDimensions] = React.useState<Size | null>(null)

  const [watermarkFile, setWatermarkFile] = React.useState<File | null>(null)
  const [watermarkPreviewUrl, setWatermarkPreviewUrl] = React.useState<string | null>(null)
  const [watermarkSize, setWatermarkSize] = React.useState<Size | null>(null)
  const [watermarkRect, setWatermarkRect] = React.useState<NormalizedRect | null>(null)

  const [opacity, setOpacity] = React.useState<number>(1)

  const [status, setStatus] = React.useState<Status>('idle')
  const [progress, setProgress] = React.useState<number>(0)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [downloadName, setDownloadName] = React.useState<string | null>(null)

  const conversionRef = React.useRef<ConversionInstance | null>(null)
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const interactionRef = React.useRef<Interaction | null>(null)

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
      if (videoUrl) URL.revokeObjectURL(videoUrl)
    }
  }, [videoUrl])

  React.useEffect(() => {
    return () => {
      if (watermarkPreviewUrl) URL.revokeObjectURL(watermarkPreviewUrl)
    }
  }, [watermarkPreviewUrl])

  React.useEffect(() => {
    if (!watermarkRect && videoDimensions && watermarkSize) {
      const aspect = watermarkSize.width / watermarkSize.height
      const baseWidthRatio = clampNumber(0.25, MIN_SIZE_RATIO, 0.9)
      let widthRatio = baseWidthRatio
      let heightRatio = widthRatio / aspect

      if (heightRatio > 0.9) {
        heightRatio = 0.9
        widthRatio = heightRatio * aspect
      }

      widthRatio = clampNumber(widthRatio, MIN_SIZE_RATIO, 0.95)
      heightRatio = clampNumber(heightRatio, MIN_SIZE_RATIO, 0.95)

      setWatermarkRect({
        width: widthRatio,
        height: heightRatio,
        x: clampNumber((1 - widthRatio) / 2, 0, 1 - widthRatio),
        y: clampNumber((1 - heightRatio) / 2, 0, 1 - heightRatio),
      })
    }
  }, [videoDimensions, watermarkRect, watermarkSize])

  const handleVideoSelected = React.useCallback((file: File | null) => {
    setVideoFile(file)
    setStatus(file ? 'ready' : 'idle')
    setProgress(0)
    setErrorMessage(null)
    setDownloadName(null)
    setVideoDimensions(null)

    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return file ? URL.createObjectURL(file) : null
    })
  }, [])

  const handleVideoMetadata = React.useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    const element = event.currentTarget
    const width = Math.round(element.videoWidth)
    const height = Math.round(element.videoHeight)

    if (!width || !height) {
      setVideoDimensions(null)
      setErrorMessage('Unable to read the video resolution.')
      setStatus('error')
      return
    }

    setVideoDimensions({ width, height })
  }, [])

  const handleWatermarkSelected = React.useCallback((file: File | null) => {
    setWatermarkFile(file)
    setWatermarkSize(null)
    setProgress(0)
    setErrorMessage(null)
    setDownloadName(null)

    setWatermarkPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return file ? URL.createObjectURL(file) : null
    })

    if (!file) {
      setWatermarkRect(null)
    }
  }, [])

  React.useEffect(() => {
    if (!watermarkFile) return

    let active = true
    loadImage(watermarkFile)
      .then((image) => {
        if (!active) return
        setWatermarkSize({ width: image.naturalWidth, height: image.naturalHeight })
      })
      .catch((err) => {
        console.error(err)
        if (active) {
          setErrorMessage('Failed to load watermark image.')
          setStatus('error')
        }
      })

    return () => {
      active = false
    }
  }, [watermarkFile])

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!containerRef.current || !watermarkRect) return
      if (event.button !== 0) return

      const handle = (event.target as HTMLElement).dataset.handle as ResizeHandle | undefined
      const rect = containerRef.current.getBoundingClientRect()
      const point = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }

      if (handle) {
        interactionRef.current = {
          kind: 'resize',
          pointerId: event.pointerId,
          origin: point,
          initialRect: watermarkRect,
          handle,
        }
      } else {
        interactionRef.current = {
          kind: 'move',
          pointerId: event.pointerId,
          origin: point,
          initialRect: watermarkRect,
        }
      }

      containerRef.current.setPointerCapture(event.pointerId)
      document.body.style.userSelect = 'none'
    },
    [watermarkRect],
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

    const minWidth = MIN_SIZE_RATIO
    const minHeight = MIN_SIZE_RATIO

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

      setWatermarkRect(next)
      return
    }

    if (interaction.kind === 'resize') {
      const deltaX = (point.x - interaction.origin.x) / width
      const deltaY = (point.y - interaction.origin.y) / height
      const next = applyResize(interaction.initialRect, interaction.handle, deltaX, deltaY, minWidth, minHeight)
      setWatermarkRect(next)
    }
  }, [])

  const handlePointerUp = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (containerRef.current?.hasPointerCapture(event.pointerId)) {
      containerRef.current.releasePointerCapture(event.pointerId)
    }
    interactionRef.current = null
    document.body.style.userSelect = ''
  }, [])

  const statusMessage = React.useMemo(() => {
    if (status === 'converting') {
      return { text: 'Applying watermark…', tone: 'text-amber-200' }
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
  const readyToConvert = !!videoFile && !!watermarkFile && !!watermarkRect && !loading
  const disabled = converting || !readyToConvert

  const resetWatermark = React.useCallback(() => {
    setWatermarkRect(null)
  }, [])

  const convert = React.useCallback(async () => {
    if (!videoFile || !watermarkFile || !watermarkRect) {
      setErrorMessage('Select a video, watermark, and position the overlay before converting.')
      setStatus('error')
      return
    }

    const runtime = mediabunny ?? (await reload().catch(() => null))
    if (!runtime) {
      setErrorMessage('Unable to load Mediabunny. Please try again.')
      setStatus('error')
      return
    }

    const watermarkImage = await loadImage(watermarkFile)

    setStatus('converting')
    setProgress(0)
    setErrorMessage(null)
    setDownloadName(null)

    let input: InstanceType<Mediabunny['Input']> | null = null

    try {
      input = await createBlobInput(videoFile, runtime)

      const { output, target, format } = createMp4Output(runtime)
      const conversion = await runtime.Conversion.init({
        input,
        output,
        video: {
          forceTranscode: true,
          process: (() => {
            let canvas: OffscreenCanvas | HTMLCanvasElement | null = null
            let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null

            return (sample: InstanceType<Mediabunny['VideoSample']>) => {
              const width = sample.displayWidth
              const height = sample.displayHeight

              if (!canvas) {
                if (typeof OffscreenCanvas !== 'undefined') {
                  canvas = new OffscreenCanvas(width, height)
                } else {
                  canvas = document.createElement('canvas')
                  canvas.width = width
                  canvas.height = height
                }
              }

              if (!ctx) {
                const renderedContext = canvas.getContext('2d') as
                  | CanvasRenderingContext2D
                  | OffscreenCanvasRenderingContext2D
                  | null
                ctx = renderedContext ?? null
              }

              if (!ctx) {
                throw new Error('Unable to draw watermark.')
              }

              if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width
                canvas.height = height
              }

              ctx.clearRect(0, 0, width, height)
              sample.draw(ctx, 0, 0)

              const pixelWidth = clampNumber(Math.round(watermarkRect.width * width), 1, width)
              const pixelHeight = clampNumber(Math.round(watermarkRect.height * height), 1, height)
              const pixelX = clampNumber(Math.round(watermarkRect.x * width), 0, width - pixelWidth)
              const pixelY = clampNumber(Math.round(watermarkRect.y * height), 0, height - pixelHeight)

              const previousAlpha = ctx.globalAlpha
              ctx.globalAlpha = clampNumber(opacity, 0, 1)
              ctx.drawImage(watermarkImage, pixelX, pixelY, pixelWidth, pixelHeight)
              ctx.globalAlpha = previousAlpha

              return canvas
            }
          })(),
        },
      })

      if (!conversion.isValid) {
        setStatus('error')
        setErrorMessage('Could not configure the watermark conversion for this file.')
        await output.cancel()
        return
      }

      conversionRef.current = conversion
      conversion.onProgress = (value) => setProgress(Math.round(value * 100))

      await conversion.execute()

      const buffer = target.buffer
      if (!buffer) {
        throw new Error('No video data produced.')
      }

      const blob = new Blob([buffer], { type: format.mimeType })
      const url = URL.createObjectURL(blob)
      const filename = buildOutputName(videoFile.name, format.fileExtension)

      triggerDownload(url, filename)
      setDownloadName(filename)
      setStatus('success')
      setProgress(100)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Applying the watermark failed. Try again.'
      setErrorMessage(message)
      setStatus('error')
      setProgress(0)
    } finally {
      conversionRef.current = null
      if (input) {
        input.dispose()
      }
    }
  }, [mediabunny, opacity, reload, videoFile, watermarkFile, watermarkRect])

  return (
    <div className="flex flex-col gap-6">
      <SourceFilePicker
        accept="video/*"
        file={videoFile}
        disabled={converting}
        placeholder="Select a video file"
        onFileSelected={handleVideoSelected}
      />

      <SourceFilePicker
        accept="image/*"
        file={watermarkFile}
        disabled={converting}
        placeholder="Select a watermark image"
        onFileSelected={handleWatermarkSelected}
      />

      {videoUrl && (
        <div className="space-y-3">
          <div
            ref={containerRef}
            className="relative mx-auto w-full max-w-[720px] overflow-hidden rounded-xl border border-slate-700/60 bg-black"
            style={{
              aspectRatio: videoDimensions ? `${videoDimensions.width}/${videoDimensions.height}` : undefined,
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
              className="h-full w-full object-contain"
              onLoadedMetadata={handleVideoMetadata}
            />
            {watermarkRect && watermarkPreviewUrl && (
              <WatermarkOverlay
                rect={watermarkRect}
                previewUrl={watermarkPreviewUrl}
              />
            )}
          </div>
          <div className="flex items-start justify-between gap-3 text-xs text-slate-400">
            <p>Drag the watermark to reposition it. Use the corner handles to resize.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={resetWatermark}
              disabled={converting}
              className="border-slate-600/70 text-slate-600 hover:text-orange-400"
            >
              Reset overlay
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-4 rounded-2xl border border-slate-700/60 bg-slate-900/60 p-6">
        <div className="space-y-2">
          <Label className="text-sm text-slate-200" htmlFor="watermark-opacity">
            Opacity (%)
          </Label>
          <Input
            id="watermark-opacity"
            type="number"
            min={5}
            max={100}
            value={Math.round(opacity * 100)}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (!Number.isFinite(value)) return
              setOpacity(Math.min(1, Math.max(0.05, value / 100)))
            }}
            disabled={converting}
            className="bg-white text-slate-900 placeholder:text-slate-500 border-slate-300 focus-visible:border-orange-400 focus-visible:ring-orange-400/40"
          />
        </div>
      </div>

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
            {status === 'converting' ? 'Processing…' : 'Apply watermark'}
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

function WatermarkOverlay({ rect, previewUrl }: { rect: NormalizedRect; previewUrl: string }) {
  const style = React.useMemo(() => {
    return {
      left: `${rect.x * 100}%`,
      top: `${rect.y * 100}%`,
      width: `${rect.width * 100}%`,
      height: `${rect.height * 100}%`,
    }
  }, [rect])

  const handles: Array<{ id: ResizeHandle; className: string }> = [
    { id: 'top-left', className: 'top-0 left-0 -translate-x-1/2 -translate-y-1/2' },
    { id: 'top-right', className: 'top-0 right-0 translate-x-1/2 -translate-y-1/2' },
    { id: 'bottom-left', className: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2' },
    { id: 'bottom-right', className: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2' },
  ]

  return (
    <div className="pointer-events-none absolute inset-0">
      <div
        data-watermark="true"
        className="pointer-events-auto absolute rounded-lg border-2 border-orange-400/80 shadow-[0_0_0_9999px_rgba(15,23,42,0.55)]"
        style={{
          ...style,
          backgroundImage: `url(${previewUrl})`,
          backgroundSize: 'contain',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center',
        }}
      >
        {handles.map((handle) => (
          <span
            key={handle.id}
            data-handle={handle.id}
            className={cn(
              'absolute h-3 w-3 rounded-full bg-orange-400 shadow-md',
              handle.className,
              'pointer-events-auto cursor-grab',
            )}
          />
        ))}
      </div>
    </div>
  )
}

function clampNumber(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min
  if (min > max) return min
  return Math.min(Math.max(value, min), max)
}

function clampRect(rect: NormalizedRect, minWidth: number, minHeight: number): NormalizedRect {
  const width = clampNumber(rect.width, minWidth, 1)
  const height = clampNumber(rect.height, minHeight, 1)

  return {
    width,
    height,
    x: clampNumber(rect.x, 0, 1 - width),
    y: clampNumber(rect.y, 0, 1 - height),
  }
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

  switch (handle) {
    case 'top-left': {
      const newX = clampNumber(x + deltaX, 0, x + width - minWidth)
      const newY = clampNumber(y + deltaY, 0, y + height - minHeight)
      width -= newX - x
      height -= newY - y
      x = newX
      y = newY
      break
    }
    case 'top-right': {
      const newWidth = clampNumber(width + deltaX, minWidth, 1 - x)
      const newY = clampNumber(y + deltaY, 0, y + height - minHeight)
      height -= newY - y
      y = newY
      width = newWidth
      break
    }
    case 'bottom-left': {
      const newX = clampNumber(x + deltaX, 0, x + width - minWidth)
      const newHeight = clampNumber(height + deltaY, minHeight, 1 - y)
      width -= newX - x
      x = newX
      height = newHeight
      break
    }
    case 'bottom-right': {
      width = clampNumber(width + deltaX, minWidth, 1 - x)
      height = clampNumber(height + deltaY, minHeight, 1 - y)
      break
    }
  }

  return clampRect({ x, y, width, height }, minWidth, minHeight)
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load watermark image.'))
    }
    image.src = url
  })
}

function buildOutputName(original: string, extension: string) {
  const base = original.replace(/\.[^/.]+$/, '')
  return `${base}-watermarked${extension}`
}

function triggerDownload(url: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
