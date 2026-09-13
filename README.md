# ESP8266 引脚开机 + 软路由插件

用 ESP8266 的 GPIO 短接主板 PWR_SW 触点实现远程开机，iStoreOS 上提供 LuCI 插件自动发现设备并在 WebUI 中控制。

## 组成

| 目录 | 内容 |
| --- | --- |
| `firmware/` | ESP8266 固件（PlatformIO + Arduino Core，4 路低电平脉冲、mDNS、HTTP API、OTA、AP 配网） |
| `luci-app-esp-switch/root/` | iStoreOS 插件文件树（rpcd 后端 + LuCI JS 前端 + uci 配置 + ACL + 菜单） |
| `tools/deploy.sh` | 在路由器上安装插件（scp 上传后执行） |
| `tools/build_ipk.py` | 生成 ipk 包（当前 iStoreOS 的 opkg 不接受自建 ipk，见下文） |
| `tools/fake_device.py` | 模拟设备，用于在没有硬件时验证插件链路 |

## 硬件接线

主板开机是干接点（PWR_SW 两股线），所以每路用**两个 GPIO 分别接这两股线**，触发时两脚同时拉低形成通路（共地），松开后两脚回到高阻。

| 通道 | 默认名称 | 引脚 A | 引脚 B |
| --- | --- | --- | --- |
| 1 | A | GPIO12 (D6) | GPIO13 (D7) |
| 2 | B | GPIO14 (D5) | GPIO4 (D2) |
| 3 | C | GPIO5 | GPIO16 (D0) |
| 4 | D | GPIO0 | GPIO2 |

这些默认值只是出厂值，实际接哪两个脚由软路由页面上的两个下拉框决定，可选引脚为 GPIO0 / 2 / 4 / 5 / 12 / 13 / 14 / 15 / 16。

注意：GPIO0 / GPIO2 / GPIO15 是 ESP8266 的启动配置脚（分别需要高/高/低电平才能正常启动），如果外部电路把它们持续拉向相反电平，会导致设备无法开机，必要时避开这三个脚。

触发时长由插件里的“脉冲时长”控制，默认 500ms，范围 100-5000ms。

## 固件

编译与烧录（`pio` 位于 `C:\Users\admin\.platformio\penv\Scripts\platformio.exe`，已加入 PATH）：

```bash
cd firmware
pio run                # 编译
pio run -t upload      # 烧录，需要接好串口
pio device monitor     # 串口日志 115200
```

### 首次配网

1. 上电后设备开启热点 `ESP-Switch-XXXX`（XXXX 为 MAC 后四位，无密码）
2. 连接热点后访问 `http://192.168.4.1`，页面会**自动扫描**周边 WiFi 并列出
3. 选择 WiFi，填密码，点“保存并连接”，设备重启后进入局域网（地址由 DHCP 分配）
4. 运行中断网超过 30 秒会自动重开热点，同时持续尝试重连原来的 WiFi

设备自带页面只做配网与查看（设备名、通道名、每路引脚、当前 IP），**不提供开关控制**，所有控制都在软路由的插件里。

### HTTP API

| 请求 | 说明 |
| --- | --- |
| `GET /api/info` | 设备信息，含可选引脚池 `pins` 与四路通道状态（每路含 `pinA`/`pinB`） |
| `GET /api/pulse?ch=1&ms=500` | 触发第 1 路：pinA 与 pinB 同时拉低 500ms（`ch=all` 表示全部） |
| `GET/POST /api/config?name=xx&ch1=A&a1=12&b1=13&pulse_ms=500` | 改名、设置通道名与每路两个引脚、脉冲时长 |
| `GET /api/scan` | 扫描周边 WiFi |
| `GET /api/wifi?ssid=xx&pass=yy` | 保存 WiFi 并重启 |
| `GET /api/reset` | 清除配置并回到配网模式 |
| `GET /api/reboot` | 重启设备 |

设备通过 mDNS 广播 `_esp-switch._tcp` 服务，TXT 记录含 `id`（MAC 无冒号）、`host`、`fw`、`ch=4`，OTA 主机名与设备名一致。

## 路由器插件

插件已部署在 <路由器IP>。重新安装：

```bash
# 本机
pscp -pw <密码> -r luci-app-esp-switch/root root@<路由器IP>:/tmp/luci-app-esp-switch
pscp -pw <密码> tools/deploy.sh root@<路由器IP>:/root/
# 路由器
tr -d '\r' < /root/deploy.sh > /root/d.sh && sh /root/d.sh
```

入口：LuCI → 服务 → ESP 开关。

- 「扫描设备」用 `avahi-browse` 发现 `_esp-switch._tcp`，做 HTTP 探测确认在线并取回通道名
- 每 10 秒轮询一次已知设备（不做完整发现，避免卡顿）
- 每台设备可自定义名称与四路通道名（默认 A/B/C/D），每路用两个下拉框选定引脚 A 与引脚 B
- 点通道按钮即把该路的两个引脚同时拉低 `pulse_ms` 毫秒，默认 500
- 保存时同时写入 uci 并推送到设备；设备离线则只存 uci，上线后再保存即可下发
- 脉冲时长保存在 `/etc/config/esp-switch` 的 `settings.pulse_ms`

主要 uci 结构：

```
config settings 'settings'
	option pulse_ms '500'
	option discover_timeout '5'

config device 'dev_a4cf12ab34cd'
	option name '机柜'
	option address '192.168.1.30'
	option ch1 'A'
	option ch2 'B'
	option ch3 'C'
	option ch4 'D'
	option a1 '12'
	option b1 '13'
	option a2 '14'
	option b2 '4'
	option a3 '5'
	option b3 '16'
	option a4 '0'
	option b4 '2'
```

## 已知问题

- iStoreOS 24.10.7 的 opkg 对本机生成的 ipk 一律报 `Malformed package file`（结构经 bsdtar 校验正常），因此改用文件级部署，`tools/build_ipk.py` 仍可生成 ipk 备用
- 插件文件必须用 LF 行尾（Windows 上传后 CRLF 会让 rpcd 脚本失效），`deploy.sh` 已统一转换
- 插件里的 curl 要用绝对路径 `/usr/bin/curl`，PATH 里的 `/usr/sbin/curl` 是包装脚本，在 rpcd 环境下会失败
