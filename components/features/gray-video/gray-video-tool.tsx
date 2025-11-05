'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useMediabunny } from '@/hooks/use-mediabunny'
import { createBlobInput, createMp4Output } from '@/lib/mediabunny-loader'
import { SourceFilePicker } from '@/components/media/source-file-picker'
import { cn } from '@/lib/utils'

import type * as MediabunnyModule from 'mediabunny'

type ConversionConstructor = typeof MediabunnyModule.Conversion
type ConversionInstance = Awaited<ReturnType<ConversionConstructor['init']>>

type Status = 'idle' | 'ready' | 'converting' | 'success' | 'error'

export function GrayVideoTool() {
  const [file, setFile] = React.useState<File | null>(null)
  const [videoUrl, setVideoUrl] = React.useState<string | null>(null)
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

    setVideoUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev)
      }
      return nextFile ? URL.createObjectURL(nextFile) : null
    })
  }, [])

  const convert = React.useCallback(async () => {
    if (!file) {
      setErrorMessage('Select a video file first.')
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
            // Convert video frame to grayscale using canvas
            const canvas = document.createElement('canvas')
            const ctx = canvas.getContext('2d')!
            
            canvas.width = sample.displayWidth
            canvas.height = sample.displayHeight
            
            // Draw the original frame using the VideoSample's draw method
            sample.draw(ctx, 0, 0)
            
            // Get image data and convert to grayscale
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const data = imageData.data
            
            for (let i = 0; i < data.length; i += 4) {
              const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
              data[i] = gray     // Red
              data[i + 1] = gray // Green
              data[i + 2] = gray // Blue
              // data[i + 3] is alpha, leave unchanged
            }
            
            // Put the grayscale data back
            ctx.putImageData(imageData, 0, 0)
            
            return canvas
          },
        },
      })

      if (!conversion.isValid) {
        setStatus('error')
        setErrorMessage('Could not configure the grayscale conversion with this file. Try a different video.')
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
      const filename = buildOutputName(file.name, format.fileExtension)

      triggerBrowserDownload(url, filename)
      setDownloadName(filename)
      setStatus('success')
      setProgress(100)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Grayscale conversion failed. Try again.'
      setErrorMessage(message)
      setStatus('error')
      setProgress(0)
    } finally {
      conversionRef.current = null
      if (input) {
        input.dispose()
      }
    }
  }, [file, mediabunny, reload])

  const statusMessage = React.useMemo(() => {
    if (status === 'converting') {
      return { text: 'Converting to grayscale…', tone: 'text-amber-200' }
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
  const disabled = converting || !file || loading

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
          />
          <p className="text-xs text-slate-200">
            Preview of your video before grayscale conversion
          </p>
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
            {status === 'converting' ? 'Converting…' : 'Convert to grayscale'}
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

function buildOutputName(original: string, extension: string) {
  const base = original.replace(/\.[^/.]+$/, '')
  return `${base}-grayscale${extension}`
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
