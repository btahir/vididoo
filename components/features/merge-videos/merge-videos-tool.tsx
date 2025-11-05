'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { SourceFilePicker } from '@/components/media/source-file-picker'
import { useMediabunny } from '@/hooks/use-mediabunny'
import { createBlobInput, createMp4Output } from '@/lib/mediabunny-loader'
import { cn } from '@/lib/utils'
import { GripVertical, X } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

type Mediabunny = typeof import('mediabunny')

type Status = 'idle' | 'ready' | 'converting' | 'success' | 'error'

type VideoFile = {
  file: File
}

export function MergeVideosTool() {
  const [videoFiles, setVideoFiles] = React.useState<VideoFile[]>([])
  const [status, setStatus] = React.useState<Status>('idle')
  const [progress, setProgress] = React.useState<number>(0)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [downloadName, setDownloadName] = React.useState<string | null>(null)

  const { mediabunny, loading, error, reload } = useMediabunny()

  const handleFilesSelected = React.useCallback((files: File[]) => {
    if (files.length === 0) {
      setVideoFiles([])
      setStatus('idle')
      setProgress(0)
      setErrorMessage(null)
      setDownloadName(null)
      return
    }

    const newVideoFiles: VideoFile[] = files.map((file) => ({
      file,
    }))

    setVideoFiles(newVideoFiles)
    setStatus('ready')
    setProgress(0)
    setErrorMessage(null)
    setDownloadName(null)
  }, [])

  const handleFileInputChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(event.target.files || [])
      if (selectedFiles.length > 0) {
        handleFilesSelected(selectedFiles)
      }
    },
    [handleFilesSelected],
  )

  const readyToMerge = videoFiles.length >= 2

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event

      if (over && active.id !== over.id) {
        setVideoFiles((items) => {
          const oldIndex = items.findIndex((item) => item.file.name === active.id)
          const newIndex = items.findIndex((item) => item.file.name === over.id)

          return arrayMove(items, oldIndex, newIndex)
        })
      }
    },
    [],
  )

  const removeVideo = React.useCallback((index: number) => {
    setVideoFiles((prev) => {
      const newFiles = [...prev]
      newFiles.splice(index, 1)
      return newFiles
    })
  }, [])

  const mergeVideos = React.useCallback(async () => {
    if (videoFiles.length < 2) {
      setErrorMessage('Select at least two video files to merge.')
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

    let output: InstanceType<Mediabunny['Output']> | null = null
    let videoSource: InstanceType<Mediabunny['VideoSampleSource']> | null = null
    let audioSource: InstanceType<Mediabunny['AudioSampleSource']> | null = null

    const inputs: Array<InstanceType<Mediabunny['Input']>> = []
    const videoTracks: any[] = []
    const audioTracks: any[] = []

    try {
      // Load all videos and get their tracks
      for (const videoFile of videoFiles) {
        const input = await createBlobInput(videoFile.file, runtime)
        inputs.push(input)

        const tracks = await input.getVideoTracks()
        if (!tracks.length) {
          throw new Error(`Video "${videoFile.file.name}" does not contain a video track.`)
        }
        videoTracks.push(tracks[0])

        const audioTracksForVideo = await input.getAudioTracks()
        audioTracks.push(audioTracksForVideo.length > 0 ? audioTracksForVideo[0] : null)
      }

      // Get the first video's resolution (we'll resize all others to match)
      const firstVideoSink = new runtime.VideoSampleSink(videoTracks[0])
      let firstSample: InstanceType<Mediabunny['VideoSample']> | null = null
      for await (const sample of firstVideoSink.samples()) {
        firstSample = sample
        break // Just get the first sample to check dimensions
      }
      
      if (!firstSample) {
        throw new Error('Unable to read first video dimensions.')
      }

      const targetWidth = firstSample.displayWidth
      const targetHeight = firstSample.displayHeight
      firstSample.close()

      // Create output
      const { output: createdOutput, target, format } = createMp4Output(runtime)
      output = createdOutput

      videoSource = new runtime.VideoSampleSource({
        codec: 'avc',
        bitrate: 4_000_000,
      })
      output.addVideoTrack(videoSource, { 
        frameRate: 30,
      })

      // Always create audio track - we'll add audio from videos that have it, silence for those that don't
      audioSource = new runtime.AudioSampleSource({
        codec: 'aac',
        bitrate: 192_000,
      })
      output.addAudioTrack(audioSource)

      await output.start()

      let currentTimestamp = 0
      const totalVideos = videoFiles.length

      // Process each video - resize if needed, then concatenate
      for (let i = 0; i < videoTracks.length; i++) {
        const track = videoTracks[i]
        const audioTrack = audioTracks[i]

        setProgress(Math.round((i / totalVideos) * 90))

        // Check if this video needs resizing (first video is the reference, skip it)
        let needsResize = false
        if (i > 0) {
          const checkSink = new runtime.VideoSampleSink(track)
          for await (const checkSample of checkSink.samples()) {
            if (checkSample.displayWidth !== targetWidth || checkSample.displayHeight !== targetHeight) {
              needsResize = true
            }
            checkSample.close()
            break
          }
        }

        // If video needs resizing, process through Conversion API first
        if (needsResize) {
          // Process this video through Conversion API to resize it
          const tempOutput = createMp4Output(runtime)
          const conversion = await runtime.Conversion.init({
            input: inputs[i],
            output: tempOutput.output,
            video: {
              forceTranscode: true,
              process: (sample) => {
                const canvas = document.createElement('canvas')
                canvas.width = targetWidth
                canvas.height = targetHeight
                const ctx = canvas.getContext('2d')!
                // Draw and scale the sample to target dimensions
                sample.draw(ctx, 0, 0, targetWidth, targetHeight)
                return canvas
              },
            },
            audio: {
              forceTranscode: true,
            },
          })

          if (conversion.isValid) {
            await conversion.execute()
            const resizedBuffer = tempOutput.target.buffer
            if (resizedBuffer) {
              // Create new input from resized video
              const resizedBlob = new Blob([resizedBuffer], { type: tempOutput.format.mimeType })
              const resizedInput = await createBlobInput(
                new File([resizedBlob], `resized-${i}.mp4`),
                runtime,
              )
              const resizedTracks = await resizedInput.getVideoTracks()
              const resizedAudioTracks = await resizedInput.getAudioTracks()
              if (resizedTracks.length > 0) {
                const resizedSink = new runtime.VideoSampleSink(resizedTracks[0])
                let lastVideoTimestamp = 0
                for await (const sample of resizedSink.samples()) {
                  const adjusted = sample.clone()
                  adjusted.setTimestamp(sample.timestamp + currentTimestamp)
                  await videoSource!.add(adjusted)
                  sample.close()
                  adjusted.close()
                  lastVideoTimestamp = Math.max(lastVideoTimestamp, sample.timestamp + sample.duration)
                }

                // Process audio from resized video
                if (audioSource && resizedAudioTracks.length > 0) {
                  try {
                    const audioSink = new runtime.AudioSampleSink(resizedAudioTracks[0])
                    for await (const sample of audioSink.samples()) {
                      const adjusted = sample.clone()
                      adjusted.setTimestamp(sample.timestamp + currentTimestamp)
                      await audioSource.add(adjusted)
                      sample.close()
                      adjusted.close()
                    }
                  } catch (err) {
                    // Skip audio if it fails
                  }
                }

                currentTimestamp += lastVideoTimestamp
                resizedInput.dispose()
                continue
              }
              resizedInput.dispose()
            }
          }
        }

        // Process all video samples - no resizing needed (first video or already resized)
        const videoSink = new runtime.VideoSampleSink(track)
        let lastVideoTimestamp = 0
        for await (const sample of videoSink.samples()) {
          const adjusted = sample.clone()
          adjusted.setTimestamp(sample.timestamp + currentTimestamp)
          await videoSource!.add(adjusted)
          sample.close()
          adjusted.close()
          lastVideoTimestamp = Math.max(lastVideoTimestamp, sample.timestamp + sample.duration)
        }

        // Process audio samples if available, otherwise skip (video will be silent)
        if (audioSource && audioTrack !== null) {
          try {
            const audioSink = new runtime.AudioSampleSink(audioTrack)
            for await (const sample of audioSink.samples()) {
              const adjusted = sample.clone()
              adjusted.setTimestamp(sample.timestamp + currentTimestamp)
              await audioSource.add(adjusted)
              sample.close()
              adjusted.close()
            }
          } catch (err) {
            // If audio processing fails for this video, just skip it (video will be silent)
            // Continue with the next video - we don't care if some videos are silent
          }
        }

        // Move timestamp forward for next video
        currentTimestamp += lastVideoTimestamp
      }

      videoSource?.close()
      audioSource?.close()

      await output.finalize()

      const buffer = target.buffer
      if (!buffer) {
        throw new Error('No video data produced.')
      }

      const blob = new Blob([buffer], { type: format.mimeType })
      const url = URL.createObjectURL(blob)
      const filename = buildOutputName(videoFiles.map((vf) => vf.file.name), format.fileExtension)
      triggerDownload(url, filename)
      setDownloadName(filename)
      setProgress(100)
      setStatus('success')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Video merging failed. Please try again.'
      setErrorMessage(message)
      setStatus('error')
      setProgress(0)
    } finally {
      videoSource?.close()
      audioSource?.close()
      inputs.forEach((input) => {
        input.dispose()
      })
    }
  }, [videoFiles, mediabunny, reload])

  const disabled = status === 'converting' || loading || !readyToMerge

  const statusMessage = React.useMemo(() => {
    if (status === 'converting') {
      return { text: 'Merging videos…', tone: 'text-amber-200' }
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
      <div className="space-y-2">
        <label htmlFor="video-files" className="text-sm font-medium text-slate-300">
          Select video files to merge (in order)
        </label>
        <input
          id="video-files"
          type="file"
          accept="video/*"
          multiple
          disabled={status === 'converting'}
          onChange={handleFileInputChange}
          className="sr-only"
        />
        <button
          type="button"
          onClick={() => document.getElementById('video-files')?.click()}
          disabled={status === 'converting'}
          className={cn(
            'flex w-full items-center justify-between gap-3 overflow-hidden rounded-lg border border-white/10 bg-slate-900/60 px-4 py-3 text-left text-sm text-slate-200 transition hover:border-orange-400/40 hover:bg-slate-900/80',
            disabled && 'cursor-not-allowed opacity-70',
          )}
        >
          <span className="min-w-0 truncate">
            {videoFiles.length === 0
              ? 'Select video files (at least 2 required)'
              : `${videoFiles.length} video${videoFiles.length === 1 ? '' : 's'} selected`}
          </span>
          <span className="shrink-0 rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">
            Browse
          </span>
        </button>
      </div>

      {videoFiles.length > 0 && (
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/60 p-4">
          <p className="mb-3 text-sm font-medium text-slate-300">Video Order</p>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={videoFiles.map((vf) => vf.file.name)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {videoFiles.map((videoFile, index) => (
                  <SortableVideoItem
                    key={videoFile.file.name}
                    videoFile={videoFile}
                    index={index}
                    onRemove={() => removeVideo(index)}
                    disabled={status === 'converting'}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
          <p className="mt-3 text-xs text-slate-400">
            Drag the handle to reorder videos. They will be concatenated in this order.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {(status === 'converting' || progress > 0) && (
          <Progress value={progress} className="h-1.5 bg-slate-800" />
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={mergeVideos}
            disabled={disabled}
            className="rounded-full bg-linear-to-r from-orange-500 to-orange-600 px-6 text-white shadow-lg shadow-orange-500/30 transition hover:from-orange-400 hover:to-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === 'converting' ? 'Processing…' : 'Merge videos'}
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

type SortableVideoItemProps = {
  videoFile: VideoFile
  index: number
  onRemove: () => void
  disabled: boolean
}

function SortableVideoItem({ videoFile, index, onRemove, disabled }: SortableVideoItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: videoFile.file.name,
    disabled,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-3 rounded-lg border border-slate-700/40 bg-slate-800/40 px-3 py-2',
        isDragging && 'shadow-lg border-orange-500/50',
      )}
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-orange-500/20 text-xs font-semibold text-orange-400">
        {index + 1}
      </span>
      <div
        {...attributes}
        {...listeners}
        className={cn(
          'cursor-grab active:cursor-grabbing touch-none p-1 hover:bg-slate-700/50 rounded transition-colors',
          disabled && 'cursor-not-allowed opacity-50',
        )}
        tabIndex={disabled ? -1 : 0}
      >
        <GripVertical className="h-4 w-4 text-slate-400" />
      </div>
      <p className="flex-1 text-sm text-slate-200 truncate">{videoFile.file.name}</p>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-rose-400 hover:text-rose-300 hover:bg-rose-500/20"
        disabled={disabled}
        onClick={onRemove}
        title="Remove"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}

function buildOutputName(fileNames: string[], extension: string) {
  const base = fileNames
    .map((name) => name.replace(/\.[^/.]+$/, '').replace(/\s+/g, '-').toLowerCase())
    .join('-')
  return `${base}-merged${extension}`
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

