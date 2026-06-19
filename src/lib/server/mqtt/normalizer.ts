import { Buffer } from 'node:buffer';
import { Duplex } from 'node:stream';
import type net from 'node:net';
import { DEVICE_SET_TOPIC } from './topics';

const DEVICE_SET_TOPIC_BUFFER = Buffer.from(DEVICE_SET_TOPIC, 'utf-8');

type MqttPacketBounds = {
  headerLength: number;
  remainingLength: number;
  end: number;
};

export function createPixooMqttStream(socket: net.Socket) {
  let inputBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  const stream = new Duplex({
    read() {},
    write(chunk: Buffer | string, _encoding, callback) {
      socket.write(chunk, callback);
    },
    destroy(error, callback) {
      socket.destroy(error ?? undefined);
      callback(error);
    }
  });

  socket.on('data', (chunk: Buffer | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    inputBuffer = Buffer.concat([inputBuffer, buffer]);
    inputBuffer = flushNormalizedPackets(inputBuffer, stream);
  });

  socket.on('close', () => {
    stream.push(null);
    stream.destroy();
  });

  socket.on('error', (error) => {
    stream.destroy(error);
  });

  return stream;
}

function flushNormalizedPackets(buffer: Buffer, stream: Duplex) {
  let cursor = 0;

  while (cursor < buffer.length) {
    const parsed = readMqttPacketBounds(buffer, cursor);

    if (!parsed) {
      break;
    }

    const packet = buffer.subarray(cursor, parsed.end);
    stream.push(safeNormalizePixooPublishPacket(packet, parsed.headerLength, parsed.remainingLength));
    cursor = parsed.end;
  }

  return cursor > 0 ? buffer.subarray(cursor) : buffer;
}

function readMqttPacketBounds(buffer: Buffer, offset: number): MqttPacketBounds | null {
  let multiplier = 1;
  let remainingLength = 0;

  for (let index = offset + 1; index < Math.min(buffer.length, offset + 5); index += 1) {
    const encodedByte = buffer[index];

    if (encodedByte === undefined) {
      return null;
    }

    remainingLength += (encodedByte & 127) * multiplier;

    if ((encodedByte & 128) === 0) {
      const headerLength = index - offset + 1;
      const end = offset + headerLength + remainingLength;
      return buffer.length >= end ? { headerLength, remainingLength, end } : null;
    }

    multiplier *= 128;
  }

  return null;
}

function safeNormalizePixooPublishPacket(packet: Buffer, headerLength: number, remainingLength: number) {
  try {
    return normalizePixooPublishPacket(packet, headerLength, remainingLength);
  } catch (error) {
    console.warn(
      `[PixooPal MQTT] Malformed Pixoo packet passed through normalizer: ${error instanceof Error ? error.message : String(error)}`
    );
    return packet;
  }
}

function normalizePixooPublishPacket(packet: Buffer, headerLength: number, remainingLength: number) {
  const packetType = packet[0] >> 4;
  const flags = packet[0] & 0x0f;
  const qos = (flags >> 1) & 0x03;

  if (packetType !== 3 || qos === 0) {
    return packet;
  }

  if (packet.length < headerLength + 2 || remainingLength < 2) {
    return packet;
  }

  const topicLength = packet.readUInt16BE(headerLength);

  if (topicLength <= remainingLength - 2) {
    return packet;
  }

  const topicIndex = packet.indexOf(DEVICE_SET_TOPIC_BUFFER, headerLength);

  if (topicIndex < 0) {
    return packet;
  }

  const packetIdIndex = topicIndex + DEVICE_SET_TOPIC_BUFFER.length;
  const payloadIndex = packetIdIndex + 2;

  if (packet.length < payloadIndex + 1 || packet[payloadIndex] !== 0x7b) {
    return packet;
  }

  const packetId = packet.subarray(packetIdIndex, payloadIndex);
  const payload = packet.subarray(payloadIndex);
  const newRemainingLength = 2 + DEVICE_SET_TOPIC_BUFFER.length + 2 + payload.length;
  const normalized = Buffer.concat([
    Buffer.from([packet[0], ...encodeRemainingLength(newRemainingLength)]),
    Buffer.from([0, DEVICE_SET_TOPIC_BUFFER.length]),
    DEVICE_SET_TOPIC_BUFFER,
    packetId,
    payload
  ]);

  console.warn(
    `[PixooPal MQTT] Normalized malformed Pixoo PUBLISH: topic=${DEVICE_SET_TOPIC}, oldRemainingLength=${remainingLength}, newRemainingLength=${newRemainingLength}`
  );

  return normalized;
}

function encodeRemainingLength(value: number) {
  const bytes: number[] = [];
  let remaining = value;

  do {
    let encodedByte = remaining % 128;
    remaining = Math.floor(remaining / 128);

    if (remaining > 0) {
      encodedByte |= 128;
    }

    bytes.push(encodedByte);
  } while (remaining > 0);

  return bytes;
}
