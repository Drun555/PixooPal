> [!IMPORTANT]
> ⚠️ Work in progress. It's fully usable though.

<p align="center">
  <img alt="PixooPal Logo" src="https://github.com/user-attachments/assets/425a98a7-2e2b-45cf-bfbe-6716e32d63c8" />

  <span>
  <a href="https://github.com/Drun555/PixooPal-Preview">Make your own clockface</a>
  |
  <a href="https://github.com/Drun555/PixooPal-SDK">SDK</a>
  |
  <a href="https://github.com/Drun555/PixooPal-Community/tree/master/src">Community repository</a>
  </span>
</p>
<p align="center">
PixooPal is a companion software for Pixoo. 
</p>
  
It serves as server-side clockface render engine. In another words, it's a cute thing that creates pixelated images and pushes them to your Pixoo.

- Get new clockfaces from a community store, or even create your own with ease
- Full-fledged Home Assistant support
- Real-time preview of your Pixoo screen
- Send notifications to your Pixoo - they'll appear on top of any clockface. Emojis supported!

> [!NOTE]
> This project is almost entirely vibesloped by me, experienced web-developer. For some, it can be a huge con. For others, it also a huge con. Speaking for myself, I think AI is a nice tool, especially for harmless projects like this one. In the end, it's nothing but a a small project that I did solely for myself. I don't think something like this would be possible without AI, as it would take months or even years.

> [!IMPORTANT]
> Tested on Pixoo 64. However, it should work for Pixoo 16 / 32 too. Testing is welcomed.

<img alt="UI" src="https://github.com/user-attachments/assets/a88e56a8-e5fd-4e73-8020-bef8a215b6d9" />


## Home Assistant

PixooPal features full-fledged Home Assistant support, including Home Assistant App, Integration and Card. It also comes with a several nice clockfaces that utilizes Home Assistant API.

Clockfaces:
- Now Playing: shows Home Assistant media_player entity (album cover art, progress and a title)
- Next Up: shows the name and a time counter before next event from HA calendar
- ToDo: shows "To-Do" list
- You can also build your own clockface with any information you want.


Home Assistant App (in case if this link is broken, just add this repo in HA Apps store page)

[![Open your Home Assistant instance and show the add add-on repository dialog with this repository URL pre-filled.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FDrun555%2FPixooPal)

Integration:

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Drun555&repository=PixooPal-Integration&category=integration)


Custom card for displaying clockface inputs

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Drun555&repository=PixooPal-Card&category=plugin)

## Docker-compose

(here)[https://github.com/Drun555/PixooPal/blob/main/docker-compose.yaml]

## Running Locally / Developing

```
npm install
npm run dev -- --host 0.0.0.0 --http-port 80 --pixoo 192.168.x.x --resolution 64 --ha-host 192.168.x.x --ha-token xxx
```

## Decloudifying
It's a tricky, not really recomended part. Currently, declouding requires DNS redirection, free 1883 port and some kind of reverse proxy (not needed if you're hosting PixooPal on 80/443 ports). Additionally, I'm not sure if it's possible with Home Assistant App installations.


For decloudifying purpose, PixooPal serves:
- A slightly customized built-in MQ broker that keeps Pixoo alive (publishing Device/Hearbeat and AppMqttReset topics from time to time)
- Device/InitV2 and Test/GetIP endpoints


-1. Make sure that your host have an open 1883 port. It sucks, I know. If your 1883 port is already taken, your best bet is to make use of VLAN. 
0. Add ``PIXOO_DEVICE_ADDRESS`` variable (for docker-compose or Unraid installations), ``--pixoopal-ip 192.168.x.x`` argument (for local deployment). It's IP address of PixooPal instance that should be reachable by Divoom device. 
1. You should redirect ``app.divoom-gz.com`` to your PixooPal host IP at router level.
2. After that, you should make sure 80/443 ports are directed at PixooPal. PixooPal already serves a self-signed certificate by it's own, which can be helpful. If you're hosting PixooPal not on the 80/443 ports, then ``app.divoom-gz.com`` should point at reverse proxy that routes a request to PixooPal.

I suck a little in terms of creating tutorials, sorry. Feel free to create an issue in case of fail.
