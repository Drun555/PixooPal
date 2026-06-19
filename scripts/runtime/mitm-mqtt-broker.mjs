import net from "node:net";
import { Buffer } from "node:buffer";
import { Aedes } from "aedes";
import { Duplex } from "node:stream";
//#region src/lib/server/mqtt/payload.ts
function parsePayloadJson(payload) {
	if (!payload) return null;
	try {
		const text = Buffer.isBuffer(payload) ? payload.toString("utf-8") : String(payload);
		const parsed = JSON.parse(text);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}
function normalizeNumber(value, fallback) {
	const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
	return Number.isFinite(parsed) ? parsed : fallback;
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
//#endregion
//#region src/lib/server/mqtt/topics.ts
var MQTT_PORT = 1883;
var HEARTBEAT_TOPIC = "divoom/2/DeviceHeart";
var DEVICE_SET_TOPIC = "divoom/2/12345/set";
var DEVICE_GET_TOPIC = "divoom/2/12345/get";
var HEARTBEAT_INTERVAL_MS = 6e4;
//#endregion
//#region src/lib/server/mqtt/deviceCommands.ts
function startDeviceHeartbeat(publish) {
	publishHeartbeat(publish);
	return setInterval(() => publishHeartbeat(publish), HEARTBEAT_INTERVAL_MS);
}
function handleDevicePublish(topic, payload, publish) {
	if (topic !== "divoom/2/12345/set") return;
	handleDeviceSet(payload, publish);
}
function handleDeviceSet(payload, publish) {
	const body = parsePayloadJson(payload);
	if (body?.Command !== "Device/AppRestartMqtt") return;
	const response = {
		ReturnCode: 0,
		ReturnMessage: "",
		DeviceId: normalizeNumber(body.DeviceId, 300358569),
		Command: "Device/AppRestartMqtt",
		PacketFlag: normalizeNumber(body.PacketFlag, 0)
	};
	console.log(`[PixooPal MQTT] Device/AppRestartMqtt received. Publishing response to ${DEVICE_GET_TOPIC}: DeviceId=${response.DeviceId}, PacketFlag=${response.PacketFlag}`);
	publish(DEVICE_GET_TOPIC, response);
}
function publishHeartbeat(publish) {
	publish(HEARTBEAT_TOPIC, { Command: "Device/Hearbeat" });
}
//#endregion
//#region src/lib/server/mqtt/normalizer.ts
var DEVICE_SET_TOPIC_BUFFER = Buffer.from(DEVICE_SET_TOPIC, "utf-8");
function createPixooMqttStream(socket) {
	let inputBuffer = Buffer.alloc(0);
	const stream = new Duplex({
		read() {},
		write(chunk, _encoding, callback) {
			socket.write(chunk, callback);
		},
		destroy(error, callback) {
			socket.destroy(error ?? void 0);
			callback(error);
		}
	});
	socket.on("data", (chunk) => {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		inputBuffer = Buffer.concat([inputBuffer, buffer]);
		inputBuffer = flushNormalizedPackets(inputBuffer, stream);
	});
	socket.on("close", () => {
		stream.push(null);
		stream.destroy();
	});
	socket.on("error", (error) => {
		stream.destroy(error);
	});
	return stream;
}
function flushNormalizedPackets(buffer, stream) {
	let cursor = 0;
	while (cursor < buffer.length) {
		const parsed = readMqttPacketBounds(buffer, cursor);
		if (!parsed) break;
		const packet = buffer.subarray(cursor, parsed.end);
		stream.push(safeNormalizePixooPublishPacket(packet, parsed.headerLength, parsed.remainingLength));
		cursor = parsed.end;
	}
	return cursor > 0 ? buffer.subarray(cursor) : buffer;
}
function readMqttPacketBounds(buffer, offset) {
	let multiplier = 1;
	let remainingLength = 0;
	for (let index = offset + 1; index < Math.min(buffer.length, offset + 5); index += 1) {
		const encodedByte = buffer[index];
		if (encodedByte === void 0) return null;
		remainingLength += (encodedByte & 127) * multiplier;
		if ((encodedByte & 128) === 0) {
			const headerLength = index - offset + 1;
			const end = offset + headerLength + remainingLength;
			return buffer.length >= end ? {
				headerLength,
				remainingLength,
				end
			} : null;
		}
		multiplier *= 128;
	}
	return null;
}
function safeNormalizePixooPublishPacket(packet, headerLength, remainingLength) {
	try {
		return normalizePixooPublishPacket(packet, headerLength, remainingLength);
	} catch (error) {
		console.warn(`[PixooPal MQTT] Malformed Pixoo packet passed through normalizer: ${error instanceof Error ? error.message : String(error)}`);
		return packet;
	}
}
function normalizePixooPublishPacket(packet, headerLength, remainingLength) {
	const packetType = packet[0] >> 4;
	const qos = (packet[0] & 15) >> 1 & 3;
	if (packetType !== 3 || qos === 0) return packet;
	if (packet.length < headerLength + 2 || remainingLength < 2) return packet;
	if (packet.readUInt16BE(headerLength) <= remainingLength - 2) return packet;
	const topicIndex = packet.indexOf(DEVICE_SET_TOPIC_BUFFER, headerLength);
	if (topicIndex < 0) return packet;
	const packetIdIndex = topicIndex + DEVICE_SET_TOPIC_BUFFER.length;
	const payloadIndex = packetIdIndex + 2;
	if (packet.length < payloadIndex + 1 || packet[payloadIndex] !== 123) return packet;
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
	console.warn(`[PixooPal MQTT] Normalized malformed Pixoo PUBLISH: topic=${DEVICE_SET_TOPIC}, oldRemainingLength=${remainingLength}, newRemainingLength=${newRemainingLength}`);
	return normalized;
}
function encodeRemainingLength(value) {
	const bytes = [];
	let remaining = value;
	do {
		let encodedByte = remaining % 128;
		remaining = Math.floor(remaining / 128);
		if (remaining > 0) encodedByte |= 128;
		bytes.push(encodedByte);
	} while (remaining > 0);
	return bytes;
}
//#endregion
//#region src/lib/server/mqtt/broker.ts
var state = getBrokerState();
function startPixooMitmMqttBroker() {
	if (state.started) return state;
	state.started = true;
	Aedes.createBroker({
		id: `pixoopal-${process.pid}`,
		authenticate(client, _username, password, done) {
			const passwordText = password ? password.toString("utf-8") : "";
			if (!(!passwordText || passwordText === "pixoopal")) {
				console.warn(`[PixooPal MQTT] Connect rejected: clientId=${client.id || "(empty)"}`);
				const error = /* @__PURE__ */ new Error("Bad username or password");
				error.returnCode = 4;
				done(error, false);
				return;
			}
			done(null, true);
		}
	}).then((broker) => {
		state.broker = broker;
		wireBrokerHandlers(broker);
		const server = net.createServer((socket) => {
			broker.handle(createPixooMqttStream(socket));
		});
		state.server = server;
		server.on("error", (error) => {
			console.error(`[PixooPal MQTT] Broker listen failed on 0.0.0.0:${MQTT_PORT}: ${getErrorCode(error) || error.message}`);
		});
		server.listen(MQTT_PORT, "0.0.0.0", () => {
			console.log(`[PixooPal MQTT] Broker listening on mqtt://0.0.0.0:${MQTT_PORT}`);
			state.heartbeatTimer = startDeviceHeartbeat((topic, payload) => publishPayload(broker, topic, payload));
		});
	}).catch((error) => {
		console.error(`[PixooPal MQTT] Broker start failed: ${error instanceof Error ? error.message : String(error)}`);
	});
	return state;
}
function stopPixooMitmMqttBroker() {
	state.started = false;
	if (state.heartbeatTimer) {
		clearInterval(state.heartbeatTimer);
		state.heartbeatTimer = void 0;
	}
	if (state.server) {
		state.server.close();
		state.server = void 0;
	}
	if (state.broker) {
		state.broker.close();
		state.broker = void 0;
	}
}
function sendCommand(topic, payload) {
	const broker = state.broker;
	if (!broker) throw new Error("PixooPal MQTT broker is not started.");
	publishPayload(broker, topic, payload);
}
function getBrokerState() {
	const scope = globalThis;
	scope.__pixoopalMitmMqttBroker ??= {};
	return scope.__pixoopalMitmMqttBroker;
}
function wireBrokerHandlers(broker) {
	broker.on("clientReady", (client) => {
		console.log(`[PixooPal MQTT] Pixoo connected: clientId=${client.id}`);
	});
	broker.on("clientDisconnect", (client) => {
		console.log(`[PixooPal MQTT] Pixoo disconnected: clientId=${client.id}`);
	});
	broker.on("clientError", (client, error) => {
		console.warn(`[PixooPal MQTT] Pixoo connection failed: clientId=${client?.id || "(empty)"}, error=${error.message}`);
	});
	broker.on("connectionError", (client, error) => {
		console.warn(`[PixooPal MQTT] MQTT connection failed: clientId=${client?.id || "(empty)"}, error=${error.message}`);
	});
	broker.on("publish", (packet, client) => {
		if (!client) return;
		handleDevicePublish(packet.topic, packet.payload, (topic, payload) => publishPayload(broker, topic, payload));
	});
}
function publishPayload(broker, topic, payload) {
	const body = Buffer.isBuffer(payload) || typeof payload === "string" ? payload : Buffer.from(JSON.stringify(payload), "utf-8");
	broker.publish({
		cmd: "publish",
		topic,
		payload: body,
		qos: 0,
		retain: false,
		dup: false
	}, (error) => {
		if (error) console.warn(`[PixooPal MQTT] Publish failed: topic=${topic}, error=${error.message}`);
	});
}
function getErrorCode(error) {
	return "code" in error ? String(error.code ?? "") : "";
}
//#endregion
export { sendCommand, startPixooMitmMqttBroker, stopPixooMitmMqttBroker };
