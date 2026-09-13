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

| 通道 | 默认名称 | GPIO | 板载丝印 |
| --- | --- | --- | --- |
| 1 | 主机A | GPIO12 | D6 |
| 2 | 主机B | GPIO13 | D7 |
| 3 | 主机C | GPIO14 | D5 |
| 4 | 主机D | GPIO4 | D2 |

继电器/光耦为**低电平触发**：空闲输出高电平，触发时拉低 500ms（可在插件里改 100-5000ms）。

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

设备自带页面只做配网与查看（通道名、GPIO 引脚、当前 IP），**不提供开关控制**，所有控制都在软路由的插件里。

### HTTP API

| 请求 | 说明 |
| --- | --- |
| `GET /api/info` | 设备信息与四路通道状态 |
| `GET /api/pulse?ch=1&ms=500` | 触发第 1 路，接通 500ms（`ch=all` 表示全部） |
| `GET/POST /api/config?name=xx&ch1=主机A&pulse_ms=500` | 改名、设置通道名与脉冲时长 |
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
- 每台设备可自定义名称与四路通道名（默认 A/B/C/D），页面同时显示每路对应的 GPIO 引脚
- 点通道按钮即拉低对应引脚短接 `pulse_ms` 毫秒，默认 500
- 保存时同时写入 uci 并推送到设备；设备离线则只存 uci，上线后再保存即可下发
- 脉冲时长保存在 `/etc/config/esp-switch` 的 `settings.pulse_ms`

主要 uci 结构：

```
config settings 'settings'
	option pulse_ms '500'
	option discover_timeout '5'

config device 'dev_a4cf12ab34cd'
	option name '书房主机'
	option address '192.168.1.30'
	option ch1 'A'
	option ch2 'B'
	option ch3 'C'
	option ch4 'D'
```

## 已知问题

- iStoreOS 24.10.7 的 opkg 对本机生成的 ipk 一律报 `Malformed package file`（结构经 bsdtar 校验正常），因此改用文件级部署，`tools/build_ipk.py` 仍可生成 ipk 备用
- 插件文件必须用 LF 行尾（Windows 上传后 CRLF 会让 rpcd 脚本失效），`deploy.sh` 已统一转换
