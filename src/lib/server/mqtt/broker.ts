import net from 'node:net';
import { Buffer } from 'node:buffer';
import { Aedes, type Client } from 'aedes';
import { handleDevicePublish, startDeviceHeartbeat } from './deviceCommands';
import { createPixooMqttStream } from './normalizer';
import { MQTT_PASSWORD, MQTT_PORT } from './topics';

type BrokerState = {
  broker?: Aedes;
  server?: net.Server;
  started?: boolean;
  heartbeatTimer?: ReturnType<typeof setInterval>;
};

const state = getBrokerState();

export function startPixooMitmMqttBroker() {
  if (state.started) {
    return state;
  }

  state.started = true;

  Aedes.createBroker({
    id: `pixoopal-${process.pid}`,
    authenticate(client, _username, password, done) {
      const passwordText = password ? password.toString('utf-8') : '';
      const accepted = !passwordText || passwordText === MQTT_PASSWORD;

      if (!accepted) {
        console.warn(`[PixooPal MQTT] Connect rejected: clientId=${client.id || '(empty)'}`);
        const error = new Error('Bad username or password') as Error & { returnCode: 4 };
        error.returnCode = 4;
        done(error, false);
        return;
      }

      done(null, true);
    }
  })
    .then((broker) => {
      state.broker = broker;
      wireBrokerHandlers(broker);

      const server = net.createServer((socket) => {
        broker.handle(createPixooMqttStream(socket));
      });

      state.server = server;

      server.on('error', (error) => {
        console.error(
          `[PixooPal MQTT] Broker listen failed on 0.0.0.0:${MQTT_PORT}: ${getErrorCode(error) || error.message}`
        );
      });

      server.listen(MQTT_PORT, '0.0.0.0', () => {
        console.log(`[PixooPal MQTT] Broker listening on mqtt://0.0.0.0:${MQTT_PORT}`);
        state.heartbeatTimer = startDeviceHeartbeat((topic, payload) => publishPayload(broker, topic, payload));
      });
    })
    .catch((error) => {
      console.error(
        `[PixooPal MQTT] Broker start failed: ${error instanceof Error ? error.message : String(error)}`
      );
    });

  return state;
}

export function stopPixooMitmMqttBroker() {
  state.started = false;

  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = undefined;
  }

  if (state.server) {
    state.server.close();
    state.server = undefined;
  }

  if (state.broker) {
    state.broker.close();
    state.broker = undefined;
  }
}

export function sendCommand(topic: string, payload: Record<string, unknown> | Buffer | string) {
  const broker = state.broker;

  if (!broker) {
    throw new Error('PixooPal MQTT broker is not started.');
  }

  publishPayload(broker, topic, payload);
}

function getBrokerState() {
  const scope = globalThis as typeof globalThis & { __pixoopalMitmMqttBroker?: BrokerState };
  scope.__pixoopalMitmMqttBroker ??= {};
  return scope.__pixoopalMitmMqttBroker;
}

function wireBrokerHandlers(broker: Aedes) {
  broker.on('clientReady', (client) => {
    console.log(`[PixooPal MQTT] Pixoo connected: clientId=${client.id}`);
  });

  broker.on('clientDisconnect', (client) => {
    console.log(`[PixooPal MQTT] Pixoo disconnected: clientId=${client.id}`);
  });

  broker.on('clientError', (client, error) => {
    console.warn(
      `[PixooPal MQTT] Pixoo connection failed: clientId=${client?.id || '(empty)'}, error=${error.message}`
    );
  });

  broker.on('connectionError', (client, error) => {
    console.warn(
      `[PixooPal MQTT] MQTT connection failed: clientId=${client?.id || '(empty)'}, error=${error.message}`
    );
  });

  broker.on('publish', (packet, client) => {
    if (!client) {
      return;
    }

    handleDevicePublish(packet.topic, packet.payload, (topic, payload) => publishPayload(broker, topic, payload));
  });
}

function publishPayload(broker: Aedes, topic: string, payload: Record<string, unknown> | Buffer | string) {
  const body =
    Buffer.isBuffer(payload) || typeof payload === 'string'
      ? payload
      : Buffer.from(JSON.stringify(payload), 'utf-8');

  broker.publish(
    {
      cmd: 'publish',
      topic,
      payload: body,
      qos: 0,
      retain: false,
      dup: false
    },
    (error) => {
      if (error) {
        console.warn(`[PixooPal MQTT] Publish failed: topic=${topic}, error=${error.message}`);
      }
    }
  );
}

function getErrorCode(error: Error) {
  return 'code' in error ? String(error.code ?? '') : '';
}

export type { Client as MqttClient };
