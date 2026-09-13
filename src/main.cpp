#include <Arduino.h>
#include <ArduinoOTA.h>
#include <DNSServer.h>
#include <EEPROM.h>
#include <ESP8266WebServer.h>
#include <ESP8266WiFi.h>
#include <ESP8266mDNS.h>

#ifndef FW_VERSION
#define FW_VERSION "1.0.0"
#endif

#define CH_COUNT 4
#define CONFIG_MAGIC 0x45534731UL
#define CONFIG_VERSION 2
#define DEFAULT_PULSE_MS 500
#define MIN_PULSE_MS 100
#define MAX_PULSE_MS 5000
#define STA_TIMEOUT_MS 20000UL
#define AP_FALLBACK_MS 30000UL
#define RECONNECT_MS 15000UL

static const uint8_t CH_PINS[CH_COUNT] = {12, 13, 14, 4};
static const char *CH_DEFAULT_NAMES[CH_COUNT] = {"主机A", "主机B", "主机C", "主机D"};

struct Config {
  uint32_t magic;
  uint16_t version;
  uint16_t pulseMs;
  char ssid[33];
  char pass[65];
  char device[33];
  char chan[CH_COUNT][19];
  uint8_t reserved[3];
};

struct ChannelRun {
  bool active;
  uint32_t start;
  uint16_t ms;
};

static Config cfg;
static ChannelRun chRun[CH_COUNT];
static ESP8266WebServer server(80);
static DNSServer dns;
static bool apRunning = false;
static bool mdnsUp = false;
static uint32_t downSince = 0;
static uint32_t lastAttempt = 0;
static uint32_t rebootAt = 0;

static String macId() {
  String mac = WiFi.macAddress();
  mac.replace(":", "");
  mac.toLowerCase();
  return mac;
}

static String apName() {
  String id = macId();
  return "ESP-Switch-" + id.substring(id.length() - 4);
}

static String hostName() {
  String out;
  for (size_t i = 0; i < sizeof(cfg.device) && cfg.device[i]; i++) {
    char c = cfg.device[i];
    if (c >= 'a' && c <= 'z') {
      out += c;
    } else if (c >= 'A' && c <= 'Z') {
      out += (char)(c - 'A' + 'a');
    } else if (c >= '0' && c <= '9') {
      out += c;
    } else if (c == '-' || c == '_') {
      out += c;
    } else if (c == ' ') {
      out += '-';
    }
    if (out.length() >= 24) {
      break;
    }
  }
  if (!out.length()) {
    String id = macId();
    out = "esp-switch-" + id.substring(id.length() - 4);
  }
  return out;
}

static void configDefaults() {
  memset(&cfg, 0, sizeof(cfg));
  cfg.magic = CONFIG_MAGIC;
  cfg.version = CONFIG_VERSION;
  cfg.pulseMs = DEFAULT_PULSE_MS;
  for (int i = 0; i < CH_COUNT; i++) {
    strncpy(cfg.chan[i], CH_DEFAULT_NAMES[i], sizeof(cfg.chan[i]) - 1);
  }
  String id = macId();
  snprintf(cfg.device, sizeof(cfg.device), "esp-switch-%s", id.substring(id.length() - 4).c_str());
}

static void configSave() {
  EEPROM.put(0, cfg);
  EEPROM.commit();
}

static void configLoad() {
  EEPROM.begin(sizeof(Config) + 8);
  EEPROM.get(0, cfg);
  if (cfg.magic != CONFIG_MAGIC || cfg.version != CONFIG_VERSION) {
    configDefaults();
    configSave();
    return;
  }
  if (cfg.pulseMs < MIN_PULSE_MS || cfg.pulseMs > MAX_PULSE_MS) {
    cfg.pulseMs = DEFAULT_PULSE_MS;
  }
  for (int i = 0; i < CH_COUNT; i++) {
    cfg.chan[i][sizeof(cfg.chan[i]) - 1] = 0;
  }
  cfg.ssid[sizeof(cfg.ssid) - 1] = 0;
  cfg.pass[sizeof(cfg.pass) - 1] = 0;
  cfg.device[sizeof(cfg.device) - 1] = 0;
}

static void chanInit() {
  for (int i = 0; i < CH_COUNT; i++) {
    pinMode(CH_PINS[i], OUTPUT);
    digitalWrite(CH_PINS[i], HIGH);
    chRun[i].active = false;
    chRun[i].start = 0;
    chRun[i].ms = 0;
  }
}

static void chanPulse(int index, uint16_t ms) {
  if (index < 0 || index >= CH_COUNT) {
    return;
  }
  if (ms < MIN_PULSE_MS) {
    ms = MIN_PULSE_MS;
  }
  if (ms > MAX_PULSE_MS) {
    ms = MAX_PULSE_MS;
  }
  digitalWrite(CH_PINS[index], LOW);
  chRun[index].active = true;
  chRun[index].start = millis();
  chRun[index].ms = ms;
}

static void chanTick() {
  uint32_t now = millis();
  for (int i = 0; i < CH_COUNT; i++) {
    if (chRun[i].active && now - chRun[i].start >= chRun[i].ms) {
      digitalWrite(CH_PINS[i], HIGH);
      chRun[i].active = false;
    }
  }
}

static void mdnsStart() {
  if (mdnsUp || WiFi.status() != WL_CONNECTED) {
    return;
  }
  String host = hostName();
  if (MDNS.begin(host.c_str())) {
    MDNS.addService("esp-switch", "tcp", 80);
    MDNS.addServiceTxt("esp-switch", "tcp", "id", macId().c_str());
    MDNS.addServiceTxt("esp-switch", "tcp", "host", host.c_str());
    MDNS.addServiceTxt("esp-switch", "tcp", "model", "esp-switch-4ch");
    MDNS.addServiceTxt("esp-switch", "tcp", "fw", FW_VERSION);
    MDNS.addServiceTxt("esp-switch", "tcp", "ch", "4");
    mdnsUp = true;
  }
}

static void startAP() {
  if (apRunning) {
    return;
  }
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(apName().c_str());
  dns.start(53, "*", WiFi.softAPIP());
  apRunning = true;
}

static void stopAP() {
  if (!apRunning) {
    return;
  }
  dns.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  apRunning = false;
}

static void startSTA() {
  WiFi.persistent(false);
  WiFi.mode(apRunning ? WIFI_AP_STA : WIFI_STA);
  WiFi.setAutoReconnect(true);
  if (cfg.ssid[0]) {
    WiFi.begin(cfg.ssid, cfg.pass);
    lastAttempt = millis();
  }
}

static void netSetup() {
  WiFi.hostname(hostName().c_str());
  if (!cfg.ssid[0]) {
    startAP();
    return;
  }
  startSTA();
}

static void netTick() {
  uint32_t now = millis();
  if (WiFi.status() == WL_CONNECTED) {
    downSince = 0;
    stopAP();
    mdnsStart();
    return;
  }
  if (!cfg.ssid[0]) {
    startAP();
    return;
  }
  if (!downSince) {
    downSince = now;
  }
  if (now - downSince > AP_FALLBACK_MS) {
    startAP();
  }
  if (now - lastAttempt > RECONNECT_MS) {
    lastAttempt = now;
    WiFi.begin(cfg.ssid, cfg.pass);
  }
}

static String jsonEscape(const char *text) {
  String out;
  for (const char *p = text; *p; p++) {
    unsigned char c = (unsigned char)*p;
    if (c == '"' || c == '\\') {
      out += '\\';
      out += (char)c;
    } else if (c < 0x20) {
      out += ' ';
    } else {
      out += (char)c;
    }
  }
  return out;
}

static String infoJson() {
  String body;
  body.reserve(512);
  body = "{\"id\":\"";
  body += macId();
  body += "\",\"name\":\"";
  body += jsonEscape(cfg.device);
  body += "\",\"host\":\"";
  body += hostName();
  body += "\",\"fw\":\"";
  body += FW_VERSION;
  body += "\",\"pulse_ms\":";
  body += String(cfg.pulseMs);
  body += ",\"ip\":\"";
  body += (WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : WiFi.softAPIP().toString());
  body += "\",\"mode\":\"";
  body += (WiFi.status() == WL_CONNECTED ? "sta" : "ap");
  body += "\",\"channels\":[";
  for (int i = 0; i < CH_COUNT; i++) {
    if (i) {
      body += ',';
    }
    body += "{\"index\":";
    body += String(i + 1);
    body += ",\"name\":\"";
    body += jsonEscape(cfg.chan[i]);
    body += "\",\"active\":";
    body += (chRun[i].active ? "true" : "false");
    body += '}';
  }
  body += "]}";
  return body;
}

static String pageHtml() {
  String h;
  h.reserve(4200);
  h += F("<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">");
  h += F("<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">");
  h += F("<title>ESP 开关</title><style>");
  h += F("body{margin:0;background:#14161a;color:#e8eaed;font:15px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif}");
  h += F("main{max-width:640px;margin:0 auto;padding:20px}h1{font-size:20px;margin:0 0 4px}");
  h += F(".muted{color:#9aa0a6;font-size:13px;word-break:break-all}");
  h += F("section{background:#1e2126;border:1px solid #2a2e35;border-radius:10px;padding:14px;margin-top:14px}");
  h += F(".ch{display:flex;gap:10px;align-items:center;margin:8px 0}");
  h += F(".ch b{flex:1;font-weight:500}button{background:#2f6feb;color:#fff;border:0;border-radius:8px;padding:8px 14px;font-size:14px;cursor:pointer}");
  h += F("button.ghost{background:#2a2e35}input{background:#14161a;color:#e8eaed;border:1px solid #333941;border-radius:8px;padding:8px;width:100%;box-sizing:border-box;margin:4px 0}");
  h += F("label{font-size:13px;color:#9aa0a6}.row{display:flex;gap:8px;margin-top:8px}");
  h += F("table{width:100%;border-collapse:collapse;font-size:14px}td{padding:4px 0;border-bottom:1px solid #24282e}");
  h += F("</style></head><body><main>");
  h += F("<h1>ESP 开关</h1><div class=\"muted\" id=\"sub\">加载中</div>");
  h += F("<section><div id=\"chs\"></div></section>");
  h += F("<section><div class=\"muted\">设备设置</div><label>设备名</label>");
  h += F("<input id=\"dev\" maxlength=\"32\"><label>脉冲时长 (ms)</label><input id=\"pms\" type=\"number\" min=\"100\" max=\"5000\">");
  h += F("<div class=\"row\"><button onclick=\"saveDev()\">保存</button><button class=\"ghost\" onclick=\"reboot()\">重启</button></div></section>");
  h += F("<section><div class=\"muted\">WiFi 配置</div><div id=\"wl\"></div>");
  h += F("<label>SSID</label><input id=\"ssid\"><label>密码</label><input id=\"pass\" type=\"password\">");
  h += F("<div class=\"row\"><button onclick=\"scan()\">扫描</button><button onclick=\"saveWifi()\">保存并连接</button>");
  h += F("<button class=\"ghost\" onclick=\"resetCfg()\">清除配置</button></div></section>");
  h += F("<script>");
  h += F("let info=null;");
  h += F("async function api(u){const r=await fetch(u);return r.headers.get('content-type').includes('json')?r.json():r.text();}");
  h += F("function render(){if(!info)return;document.getElementById('sub').textContent=info.name+' | '+info.mode+' | '+info.ip+' | '+info.id;");
  h += F("let box=document.getElementById('chs');box.innerHTML='';info.channels.forEach(c=>{");
  h += F("let d=document.createElement('div');d.className='ch';d.innerHTML='<b>'+c.name+'</b>';");
  h += F("let b=document.createElement('button');b.textContent='开机';b.onclick=()=>pulse(c.index);d.appendChild(b);box.appendChild(d);});");
  h += F("document.getElementById('dev').value=info.name;document.getElementById('pms').value=info.pulse_ms;}");
  h += F("async function refresh(){info=await api('/api/info');render();}");
  h += F("async function pulse(i){await fetch('/api/pulse?ch='+i);refresh();}");
  h += F("async function saveDev(){await fetch('/api/config?name='+encodeURIComponent(document.getElementById('dev').value)+'&pulse_ms='+document.getElementById('pms').value);refresh();}");
  h += F("async function reboot(){if(confirm('确认重启？')){await fetch('/api/reboot');}}");
  h += F("async function resetCfg(){if(confirm('清除 WiFi 与名称配置？')){await fetch('/api/reset');}}");
  h += F("async function scan(){let l=await api('/api/scan');let box=document.getElementById('wl');box.innerHTML='';");
  h += F("l.networks.forEach(n=>{let d=document.createElement('div');d.className='ch';d.innerHTML='<b>'+n.ssid+'</b><span class=\"muted\">'+n.rssi+'dBm</span>';");
  h += F("let b=document.createElement('button');b.className='ghost';b.textContent='选择';b.onclick=()=>{document.getElementById('ssid').value=n.ssid;};d.appendChild(b);box.appendChild(d);});}");
  h += F("async function saveWifi(){await fetch('/api/wifi?ssid='+encodeURIComponent(document.getElementById('ssid').value)+'&pass='+encodeURIComponent(document.getElementById('pass').value));alert('已保存，设备将重启并尝试连接');}");
  h += F("refresh();setInterval(refresh,3000);");
  h += F("</script></main></body></html>");
  return h;
}

static void handleRoot() {
  server.send(200, "text/html; charset=utf-8", pageHtml());
}

static void handleInfo() {
  server.send(200, "application/json", infoJson());
}

static void handlePulse() {
  uint16_t ms = cfg.pulseMs;
  if (server.hasArg("ms")) {
    ms = (uint16_t)server.arg("ms").toInt();
  }
  if (server.hasArg("all")) {
    for (int i = 0; i < CH_COUNT; i++) {
      chanPulse(i, ms);
    }
    server.send(200, "application/json", "{\"ok\":true,\"ch\":\"all\"}");
    return;
  }
  int ch = server.hasArg("ch") ? server.arg("ch").toInt() : 1;
  if (ch < 1 || ch > CH_COUNT) {
    server.send(400, "application/json", "{\"ok\":false,\"error\":\"bad channel\"}");
    return;
  }
  chanPulse(ch - 1, ms);
  String body = "{\"ok\":true,\"ch\":" + String(ch) + ",\"ms\":" + String(ms) + "}";
  server.send(200, "application/json", body);
}

static void handleConfig() {
  if (server.hasArg("name")) {
    String name = server.arg("name");
    name.trim();
    if (name.length()) {
      strncpy(cfg.device, name.c_str(), sizeof(cfg.device) - 1);
      cfg.device[sizeof(cfg.device) - 1] = 0;
    }
  }
  for (int i = 1; i <= CH_COUNT; i++) {
    String key = "ch" + String(i);
    if (server.hasArg(key)) {
      String name = server.arg(key);
      name.trim();
      if (name.length()) {
        strncpy(cfg.chan[i - 1], name.c_str(), sizeof(cfg.chan[i - 1]) - 1);
        cfg.chan[i - 1][sizeof(cfg.chan[i - 1]) - 1] = 0;
      }
    }
  }
  if (server.hasArg("pulse_ms")) {
    long ms = server.arg("pulse_ms").toInt();
    if (ms >= MIN_PULSE_MS && ms <= MAX_PULSE_MS) {
      cfg.pulseMs = (uint16_t)ms;
    }
  }
  configSave();
  mdnsUp = false;
  WiFi.hostname(hostName().c_str());
  server.send(200, "application/json", infoJson());
}

static void handleScan() {
  int found = WiFi.scanNetworks();
  String body = "{\"networks\":[";
  for (int i = 0; i < found; i++) {
    if (i) {
      body += ',';
    }
    body += "{\"ssid\":\"";
    body += jsonEscape(WiFi.SSID(i).c_str());
    body += "\",\"rssi\":";
    body += String(WiFi.RSSI(i));
    body += ",\"secure\":";
    body += (WiFi.encryptionType(i) == ENC_TYPE_NONE ? "false" : "true");
    body += '}';
  }
  body += "]}";
  WiFi.scanDelete();
  server.send(200, "application/json", body);
}

static void handleWifi() {
  if (server.hasArg("ssid")) {
    String ssid = server.arg("ssid");
    ssid.trim();
    strncpy(cfg.ssid, ssid.c_str(), sizeof(cfg.ssid) - 1);
    cfg.ssid[sizeof(cfg.ssid) - 1] = 0;
    String pass = server.hasArg("pass") ? server.arg("pass") : String();
    strncpy(cfg.pass, pass.c_str(), sizeof(cfg.pass) - 1);
    cfg.pass[sizeof(cfg.pass) - 1] = 0;
    configSave();
  }
  server.send(200, "application/json", "{\"ok\":true,\"reboot\":true}");
  rebootAt = millis() + 800;
}

static void handleReset() {
  memset(cfg.ssid, 0, sizeof(cfg.ssid));
  memset(cfg.pass, 0, sizeof(cfg.pass));
  configDefaults();
  configSave();
  server.send(200, "application/json", "{\"ok\":true,\"reboot\":true}");
  rebootAt = millis() + 800;
}

static void handleReboot() {
  server.send(200, "application/json", "{\"ok\":true}");
  rebootAt = millis() + 800;
}

static void handleNotFound() {
  server.send(404, "application/json", "{\"ok\":false,\"error\":\"not found\"}");
}

static void webSetup() {
  server.on("/", HTTP_GET, handleRoot);
  server.on("/api/info", HTTP_GET, handleInfo);
  server.on("/api/pulse", HTTP_GET, handlePulse);
  server.on("/api/pulse", HTTP_POST, handlePulse);
  server.on("/api/config", HTTP_GET, handleConfig);
  server.on("/api/config", HTTP_POST, handleConfig);
  server.on("/api/scan", HTTP_GET, handleScan);
  server.on("/api/wifi", HTTP_GET, handleWifi);
  server.on("/api/wifi", HTTP_POST, handleWifi);
  server.on("/api/reset", HTTP_GET, handleReset);
  server.on("/api/reboot", HTTP_GET, handleReboot);
  server.onNotFound(handleNotFound);
  server.begin();
}

static void otaSetup() {
  ArduinoOTA.setHostname(hostName().c_str());
  ArduinoOTA.onStart([]() {});
  ArduinoOTA.begin();
}

void setup() {
  chanInit();
  configLoad();
  WiFi.hostname(hostName().c_str());
  netSetup();
  webSetup();
  otaSetup();
}

void loop() {
  chanTick();
  netTick();
  if (apRunning) {
    dns.processNextRequest();
  }
  server.handleClient();
  ArduinoOTA.handle();
  if (mdnsUp) {
    MDNS.update();
  }
  if (rebootAt && millis() > rebootAt) {
    rebootAt = 0;
    ESP.restart();
  }
  delay(2);
}
