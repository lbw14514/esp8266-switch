# ESP8266 引脚开机固件

用 ESP8266 的 GPIO 短接主板 PWR_SW 触点实现远程开机。带 mDNS 自动发现、HTTP API、OTA 与 AP 配网页面。

## 硬件接线

主板开机是干接点（PWR_SW 两股线），所以每路用**两个 GPIO 分别接这两股线**，触发时两脚同时拉低形成通路（共地），松开后两脚回到高阻。

| 通道 | 默认名称 | 引脚 A | 引脚 B |
| --- | --- | --- | --- |
| 1 | A | GPIO12 (D6) | GPIO13 (D7) |
| 2 | B | GPIO14 (D5) | GPIO4 (D2) |
| 3 | C | GPIO5 | GPIO16 (D0) |

可选引脚池只有 GPIO4 / 5 / 12 / 13 / 14 / 16 六个。GPIO0 / 2 / 15 是 ESP8266 的启动配置脚（分别需要高/高/低电平才能启动），接了外部电路容易导致开不了机；GPIO1 / 3 是串口；GPIO9 / 10 在多数模块上未引出，因此它们都不出现在可选引脚里。

因为可选引脚只有 6 个，而每路要占 2 个，所以固定为 3 路。

触发时长默认 500ms，范围 100-5000ms，可通过 HTTP API 或软路由插件修改。

## 编译与烧录

```bash
cd firmware
pio run                # 编译
pio run -t upload      # 烧录，需要接好串口
pio device monitor     # 串口日志 115200
```

也可以直接用 Release 里的 `esp8266-switch-1.2.0.bin`，从地址 `0x00000000` 烧录（适配 nodeMCU / ESP-12E，4MB Flash）。

## 首次配网

1. 上电后设备开启热点 `ESP-Switch-XXXX`（XXXX 为 MAC 后四位，无密码）
2. 连接热点后访问 `http://192.168.4.1`，页面会**自动扫描**周边 WiFi 并列出
3. 选择 WiFi，填密码，点“保存并连接”，设备重启后进入局域网（地址由 DHCP 分配）
4. 运行中断网超过 30 秒会自动重开热点，同时持续尝试重连原来的 WiFi

设备自带页面只做配网与查看（设备名、通道名、每路引脚、当前 IP），**不提供开关控制**，所有控制都在软路由插件里。

## HTTP API

| 请求 | 说明 |
| --- | --- |
| `GET /api/info` | 设备信息，含可选引脚池 `pins` 与三路通道状态（每路含 `pinA`/`pinB`） |
| `GET /api/pulse?ch=1&ms=500` | 触发第 1 路：pinA 与 pinB 同时拉低 500ms（`ch=all` 表示全部） |
| `GET/POST /api/config?name=xx&ch1=A&a1=12&b1=13&pulse_ms=500` | 改名、设置通道名与每路两个引脚、脉冲时长 |
| `GET /api/scan` | 扫描周边 WiFi |
| `GET /api/wifi?ssid=xx&pass=yy` | 保存 WiFi 并重启 |
| `GET /api/reset` | 清除配置并回到配网模式 |
| `GET /api/reboot` | 重启设备 |

设备通过 mDNS 广播 `_esp-switch._tcp` 服务，TXT 记录含 `id`（MAC 无冒号）、`host`、`fw`、`ch=3`，OTA 主机名与设备名一致。

> 修改引脚后请先以设备页面/插件里实际选定的引脚为准再接线，否则开机信号会打到错误的脚上。

## 配套插件

软路由侧使用 `esp8266-switch` 仓库 `luci-app` 分支的 LuCI 插件（`luci-app-esp-switch`），从该仓库 Release 下载 ipk 安装。
