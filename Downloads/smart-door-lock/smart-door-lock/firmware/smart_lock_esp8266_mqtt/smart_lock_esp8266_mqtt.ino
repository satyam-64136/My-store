/*
 * Smart Door Lock v2 - ESP8266 (NodeMCU) + MQTT push + Telegram OTP
 * No Google Apps Script, no polling. The ESP keeps ONE live TLS connection
 * to an MQTT broker; the web app publishes commands and the ESP reacts in
 * ~50-150 ms. OTP is generated and checked ON the ESP (never on the web).
 *
 * Libraries (Library Manager): PubSubClient (Nick O'Leary), ArduinoJson v6.21.x,
 *                              LiquidCrystal I2C (Frank de Brabander)  [LCD is optional]
 * Board: NodeMCU 1.0 (ESP-12E)
 */
#include <ESP8266WiFi.h>
#include <WiFiClientSecureBearSSL.h>
#include <ESP8266HTTPClient.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// ---------- EDIT THESE ----------
#include "secrets.h"   // copy secrets.example.h -> secrets.h and edit

const int  RELAY_PIN = D5;               // GPIO14 -> relay IN1
const bool RELAY_ACTIVE_LOW = true;      // most 4-ch modules are active LOW
const uint32_t UNLOCK_MS     = 5000;     // how long solenoid stays energised
const uint32_t OTP_TTL_MS    = 300000;   // OTP valid 5 min
const uint32_t TG_DELETE_MS  = 45000;    // delete Telegram OTP msg after 45 s
const uint32_t REQ_COOLDOWN  = 15000;    // min gap between OTP requests
const uint32_t LOCKOUT_MS    = 60000;    // lockout after 3 wrong tries
const uint8_t  MAX_TRIES     = 3;
// --------------------------------

#define T_CMD    PREFIX "/cmd"
#define T_EVT    PREFIX "/evt"
#define T_STATUS PREFIX "/status"

BearSSL::WiFiClientSecure net;
PubSubClient mqtt(net);

char     otp[7] = "";
bool     otpActive = false, pendingReq = false, relayOn = false;
uint8_t  tries = 0;
uint32_t otpAt = 0, lastReq = 0, lockoutAt = 0, relayAt = 0, tgDelAt = 0, lastMqttTry = 0;
bool     lockedOut = false;
long     tgMsgId = 0;

void relayWrite(bool on) {
  digitalWrite(RELAY_PIN, (on ^ RELAY_ACTIVE_LOW) ? HIGH : LOW);
  relayOn = on;
}

// ---------- 16x2 I2C LCD on D2 (SDA) / D1 (SCL). Optional: the lock works without it ----------
LiquidCrystal_I2C* lcd = nullptr;
char lcdBuf[2][17] = {"", ""};
uint32_t msgUntil = 0, lcdLast = 0;

void lcdPrint(const char* a, const char* b) {            // only rewrites lines that changed
  if (!lcd) return;
  char l[2][17];
  snprintf(l[0], 17, "%-16.16s", a);
  snprintf(l[1], 17, "%-16.16s", b);
  for (int i = 0; i < 2; i++) if (strcmp(l[i], lcdBuf[i])) {
    lcd->setCursor(0, i); lcd->print(l[i]); strcpy(lcdBuf[i], l[i]);
  }
}
void flashMsg(const char* a, const char* b, uint32_t ms = 2500) { lcdPrint(a, b); msgUntil = millis() + ms; }

void lcdIdle() {                                          // default screen, derived from state
  if (!lcd || millis() - lcdLast < 200 || (int32_t)(msgUntil - millis()) > 0) return;
  lcdLast = millis();
  if (WiFi.status() != WL_CONNECTED) lcdPrint("WiFi lost", "Reconnecting...");
  else if (!mqtt.connected())        lcdPrint("Connecting...", "to broker");
  else if (relayOn)                  lcdPrint("UNLOCKED", "Door open");
  else if (lockedOut)                lcdPrint("LOCKED OUT", "Please wait");
  else if (otpActive)                lcdPrint("Enter code", "in the web app");
  else                               lcdPrint("LOCKED", "Ready");
}

void lcdEvent(const char* j) {                            // short messages for events
  if (!lcd || strstr(j, "bad_req")) return;
  if (strstr(j, "unlocked") || strstr(j, "\"locked\"")) { msgUntil = 0; return; }
  if (strstr(j, "sending"))        flashMsg("Sending code...", "Please wait", 15000);
  else if (strstr(j, "otp_sent"))  flashMsg("Code sent", "Check Telegram", 3000);
  else if (strstr(j, "\"bad\"")) {
    char b[17]; const char* p = strstr(j, "\"left\":");
    snprintf(b, 17, "%d tries left", p ? atoi(p + 7) : 0);
    flashMsg("Wrong code", b, 3000);
  }
  else if (strstr(j, "locked_out")) flashMsg("Too many tries", "Wait 60 s", 4000);
  else if (strstr(j, "expired"))    flashMsg("Code expired", "Request new one", 3000);
  else if (strstr(j, "no_otp"))     flashMsg("No code active", "Request one first", 3000);
  else if (strstr(j, "tg_fail"))    flashMsg("Telegram failed", "Try again", 3000);
  else if (strstr(j, "low_mem"))    flashMsg("Low memory", "Try again", 3000);
  else if (strstr(j, "wait"))       flashMsg("Please wait", "a few seconds", 2000);
}

void evt(const char* json) { mqtt.publish(T_EVT, json); lcdEvent(json); }

// ---- Telegram (HTTPS POST, returns response body) ----
String tgPost(const char* method, const String& body) {
  std::unique_ptr<BearSSL::WiFiClientSecure> c(new BearSSL::WiFiClientSecure);
  c->setInsecure();
  static int8_t mf = -1;                         // does Telegram accept small TLS fragments?
  if (mf < 0) mf = c->probeMaxFragmentLength("api.telegram.org", 443, 1024) ? 1 : 0;
  if (mf) c->setBufferSizes(1024, 512);          // otherwise default 16 KB buffers (~25 KB heap)
  HTTPClient http;
  String out;
  if (http.begin(*c, String("https://api.telegram.org/bot") + TG_TOKEN + "/" + method)) {
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(5000);
    if (http.POST(body) == 200) out = http.getString();
    http.end();
  }
  return out;
}

bool sendOtpToTelegram() {
  String body = String("{\"chat_id\":\"") + TG_CHAT +
    "\",\"parse_mode\":\"HTML\",\"text\":\"<b>Door OTP</b>\\n<code>" + otp +
    "</code>\\nExpires in 5 min\"}";
  String r = tgPost("sendMessage", body);
  if (!r.length()) return false;
  StaticJsonDocument<64> f; f["result"]["message_id"] = true;
  DynamicJsonDocument d(256);
  if (deserializeJson(d, r, DeserializationOption::Filter(f))) return false;
  tgMsgId = d["result"]["message_id"] | 0;
  tgDelAt = millis() + TG_DELETE_MS;
  return true;
}

void mqttConnect();                              // defined below
char pendingEvt[40] = "";
void flushPending() { if (pendingEvt[0] && mqtt.connected()) { evt(pendingEvt); pendingEvt[0] = 0; } }

void handleRequest() {
  pendingReq = false;
  evt("{\"e\":\"sending\"}");
  mqtt.loop();                                   // push "sending" out first
  bool dropped = false;
  if (ESP.getFreeHeap() < 45000) {               // two TLS sessions do not fit: pause MQTT for the Telegram call
    mqtt.disconnect(); net.stop(); dropped = true;
  }
  const char* res;
  if (ESP.getFreeHeap() < 24000) {
    Serial.printf("[MEM] low heap: %u\n", ESP.getFreeHeap());
    res = "{\"e\":\"low_mem\"}";
  } else {
    uint32_t n = RANDOM_REG32 % 1000000;         // hardware RNG
    snprintf(otp, sizeof(otp), "%06lu", (unsigned long)n);
    tries = 0; otpAt = millis(); otpActive = true;
    if (sendOtpToTelegram()) res = "{\"e\":\"otp_sent\"}";
    else { otpActive = false; res = "{\"e\":\"tg_fail\"}"; }
  }
  snprintf(pendingEvt, sizeof(pendingEvt), "%s", res);
  if (dropped) { lastMqttTry = 0; mqttConnect(); }   // reconnect right away
  flushPending();
}

void doUnlock() {
  relayWrite(true);
  relayAt = millis();
  otpActive = false; memset(otp, 0, sizeof(otp));
  if (tgMsgId) tgDelAt = millis() + UNLOCK_MS + 500;   // clean up OTP message after relock
  mqtt.publish(T_STATUS, "unlocked", true);
  evt("{\"e\":\"unlocked\"}");
}

void doLock() {
  relayWrite(false);
  mqtt.publish(T_STATUS, "locked", true);
  evt("{\"e\":\"locked\"}");
}

void checkOtp(const char* v) {
  if (strlen(v) != 6) { evt("{\"e\":\"bad_req\"}"); return; }   // malformed: no attempt used
  if (lockedOut) { evt("{\"e\":\"locked_out\"}"); return; }
  if (!otpActive) { evt("{\"e\":\"no_otp\"}"); return; }
  if (millis() - otpAt > OTP_TTL_MS) { otpActive = false; evt("{\"e\":\"expired\"}"); return; }
  if (strcmp(v, otp) == 0) { doUnlock(); return; }
  if (++tries >= MAX_TRIES) {
    otpActive = false; lockedOut = true; lockoutAt = millis();
    evt("{\"e\":\"locked_out\"}");
  } else {
    char b[40]; snprintf(b, sizeof(b), "{\"e\":\"bad\",\"left\":%u}", MAX_TRIES - tries);
    evt(b);
  }
}

void onMsg(char* topic, byte* p, unsigned int len) {
  if (len > 80) return;                           // ignore oversized/garbage payloads
  StaticJsonDocument<96> d;
  if (deserializeJson(d, p, len)) return;
  const char* a = d["a"] | "";
  if (!strcmp(a, "req")) {
    if (lockedOut) { evt("{\"e\":\"locked_out\"}"); return; }
    if (millis() - lastReq < REQ_COOLDOWN && lastReq) { evt("{\"e\":\"wait\"}"); return; }
    lastReq = millis(); pendingReq = true;       // handled in loop (blocking HTTPS)
  } else if (!strcmp(a, "otp")) {
    checkOtp(d["v"] | "");
  } else if (!strcmp(a, "lock")) {
    doLock();
  }
}

const char* mqttWhy(int rc) {
  switch (rc) {
    case -4: return "timeout";
    case -3: return "connection lost";
    case -2: return "TCP/TLS connect failed (wrong host/port, TLS or memory)";
    case -1: return "disconnected";
    case 1: return "bad protocol";
    case 2: return "bad client id";
    case 3: return "broker unavailable";
    case 4: return "BAD USERNAME OR PASSWORD";
    case 5: return "not authorised (user lacks permission)";
  }
  return "unknown";
}

void mqttConnect() {
  if (millis() - lastMqttTry < 2000) return;
  lastMqttTry = millis();
  String id = "lock-" + String(ESP.getChipId(), HEX);
  if (mqtt.connect(id.c_str(), MQTT_USER, MQTT_PASS, T_STATUS, 0, true, "offline")) {
    mqtt.subscribe(T_CMD);
    mqtt.publish(T_STATUS, relayOn ? "unlocked" : "locked", true);
    Serial.println("[MQTT] connected");
  } else {
    int rc = mqtt.state();
    char e[100] = "";
    if (rc == -2) net.getLastSSLError(e, sizeof(e));
    Serial.printf("[MQTT] fail rc=%d: %s %s | heap=%u\n", rc, mqttWhy(rc), e, ESP.getFreeHeap());
    char b[17]; snprintf(b, 17, "error %d", rc);
    flashMsg("Broker failed", b, 1500);
  }
}

void setup() {
  Serial.begin(115200);
  Wire.begin(D2, D1);                              // SDA = D2 (GPIO4), SCL = D1 (GPIO5)
  const uint8_t addrs[] = {0x27, 0x3F, 0x26, 0x20};
  for (uint8_t a : addrs) {                        // auto-detect the LCD backpack address
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      lcd = new LiquidCrystal_I2C(a, 16, 2);
      lcd->init(); lcd->backlight(); lcd->clear();
      Serial.printf("[LCD] found at 0x%02X\n", a);
      break;
    }
  }
  if (!lcd) Serial.println("[LCD] not found - check SDA/SCL/VCC/GND wiring");
  flashMsg("Smart Door Lock", "Starting...", 1500);
  digitalWrite(RELAY_PIN, RELAY_ACTIVE_LOW ? HIGH : LOW);   // latch OFF level first
  pinMode(RELAY_PIN, OUTPUT);                                // then enable output: no boot glitch
  relayWrite(false);                              // locked on boot
  if (strstr(MQTT_HOST, "://") || strchr(MQTT_HOST, ':'))
    Serial.println("[WARN] MQTT_HOST must be only the hostname (no https:// and no port)");
  if (!strcmp(MQTT_HOST, "your-broker-host.emqxsl.com") || !strcmp(WIFI_SSID, "your-wifi"))
    Serial.println("[WARN] Config still has placeholder values!");
  WiFi.mode(WIFI_STA);
  WiFi.setSleepMode(WIFI_NONE_SLEEP);             // biggest latency win
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  lcdPrint("Connecting WiFi", WIFI_SSID);
  uint32_t t = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(250); Serial.print(".");
    if (millis() - t > 20000) { Serial.println("\n[WiFi] timeout, restarting"); ESP.restart(); }
  }
  Serial.println(WiFi.localIP());
  flashMsg("WiFi connected", WiFi.localIP().toString().c_str(), 1500);
  WiFi.setAutoReconnect(true);
  net.setInsecure();                              // TODO: pin cert for production
  if (net.probeMaxFragmentLength(MQTT_HOST, MQTT_PORT, 512)) {
    net.setBufferSizes(512, 512); Serial.println("[TLS] small buffers (broker supports MFLN)");
  } else Serial.println("[TLS] broker has no MFLN: using default buffers");
  net.setNoDelay(true);
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setKeepAlive(15);
  mqtt.setSocketTimeout(5);
  mqtt.setCallback(onMsg);
}

void loop() {
  static uint32_t wifiDownAt = 0;
  if (WiFi.status() == WL_CONNECTED) {
    wifiDownAt = 0;
    if (!mqtt.connected()) mqttConnect(); else { mqtt.loop(); flushPending(); }
  } else {
    if (!wifiDownAt) wifiDownAt = millis();
    if (millis() - wifiDownAt > 60000) ESP.restart();   // WiFi stuck for 1 min: reboot (relay boots LOCKED)
  }
  if (pendingReq) handleRequest();
  if (relayOn && millis() - relayAt >= UNLOCK_MS) doLock();
  if (lockedOut && millis() - lockoutAt >= LOCKOUT_MS) { lockedOut = false; tries = 0; }
  if (tgMsgId && !relayOn && (int32_t)(millis() - tgDelAt) >= 0) {   // never block during unlock
    tgPost("deleteMessage", String("{\"chat_id\":\"") + TG_CHAT + "\",\"message_id\":" + tgMsgId + "}");
    tgMsgId = 0;
  }
  lcdIdle();
  yield();
}
