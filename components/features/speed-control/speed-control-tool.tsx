'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { SourceFilePicker } from '@/components/media/source-file-picker'
import { useMediabunny } from '@/hooks/use-mediabunny'
import { createBlobInput, createMp4Output } from '@/lib/mediabunny-loader'
import { cn } from '@/lib/utils'

type Mediabunny = typeof import('mediabunny')

type Status = 'idle' | 'ready' | 'converting' | 'success' | 'error'

const PRESETS = [
  { id: '0.5', label: '0.5× (Half speed)', value: 0.5 },
  { id: '0.75', label: '0.75× (Slight slowdown)', value: 0.75 },
  { id: '1.25', label: '1.25× (Slight speedup)', value: 1.25 },
  { id: '1.5', label: '1.5× (Fast)', value: 1.5 },
  { id: '2', label: '2× (Double speed)', value: 2 },
]

export function SpeedControlTool() {
  const [file, setFile] = React.useState<File | null>(null)
  const [videoUrl, setVideoUrl] = React.useState<string | null>(null)
  const [duration, setDuration] = React.useState<number | null>(null)
  const [speed, setSpeed] = React.useState<number>(1.25)
  const [presetId, setPresetId] = React.useState<string>('1.25')

  const [status, setStatus] = React.useState<Status>('idle')
  const [progress, setProgress] = React.useState<number>(0)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [downloadName, setDownloadName] = React.useState<string | null>(null)

  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const { mediabunny, loading, error, reload } = useMediabunny()

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

    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return nextFile ? URL.createObjectURL(nextFile) : null
    })
  }, [])

  const handleMetadataLoaded = React.useCallback(() => {
    const value = videoRef.current?.duration
    if (Number.isFinite(value)) {
      setDuration(value!)
    }
  }, [])

  const statusMessage = React.useMemo(() => {
    if (status === 'converting') {
      return { text: 'Adjusting playback speed…', tone: 'text-amber-200' }
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
  const disabled = converting || !file || loading || speed <= 0

  const normalizeSpeed = React.useCallback((value: number) => {
    return Math.min(4, Math.max(0.25, value))
  }, [])

  const handlePresetChange = React.useCallback(
    (value: string) => {
      setPresetId(value)
      const preset = PRESETS.find((item) => item.id === value)
      if (preset) {
        setSpeed(preset.value)
      }
    },
    [],
  )

  const handleSpeedChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value)
      if (!Number.isFinite(value)) {
        return
      }
      const normalized = normalizeSpeed(value)
      setSpeed(normalized)
      setPresetId('')
    },
    [normalizeSpeed],
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

    let input: InstanceType<Mediabunny['Input']> | null = null
    let videoSource: InstanceType<Mediabunny['VideoSampleSource']> | null = null
    let audioSource: InstanceType<Mediabunny['AudioSampleSource']> | null = null

    try {
      input = await createBlobInput(file, runtime)
      const videoTracks = await input.getVideoTracks()
      const audioTracks = await input.getAudioTracks()

      if (!videoTracks.length) {
        throw new Error('The selected file does not contain a video track.')
      }

      const primaryVideo = videoTracks[0]
      const videoCodec = primaryVideo.codec
      if (!videoCodec) {
        throw new Error('Unable to determine the input video codec.')
      }

      const { output, target, format } = createMp4Output(runtime)

      videoSource = new runtime.VideoSampleSource({
        codec: 'avc',
        bitrate: 4_000_000,
      })
      output.addVideoTrack(videoSource, { frameRate: 30 })

      const keepAudio = audioTracks.length > 0
      if (keepAudio) {
        audioSource = new runtime.AudioSampleSource({
          codec: 'aac',
          bitrate: 192_000,
        })
        output.addAudioTrack(audioSource)
      }

      setStatus('converting')
      setProgress(0)
      setErrorMessage(null)
      setDownloadName(null)

      await output.start()

      const videoSink = new runtime.VideoSampleSink(primaryVideo)
      const totalDuration = duration ?? (await primaryVideo.computeDuration().catch(() => null))
      const effectiveSpeed = speed

      for await (const sample of videoSink.samples()) {
        const adjusted = sample.clone()
        const newTimestamp = sample.timestamp / effectiveSpeed
        adjusted.setTimestamp(newTimestamp)
        adjusted.setDuration(sample.duration / effectiveSpeed)
        await videoSource!.add(adjusted)
        sample.close()
        adjusted.close()
        if (totalDuration && totalDuration > 0) {
          const scaledDuration = totalDuration / effectiveSpeed
          setProgress(Math.min(95, Math.round((newTimestamp / scaledDuration) * 100)))
        }
      }
      videoSource?.close()

      if (audioSource && audioTracks.length) {
        const audioSink = new runtime.AudioSampleSink(audioTracks[0])
        for await (const sample of audioSink.samples()) {
          const adjusted = sample.clone()
          const newTimestamp = sample.timestamp / effectiveSpeed
          adjusted.setTimestamp(newTimestamp)
          // Audio samples don't expose setDuration; their duration is derived from timestamps.
          await audioSource.add(adjusted)
          sample.close()
          adjusted.close()
        }
        audioSource.close()
      }

      await output.finalize()

      const buffer = target.buffer
      if (!buffer) {
        throw new Error('No video data produced.')
      }

      const blob = new Blob([buffer], { type: format.mimeType })
      const url = URL.createObjectURL(blob)
      const filename = buildOutputName(file.name, format.fileExtension, speed)
      triggerDownload(url, filename)
      setDownloadName(filename)
      setProgress(100)
      setStatus('success')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Speed change failed. Try again.'
      setErrorMessage(message)
      setStatus('error')
      setProgress(0)
    } finally {
      videoSource?.close()
      audioSource?.close()
      if (input) {
        input.dispose()
      }
    }
  }, [file, mediabunny, reload, speed, duration])

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
            className="w-full rounded-xl border border-slate-700/60 bg-black"
            onLoadedMetadata={handleMetadataLoaded}
          />
          {duration !== null && (
            <p className="text-xs text-slate-200">Duration: {duration.toFixed(2)}s</p>
          )}
        </div>
      )}

      <div className="grid gap-4 rounded-2xl border border-slate-700/60 bg-slate-900/60 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-slate-300">Preset speeds</Label>
            <Select
              value={presetId}
              onValueChange={handlePresetChange}
              disabled={converting}
            >
              <SelectTrigger className="border-slate-500/60 bg-slate-900/80 text-slate-100">
                <SelectValue placeholder="Choose a preset" />
              </SelectTrigger>
              <SelectContent className="border-slate-600/70 bg-slate-900/95 text-slate-100 shadow-lg shadow-slate-900/20">
                {PRESETS.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="custom-speed" className="text-slate-300">
              Custom speed (0.25× – 4×)
            </Label>
            <Input
              id="custom-speed"
              type="number"
              step={0.05}
              min={0.25}
              max={4}
              value={speed}
              disabled={converting}
              className="bg-white text-slate-900 placeholder:text-slate-500 border-slate-300 focus-visible:border-orange-400 focus-visible:ring-orange-400/40"
              onChange={handleSpeedChange}
            />
            <p className="text-xs text-slate-400">
              Increasing speed shortens the output duration; decreasing speed lengthens it.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {(status === 'converting' || progress > 0) && (
          <Progress value={progress} className="h-1.5 bg-slate-800" />
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={convert}
            disabled={disabled}
            className="rounded-full bg-linear-to-r from-orange-500 to-orange-600 px-6 text-white shadow-lg shadow-orange-500/30 transition hover:from-orange-400 hover:to-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === 'converting' ? 'Processing…' : 'Apply speed'}
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

function buildOutputName(original: string, extension: string, speed: number) {
  const base = original.replace(/\.[^/.]+$/, '')
  return `${base}-${speed.toFixed(2)}x${extension}`
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
