import {
  defineClockface,
  data,
  input,
  type ClockfaceFileInputValue,
  type MediaType
} from '@pixoopal/clockface';
import {
  DEFAULT_GIF_PLAYBACK_SPEED,
  MAX_GIF_PLAYBACK_SPEED,
  MIN_GIF_PLAYBACK_SPEED,
  normalizeGifPlaybackSpeed
} from '@pixoopal/clockface/media';

let media: ClockfaceFileInputValue | undefined;
let mediaType: MediaType = 'gif';

export default defineClockface({
  resolution: 64,
  frameQueueSize: 5,
  data: {
    fileName: data.string(''),
    playbackSpeed: data.number(DEFAULT_GIF_PLAYBACK_SPEED),
    status: data.string('Upload GIF / Video / Picture')
  },
  inputs: [
    input.number('playbackSpeed', 'Speed', {
      min: MIN_GIF_PLAYBACK_SPEED,
      max: MAX_GIF_PLAYBACK_SPEED,
      step: 0.1,
      onSubmit(value, context) {
        context.data.playbackSpeed = normalizeGifPlaybackSpeed(String(value)).toString();
      }
    }),
    input.file('media', 'GIF / Video', {
      accept: 'image/gif,video/*,.gif,.mp4,.mov,.webm,.mkv',
      isSetting: false,
      onSubmit(value, context) {
        if (!isFileInput(value)) {
          return;
        }

        media = value;
        mediaType = getMediaType(value);
        context.data.fileName = value.name;
        context.data.status = 'Готово';
      }
    })
  ],
  getInterval: () => (media ? 80 : 0),
  render: (context) => {
    context.canvas.clear();

    if (!media) {
      return;
    }

    context.canvas.media(media, mediaType);
  }
});

function isFileInput(value: unknown): value is ClockfaceFileInputValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'bytes' in value &&
    value.bytes instanceof Uint8Array
  );
}

function getMediaType(file: ClockfaceFileInputValue): MediaType {
  if (file.type.startsWith('video/')) {
    return 'video';
  }

  return 'gif';
}
