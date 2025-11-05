import type { LucideIcon } from "lucide-react";
import {
  Scissors,
  FileVideo,
  AudioLines,
  AudioWaveform,
  Replace,
  Crop,
  Palette,
  Merge,
  Expand,
  BadgeCheck,
  Package,
  Gauge,
} from "lucide-react";

export interface Method {
  name: string;
  icon: LucideIcon;
  slug: string;
}

export const METHODS: Method[] = [
  { name: "Cut Video", icon: Scissors, slug: "cut-video" },
  { name: "Image To Video", icon: FileVideo, slug: "image-to-video" },
  { name: "Blend Tracks", icon: AudioLines, slug: "blend-tracks" },
  { name: "Extract Audio", icon: AudioWaveform, slug: "extract-audio" },
  { name: "Replace Audio", icon: Replace, slug: "replace-audio" },
  { name: "Crop Video", icon: Crop, slug: "crop-video" },
  { name: "Gray Video", icon: Palette, slug: "gray-video" },
  { name: "Merge Videos", icon: Merge, slug: "merge-videos" },
  { name: "Resize Video", icon: Expand, slug: "resize-video" },
  { name: "Add Watermark", icon: BadgeCheck, slug: "add-watermark" },
  { name: "Compress Video", icon: Package, slug: "compress-video" },
  { name: "Speed Control", icon: Gauge, slug: "speed-control" },
];

export function getMethodBySlug(slug: string): Method | undefined {
  return METHODS.find((method) => method.slug === slug);
}
