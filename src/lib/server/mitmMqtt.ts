import { env } from '$env/dynamic/private';

export const MITM_DEVICE_ID = 12345;
export const MITM_DEVICE_TOKEN = 'pixoopal';
export const PIXOOPAL_MQTT_PORT = 1883;

const DEFAULT_PIXOOPAL_HOST_IP = '127.0.0.1';

export type MitmMqttConfig = {
  host: string;
  port: number;
  responseAddress: string;
};

export function getMitmMqttConfig(): MitmMqttConfig {
  const host =
    (env.PIXOOPAL_HOST_IP || env.MITM_MQTT_IP_HOST || DEFAULT_PIXOOPAL_HOST_IP).trim() ||
    DEFAULT_PIXOOPAL_HOST_IP;

  return {
    host,
    port: PIXOOPAL_MQTT_PORT,
    responseAddress: host
  };
}
