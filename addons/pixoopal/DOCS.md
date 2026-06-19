# PixooPal Add-on

## Configuration

```yaml
pixoo_device_address: 192.168.1.50
pixoopal_host_ip: 192.168.1.10
resolution: "64"
```

- `pixoo_device_address`: Pixoo host or IP address on your local network.
- `pixoopal_host_ip`: PixooPal host IP returned to Pixoo from `/Device/InitV2`; embedded MQTT always listens on `1883`.
- `resolution`: PixooPal render resolution. Supported values are `16`, `32`, and `64`; default is `64`.

The add-on stores PixooPal clockface state in its `/data` directory so settings survive restarts and updates.
