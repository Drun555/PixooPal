import { defineClockface, data, input } from '@pixoopal/clockface';

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
  render: (context) => {
    const text = (context.data.text || DEFAULT_DATA.text).trim() || DEFAULT_DATA.text;

    context.canvas.clear(context.data.backgroundColor || DEFAULT_DATA.backgroundColor);
    context.canvas.text(text, centerTextX(text), 28, {
      fill: context.data.textColor || DEFAULT_DATA.textColor
    });
  }
});

function centerTextX(text: string) {
  return Math.max(0, Math.floor((64 - text.length * 6) / 2));
}
