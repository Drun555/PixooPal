import { color, defineClockface, data, input } from '@pixoopal/clockface';
import { drawBitmapText, measureBitmapText } from '@pixoopal/clockface/bitmap-text';

const DEFAULT_DATA = {
  text: 'love',
  textColor: '#ff00d0',
  backgroundColor: '#000000'
};

export default defineClockface({
  resolution: 64,
  frameQueueSize: 1,
  data: {
    text: data.string(DEFAULT_DATA.text),
    textColor: data.color(DEFAULT_DATA.textColor),
    backgroundColor: data.color(DEFAULT_DATA.backgroundColor)
  },
  inputs: [
    input.text('text', 'Text', {
      onSubmit(value, context) {
        context.data.text = String(value).toLowerCase()
      } 
    }),
    input.color('textColor', 'Text color'),
    input.color('backgroundColor', 'Background color')
  ],
  render: async (context) => {
    const text = (context.data.text || DEFAULT_DATA.text).trim() || DEFAULT_DATA.text;

    context.canvas.clear(context.data.backgroundColor || DEFAULT_DATA.backgroundColor);
    await drawBitmapText({
      buffer: context.buffer,
      size: context.resolution,
      text,
      x: centerTextX(text, context.resolution),
      y: 28,
      color: color.parse(context.data.textColor || DEFAULT_DATA.textColor)
    });
  }
});

function centerTextX(text: string, resolution: number) {
  return Math.max(0, Math.floor((resolution - measureBitmapText(text)) / 2));
}
