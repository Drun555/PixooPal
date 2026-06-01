import { Clockface, type ClockfaceContext } from '$lib/Clockface';
import {
  createMediaAnimation,
  decodeMediaFile,
  DEFAULT_GIF_PLAYBACK_SPEED,
  drawMediaAnimationFrame,
  isMediaFileInput,
  MAX_GIF_PLAYBACK_SPEED,
  MIN_GIF_PLAYBACK_SPEED,
  normalizeGifPlaybackSpeed,
  type MediaAnimation
} from '../shared/mediaAnimation';

const RESOLUTION = 64;

let animation: MediaAnimation | undefined;

const gifPlayer = new Clockface({
  resolution: RESOLUTION,
  data: {
    fileName: '',
    playbackSpeed: DEFAULT_GIF_PLAYBACK_SPEED.toString(),
    status: 'Загрузите GIF или видео'
  },
  inputs: [
    {
      type: 'input-num',
      id: 'playbackSpeed',
      friendlyName: 'Скорость',
      min: MIN_GIF_PLAYBACK_SPEED,
      max: MAX_GIF_PLAYBACK_SPEED,
      step: 0.1,
      onSubmit: (value, context) => {
        context.data.playbackSpeed = normalizeGifPlaybackSpeed(String(value)).toString();
        animation?.reset();
        renderGif(context);
      }
    },
    {
      type: 'input-file',
      id: 'media',
      friendlyName: 'GIF / Video',
      accept: 'image/gif,video/*,.gif,.mp4,.mov,.webm,.mkv',
      onSubmit: async (value, context) => {
        if (!isMediaFileInput(value)) {
          return;
        }

        context.data.status = 'Декодирую';
        animation = createMediaAnimation(
          await decodeMediaFile(value, {
            resolution: context.resolution
          })
        );
        context.data.fileName = value.name;
        context.data.status = `${animation.frames.length} кадр.`;
        renderGif(context);
      }
    }
  ],
  getUpdateIntervalMs: () => (animation && animation.frames.length > 1 ? 80 : 0),
  init: clear,
  main: renderGif
});

export default gifPlayer;

function renderGif(context: ClockfaceContext) {
  if (!animation) {
    clear(context);
    return;
  }

  drawMediaAnimationFrame(context, animation, context.data.playbackSpeed);
}

function clear(context: ClockfaceContext) {
  for (let index = 0; index < context.buffer.length; index += 1) {
    context.buffer[index] = [0, 0, 0];
  }
}
