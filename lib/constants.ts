import type { LucideIcon } from "lucide-react";
import {
  Scissors,
  Film,
  FileVideo,
  AudioLines,
  AudioWaveform,
  Images,
  Replace,
  Crop,
  Palette,
  Merge,
  Expand,
  BadgeCheck,
  Package,
  RotateCcw,
  Subtitles,
  Gauge,
} from "lucide-react";

export interface Method {
  name: string;
  icon: LucideIcon;
  slug: string;
}

export const METHODS: Method[] = [
  { name: "Cut Video", icon: Scissors, slug: "cut-video" },
  { name: "Video To GIF", icon: Film, slug: "video-to-gif" },
  { name: "Image To Video", icon: FileVideo, slug: "image-to-video" },
  { name: "Blend Tracks", icon: AudioLines, slug: "blend-tracks" },
  { name: "Extract Audio", icon: AudioWaveform, slug: "extract-audio" },
  { name: "Image Conversion", icon: Images, slug: "image-conversion" },
  { name: "Replace Audio", icon: Replace, slug: "replace-audio" },
  { name: "Crop Video", icon: Crop, slug: "crop-video" },
  { name: "Gray Video", icon: Palette, slug: "gray-video" },
  { name: "Merge Videos", icon: Merge, slug: "merge-videos" },
  { name: "Resize Video", icon: Expand, slug: "resize-video" },
  { name: "Add Watermark", icon: BadgeCheck, slug: "add-watermark" },
  { name: "Compress Video", icon: Package, slug: "compress-video" },
  { name: "Rotate Video", icon: RotateCcw, slug: "rotate-video" },
  { name: "Add Subtitles", icon: Subtitles, slug: "add-subtitles" },
  { name: "Speed Control", icon: Gauge, slug: "speed-control" },
];

export function getMethodBySlug(slug: string): Method | undefined {
  return METHODS.find((method) => method.slug === slug);
}
