declare module 'pixoo-api' {
  export type RGB = [number, number, number];

  export class PixooAPI {
    constructor(address: string, size?: number);
    initialize(): Promise<unknown>;
    clear(): unknown;
    fill(color: RGB): unknown;
    drawTextCenter(text: string, y: number, color: RGB, font?: unknown): unknown;
    push(): Promise<unknown>;
    getAllSettings(): Promise<unknown>;
    setBrightness(brightness: number): Promise<unknown>;
    setOnOffScreen(onOff: 0 | 1): Promise<unknown>;
    [method: string]: unknown;
  }
}
