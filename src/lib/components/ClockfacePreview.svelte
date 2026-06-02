<script lang="ts">
  type PreviewPayload = {
    size: number;
    buffer: number[];
  };

  const PREVIEW_SIZE = 64;

  export let preview: PreviewPayload = {
    size: PREVIEW_SIZE,
    buffer: new Array(PREVIEW_SIZE * PREVIEW_SIZE * 3).fill(0)
  };

  let previewCanvas: HTMLCanvasElement;
  let glowColor = 'rgba(47, 138, 122, 0.45)';

  $: paintPreview(previewCanvas, preview);
  $: previewStyle = `--preview-glow: ${glowColor}`;

  function paintPreview(canvas: HTMLCanvasElement | undefined, nextPreview: PreviewPayload) {
    if (!canvas) {
      return;
    }

    const size = nextPreview.size || PREVIEW_SIZE;
    const buffer = nextPreview.buffer;
    const context = canvas.getContext('2d');

    if (!context || buffer.length < size * size * 3) {
      return;
    }

    if (canvas.width !== size) {
      canvas.width = size;
    }

    if (canvas.height !== size) {
      canvas.height = size;
    }

    const imageData = context.createImageData(size, size);

    for (let index = 0, pixel = 0; index < buffer.length; index += 3, pixel += 4) {
      imageData.data[pixel] = buffer[index] ?? 0;
      imageData.data[pixel + 1] = buffer[index + 1] ?? 0;
      imageData.data[pixel + 2] = buffer[index + 2] ?? 0;
      imageData.data[pixel + 3] = 255;
    }

    context.putImageData(imageData, 0, 0);
    glowColor = getGlowColor(buffer);
  }

  function getGlowColor(buffer: number[]) {
    let red = 0;
    let green = 0;
    let blue = 0;
    let weight = 0;

    for (let index = 0; index < buffer.length; index += 3) {
      const pixelRed = buffer[index] ?? 0;
      const pixelGreen = buffer[index + 1] ?? 0;
      const pixelBlue = buffer[index + 2] ?? 0;
      const brightness = Math.max(pixelRed, pixelGreen, pixelBlue);

      if (brightness > 12) {
        red += pixelRed * brightness;
        green += pixelGreen * brightness;
        blue += pixelBlue * brightness;
        weight += brightness;
      }
    }

    if (weight === 0) {
      return 'rgba(47, 138, 122, 0.42)';
    }

    return `rgba(${Math.round(red / weight)}, ${Math.round(green / weight)}, ${Math.round(
      blue / weight
    )}, 0.54)`;
  }
</script>

<section class="preview-stage" style={previewStyle}>
  <div class="preview-aura"></div>
  <div class="preview-shell">
    <div class="pixoo-frame">
      <div class="pixel-screen">
        <canvas
          aria-label="Pixoo Buffer"
          bind:this={previewCanvas}
          height={PREVIEW_SIZE}
          width={PREVIEW_SIZE}
        ></canvas>
      </div>
    </div>
  </div>
</section>

<style>
  .preview-stage {
    position: relative;
    display: grid;
    gap: 14px;
    place-items: center;
    isolation: isolate;
  }

  .preview-aura {
    position: absolute;
    z-index: -1;
    width: min(78vw, 520px);
    aspect-ratio: 1;
    border-radius: 50%;
    background: var(--preview-glow);
    filter: blur(58px);
    opacity: 0.82;
    transform: scale(0.92);
  }

  .preview-shell {
    width: min(calc(42vw + 44px), 474px);
    max-width: 100%;
    padding: clamp(14px, 3vw, 22px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 18px;
    background:
      linear-gradient(145deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.02)),
      rgba(10, 13, 18, 0.72);
    box-shadow:
      0 0 80px var(--preview-glow),
      0 26px 82px rgba(0, 0, 0, 0.58),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
    backdrop-filter: blur(18px);
  }

  .pixoo-frame {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 26px;
    background:
      linear-gradient(145deg, #2a303b, #11151d 62%),
      #151a23;
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.08),
      inset 0 -16px 28px rgba(0, 0, 0, 0.26);
  }

  .pixel-screen {
    display: grid;
    width: 100%;
    height: 100%;
    place-items: center;
    overflow: hidden;
    border-radius: 13px;
    background: #030405;
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.05),
      inset 0 0 44px rgba(0, 0, 0, 0.84);
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
    image-rendering: pixelated;
  }

  @media (max-width: 860px) {
    .preview-stage {
      min-height: 0;
      padding: 8px 0;
    }

    .preview-shell {
      width: 100%;
    }

    .preview-aura {
      width: min(110vw, 520px);
    }

    .pixoo-frame {
      width: 100%;
    }
  }
</style>
