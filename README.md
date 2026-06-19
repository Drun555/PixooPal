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
> This project is almost entirely vibesloped by me, experienced web-developer. For some, it can be a huge con. For others, it also a huge con. Speaking for myself, I think AI is a good tool for harmless projects like this one. In the end, it's nothing but a a small project that I did solely for myself. I don't think something like this would be possible without AI, as it would take months or even years.

> [!IMPORTANT]
> Tested on Pixoo 64. However, it should work for Pixoo 16 / 32 too. Testing is welcomed.

<img alt="UI" src="https://github.com/user-attachments/assets/a88e56a8-e5fd-4e73-8020-bef8a215b6d9" />


## Home Assistant

PixooPal features full-fledged Home Assistant support, including Home Assistant App, Integration and Card. It also comes with a several nice clockfaces that utilizes Home Assistant API.

Clockfaces:
- Now Playing: shows Home Assistant media_player entity (album cover art, progress and a title)
- Next Up: shows the name and a time counter before next event from HA calendar
- ToDo: shows "To-Do" list
- You can also [build your own clockface](https://github.com/Drun555/PixooPal-Preview) with any information you want.

Integration: (exposes real-time MJPEG preview of the screen, clockface selection tools, notifier service, light entity and a pause switch)

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Drun555&repository=PixooPal-Integration&category=integration)


Custom card for displaying clockface inputs. With this, you can play Snake on your Pixoo right from the Home Assistant. Neat.

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Drun555&repository=PixooPal-Card&category=plugin)

## Installation

- Home Assistant App (add this repo to the Store)
- [Docker Compose](https://github.com/Drun555/PixooPal/blob/main/docker-compose.yaml)
- [Unraid](https://ca.unraid.net/apps/pixoopal-0r1tfz8075vi60)

#### Running Locally / Developing

```
npm install
npm run dev -- --host 0.0.0.0 --http-port 80 --https-port 443 --pixoopal-ip 192.168.x.x --pixoo 192.168.x.x --resolution 64 --ha-host 192.168.x.x --ha-token xxx
```

## Decloudifying
It's a tricky, not really recomended part. Currently, declouding requires DNS redirection. VLAN / dedicated IP for PixooPal is heavily recommended, since mimicking Divoom cloud requires taking 80, 443 and 1883 ports. You can read some information about how it's done [here](https://www.reddit.com/r/homeassistant/comments/183mbrk/local_control_of_a_divoom_pixoo_64_in_an_isolated/)

PixooPal serves a slightly customized MQ broker that keeps Pixoo alive (publishing Device/Hearbeat and AppMqttReset topics from time to time) and Device/InitV2 & Test/GetIP endpoints. 

Idea is simple:
Pixoo goes ``app.divoom-gz.com GET /Device/InitV2`` -> we're intercepting that, pointing Pixoo at our MQ server -> profit

So, steps:
- Make sure to add ``PIXOOPAL_HOST_IP`` / ``--pixoopal-ip``. It's a MQ broker IP that PixooPal will send to Pixoo.
- You should redirect ``app.divoom-gz.com`` to your PixooPal host IP at router level. If PixooPal uses dedicated IP and runs on 80/443/1883, then it should be enough.

To be said, if you don't want to use dedicated IP, the only thing you will actually need is 1883 port and a reverse proxy. Point your DNS record at your proxy and make a ``app.divoom-gz.com`` record there for your pixoopal's HTTP port.
