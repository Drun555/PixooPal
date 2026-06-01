# PixooPal

TBD


## Home Assistant Add-on

[![Open your Home Assistant instance and show the add add-on repository dialog with this repository URL pre-filled.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FDrun555%2FPixooPal)

Or add this repository to the Home Assistant Add-on Store manually:

```text
https://github.com/Drun555/PixooPal
```

After installation, set `pixoo_device_address` in the add-on options and open
PixooPal from the add-on Web UI.

## Unraid Community App

TBD

## Docker

```bash
docker run --rm \
  -p 5173:5173 \
  -e PIXOO_DEVICE_ADDRESS=192.168.6.3 \
  -v pixoopal-data:/data \
  --log-driver local \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  pixoopal/pixoopal:latest
```

Clockface state is stored in `/data`. You can override the path with
`PIXOOPAL_DATA_DIR`. PixooPal writes logs to stdout/stderr only; Docker keeps
those logs in its own log store with the rotation limit shown above.

### Docker Compose

```yaml
services:
  pixoopal:
    image: pixoopal/pixoopal:latest
    container_name: pixoopal
    restart: unless-stopped
    ports:
      - "5173:5173"
    environment:
      PIXOO_DEVICE_ADDRESS: ${PIXOO_DEVICE_ADDRESS:-192.168.x.x}
      PORT: "5173"
      PIXOOPAL_DATA_DIR: /data
    volumes:
      - ./pixoopal-data:/data
    logging:
      driver: local
      options:
        max-size: "10m"
        max-file: "3"
```

## Running Locally

Install dependencies:

```bash
npm install
```

Development server:

```bash
npm run dev -- --device 192.168.x.x --webui-port 5173
```

Production:

```bash
npm run build
npm run start -- --device 192.168.x.x --webui-port 5173
```
