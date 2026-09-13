#!/bin/sh
BASE=/tmp/luci-app-esp-switch/root
[ -d "$BASE" ] || { echo "missing $BASE"; exit 1; }

mkdir -p /usr/libexec/rpcd /usr/share/rpcd/acl.d /usr/share/luci/menu.d /www/luci-static/resources/view/esp-switch /etc/config

put() {
	src="$1"
	dst="$2"
	mode="$3"
	tr -d '\r' <"$src" >"$dst"
	chmod "$mode" "$dst"
}

put "$BASE/usr/libexec/rpcd/esp-switch" /usr/libexec/rpcd/esp-switch 755
put "$BASE/usr/share/rpcd/acl.d/luci-app-esp-switch.json" /usr/share/rpcd/acl.d/luci-app-esp-switch.json 644
put "$BASE/usr/share/luci/menu.d/luci-app-esp-switch.json" /usr/share/luci/menu.d/luci-app-esp-switch.json 644
put "$BASE/www/luci-static/resources/view/esp-switch/overview.js" /www/luci-static/resources/view/esp-switch/overview.js 644

if [ -f /etc/config/esp-switch ]; then
	echo "keep existing /etc/config/esp-switch"
else
	put "$BASE/etc/config/esp-switch" /etc/config/esp-switch 644
fi

rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/* 2>/dev/null
killall -9 rpcd 2>/dev/null
sleep 1
/etc/init.d/rpcd start
sleep 2
echo "== list"
echo '{}' | /usr/libexec/rpcd/esp-switch list
echo
echo "== ubus"
ubus -v list esp-switch
