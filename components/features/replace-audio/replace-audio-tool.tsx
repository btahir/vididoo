'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useMediabunny } from '@/hooks/use-mediabunny'
import { createBlobInput, createMp4Output } from '@/lib/mediabunny-loader'
import { SourceFilePicker } from '@/components/media/source-file-picker'
import { cn } from '@/lib/utils'

type Mediabunny = typeof import('mediabunny')
type EncodedVideoPacketSourceCtor = Mediabunny['EncodedVideoPacketSource']
type EncodedVideoPacketSource = InstanceType<EncodedVideoPacketSourceCtor>
type AudioBufferSourceCtor = Mediabunny['AudioBufferSource']
type AudioBufferSource = InstanceType<AudioBufferSourceCtor>

type Status = 'idle' | 'ready' | 'converting' | 'success' | 'error'

export function ReplaceAudioTool() {
  const [videoFile, setVideoFile] = React.useState<File | null>(null)
  const [videoUrl, setVideoUrl] = React.useState<string | null>(null)
  const [videoDuration, setVideoDuration] = React.useState<number | null>(null)

  const [audioFile, setAudioFile] = React.useState<File | null>(null)
  const [audioPreviewUrl, setAudioPreviewUrl] = React.useState<string | null>(null)
  const [audioBuffer, setAudioBuffer] = React.useState<AudioBuffer | null>(null)
  const [audioDuration, setAudioDuration] = React.useState<number | null>(null)

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
      if (audioPreviewUrl) {
        URL.revokeObjectURL(audioPreviewUrl)
      }
    }
  }, [videoUrl, audioPreviewUrl])

  const handleVideoSelected = React.useCallback((file: File | null) => {
    setVideoFile(file)
    setStatus(file && audioFile ? 'ready' : 'idle')
    setProgress(0)
    setErrorMessage(null)
    setDownloadName(null)
    setVideoDuration(null)

    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return file ? URL.createObjectURL(file) : null
    })
  }, [audioFile])

  const handleAudioSelected = React.useCallback(
    async (file: File | null) => {
      setAudioFile(file)
      setStatus(videoFile && file ? 'ready' : 'idle')
      setProgress(0)
      setErrorMessage(null)
      setDownloadName(null)
      setAudioDuration(null)
      setAudioBuffer(null)

      setAudioPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return file ? URL.createObjectURL(file) : null
      })

      if (!file) {
        return
      }

      try {
        const { buffer, duration } = await decodeAudioBuffer(file)
        setAudioBuffer(buffer)
        setAudioDuration(duration)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to decode audio file.'
        setErrorMessage(message)
        setStatus('error')
      }
    },
    [videoFile],
  )

  const handleVideoMetadata = React.useCallback(() => {
    const duration = videoRef.current?.duration
    if (Number.isFinite(duration)) {
      setVideoDuration(duration!)
    }
  }, [])

  const statusMessage = React.useMemo(() => {
    if (status === 'converting') {
      return { text: 'Replacing audio…', tone: 'text-amber-200' }
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
  const readyToReplace = videoFile && audioFile && audioBuffer
  const disabled = converting || !readyToReplace || loading

  const replaceAudio = React.useCallback(async () => {
    if (!readyToReplace || !audioBuffer) {
      setErrorMessage('Select both a video and an audio file first.')
      setStatus('error')
      return
    }

    const runtime = mediabunny ?? (await reload().catch(() => null))

    if (!runtime) {
      setErrorMessage('Unable to load Mediabunny. Please try again.')
      setStatus('error')
      return
    }

    let videoInput: InstanceType<Mediabunny['Input']> | null = null
    let output: InstanceType<Mediabunny['Output']> | null = null
    let videoSource: EncodedVideoPacketSource | null = null
    let audioSource: AudioBufferSource | null = null

    try {
      videoInput = await createBlobInput(videoFile!, runtime)
      const videoTracks = await videoInput.getVideoTracks()
      if (!videoTracks.length) {
        throw new Error('The selected video has no video track.')
      }
      const primaryVideoTrack = videoTracks[0]
      const videoCodec = primaryVideoTrack.codec
      if (!videoCodec) {
        throw new Error('Unable to determine the video codec of the input file.')
      }

      const { output: createdOutput, target, format } = createMp4Output(runtime)
      output = createdOutput

      videoSource = new runtime.EncodedVideoPacketSource(videoCodec)
      output.addVideoTrack(videoSource)

      audioSource = new runtime.AudioBufferSource({ codec: 'aac', bitrate: 192_000 })
      output.addAudioTrack(audioSource)

      setStatus('converting')
      setProgress(0)
      setErrorMessage(null)
      setDownloadName(null)

      await output.start()

      const sink = new runtime.EncodedPacketSink(primaryVideoTrack)
      const decoderConfig = await primaryVideoTrack.getDecoderConfig()
      let firstPacket = true

      const totalDuration = await primaryVideoTrack.computeDuration().catch(() => null)

      for await (const packet of sink.packets(undefined, undefined, { verifyKeyPackets: true })) {
        await videoSource.add(packet, firstPacket ? { decoderConfig: decoderConfig ?? undefined } : undefined)
        if (totalDuration && totalDuration > 0) {
          setProgress(Math.min(95, Math.round((packet.timestamp / totalDuration) * 100)))
        }
        firstPacket = false
      }

      const matchedBuffer = matchAudioDuration(
        audioBuffer,
        videoDuration ?? audioBuffer.duration,
      )

      await audioSource.add(matchedBuffer)

      await output.finalize()

      const buffer = target.buffer
      if (!buffer) {
        throw new Error('No video data produced.')
      }

      const blob = new Blob([buffer], { type: format.mimeType })
      const url = URL.createObjectURL(blob)
      const filename = buildOutputName(videoFile!.name, format.fileExtension)
      triggerDownload(url, filename)
      setDownloadName(filename)
      setProgress(100)
      setStatus('success')

      audioSource = null
      videoSource = null
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Audio replacement failed. Please try again.'
      setErrorMessage(message)
      setStatus('error')
      setProgress(0)
    } finally {
      if (videoInput) {
        videoInput.dispose()
      }
      if (output && output.state !== 'finalized') {
        output.cancel().catch(() => undefined)
      }
    }
  }, [readyToReplace, audioBuffer, mediabunny, reload, videoFile])

  return (
    <div className="flex flex-col gap-6">
      <SourceFilePicker
        accept="video/*"
        file={videoFile}
        disabled={converting}
        placeholder="Select a video file"
        onFileSelected={handleVideoSelected}
      />

      {videoUrl && (
        <div className="space-y-3">
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            className="w-full rounded-xl border border-slate-700/60 bg-black"
            onLoadedMetadata={handleVideoMetadata}
          />
          {videoDuration !== null && (
            <p className="text-xs text-slate-200">Video duration: {videoDuration.toFixed(2)}s</p>
          )}
        </div>
      )}

      <SourceFilePicker
        accept="audio/*"
        file={audioFile}
        disabled={converting}
        placeholder="Select a replacement audio file"
        onFileSelected={handleAudioSelected}
        className="mt-2"
      />

      {audioPreviewUrl && (
        <div className="space-y-2 rounded-xl border border-slate-700/60 bg-slate-900/60 p-4">
          <audio controls src={audioPreviewUrl} className="w-full" />
          {audioDuration !== null && (
            <p className="text-xs text-slate-200">Audio duration: {audioDuration.toFixed(2)}s</p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {(status === 'converting' || progress > 0) && (
          <Progress value={progress} className="h-1.5 bg-slate-800" />
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={replaceAudio}
            disabled={disabled}
            className="rounded-full bg-linear-to-r from-orange-500 to-orange-600 px-6 text-white shadow-lg shadow-orange-500/30 transition hover:from-orange-400 hover:to-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === 'converting' ? 'Replacing…' : 'Replace audio'}
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

function buildOutputName(originalName: string, extension: string) {
  const base = originalName.replace(/\.[^/.]+$/, '')
  return `${base}-with-replaced-audio${extension}`
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

function matchAudioDuration(buffer: AudioBuffer, targetDuration: number) {
  const sampleRate = buffer.sampleRate
  const sourceLength = buffer.length
  const channelCount = buffer.numberOfChannels

  const targetLength = Math.max(1, Math.round(sampleRate * targetDuration))
  if (targetLength === sourceLength) {
    return buffer
  }

  const matched = new AudioBuffer({
    length: targetLength,
    sampleRate,
    numberOfChannels: channelCount,
  })

  for (let channel = 0; channel < channelCount; channel++) {
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
