import mediaFormats from '../../media-formats.json';

export const SUPPORTED_AUDIO_EXTENSIONS: readonly string[] = Object.freeze([
  ...mediaFormats.audioExtensions,
]);

export const SUPPORTED_AUDIO_EXTENSION_SET: ReadonlySet<string> = new Set(
  SUPPORTED_AUDIO_EXTENSIONS,
);
