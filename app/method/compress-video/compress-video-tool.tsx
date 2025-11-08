'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
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
import { createBlobInput, createMp4Output } from '@/lib/mediabunny-loader'
import { SourceFilePicker } from '@/components/media/source-file-picker'
import { cn } from '@/lib/utils'

import type * as MediabunnyModule from 'mediabunny'

type ConversionConstructor = typeof MediabunnyModule.Conversion
type ConversionInstance = Awaited<ReturnType<ConversionConstructor['init']>>
type Quality = MediabunnyModule.Quality

type Status = 'idle' | 'ready' | 'converting' | 'success' | 'error'

const QUALITY_OPTIONS = [
  { id: 'very_low', label: 'Very Low (Smallest file)', quality: 'QUALITY_VERY_LOW' as const },
  { id: 'low', label: 'Low', quality: 'QUALITY_LOW' as const },
  { id: 'medium', label: 'Medium (Recommended)', quality: 'QUALITY_MEDIUM' as const },
  { id: 'high', label: 'High', quality: 'QUALITY_HIGH' as const },
  { id: 'very_high', label: 'Very High (Largest file)', quality: 'QUALITY_VERY_HIGH' as const },
  { id: 'custom', label: 'Custom Bitrate', quality: null },
]

const BITRATE_PRESETS = [
  { id: '500k', label: '500 Kbps (Low)', value: 500_000 },
  { id: '1m', label: '1 Mbps (Medium)', value: 1_000_000 },
  { id: '2m', label: '2 Mbps (Good)', value: 2_000_000 },
  { id: '4m', label: '4 Mbps (High)', value: 4_000_000 },
  { id: '8m', label: '8 Mbps (Very High)', value: 8_000_000 },
]

export function CompressVideoTool() {
  const [file, setFile] = React.useState<File | null>(null)
  const [videoUrl, setVideoUrl] = React.useState<string | null>(null)
  const [qualityOption, setQualityOption] = React.useState<string>('medium')
  const [bitratePreset, setBitratePreset] = React.useState<string>('2m')
  const [status, setStatus] = React.useState<Status>('idle')
  const [progress, setProgress] = React.useState<number>(0)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [downloadName, setDownloadName] = React.useState<string | null>(null)
  const [originalSize, setOriginalSize] = React.useState<number | null>(null)
  const [compressedSize, setCompressedSize] = React.useState<number | null>(null)

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
    setOriginalSize(nextFile?.size ?? null)
    setCompressedSize(null)

    setVideoUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev)
      }
      return nextFile ? URL.createObjectURL(nextFile) : null
    })
  }, [])

  const selectedQualityOption = React.useMemo(
    () => QUALITY_OPTIONS.find((opt) => opt.id === qualityOption) ?? QUALITY_OPTIONS[2],
    [qualityOption],
  )

  const selectedBitratePreset = React.useMemo(
    () => BITRATE_PRESETS.find((preset) => preset.id === bitratePreset) ?? BITRATE_PRESETS[2],
    [bitratePreset],
  )

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
    setCompressedSize(null)

    let input: InstanceType<typeof runtime.Input> | null = null

    try {
      input = await createBlobInput(file, runtime)

      const { output, target, format } = createMp4Output(runtime)
      
      // Get the quality value or use custom bitrate
      let videoBitrate: number | Quality
      if (selectedQualityOption.quality) {
        // Access quality constants from runtime
        switch (selectedQualityOption.quality) {
          case 'QUALITY_VERY_LOW':
            videoBitrate = runtime.QUALITY_VERY_LOW
            break
          case 'QUALITY_LOW':
            videoBitrate = runtime.QUALITY_LOW
            break
          case 'QUALITY_MEDIUM':
            videoBitrate = runtime.QUALITY_MEDIUM
            break
          case 'QUALITY_HIGH':
            videoBitrate = runtime.QUALITY_HIGH
            break
          case 'QUALITY_VERY_HIGH':
            videoBitrate = runtime.QUALITY_VERY_HIGH
            break
          default:
            videoBitrate = runtime.QUALITY_MEDIUM
        }
      } else {
        videoBitrate = selectedBitratePreset.value
      }

      const conversion = await runtime.Conversion.init({
        input,
        output,
        video: {
          forceTranscode: true,
          bitrate: videoBitrate,
          codec: 'avc', // H.264 for best compatibility
        },
        audio: {
          forceTranscode: true,
          bitrate: 128_000, // Standard audio bitrate
          codec: 'aac',
        },
      })

      if (!conversion.isValid) {
        setStatus('error')
        setErrorMessage('Could not configure the compression with this file. Try a different video.')
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

      setCompressedSize(blob.size)
      triggerBrowserDownload(url, filename)
      setDownloadName(filename)
      setStatus('success')
      setProgress(100)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Video compression failed. Try again.'
      setErrorMessage(message)
      setStatus('error')
      setProgress(0)
    } finally {
      conversionRef.current = null
      if (input) {
        input.dispose()
      }
    }
  }, [file, mediabunny, reload, selectedQualityOption, selectedBitratePreset])

  const statusMessage = React.useMemo(() => {
    if (status === 'converting') {
      return { text: 'Compressing video…', tone: 'text-amber-200' }
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

  const compressionRatio = React.useMemo(() => {
    if (!originalSize || !compressedSize) return null
    const ratio = ((originalSize - compressedSize) / originalSize) * 100
    return Math.round(ratio)
  }, [originalSize, compressedSize])

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
          {originalSize && (
            <p className="text-xs text-slate-200">
              Original file size: {formatFileSize(originalSize)}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 rounded-2xl border border-slate-700/60 bg-slate-900/60 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-slate-300">Compression Quality</Label>
            <Select
              value={qualityOption}
              onValueChange={setQualityOption}
              disabled={converting}
            >
              <SelectTrigger className="border-slate-500/60 bg-slate-900/80 text-slate-100">
                <SelectValue placeholder="Choose quality" />
              </SelectTrigger>
              <SelectContent className="border-slate-600/70 bg-slate-900/95 text-slate-100 shadow-lg shadow-slate-900/20">
                {QUALITY_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {selectedQualityOption.id === 'custom' && (
            <div className="space-y-2">
              <Label className="text-slate-300">Video Bitrate</Label>
              <Select
                value={bitratePreset}
                onValueChange={setBitratePreset}
                disabled={converting}
              >
                <SelectTrigger className="border-slate-500/60 bg-slate-900/80 text-slate-100">
                  <SelectValue placeholder="Choose bitrate" />
                </SelectTrigger>
                <SelectContent className="border-slate-600/70 bg-slate-900/95 text-slate-100 shadow-lg shadow-slate-900/20">
                  {BITRATE_PRESETS.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        
        <div className="text-sm text-slate-200">
          <div>Video codec: <span className="font-medium">H.264 (AVC)</span></div>
          <div>Audio codec: <span className="font-medium">AAC (128 kbps)</span></div>
        </div>
      </div>

      {compressedSize && originalSize && (
        <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-4">
          <div className="grid gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-300">Original size:</span>
              <span className="text-slate-100">{formatFileSize(originalSize)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-300">Compressed size:</span>
              <span className="text-slate-100">{formatFileSize(compressedSize)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-700/60 pt-2">
              <span className="text-slate-300">Space saved:</span>
              <span className="font-medium text-emerald-300">
                {compressionRatio}% ({formatFileSize(originalSize - compressedSize)})
              </span>
            </div>
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
            {status === 'converting' ? 'Compressing…' : 'Compress video'}
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
  return `${base}-compressed${extension}`
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
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
