'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useMediabunny } from '@/hooks/use-mediabunny'
import { createAudioOutput, createBlobInput } from '@/lib/mediabunny-loader'
import { SourceFilePicker } from '@/components/media/source-file-picker'
import { cn } from '@/lib/utils'

import type * as MediabunnyModule from 'mediabunny'

type AudioCodec = MediabunnyModule.AudioCodec
type ConversionConstructor = typeof MediabunnyModule.Conversion
type ConversionInstance = Awaited<ReturnType<ConversionConstructor['init']>>
type DiscardedTrack = MediabunnyModule.DiscardedTrack

const WAV_CODEC_CANDIDATES: AudioCodec[] = ['pcm-s16', 'pcm-s24', 'pcm-s32', 'pcm-f32', 'pcm-u8', 'pcm-s8']
const FALLBACK_WAV_CODEC: AudioCodec = 'pcm-s16'
const BITRATE_REQUIRED_CODECS = new Set<AudioCodec>(['aac', 'opus', 'mp3', 'vorbis'])
const DISCARD_REASON_MESSAGES: Record<DiscardedTrack['reason'], string> = {
  discarded_by_user: 'The track was manually discarded.',
  max_track_count_reached: 'The container allows fewer total tracks.',
  max_track_count_of_type_reached: 'The container cannot store more tracks of this type.',
  unknown_source_codec: 'The source codec is unknown in this browser.',
  undecodable_source_codec: 'The source audio cannot be decoded in this browser.',
  no_encodable_target_codec: 'This browser cannot encode the selected audio format.',
}

type ExtractionStatus = 'idle' | 'ready' | 'converting' | 'success' | 'error'

export function ExtractAudioTool() {
  const [file, setFile] = React.useState<File | null>(null)
  const [status, setStatus] = React.useState<ExtractionStatus>('idle')
  const [progress, setProgress] = React.useState(0)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [downloadedFileName, setDownloadedFileName] = React.useState<string | null>(null)

  const conversionRef = React.useRef<ConversionInstance | null>(null)

  const { mediabunny, loading, error, reload } = useMediabunny()

  React.useEffect(() => {
    return () => {
      if (conversionRef.current) {
        void conversionRef.current.cancel()
      }
    }
  }, [])

  const handleFileChange = React.useCallback((nextFile: File | null) => {
    setFile(nextFile)
    setStatus(nextFile ? 'ready' : 'idle')
    setProgress(0)
    setErrorMessage(null)
    setDownloadedFileName(null)
  }, [])

  const buildOutputFileName = React.useCallback(
    (inputName: string, extension: string) => {
      const base = inputName.replace(/\.[^/.]+$/, '')
      return `${base}-audio${extension}`
    },
    [],
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
    setDownloadedFileName(null)

    let input: InstanceType<typeof runtime.Input> | null = null

    try {
      input = await createBlobInput(file, runtime)

      const audioTracks = await input.getAudioTracks()
      if (!audioTracks.length) {
        setStatus('error')
        setErrorMessage('That video does not contain an audio track to extract.')
        return
      }

      let selectedCodec: AudioCodec | null = null
      try {
        selectedCodec = await runtime.getFirstEncodableAudioCodec(WAV_CODEC_CANDIDATES)
      } catch {
        // Ignore detection errors and fall back to PCM.
      }

      if (!selectedCodec) {
        selectedCodec = FALLBACK_WAV_CODEC
      }

      const { output, target, format } = createAudioOutput(runtime, 'wav')
      const conversion = await runtime.Conversion.init({
        input,
        output,
        video: { discard: true },
        audio: {
          codec: selectedCodec,
          ...(needsBitrate(selectedCodec) ? { bitrate: 192_000 } : {}),
          forceTranscode: true,
        },
      })

      if (!conversion.isValid) {
        setStatus('error')
        setErrorMessage(buildInvalidConfigurationMessage(conversion.discardedTracks))
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
        throw new Error('No audio data produced.')
      }

      const blob = new Blob([buffer], { type: format.mimeType })
      const url = URL.createObjectURL(blob)
      const filename = buildOutputFileName(file.name, format.fileExtension)

      triggerBrowserDownload(url, filename)
      setDownloadedFileName(filename)
      setStatus('success')
      setProgress(100)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Audio extraction failed.'
      setErrorMessage(message)
      setStatus('error')
      setProgress(0)
    } finally {
      conversionRef.current = null
      if (input) {
        input.dispose()
      }
    }
  }, [file, mediabunny, reload, buildOutputFileName])

  const disabled =
    status === 'converting' ||
    !file ||
    loading

  const statusMessage = (() => {
    if (status === 'converting') {
      return { text: 'Extracting audio…', tone: 'text-amber-200' }
    }
    if (status === 'success' && downloadedFileName) {
      return {
        text: `Downloaded as ${downloadedFileName}`,
        tone: 'text-emerald-200',
      }
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
  })()

  return (
    <div className="flex flex-col gap-4">
      <SourceFilePicker
        accept="video/*"
        file={file}
        disabled={status === 'converting'}
        placeholder="Select a video file"
        onFileSelected={handleFileChange}
      />

      <div className="flex flex-col gap-3">
        {(status === 'converting' || progress > 0) && (
          <Progress value={progress} className="h-1.5 bg-slate-800 my-2" />
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={convert}
            disabled={disabled}
            className="rounded-full bg-linear-to-r from-orange-500 to-orange-600 px-6 text-white shadow-lg shadow-orange-500/30 transition hover:from-orange-400 hover:to-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === 'converting' ? 'Extracting…' : 'Extract audio (WAV)'}
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

function needsBitrate(codec: AudioCodec) {
  return BITRATE_REQUIRED_CODECS.has(codec)
}

function buildInvalidConfigurationMessage(discardedTracks: DiscardedTrack[]) {
  const relevantTracks = discardedTracks.filter((entry) => entry.reason !== 'discarded_by_user')

  if (!relevantTracks.length) {
    return 'This configuration cannot be executed with the selected output format. Please try again or refresh the page.'
  }

  const details = relevantTracks.map((entry) => {
    const trackType = entry.track.type
    const reason = DISCARD_REASON_MESSAGES[entry.reason] ?? 'The track could not be included.'
    return `${trackType} track: ${reason}`
  })

  return `${details.join(' ')}`
}

function triggerBrowserDownload(url: string, filename: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
