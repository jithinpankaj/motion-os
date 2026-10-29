export type ChannelFormat = {
  id: string;
  name: string;
  platform: string;
  width: number;
  height: number;
  /** Safe area insets as fractions of each dimension (UI overlays on the destination). */
  safe: { top: number; right: number; bottom: number; left: number };
  chrome: 'ig-post' | 'ig-story' | 'linkedin' | 'web-hero' | 'web-banner' | 'app-banner' | 'app-popup' | 'slide';
};

export const CHANNEL_FORMATS: ChannelFormat[] = [
  { id: 'instagram-feed', name: 'Instagram Feed', platform: 'Instagram', width: 1080, height: 1350, safe: { top: 0.04, right: 0.05, bottom: 0.06, left: 0.05 }, chrome: 'ig-post' },
  { id: 'instagram-story', name: 'Instagram Story', platform: 'Instagram', width: 1080, height: 1920, safe: { top: 0.13, right: 0.06, bottom: 0.18, left: 0.06 }, chrome: 'ig-story' },
  { id: 'linkedin-feed', name: 'LinkedIn Feed', platform: 'LinkedIn', width: 1200, height: 1200, safe: { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 }, chrome: 'linkedin' },
  { id: 'website-hero', name: 'Website Hero', platform: 'Web', width: 1920, height: 1080, safe: { top: 0.1, right: 0.08, bottom: 0.08, left: 0.08 }, chrome: 'web-hero' },
  { id: 'website-banner', name: 'Website Banner', platform: 'Web', width: 1600, height: 400, safe: { top: 0.1, right: 0.04, bottom: 0.1, left: 0.04 }, chrome: 'web-banner' },
  { id: 'app-banner', name: 'Mobile App Banner', platform: 'App', width: 1170, height: 390, safe: { top: 0.08, right: 0.05, bottom: 0.08, left: 0.05 }, chrome: 'app-banner' },
  { id: 'app-popup', name: 'Mobile App Popup', platform: 'App', width: 900, height: 1200, safe: { top: 0.08, right: 0.07, bottom: 0.2, left: 0.07 }, chrome: 'app-popup' },
  { id: 'presentation-slide', name: 'Presentation Slide', platform: 'Slides', width: 1920, height: 1080, safe: { top: 0.06, right: 0.06, bottom: 0.06, left: 0.06 }, chrome: 'slide' },
];

export const formatById = (id: string) => CHANNEL_FORMATS.find((f) => f.id === id);
