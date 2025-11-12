'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { SourceFilePicker } from '@/components/media/source-file-picker'
import { useMediabunny } from '@/hooks/use-mediabunny'
import { createBlobInput, createMp4Output } from '@/lib/mediabunny-loader'
import { cn } from '@/lib/utils'

import type * as MediabunnyModule from 'mediabunny'

type ConversionConstructor = typeof MediabunnyModule.Conversion
type ConversionInstance = Awaited<ReturnType<ConversionConstructor['init']>>

type Status = 'idle' | 'ready' | 'converting' | 'success' | 'error'

type Size = { width: number; height: number }

type PresetOption =
  | { id: 'original'; label: string }
  | { id: string; label: string; width: number; height: number }

const PRESETS: PresetOption[] = [
  { id: 'original', label: 'Original resolution' },
  { id: '1080p', label: '1080p (1920×1080)', width: 1920, height: 1080 },
  { id: '720p', label: '720p (1280×720)', width: 1280, height: 720 },
  { id: '480p', label: '480p (854×480)', width: 854, height: 480 },
  { id: 'square-1080', label: 'Square (1080×1080)', width: 1080, height: 1080 },
  { id: 'vertical-1080', label: 'Vertical (1080×1920)', width: 1080, height: 1920 },
]

export function ResizeVideoTool() {
  const [file, setFile] = React.useState<File | null>(null)
  const [videoUrl, setVideoUrl] = React.useState<string | null>(null)
  const [originalSize, setOriginalSize] = React.useState<Size | null>(null)

  const [presetId, setPresetId] = React.useState<string>('original')
  const [targetWidth, setTargetWidth] = React.useState<string>('')
  const [targetHeight, setTargetHeight] = React.useState<string>('')
  const [lockAspect, setLockAspect] = React.useState<boolean>(true)

  const [status, setStatus] = React.useState<Status>('idle')
  const [progress, setProgress] = React.useState<number>(0)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [downloadName, setDownloadName] = React.useState<string | null>(null)

  const conversionRef = React.useRef<ConversionInstance | null>(null)

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

  const handleFileSelected = React.useCallback((nextFile: File | null) => {
    setFile(nextFile)
    setStatus(nextFile ? 'ready' : 'idle')
    setProgress(0)
    setErrorMessage(null)
    setDownloadName(null)
    setOriginalSize(null)
    setPresetId('original')
    setTargetWidth('')
    setTargetHeight('')

    setVideoUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev)
      }
      return nextFile ? URL.createObjectURL(nextFile) : null
    })
  }, [])

  const handleMetadataLoaded = React.useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    const element = event.currentTarget
    const width = Math.round(element.videoWidth)
    const height = Math.round(element.videoHeight)
    if (!width || !height) {
      setOriginalSize(null)
      setErrorMessage('Unable to read the video resolution. Try a different file.')
      setStatus('error')
      return
    }

    const evenWidth = ensureEven(width)
    const evenHeight = ensureEven(height)

    setOriginalSize({ width, height })
    setTargetWidth(String(evenWidth))
    setTargetHeight(String(evenHeight))
    setPresetId('original')
  }, [])

  const aspectRatio = React.useMemo(() => {
    const widthValue = Number(targetWidth)
    const heightValue = Number(targetHeight)
    if (Number.isFinite(widthValue) && widthValue > 0 && Number.isFinite(heightValue) && heightValue > 0) {
      return widthValue / heightValue
    }
    if (originalSize && originalSize.height > 0) {
      return originalSize.width / originalSize.height
    }
    return null
  }, [originalSize, targetWidth, targetHeight])

  const setDimensionsFromPreset = React.useCallback(
    (preset: PresetOption) => {
      if (preset.id === 'original') {
        if (!originalSize) return
        setTargetWidth(String(originalSize.width))
        setTargetHeight(String(originalSize.height))
        return
      }
      if ('width' in preset && 'height' in preset) {
        setTargetWidth(String(preset.width))
        setTargetHeight(String(preset.height))
      }
    },
    [originalSize],
  )

  const handlePresetChange = React.useCallback(
    (value: string) => {
      setPresetId(value)
      const preset = PRESETS.find((item) => item.id === value)
      if (!preset) return
      setDimensionsFromPreset(preset)
    },
    [setDimensionsFromPreset],
  )

  const handleWidthChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value
      setTargetWidth(value)
      setPresetId('custom')

      const numeric = Number(value)
      if (lockAspect && aspectRatio && Number.isFinite(numeric) && numeric > 0) {
        const derivedHeight = Math.max(2, Math.round(numeric / aspectRatio))
        setTargetHeight(String(derivedHeight))
      }
    },
    [aspectRatio, lockAspect],
  )

  const handleHeightChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value
      setTargetHeight(value)
      setPresetId('custom')

      const numeric = Number(value)
      if (lockAspect && aspectRatio && Number.isFinite(numeric) && numeric > 0) {
        const derivedWidth = Math.max(2, Math.round(numeric * aspectRatio))
        setTargetWidth(String(derivedWidth))
      }
    },
    [aspectRatio, lockAspect],
  )

  const handleLockAspectToggle = React.useCallback(
    (checked: boolean) => {
      setLockAspect(checked)
      if (!checked || !aspectRatio) return

      const numericWidth = Number(targetWidth)
      if (Number.isFinite(numericWidth) && numericWidth > 0) {
        const derivedHeight = Math.max(2, Math.round(numericWidth / aspectRatio))
        setTargetHeight(String(derivedHeight))
      }
    },
    [aspectRatio, targetWidth],
  )

  const selectionValid = React.useMemo(() => {
    const widthValue = Number(targetWidth)
    const heightValue = Number(targetHeight)
    return (
      Number.isFinite(widthValue) &&
      Number.isFinite(heightValue) &&
      widthValue >= 2 &&
      heightValue >= 2 &&
      widthValue <= 8192 &&
      heightValue <= 8192
    )
  }, [targetWidth, targetHeight])

  const statusMessage = React.useMemo(() => {
    if (status === 'converting') {
      return { text: 'Resizing video…', tone: 'text-amber-200' }
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
  const disabled = converting || !file || !selectionValid || loading

  const convert = React.useCallback(async () => {
    if (!file) {
      setErrorMessage('Select a video file first.')
      setStatus('error')
      return
    }

    const widthValue = Number(targetWidth)
    const heightValue = Number(targetHeight)
    if (!Number.isFinite(widthValue) || !Number.isFinite(heightValue) || widthValue < 2 || heightValue < 2) {
      setErrorMessage('Enter a valid width and height (at least 2 pixels).')
      setStatus('error')
      return
    }

    const evenWidth = ensureEven(widthValue)
    const evenHeight = ensureEven(heightValue)
    if (evenWidth < 2 || evenHeight < 2) {
      setErrorMessage('Width and height must be at least 2 pixels.')
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
      const conversion = await runtime.Conversion.init({
        input,
        output,
        video: {
          forceTranscode: true,
          process: (sample) => {
            const canvas = document.createElement('canvas')
            canvas.width = evenWidth
            canvas.height = evenHeight
            const context = canvas.getContext('2d')
            if (!context) {
              throw new Error('Unable to resize video frame.')
            }

            sample.draw(context, 0, 0, evenWidth, evenHeight)
            return canvas
          },
        },
      })

      if (!conversion.isValid) {
        setStatus('error')
        setErrorMessage('Could not configure the resize operation for this file.')
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

      const filename = buildOutputName(file.name, format.fileExtension, evenWidth, evenHeight)
      triggerBrowserDownload(url, filename)
      setDownloadName(filename)
      setStatus('success')
      setProgress(100)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Resizing failed. Try again.'
      setErrorMessage(message)
      setStatus('error')
      setProgress(0)
    } finally {
      conversionRef.current = null
      if (input) {
        input.dispose()
      }
    }
  }, [file, mediabunny, reload, targetHeight, targetWidth])

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
          <video
            src={videoUrl}
            controls
            playsInline
            className="h-auto max-h-[320px] w-full rounded-xl border border-slate-700/60 bg-black object-contain"
            onLoadedMetadata={handleMetadataLoaded}
          />
          {originalSize && (
            <p className="text-xs text-slate-400">
              Original resolution: {originalSize.width}px × {originalSize.height}px
            </p>
          )}
        </div>
      )}

      <div className="space-y-4 rounded-2xl border border-slate-700/60 bg-slate-900/50 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-sm text-slate-200" htmlFor="resize-preset">
              Preset
            </Label>
            <Select
              value={presetId}
              onValueChange={handlePresetChange}
              disabled={converting || !originalSize}
            >
              <SelectTrigger id="resize-preset" className="w-full border-slate-700/60 bg-slate-900/80 text-slate-100">
                <SelectValue placeholder="Choose preset" />
              </SelectTrigger>
              <SelectContent>
                {PRESETS.map((preset) => (
                  <SelectItem
                    key={preset.id}
                    value={preset.id}
                    disabled={preset.id === 'original' && !originalSize}
                  >
                    {preset.label}
                  </SelectItem>
                ))}
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="aspect-lock" className="text-sm text-slate-200">
              Maintain aspect ratio
            </Label>
            <div className="flex items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-900/80 px-4 py-2">
              <Switch
                id="aspect-lock"
                checked={lockAspect}
                onCheckedChange={handleLockAspectToggle}
                disabled={converting}
                className="data-[state=checked]:bg-orange-400/80 data-[state=checked]:hover:bg-orange-300/80"
              />
              <span className="text-sm text-slate-300">{lockAspect ? 'Enabled' : 'Disabled'}</span>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="target-width" className="text-sm text-slate-200">
              Target width (px)
            </Label>
            <Input
              id="target-width"
              type="number"
              min={2}
              max={8192}
              value={targetWidth}
              onChange={handleWidthChange}
              disabled={converting}
              className="bg-white text-slate-900 placeholder:text-slate-500 border-slate-300 focus-visible:border-orange-400 focus-visible:ring-orange-400/40"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="target-height" className="text-sm text-slate-200">
              Target height (px)
            </Label>
            <Input
              id="target-height"
              type="number"
              min={2}
              max={8192}
              value={targetHeight}
              onChange={handleHeightChange}
              disabled={converting}
              className="bg-white text-slate-900 placeholder:text-slate-500 border-slate-300 focus-visible:border-orange-400 focus-visible:ring-orange-400/40"
            />
          </div>
        </div>

        <p className="text-xs text-slate-400">
          Final dimensions snap to the nearest even numbers to match H.264 encoding requirements.
        </p>
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
            {status === 'converting' ? 'Processing…' : 'Resize video'}
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

function ensureEven(value: number) {
  let next = Math.max(2, Math.round(value))
  if (next % 2 !== 0) {
    next = next > 2 ? next - 1 : 2
  }
  return next
}

function buildOutputName(original: string, extension: string, width: number, height: number) {
  const base = original.replace(/\.[^/.]+$/, '')
  return `${base}-resized-${width}x${height}${extension}`
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
