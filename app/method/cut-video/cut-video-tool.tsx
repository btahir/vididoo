'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { useMediabunny } from '@/hooks/use-mediabunny'
import { createBlobInput, createMp4Output } from '@/lib/mediabunny-loader'
import { SourceFilePicker } from '@/components/media/source-file-picker'
import { cn } from '@/lib/utils'

import type * as MediabunnyModule from 'mediabunny'

type ConversionConstructor = typeof MediabunnyModule.Conversion
type ConversionInstance = Awaited<ReturnType<ConversionConstructor['init']>>

type Status = 'idle' | 'ready' | 'converting' | 'success' | 'error'

export function CutVideoTool() {
  const [file, setFile] = React.useState<File | null>(null)
  const [videoUrl, setVideoUrl] = React.useState<string | null>(null)
  const [duration, setDuration] = React.useState<number | null>(null)
  const [startTime, setStartTime] = React.useState<number>(0)
  const [endTime, setEndTime] = React.useState<number | null>(null)
  const [status, setStatus] = React.useState<Status>('idle')
  const [progress, setProgress] = React.useState<number>(0)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [downloadName, setDownloadName] = React.useState<string | null>(null)

  const videoRef = React.useRef<HTMLVideoElement | null>(null)
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
    setDuration(null)
    setStartTime(0)
    setEndTime(null)

    setVideoUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev)
      }
      return nextFile ? URL.createObjectURL(nextFile) : null
    })
  }, [])

  const handleMetadataLoaded = React.useCallback(() => {
    const mediaDuration = videoRef.current?.duration
    if (Number.isFinite(mediaDuration)) {
      setDuration(mediaDuration!)
      setStartTime(0)
      setEndTime(mediaDuration!)
    }
  }, [])

  const setStartFromVideo = React.useCallback(() => {
    if (!videoRef.current) return
    const current = clamp(videoRef.current.currentTime, 0, endTime ?? videoRef.current.currentTime)
    setStartTime(current)
  }, [endTime])

  const setEndFromVideo = React.useCallback(() => {
    if (!videoRef.current) return
    const limit = duration ?? videoRef.current.currentTime
    const current = clamp(videoRef.current.currentTime, startTime, limit)
    setEndTime(current)
  }, [duration, startTime])

  const startEndValid =
    duration !== null &&
    endTime !== null &&
    startTime >= 0 &&
    startTime < endTime &&
    endTime <= duration

  const clipLength = startEndValid && endTime !== null ? endTime - startTime : 0

  const convert = React.useCallback(async () => {
    if (!file) {
      setErrorMessage('Select a video file first.')
      setStatus('error')
      return
    }

    if (!startEndValid || endTime === null) {
      setErrorMessage('Choose a valid start and end time before cutting.')
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
        trim: {
          start: startTime,
          end: endTime,
        },
      })

      if (!conversion.isValid) {
        setStatus('error')
        setErrorMessage('Could not configure the cut with this file. Try a different video.')
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
      const filename = buildOutputName(file.name, format.fileExtension, startTime, endTime)

      triggerBrowserDownload(url, filename)
      setDownloadName(filename)
      setStatus('success')
      setProgress(100)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Cutting failed. Try again.'
      setErrorMessage(message)
      setStatus('error')
      setProgress(0)
    } finally {
      conversionRef.current = null
      if (input) {
        input.dispose()
      }
    }
  }, [file, startEndValid, endTime, mediabunny, reload, startTime])

  const statusMessage = React.useMemo(() => {
    if (status === 'converting') {
      return { text: 'Cutting video…', tone: 'text-amber-200' }
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
  const disabled =
    converting || !file || loading || !startEndValid || clipLength <= 0.05

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
            ref={videoRef}
            src={videoUrl}
            controls
            playsInline
            className="h-auto max-h-[320px] w-full rounded-xl border border-slate-700/60 bg-black object-contain"
            onLoadedMetadata={handleMetadataLoaded}
          />
          <p className="text-xs text-slate-200">
            {duration !== null
              ? `Duration: ${formatTime(duration)}`
              : 'Loading video metadata…'}
          </p>
        </div>
      )}

      <div className="grid gap-4 rounded-2xl border border-slate-700/60 bg-slate-900/60 p-6">
        <div className="grid gap-2 sm:grid-cols-2 sm:items-end sm:gap-6">
          <div className="space-y-2">
            <Label htmlFor="start-time" className="text-slate-300">
              Start time (seconds)
            </Label>
            <Input
              id="start-time"
              type="number"
              min={0}
              step={0.1}
              value={formatNumericInput(startTime)}
              className="bg-white text-slate-900 placeholder:text-slate-500 border-slate-300 focus-visible:border-orange-400 focus-visible:ring-orange-400/40"
              disabled={converting || duration === null}
              onChange={(event) => {
                const value = Number(event.target.value)
                if (!Number.isFinite(value)) return
                setStartTime(clamp(value, 0, Math.min(endTime ?? value, duration ?? value)))
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!videoRef.current || converting}
              onClick={setStartFromVideo}
              className="justify-start text-xs text-slate-400 hover:text-slate-900"
            >
              Use current video time
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="end-time" className="text-slate-300">
              End time (seconds)
            </Label>
            <Input
              id="end-time"
              type="number"
              min={0}
              step={0.1}
              value={formatNumericInput(endTime ?? 0)}
              className="bg-white text-slate-900 placeholder:text-slate-500 border-slate-300 focus-visible:border-orange-400 focus-visible:ring-orange-400/40"
              disabled={converting || duration === null}
              onChange={(event) => {
                const value = Number(event.target.value)
                if (!Number.isFinite(value)) return
                const upper = duration ?? value
                setEndTime(clamp(value, startTime + 0.01, upper))
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!videoRef.current || converting}
              onClick={setEndFromVideo}
              className="justify-start text-xs text-slate-400 hover:text-slate-900"
            >
              Use current video time
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-100">
          <span>
            Clip length:{' '}
            <span className="font-medium">
              {clipLength > 0 ? formatTime(clipLength) : '—'}
            </span>
          </span>
          <span>
            Trim range:{' '}
            <span className="font-medium">
              {`${startTime.toFixed(2)}s → ${endTime !== null ? endTime.toFixed(2) : '—'}s`}
            </span>
          </span>
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
            {status === 'converting' ? 'Cutting…' : 'Cut video'}
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

function buildOutputName(original: string, extension: string, start: number, end: number) {
  const base = original.replace(/\.[^/.]+$/, '')
  return `${base}-${start.toFixed(2)}s-${end.toFixed(2)}s${extension}`
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds - mins * 60
  return `${mins}:${secs.toFixed(2).padStart(5, '0')}`
}

function formatNumericInput(value: number) {
  return Number.isFinite(value) ? value : 0
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
