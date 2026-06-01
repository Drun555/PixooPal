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

### Docker Compose

```yaml
services:
  pixoopal:
    image: drun555/pixoopal:latest
    container_name: pixoopal
    restart: unless-stopped
    ports:
      - "5173:5173"
    environment:
      PIXOO_DEVICE_ADDRESS: ${PIXOO_DEVICE_ADDRESS:-192.168.x.x}
      PIXOOPAL_INSTANCE_NAME: PixooPal
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

## Home Assistant Discovery

PixooPal publishes a Zeroconf/mDNS service named `_pixoopal._tcp.local.` on
port `5173`. Home Assistant integrations can use that record to discover the
instance and then call:

```text
GET /api/v1/discovery
```

The response includes a stable instance id, the PixooPal version, API paths,
and whether a Pixoo address is configured. The instance id is stored in
`PIXOOPAL_DATA_DIR` as `.pixoopal-instance.json`, so it survives container
restarts.

Optional environment variables:

```text
PIXOOPAL_INSTANCE_NAME=PixooPal
PIXOOPAL_DISABLE_MDNS=1
```

If Docker networking blocks multicast DNS, run PixooPal on a network that can
publish mDNS to Home Assistant, or configure the integration URL manually.

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
