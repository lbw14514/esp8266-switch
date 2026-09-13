# ESP8266 引脚开机固件

用 ESP8266 的 GPIO 拉低 500ms 短接主板 PWR_SW 触点实现远程开机，四路独立可控，带 mDNS 自动发现、HTTP API、OTA 与 AP 配网页面。

## 硬件接线

| 通道 | 默认名称 | GPIO | 板载丝印 |
| --- | --- | --- | --- |
| 1 | 主机A | GPIO12 | D6 |
| 2 | 主机B | GPIO13 | D7 |
| 3 | 主机C | GPIO14 | D5 |
| 4 | 主机D | GPIO4 | D2 |

继电器/光耦为低电平触发：空闲输出高电平，触发时拉低，脉冲结束后恢复高电平。所有引脚上电即初始化为高电平。

## 编译与烧录

```bash
pio run                # 编译
pio run -t upload      # 烧录（可加 --upload-port COM3）
pio device monitor     # 串口 115200
```

## 首次配网

1. 上电后设备开启热点 `ESP-Switch-XXXX`（XXXX 为 MAC 后四位，开放热点）
2. 连接热点后访问 `http://192.168.4.1`
3. 点“扫描”选择 WiFi，填密码，点“保存并连接”，设备重启后进入局域网
4. 运行中掉线超过 30 秒会自动重开热点，同时持续尝试重连

## HTTP API

| 请求 | 说明 |
| --- | --- |
| `GET /api/info` | 设备信息与四路通道状态 |
| `GET /api/pulse?ch=1&ms=500` | 触发第 1 路，接通 500ms（`all=1` 表示全部） |
| `GET/POST /api/config?name=xx&ch1=主机A&ch2=...&pulse_ms=500` | 改名、设置通道名与脉冲时长 |
| `GET /api/scan` | 扫描周边 WiFi |
| `GET /api/wifi?ssid=xx&pass=yy` | 保存 WiFi 并重启 |
| `GET /api/reset` | 清除配置并回到配网模式 |
| `GET /api/reboot` | 重启设备 |

配置写入 EEPROM，`magic` 不匹配时自动恢复默认值。脉冲使用非阻塞状态机，不会阻塞 HTTP 服务。

## 发现与升级

- mDNS 服务 `_esp-switch._tcp`，TXT 记录含 `id`（MAC 无冒号）、`host`、`model`、`fw`、`ch`
- OTA 主机名与设备名（`/api/config` 的 `name`）一致，可用 PlatformIO 或 ArduinoOTA 客户端推送
