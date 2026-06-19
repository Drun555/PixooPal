import { Buffer } from 'node:buffer';
import { normalizeNumber, parsePayloadJson } from './payload';
import { DEVICE_GET_TOPIC, DEVICE_SET_TOPIC, HEARTBEAT_INTERVAL_MS, HEARTBEAT_TOPIC } from './topics';

type PublishPayload = (topic: string, payload: Record<string, unknown> | Buffer | string) => void;

export function startDeviceHeartbeat(publish: PublishPayload) {
  publishHeartbeat(publish);
  return setInterval(() => publishHeartbeat(publish), HEARTBEAT_INTERVAL_MS);
}

export function handleDevicePublish(topic: string, payload: Buffer | string | undefined, publish: PublishPayload) {
  if (topic !== DEVICE_SET_TOPIC) {
    return;
  }

  handleDeviceSet(payload, publish);
}

function handleDeviceSet(payload: Buffer | string | undefined, publish: PublishPayload) {
  const body = parsePayloadJson(payload);

  if (body?.Command !== 'Device/AppRestartMqtt') {
    return;
  }

  const response = {
    ReturnCode: 0,
    ReturnMessage: '',
    DeviceId: normalizeNumber(body.DeviceId, 300358569),
    Command: 'Device/AppRestartMqtt',
    PacketFlag: normalizeNumber(body.PacketFlag, 0)
  };

  console.log(
    `[PixooPal MQTT] Device/AppRestartMqtt received. Publishing response to ${DEVICE_GET_TOPIC}: DeviceId=${response.DeviceId}, PacketFlag=${response.PacketFlag}`
  );
  publish(DEVICE_GET_TOPIC, response);
}

function publishHeartbeat(publish: PublishPayload) {
  publish(HEARTBEAT_TOPIC, {
    Command: 'Device/Hearbeat'
  });
}
