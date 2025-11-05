'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { SourceFilePicker } from '@/components/media/source-file-picker'
import { useMediabunny } from '@/hooks/use-mediabunny'
import { createAudioOutput, type AudioContainer } from '@/lib/mediabunny-loader'
import { cn } from '@/lib/utils'

import type * as MediabunnyModule from 'mediabunny'

type Mediabunny = typeof import('mediabunny')
type AudioCodec = MediabunnyModule.AudioCodec

type Status = 'idle' | 'ready' | 'converting' | 'success' | 'error'

type BlendCandidate = {
  file: File | null
  previewUrl: string | null
  buffer: AudioBuffer | null
  duration: number | null
}

const DEFAULT_BLEND_RATIO = 0.3

export function BlendTracksTool() {
  const [primary, setPrimary] = React.useState<BlendCandidate>({
    file: null,
    previewUrl: null,
    buffer: null,
    duration: null,
  })
  const [secondary, setSecondary] = React.useState<BlendCandidate>({
    file: null,
    previewUrl: null,
    buffer: null,
    duration: null,
  })

  const [blendRatio, setBlendRatio] = React.useState<number>(DEFAULT_BLEND_RATIO)

  const [status, setStatus] = React.useState<Status>('idle')
  const [progress, setProgress] = React.useState<number>(0)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [downloadName, setDownloadName] = React.useState<string | null>(null)

  const audioContextRef = React.useRef<AudioContext | null>(null)

  const { mediabunny, loading, error, reload } = useMediabunny()

  React.useEffect(() => {
    return () => {
      if (primary.previewUrl) {
        URL.revokeObjectURL(primary.previewUrl)
      }
      if (secondary.previewUrl) {
        URL.revokeObjectURL(secondary.previewUrl)
      }
      if (audioContextRef.current) {
        void audioContextRef.current.close()
        audioContextRef.current = null
      }
    }
    // We only want to run this on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    setStatus((current) => {
      const canBlend = Boolean(primary.buffer && secondary.buffer)
      if (canBlend) {
        return current === 'idle' ? 'ready' : current
      }
      if (!canBlend && current === 'ready') {
        return 'idle'
      }
      return current
    })
  }, [primary.buffer, secondary.buffer])

  const readyToBlend = Boolean(primary.buffer && secondary.buffer)
  const primaryGain = 1 - blendRatio
  const secondaryGain = blendRatio

  const ensureAudioContext = React.useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }
    return audioContextRef.current
  }, [])

  const resetStatus = React.useCallback((nextStatus: Status = 'idle') => {
    setStatus(nextStatus)
    setProgress(0)
    setErrorMessage(null)
    setDownloadName(null)
  }, [])

  const handlePrimarySelected = React.useCallback(
    async (file: File | null) => {
      if (primary.previewUrl) {
        URL.revokeObjectURL(primary.previewUrl)
      }

      if (!file) {
        setPrimary({
          file: null,
          previewUrl: null,
          buffer: null,
          duration: null,
        })
        resetStatus('idle')
        return
      }

      const previewUrl = URL.createObjectURL(file)
      setPrimary((prev) => ({
        ...prev,
        file,
        previewUrl,
        buffer: null,
        duration: null,
      }))
      resetStatus('idle')

      try {
        const context = ensureAudioContext()
        const decoded = await decodeAudioFile(file, context)
        setPrimary({
          file,
          previewUrl,
          buffer: decoded.buffer,
          duration: decoded.duration,
        })
      } catch (err) {
        setPrimary({
          file,
          previewUrl,
          buffer: null,
          duration: null,
        })
        const message =
          err instanceof Error ? err.message : 'Unable to decode the first track. Try another file.'
        setErrorMessage(message)
        setStatus('error')
      }
    },
    [primary.previewUrl, ensureAudioContext, resetStatus],
  )

  const handleSecondarySelected = React.useCallback(
    async (file: File | null) => {
      if (secondary.previewUrl) {
        URL.revokeObjectURL(secondary.previewUrl)
      }

      if (!file) {
        setSecondary({
          file: null,
          previewUrl: null,
          buffer: null,
          duration: null,
        })
        resetStatus('idle')
        return
      }

      const previewUrl = URL.createObjectURL(file)
      setSecondary((prev) => ({
        ...prev,
        file,
        previewUrl,
        buffer: null,
        duration: null,
      }))
      resetStatus('idle')

      try {
        const context = ensureAudioContext()
        const decoded = await decodeAudioFile(file, context)
        setSecondary({
          file,
          previewUrl,
          buffer: decoded.buffer,
          duration: decoded.duration,
        })
      } catch (err) {
        setSecondary({
          file,
          previewUrl,
          buffer: null,
          duration: null,
        })
        const message =
          err instanceof Error ? err.message : 'Unable to decode the second track. Try another file.'
        setErrorMessage(message)
        setStatus('error')
      }
    },
    [secondary.previewUrl, ensureAudioContext, resetStatus],
  )

  const handleBlendRatioChange = React.useCallback((value: number[]) => {
    const next = clamp(value[0] ?? DEFAULT_BLEND_RATIO, 0, 1)
    setBlendRatio(next)
  }, [])

  const blendTracks = React.useCallback(async () => {
    if (!primary.buffer || !secondary.buffer) {
      setErrorMessage('Select two audio tracks before blending.')
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
    setProgress(10)
    setErrorMessage(null)
    setDownloadName(null)

    let output: InstanceType<Mediabunny['Output']> | null = null
    let audioSource: InstanceType<Mediabunny['AudioBufferSource']> | null = null

    try {
      const mixedBuffer = mixAudioBuffers(primary.buffer, secondary.buffer, primaryGain, secondaryGain)
      setProgress(30)

      const encoding = await selectEncodingConfig(runtime, mixedBuffer.numberOfChannels, mixedBuffer.sampleRate)
      setProgress(45)

      const { output: createdOutput, target, format } = createAudioOutput(runtime, encoding.container)
      output = createdOutput

      const sourceConfig =
        encoding.bitrate !== undefined
          ? { codec: encoding.codec, bitrate: encoding.bitrate }
          : { codec: encoding.codec }

      audioSource = new runtime.AudioBufferSource(sourceConfig)
      output.addAudioTrack(audioSource)

      await output.start()
      setProgress(60)

      await audioSource.add(mixedBuffer)
      audioSource.close()
      audioSource = null
      setProgress(80)

      await output.finalize()

      const buffer = target.buffer
      if (!buffer) {
        throw new Error('No audio data produced.')
      }

      const blob = new Blob([buffer], { type: format.mimeType })
      const url = URL.createObjectURL(blob)
      const filename = buildOutputName(primary.file, secondary.file, format.fileExtension)
      triggerBrowserDownload(url, filename)

      setDownloadName(filename)
      setStatus('success')
      setProgress(100)
    } catch (err) {
      if (audioSource) {
        try {
          audioSource.close()
        } catch {
          // Ignore close errors.
        }
      }
      if (output && output.state !== 'finalized') {
        void output.cancel().catch(() => undefined)
      }
      const message =
        err instanceof Error ? err.message : 'Track blending failed. Please try again with different files.'
      setErrorMessage(message)
      setStatus('error')
      setProgress(0)
    }
  }, [primary.buffer, secondary.buffer, primaryGain, secondaryGain, mediabunny, reload, primary.file, secondary.file])

  const disabled = status === 'converting' || loading || !readyToBlend

  const statusMessage = React.useMemo(() => {
    if (status === 'converting') {
      return { text: 'Blending tracks…', tone: 'text-amber-200' }
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

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <TrackPanel
          title="Primary track"
          candidate={primary}
          gain={primaryGain}
          status={status}
          onFileSelected={handlePrimarySelected}
        />
        <TrackPanel
          title="Secondary track"
          candidate={secondary}
          gain={secondaryGain}
          status={status}
          onFileSelected={handleSecondarySelected}
        />
      </div>

      <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-5">
        <div className="flex items-center justify-between pb-3">
          <div>
            <p className="text-sm font-medium text-slate-200">Blend balance</p>
            <p className="text-xs text-slate-400">
              0 plays only the primary track, 1 plays only the secondary track.
            </p>
          </div>
          <div className="text-xs text-slate-400">
            <span className="font-semibold text-slate-200">{blendRatio.toFixed(2)}</span>
            <span className="ml-1 text-slate-500">ratio</span>
          </div>
        </div>
        <Slider
          min={0}
          max={1}
          step={0.01}
          value={[blendRatio]}
          disabled={status === 'converting'}
          onValueChange={handleBlendRatioChange}
        />
        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
          <span>
            Primary • {(primaryGain * 100).toFixed(0)}%
          </span>
          <span>
            Secondary • {(secondaryGain * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {(status === 'converting' || progress > 0) && (
          <Progress value={progress} className="h-1.5 bg-slate-600" />
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={blendTracks}
            disabled={disabled}
            className="rounded-full bg-linear-to-r from-orange-500 to-orange-600 px-6 text-white shadow-lg shadow-orange-500/30 transition hover:from-orange-400 hover:to-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === 'converting' ? 'Processing…' : 'Blend tracks'}
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

type TrackPanelProps = {
  title: string
  candidate: BlendCandidate
  gain: number
  status: Status
  onFileSelected: (file: File | null) => void
}

function TrackPanel({ title, candidate, gain, status, onFileSelected }: TrackPanelProps) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-700/60 bg-slate-900/60 p-5">
      <div className="space-y-2">
        <Label className="text-slate-300">{title}</Label>
        <SourceFilePicker
          accept="audio/*"
          file={candidate.file}
          disabled={status === 'converting'}
          placeholder="Select an audio file"
          onFileSelected={onFileSelected}
        />
      </div>

      {candidate.previewUrl && (
        <audio controls src={candidate.previewUrl} className="w-full rounded-lg border border-slate-800" />
      )}

      {candidate.duration !== null && (
        <p className="text-xs text-slate-400">Duration: {candidate.duration.toFixed(2)}s</p>
      )}

      <p className="text-xs text-slate-400">
        Current contribution: {(gain * 100).toFixed(0)}%
      </p>
    </div>
  )
}

type EncodingCandidate = {
  container: AudioContainer
  codec: AudioCodec
  bitrate?: number
}

const ENCODING_CANDIDATES: EncodingCandidate[] = [
  { container: 'mp3', codec: 'mp3', bitrate: 192_000 },
  { container: 'wav', codec: 'pcm-s16' },
]

async function decodeAudioFile(file: File, context: AudioContext) {
  const arrayBuffer = await file.arrayBuffer()
  const buffer = await context.decodeAudioData(arrayBuffer.slice(0))
  return { buffer, duration: buffer.duration }
}

async function selectEncodingConfig(
  runtime: Mediabunny,
  numberOfChannels: number,
  sampleRate: number,
): Promise<EncodingCandidate> {
  for (const candidate of ENCODING_CANDIDATES) {
    try {
      const canEncode = await runtime.canEncodeAudio(candidate.codec, {
        numberOfChannels,
        sampleRate,
        ...(candidate.bitrate ? { bitrate: candidate.bitrate } : {}),
      })
      if (canEncode) {
        return candidate
      }
    } catch {
      // Ignore codec detection errors and move to the next candidate.
    }
  }

  return ENCODING_CANDIDATES[ENCODING_CANDIDATES.length - 1]
}

function mixAudioBuffers(
  primary: AudioBuffer,
  secondary: AudioBuffer,
  primaryGain: number,
  secondaryGain: number,
) {
  const sampleRate = primary.sampleRate

  if (secondary.sampleRate !== sampleRate) {
    throw new Error('Both tracks must share the same sample rate.')
  }

  const channelCount = Math.max(primary.numberOfChannels, secondary.numberOfChannels)
  const frameCount = Math.min(primary.length, secondary.length)

  const mixed = new AudioBuffer({
    length: frameCount,
    numberOfChannels: channelCount,
    sampleRate,
  })

  let peak = 0

  for (let channel = 0; channel < channelCount; channel++) {
    const primaryChannel =
      channel < primary.numberOfChannels ? primary.getChannelData(channel) : null
    const secondaryChannel =
      channel < secondary.numberOfChannels ? secondary.getChannelData(channel) : null
    const mixedChannel = mixed.getChannelData(channel)

    for (let index = 0; index < frameCount; index++) {
      const sampleA = primaryChannel && index < primaryChannel.length ? primaryChannel[index] : 0
      const sampleB =
        secondaryChannel && index < secondaryChannel.length ? secondaryChannel[index] : 0
      const mixedSample = sampleA * primaryGain + sampleB * secondaryGain
      mixedChannel[index] = mixedSample
      const abs = Math.abs(mixedSample)
      if (abs > peak) {
        peak = abs
      }
    }
  }

  if (peak > 1) {
    const normalizeFactor = 1 / peak
    for (let channel = 0; channel < channelCount; channel++) {
      const mixedChannel = mixed.getChannelData(channel)
      for (let index = 0; index < frameCount; index++) {
        mixedChannel[index] *= normalizeFactor
      }
    }
  }

  return mixed
}

function buildOutputName(primaryFile: File | null, secondaryFile: File | null, extension: string) {
  const primaryBase = formatName(primaryFile?.name ?? 'track-a')
  const secondaryBase = formatName(secondaryFile?.name ?? 'track-b')
  return `${primaryBase}-${secondaryBase}-blend${extension}`
}

function formatName(filename: string) {
  return filename.replace(/\.[^/.]+$/, '').replace(/\s+/g, '-').toLowerCase()
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
