# PixooPal

SvelteKit WebUI для управления Divoom Pixoo.

## Запуск

Установите зависимости:

```bash
npm install
```

Dev-сервер:

```bash
npm run dev -- --device 192.168.6.3 --webui-port 5173
```

Production:

```bash
npm run build
npm run start -- --device 192.168.6.3 --webui-port 3000
```

Аргументы:

- `--device`, `--pixoo` или `--pixoo-address` - адрес Pixoo в локальной сети.
- `--webui-port`, `--port` или `-p` - порт WebUI.

Адрес также можно передать через `PIXOO_DEVICE_ADDRESS`, а порт - через `PORT`.
