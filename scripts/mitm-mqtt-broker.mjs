export async function startPixooMitmMqttBroker() {
  const runtime = await loadRuntime();
  return runtime.startPixooMitmMqttBroker();
}

export async function stopPixooMitmMqttBroker() {
  const runtime = await loadRuntime();
  return runtime.stopPixooMitmMqttBroker();
}

async function loadRuntime() {
  try {
    return await import('./runtime/mitm-mqtt-broker.mjs');
  } catch (error) {
    throw new Error(
      `PixooPal MQTT runtime is not built. Run npm run build first. ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

