# luci-app-esp-switch

iStoreOS / OpenWrt 的 LuCI 插件：自动发现局域网内广播 `_esp-switch._tcp` 的 ESP8266 开关板，在 WebUI 中控制四路开机触点并重命名设备。

## 功能

- 用 `avahi-browse` 做 mDNS 发现，支持同时发现多台设备
- HTTP 探测确认在线状态，并从设备取回通道名
- 点通道按钮触发脉冲，脉冲时长在页面中可调（100-5000ms，默认 500）
- 设备名与四路通道名可自定义（默认 A/B/C/D），页面显示每路对应的 GPIO 引脚
- 保存时同时写入 uci 并推送到设备，设备离线则只存 uci
- 每 10 秒轮询已知设备；点“扫描设备”才做完整 mDNS 发现

## 目录

```
root/etc/config/esp-switch                                   uci 默认配置
root/usr/libexec/rpcd/esp-switch                             rpcd 后端（sh + jshn）
root/usr/share/rpcd/acl.d/luci-app-esp-switch.json           ACL
root/usr/share/luci/menu.d/luci-app-esp-switch.json          菜单
root/www/luci-static/resources/view/esp-switch/overview.js   LuCI JS 前端
tools/deploy.sh                                              在路由器上执行的安装脚本
tools/build_ipk.py                                           生成 ipk
```

## 依赖

`luci-base`、`curl`、`avahi-daemon`、`avahi-utils`、`ubus`、`rpcd`。

## 安装

```bash
# 本机（Windows 可用 pscp）
pscp -r -pw <密码> root <路由器IP>:/tmp/luci-app-esp-switch
pscp -pw <密码> tools/deploy.sh root <路由器IP>:/root/

# 路由器
tr -d '\r' < /root/deploy.sh > /root/d.sh && sh /root/d.sh
```

入口：LuCI → 服务 → ESP 开关。

## rpcd 接口

| 方法 | 参数 | 说明 |
| --- | --- | --- |
| `devices` | `scan` | `scan=1` 做完整 mDNS 发现，`0` 只探测已知设备 |
| `pulse` | `address`、`ch`、`ms` | 触发指定设备的通道 |
| `save` | `id`、`name`、`address`、`ch1`-`ch4` | 写入 uci 并推送到设备 |
| `remove` | `id` | 删除 uci 记录 |
| `settings` | `pulse_ms`、`discover_timeout` | 读写全局设置 |

uci 结构：

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

## 注意事项

- 插件文件必须为 LF 行尾，CRLF 会让 rpcd 脚本的 shebang 失效，`deploy.sh` 已统一转换
- OpenWrt 的 busybox 不一定带 `timeout`，本插件用「后台 + sleep + kill -0」实现超时
- 同一 mDNS 服务会在 br-lan / lo / docker0 重复出现，后端只取 br-lan 的 IPv4 记录
- LuCI `menu.d` 的 `depends.acl` 必须是数组，写对象会导致 dispatcher 报 500
