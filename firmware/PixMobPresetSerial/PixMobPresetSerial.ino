
#define DISABLE_CODE_FOR_RECEIVER

#include <Arduino.h>
#include <IRremote.hpp>
#include <ESP_I2S.h>

// Hardware
const uint8_t IR_PIN = 32;
const int MIC_SCK = 26;
const int MIC_WS  = 25;
const int MIC_SD  = 27;

I2SClass I2S;
int32_t audioSamples[256];

// PixMob IR commands - 38kHz
const uint16_t RED[] = {
  1400,1400,700,700,700,1400,700,2800,
  700,2100,1400,700,700,700,700,1400,
  1400,2800,1400,2800,700
};

const uint16_t GREEN[] = {
  1400,1400,700,700,700,700,1400,2800,
  700,1400,700,1400,700,1400,700,1400,
  1400,2800,1400,2800,700
};

const uint16_t BLUE[] = {
  700,700,700,2100,1400,700,700,2800,
  700,1400,700,700,700,1400,1400,700,
  700,1400,700,700,700,700,700,700,
  700,2100,700
};

const uint16_t YELLOW[] = {
  1400,1400,700,700,700,700,1400,2800,
  700,2100,700,700,700,1400,700,1400,
  1400,2800,1400,2800,700
};

const uint16_t CYAN[] = {
  700,700,700,700,1400,1400,1400,2800,
  700,1400,700,700,1400,1400,700,1400,
  1400,2800,700,700,700,2100,700
};

const uint16_t MAGENTA[] = {
  700,700,700,700,1400,1400,1400,2800,
  700,2100,1400,2100,700,700,700,700,
  1400,2100,700,700,700,2100,700
};

const uint16_t WHITE[] = {
  700,700,700,2100,1400,700,700,2800,
  700,1400,700,700,700,2800,1400,1400,
  700,2100,700,1400,700,1400,700
};

// Modes
enum Mode {
  MANUAL_MODE,
  AUTO_MODE,
  MUSIC_MODE
};

Mode currentMode = MANUAL_MODE;

float baseline = 0;
float previousLevel = 0;
float sensitivity = 1.35f;

unsigned long lastBeat = 0;
unsigned long lastAuto = 0;
unsigned long lastPrint = 0;

uint8_t colorIndex = 0;

void sendEffect(
  const uint16_t* timings,
  size_t length
) {
  // Repeat for more reliable short-range reception
  for (int i = 0; i < 3; i++) {
    IrSender.sendRaw(timings, length, 38);
    if (i < 2) delay(80);
  }
}

#define SEND_PRESET(name) \
  sendEffect(name, sizeof(name) / sizeof(name[0]))

void sendColor(char color) {
  switch (color) {
    case 'R': SEND_PRESET(RED); break;
    case 'G': SEND_PRESET(GREEN); break;
    case 'B': SEND_PRESET(BLUE); break;
    case 'Y': SEND_PRESET(YELLOW); break;
    case 'C': SEND_PRESET(CYAN); break;
    case 'M': SEND_PRESET(MAGENTA); break;
    case 'W': SEND_PRESET(WHITE); break;
    default: return;
  }

  Serial.print("Color sent: ");
  Serial.println(color);
}

void handleSerial() {
  while (Serial.available()) {
    char c = Serial.read();

    if (c >= 'a' && c <= 'z') c -= 32;
    if (c == '\r' || c == '\n' || c == ' ') continue;

    if (c == 'A') {
      currentMode = AUTO_MODE;
      colorIndex = 0;
      lastAuto = 0;
      Serial.println("AUTO MODE ON");
    }
    else if (c == 'M') {
      currentMode = MUSIC_MODE;
      colorIndex = 0;
      lastBeat = millis();
      Serial.println("MUSIC SYNC ON");
    }
    else if (c == 'X') {
      currentMode = MANUAL_MODE;
      Serial.println("AUTO / MUSIC STOPPED");
    }
    else if (c == '+') {
      sensitivity = max(1.10f, sensitivity - 0.10f);
      Serial.printf("Sensitivity: %.2f\n", sensitivity);
    }
    else if (c == '-') {
      sensitivity = min(2.50f, sensitivity + 0.10f);
      Serial.printf("Sensitivity: %.2f\n", sensitivity);
    }
    else {
      currentMode = MANUAL_MODE;
      sendColor(c);
    }
  }
}

void readMicrophone() {
  size_t bytesRead = I2S.readBytes(
    (char*)audioSamples,
    sizeof(audioSamples)
  );

  int count = bytesRead / sizeof(int32_t);
  if (count <= 0) return;

  uint64_t sum = 0;

  for (int i = 0; i < count; i++) {
    int32_t sample = audioSamples[i] >> 16;
    sum += sample < 0 ? -(int64_t)sample : sample;
  }

  float level = (float)sum / count;

  if (baseline <= 0) baseline = level;

  float threshold = max(
    250.0f,
    baseline * sensitivity
  );

  unsigned long now = millis();

  bool beat =
    level > threshold &&
    level > previousLevel * 1.10f &&
    now - lastBeat > 420;

  baseline = baseline * 0.98f + level * 0.02f;
  previousLevel = level;

  if (currentMode == MUSIC_MODE) {
    if (now - lastPrint >= 250) {
      Serial.printf(
        "Level:%.0f Threshold:%.0f\n",
        level, threshold
      );
      lastPrint = now;
    }

    if (beat) {
      lastBeat = now;

      const char rgb[] = {'R', 'G', 'B'};
      char color = rgb[colorIndex];

      Serial.print("BEAT! ");
      sendColor(color);

      colorIndex = (colorIndex + 1) % 3;
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  IrSender.begin(IR_PIN);

  I2S.setPins(MIC_SCK, MIC_WS, -1, MIC_SD);

  if (!I2S.begin(
    I2S_MODE_STD,
    16000,
    I2S_DATA_BIT_WIDTH_32BIT,
    I2S_SLOT_MODE_MONO,
    I2S_STD_SLOT_LEFT
  )) {
    Serial.println("MICROPHONE ERROR");
    while (true) delay(1000);
  }

  Serial.println("PIXMOB STUDIO V2 READY!");
  Serial.println("R/G/B/Y/C/W = Preset color");
  Serial.println("A = Auto");
  Serial.println("M = Music Sync");
  Serial.println("X = Stop");
  Serial.println("+ = More sensitive");
  Serial.println("- = Less sensitive");
}

void loop() {
  handleSerial();

  readMicrophone();

  if (currentMode == AUTO_MODE) {
    unsigned long now = millis();

    if (lastAuto == 0 || now - lastAuto >= 1800) {
      const char colors[] = {
        'R', 'G', 'B', 'Y', 'C', 'M', 'W'
      };

      sendColor(colors[colorIndex]);
      colorIndex = (colorIndex + 1) % 7;
      lastAuto = millis();
    }
  }

  delay(5);
}
