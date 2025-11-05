export interface Method {
  name: string;
  icon: string;
  slug: string;
}

export const METHODS: Method[] = [
  { name: "Cut Video", icon: "✂️", slug: "cut-video" },
  { name: "Video To GIF", icon: "🎬", slug: "video-to-gif" },
  { name: "Image To Video", icon: "🖼️", slug: "image-to-video" },
  { name: "Blend Tracks", icon: "🎵", slug: "blend-tracks" },
  { name: "Extract Audio", icon: "🎤", slug: "extract-audio" },
  { name: "Image Conversion", icon: "🔄", slug: "image-conversion" },
  { name: "Replace Audio", icon: "🔊", slug: "replace-audio" },
  { name: "Crop Video", icon: "✂️", slug: "crop-video" },
  { name: "Gray Video", icon: "⚫", slug: "gray-video" },
  { name: "Merge Videos", icon: "🔗", slug: "merge-videos" },
  { name: "Resize Video", icon: "📐", slug: "resize-video" },
  { name: "Add Watermark", icon: "💧", slug: "add-watermark" },
  { name: "Compress Video", icon: "🗜️", slug: "compress-video" },
  { name: "Rotate Video", icon: "🔄", slug: "rotate-video" },
  { name: "Add Subtitles", icon: "📝", slug: "add-subtitles" },
  { name: "Speed Control", icon: "⚡", slug: "speed-control" },
];

export function getMethodBySlug(slug: string): Method | undefined {
  return METHODS.find((method) => method.slug === slug);
}

