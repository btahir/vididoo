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
import { canEncodeAudio } from 'mediabunny'
import { registerMp3Encoder } from '@mediabunny/mp3-encoder'
import type * as MediabunnyModule from 'mediabunny'

type Mediabunny = typeof import('mediabunny')
type CanvasSourceConstructor = Mediabunny['CanvasSource']
type CanvasSourceInstance = InstanceType<CanvasSourceConstructor>
type CanvasSourceConfig = ConstructorParameters<CanvasSourceConstructor>[1]
type AudioBufferSource = InstanceType<Mediabunny['AudioBufferSource']>
type AudioCodec = MediabunnyModule.AudioCodec

type Status = 'idle' | 'ready' | 'converting' | 'success' | 'error'

const FRAME_RATE = 30
const DEFAULT_DURATION = 5
const MIN_DURATION = 1
const MAX_DURATION = 30 * 60 // 30 minutes

const RESOLUTIONS = [
  { id: '1080p', label: '1080p (1920 × 1080)', width: 1920, height: 1080 },
  { id: '720p', label: '720p (1280 × 720)', width: 1280, height: 720 },
  { id: 'square', label: 'Square (1080 × 1080)', width: 1080, height: 1080 },
]

const BITRATE_REQUIRED_CODECS = new Set<AudioCodec>(['aac', 'opus', 'mp3', 'vorbis'])
let mp3EncoderRegistered = false

export function ImageToVideoTool() {
  const [imageFile, setImageFile] = React.useState<File | null>(null)
  const [imageUrl, setImageUrl] = React.useState<string | null>(null)
  const [imageDimensions, setImageDimensions] = React.useState<{ width: number; height: number } | null>(null)

  const [audioFile, setAudioFile] = React.useState<File | null>(null)
  const [audioPreviewUrl, setAudioPreviewUrl] = React.useState<string | null>(null)
  const [audioBuffer, setAudioBuffer] = React.useState<AudioBuffer | null>(null)
  const [audioDuration, setAudioDuration] = React.useState<number | null>(null)
  const [audioDecoding, setAudioDecoding] = React.useState(false)

  const [durationSeconds, setDurationSeconds] = React.useState<number>(DEFAULT_DURATION)
  const [resolutionId, setResolutionId] = React.useState<string>(RESOLUTIONS[0].id)

  const [status, setStatus] = React.useState<Status>('idle')
  const [progress, setProgress] = React.useState<number>(0)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [downloadName, setDownloadName] = React.useState<string | null>(null)

  const audioDecodeRequestId = React.useRef(0)
  const { mediabunny, loading, error, reload } = useMediabunny()

  React.useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl)
      }
    }
  }, [imageUrl])

  React.useEffect(() => {
    return () => {
      if (audioPreviewUrl) {
        URL.revokeObjectURL(audioPreviewUrl)
      }
    }
  }, [audioPreviewUrl])

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

  const handleAudioSelected = React.useCallback(async (nextFile: File | null) => {
    const requestId = ++audioDecodeRequestId.current

    setAudioFile(nextFile)
    setAudioBuffer(null)
    setAudioDuration(null)
    setAudioDecoding(Boolean(nextFile))

    setAudioPreviewUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev)
      }
      return nextFile ? URL.createObjectURL(nextFile) : null
    })

    if (!nextFile) {
      setAudioDecoding(false)
      return
    }

    try {
      const { buffer, duration } = await decodeAudioBuffer(nextFile)
      if (audioDecodeRequestId.current !== requestId) return
      setAudioBuffer(buffer)
      setAudioDuration(duration)
    } catch (err) {
      if (audioDecodeRequestId.current !== requestId) return
      const message = err instanceof Error ? err.message : 'Unable to decode audio file.'
      setErrorMessage(message)
      setStatus('error')
      setAudioFile(null)
      setAudioPreviewUrl((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev)
        }
        return null
      })
    } finally {
      if (audioDecodeRequestId.current === requestId) {
        setAudioDecoding(false)
      }
    }
  }, [])

  const handleImageLoaded = React.useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget
    if (naturalWidth && naturalHeight) {
      setImageDimensions({ width: naturalWidth, height: naturalHeight })
    }
  }, [])

  const durationValid =
    Number.isFinite(durationSeconds) && durationSeconds >= MIN_DURATION && durationSeconds <= MAX_DURATION
  const selectedResolution = React.useMemo(
    () => RESOLUTIONS.find((item) => item.id === resolutionId) ?? RESOLUTIONS[0],
    [resolutionId],
  )
  const audioDurationSeconds = React.useMemo(() => {
    if (audioDuration === null) return null
    const rounded = Number(audioDuration.toFixed(2))
    return clamp(rounded, MIN_DURATION, MAX_DURATION)
  }, [audioDuration])

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
  const audioReady = !audioFile || (!!audioBuffer && !audioDecoding)
  const disabled = converting || !imageFile || !durationValid || loading || !audioReady
  const canMatchAudioDuration = Boolean(audioDurationSeconds) && !audioDecoding && !converting

  const applyAudioDuration = React.useCallback(() => {
    if (audioDurationSeconds === null) return
    setDurationSeconds(audioDurationSeconds)
  }, [audioDurationSeconds])

  const convert = React.useCallback(async () => {
    if (!imageFile) {
      setErrorMessage('Select an image file first.')
      setStatus('error')
      return
    }

    if (!durationValid) {
      setErrorMessage(`Enter a duration between ${MIN_DURATION} second and ${MAX_DURATION / 60} minutes.`)
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

    let audioSource: AudioBufferSource | null = null

    if (audioBuffer) {
      const supportedCodecs = format.getSupportedAudioCodecs()
      if (!supportedCodecs?.length) {
        setErrorMessage('Audio encoding is not supported in this browser.')
        setStatus('error')
        return
      }
      const selectedAudioCodec = await selectAudioCodec(supportedCodecs)
      const audioConfig =
        needsBitrate(selectedAudioCodec) ?
          { codec: selectedAudioCodec, bitrate: 192_000 } :
          { codec: selectedAudioCodec }
      audioSource = new runtime.AudioBufferSource(audioConfig)
      output.addAudioTrack(audioSource)
    }

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

      if (audioSource && audioBuffer) {
        const matchedBuffer = matchAudioDuration(audioBuffer, durationSeconds)
        await audioSource.add(matchedBuffer)
        audioSource.close()
        audioSource = null
      }

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
    } finally {
      if (audioSource) {
        audioSource.close()
      }
    }
  }, [imageFile, durationValid, mediabunny, reload, selectedResolution, durationSeconds, audioBuffer])

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
            <div className="flex gap-2">
              <Input
                id="video-duration"
                type="number"
                min={MIN_DURATION}
                max={MAX_DURATION}
                step={0.1}
                value={durationSeconds}
                disabled={converting}
                className="flex-1 bg-white text-slate-900 placeholder:text-slate-500 border-slate-300 focus-visible:border-orange-400 focus-visible:ring-orange-400/40"
                onChange={(event) => {
                  const value = Number(event.target.value)
                  if (!Number.isFinite(value)) return
                  setDurationSeconds(clamp(value, MIN_DURATION, MAX_DURATION))
                }}
              />
              {canMatchAudioDuration && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={applyAudioDuration}
                  className="whitespace-nowrap border border-slate-400/70 bg-slate-100 text-slate-900 hover:bg-slate-200"
                >
                  Use audio length
                </Button>
              )}
            </div>
            <p className="text-xs text-slate-400">
              Up to {MAX_DURATION / 60} minutes ({MAX_DURATION} seconds) max.
              {canMatchAudioDuration && audioDuration !== null && audioDuration > MAX_DURATION && (
                <> Audio exceeds max; using {MAX_DURATION}s.</>
              )}
            </p>
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

      <div className="space-y-4 rounded-2xl border border-slate-700/60 bg-slate-900/60 p-6">
        <div className="space-y-2">
          <Label className="text-slate-300">Audio track (optional)</Label>
          <SourceFilePicker
            accept="audio/*"
            file={audioFile}
            disabled={converting}
            placeholder="Add a soundtrack"
            onFileSelected={handleAudioSelected}
          />
        </div>
        {audioDecoding && (
          <p className="text-xs text-slate-400">Decoding audio…</p>
        )}
        {audioPreviewUrl && (
          <audio
            controls
            src={audioPreviewUrl}
            className="w-full rounded-xl border border-slate-700/60 bg-black"
          />
        )}
        {audioDuration !== null && (
          <p className="text-xs text-slate-400">Source audio duration: {audioDuration.toFixed(2)}s</p>
        )}
        <p className="text-xs text-slate-500">
          The audio will be trimmed or padded to match the selected video duration.
        </p>
      </div>

      <div className="flex flex-col gap-4">
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
    img.onerror = () => {
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

async function decodeAudioBuffer(file: File) {
  const arrayBuffer = await file.arrayBuffer()
  const audioContext = new AudioContext()
  try {
    const buffer = await audioContext.decodeAudioData(arrayBuffer.slice(0))
    const duration = buffer.duration
    return { buffer, duration }
  } finally {
    audioContext.close().catch(() => undefined)
  }
}

function matchAudioDuration(buffer: AudioBuffer, targetDuration: number) {
  const sampleRate = buffer.sampleRate
  const targetLength = Math.max(1, Math.round(sampleRate * targetDuration))
  const matched = new AudioBuffer({
    length: targetLength,
    sampleRate,
    numberOfChannels: buffer.numberOfChannels,
  })

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const sourceData = buffer.getChannelData(channel)
    const targetData = matched.getChannelData(channel)
    const sourceFrames = sourceData.length

    for (let i = 0; i < targetLength; i++) {
      if (i < sourceFrames) {
        targetData[i] = sourceData[i]
      } else {
        targetData[i] = 0
      }
    }
  }

  return matched
}

async function selectAudioCodec(supported: AudioCodec[]) {
  const preferredOrder: AudioCodec[] = ['aac', 'mp3']

  for (const codec of preferredOrder) {
    if (!supported.includes(codec)) continue
    if (codec === 'aac') {
      if (await safeCanEncodeAudio(codec)) {
        return codec
      }
    } else if (codec === 'mp3') {
      if (await ensureMp3Support()) {
        return codec
      }
    }
  }

  for (const codec of supported) {
    if (codec === 'mp3') {
      if (await ensureMp3Support()) {
        return codec
      }
    } else if (await safeCanEncodeAudio(codec)) {
      return codec
    }
  }

  throw new Error('No compatible audio codec is available for this browser.')
}

async function ensureMp3Support() {
  if (await safeCanEncodeAudio('mp3')) {
    return true
  }

  if (!mp3EncoderRegistered) {
    try {
      registerMp3Encoder()
      mp3EncoderRegistered = true
    } catch {
      return false
    }
  }

  return safeCanEncodeAudio('mp3')
}

async function safeCanEncodeAudio(codec: AudioCodec) {
  try {
    return await canEncodeAudio(codec)
  } catch {
    return false
  }
}

function needsBitrate(codec: AudioCodec) {
  return BITRATE_REQUIRED_CODECS.has(codec)
}
