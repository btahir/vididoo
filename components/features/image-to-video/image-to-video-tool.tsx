'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { useMediabunny } from '@/hooks/use-mediabunny'
import { createMp4Output } from '@/lib/mediabunny-loader'
import { SourceFilePicker } from '@/components/media/source-file-picker'
import { cn } from '@/lib/utils'

type Mediabunny = typeof import('mediabunny')
type CanvasSourceConstructor = Mediabunny['CanvasSource']
type CanvasSourceInstance = InstanceType<CanvasSourceConstructor>
type CanvasSourceConfig = ConstructorParameters<CanvasSourceConstructor>[1]

type Status = 'idle' | 'ready' | 'converting' | 'success' | 'error'

const FRAME_RATE = 30
const DEFAULT_DURATION = 5

const RESOLUTIONS = [
  { id: '1080p', label: '1080p (1920 × 1080)', width: 1920, height: 1080 },
  { id: '720p', label: '720p (1280 × 720)', width: 1280, height: 720 },
  { id: 'square', label: 'Square (1080 × 1080)', width: 1080, height: 1080 },
]

export function ImageToVideoTool() {
  const [imageFile, setImageFile] = React.useState<File | null>(null)
  const [imageUrl, setImageUrl] = React.useState<string | null>(null)
  const [imageDimensions, setImageDimensions] = React.useState<{ width: number; height: number } | null>(null)

  const [durationSeconds, setDurationSeconds] = React.useState<number>(DEFAULT_DURATION)
  const [resolutionId, setResolutionId] = React.useState<string>(RESOLUTIONS[0].id)

  const [status, setStatus] = React.useState<Status>('idle')
  const [progress, setProgress] = React.useState<number>(0)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [downloadName, setDownloadName] = React.useState<string | null>(null)

  const { mediabunny, loading, error, reload } = useMediabunny()

  React.useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl)
      }
    }
  }, [imageUrl])

  const handleFileSelected = React.useCallback((nextFile: File | null) => {
    setImageFile(nextFile)
    setStatus(nextFile ? 'ready' : 'idle')
    setProgress(0)
    setErrorMessage(null)
    setDownloadName(null)
    setImageDimensions(null)

    setImageUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev)
      }
      return nextFile ? URL.createObjectURL(nextFile) : null
    })
  }, [])

  const handleImageLoaded = React.useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget
    if (naturalWidth && naturalHeight) {
      setImageDimensions({ width: naturalWidth, height: naturalHeight })
    }
  }, [])

  const durationValid = Number.isFinite(durationSeconds) && durationSeconds >= 1 && durationSeconds <= 60
  const selectedResolution = React.useMemo(
    () => RESOLUTIONS.find((item) => item.id === resolutionId) ?? RESOLUTIONS[0],
    [resolutionId],
  )

  const statusMessage = React.useMemo(() => {
    if (status === 'converting') {
      return { text: 'Rendering video…', tone: 'text-amber-200' }
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
  const disabled = converting || !imageFile || !durationValid || loading

  const convert = React.useCallback(async () => {
    if (!imageFile) {
      setErrorMessage('Select an image file first.')
      setStatus('error')
      return
    }

    if (!durationValid) {
      setErrorMessage('Enter a duration between 1 and 60 seconds.')
      setStatus('error')
      return
    }

    const runtime = mediabunny ?? (await reload().catch(() => null))

    if (!runtime) {
      setErrorMessage('Unable to load Mediabunny. Please try again.')
      setStatus('error')
      return
    }

    const imageElement = await loadImage(imageFile)

    const { width, height } = selectedResolution
    const frameCount = Math.max(1, Math.round(durationSeconds * FRAME_RATE))
    const frameDuration = 1 / FRAME_RATE

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      setErrorMessage('Unable to draw image onto canvas.')
      setStatus('error')
      return
    }

    const { output, target, format } = createMp4Output(runtime)

    const encodingConfig: CanvasSourceConfig = {
      codec: 'avc',
      bitrate: 4_000_000,
      keyFrameInterval: 2,
    }

    const canvasSource: CanvasSourceInstance = new runtime.CanvasSource(canvas, encodingConfig)
    output.addVideoTrack(canvasSource, {
      frameRate: FRAME_RATE,
    })

    setStatus('converting')
    setProgress(0)
    setErrorMessage(null)
    setDownloadName(null)

    try {
      await output.start()

      const drawInfo = computeDrawRect(imageElement.width, imageElement.height, width, height)
      for (let i = 0; i < frameCount; i++) {
        context.fillStyle = 'black'
        context.fillRect(0, 0, width, height)
        context.drawImage(
          imageElement,
          drawInfo.sx,
          drawInfo.sy,
          drawInfo.sWidth,
          drawInfo.sHeight,
          drawInfo.dx,
          drawInfo.dy,
          drawInfo.dWidth,
          drawInfo.dHeight,
        )

        await canvasSource.add(i * frameDuration, frameDuration)
        setProgress(Math.round(((i + 1) / frameCount) * 100))
      }

      canvasSource.close()
      await output.finalize()

      const buffer = target.buffer
      if (!buffer) {
        throw new Error('No video data produced.')
      }

      const blob = new Blob([buffer], { type: format.mimeType })
      const url = URL.createObjectURL(blob)
      const filename = buildOutputName(imageFile.name, format.fileExtension, durationSeconds)
      triggerDownload(url, filename)
      setDownloadName(filename)
      setStatus('success')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Video rendering failed. Try again.'
      setErrorMessage(message)
      setStatus('error')
      setProgress(0)
    }
  }, [imageFile, durationValid, mediabunny, reload, selectedResolution, durationSeconds])

  return (
    <div className="flex flex-col gap-6">
      <SourceFilePicker
        accept="image/*"
        file={imageFile}
        disabled={converting}
        placeholder="Select an image"
        onFileSelected={handleFileSelected}
      />

      {imageUrl && (
        <div className="space-y-3">
          <img
            src={imageUrl}
            alt="Selected source"
            className="max-h-80 w-full rounded-xl border border-slate-700/60 object-contain bg-slate-900/80"
            onLoad={handleImageLoaded}
          />
          {imageDimensions && (
            <p className="text-xs text-slate-200">
              Source image: {imageDimensions.width}px × {imageDimensions.height}px
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 rounded-2xl border border-slate-700/60 bg-slate-900/60 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="video-duration" className="text-slate-300">
              Video duration (seconds)
            </Label>
            <Input
              id="video-duration"
              type="number"
              min={1}
              max={60}
              step={1}
              value={durationSeconds}
              disabled={converting}
              className="bg-white text-slate-900 placeholder:text-slate-500 border-slate-300 focus-visible:border-orange-400 focus-visible:ring-orange-400/40"
              onChange={(event) => {
                const value = Number(event.target.value)
                if (!Number.isFinite(value)) return
                setDurationSeconds(clamp(value, 1, 60))
              }}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300">Resolution</Label>
            <Select
              value={resolutionId}
              onValueChange={setResolutionId}
              disabled={converting}
            >
              <SelectTrigger className="border-slate-500/60 bg-slate-900/80 text-slate-100">
                <SelectValue placeholder="Choose resolution" />
              </SelectTrigger>
              <SelectContent className="border-slate-600/70 bg-slate-900/95 text-slate-100 shadow-lg shadow-slate-900/20">
                {RESOLUTIONS.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="text-sm text-slate-200">
          Frame rate: <span className="font-medium">{FRAME_RATE} fps</span>
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
            {status === 'converting' ? 'Rendering…' : 'Create video'}
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = (event) => {
      URL.revokeObjectURL(url)
      reject(new Error('Unable to load image.'))
    }
    img.src = url
  })
}

function computeDrawRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
) {
  const sourceRatio = sourceWidth / sourceHeight
  const targetRatio = targetWidth / targetHeight

  let drawWidth = targetWidth
  let drawHeight = targetHeight

  if (sourceRatio > targetRatio) {
    drawHeight = Math.round(targetWidth / sourceRatio)
  } else {
    drawWidth = Math.round(targetHeight * sourceRatio)
  }

  const dx = Math.floor((targetWidth - drawWidth) / 2)
  const dy = Math.floor((targetHeight - drawHeight) / 2)

  return {
    sx: 0,
    sy: 0,
    sWidth: sourceWidth,
    sHeight: sourceHeight,
    dx,
    dy,
    dWidth: drawWidth,
    dHeight: drawHeight,
  }
}

function buildOutputName(original: string, extension: string, duration: number) {
  const base = original.replace(/\.[^/.]+$/, '')
  return `${base}-${duration}s${extension}`
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
