// Copy this file to secrets.h (same folder) and fill it in. secrets.h is git-ignored.
#pragma once
const char* WIFI_SSID = "your-wifi";
const char* WIFI_PASS = "your-wifi-pass";

const char* MQTT_HOST = "your-broker-host.emqxsl.com";  // EMQX Cloud deployment 'Address'
const uint16_t MQTT_PORT = 8883;                        // TLS
const char* MQTT_USER = "esp-lock";
const char* MQTT_PASS = "esp-password";
#define PREFIX "lock/CHANGE_ME_random123"               // must match the web app

const char* TG_TOKEN = "NEW_BOT_TOKEN";                 // from @BotFather
const char* TG_CHAT  = "YOUR_CHAT_ID";
