# PixMob Studio 项目交接

更新：**2026-11-21，Asia/Kuala_Lumpur**（11-20/21 加入 RF 同发，见第 1、2 节；其余段落多为 11-15 状态）。继续使用 `/Users/yh/Documents/ChatGPT/Pixmob`，无需重新创建或迁移项目。

本文件整理当前代码、最后一次硬件操作记录及用户反馈。**彩虹暗段／闪烁已在 11-20 换电池后解决（用户观察）；当前重点是 IR+RF 同发（第 1、2 节）。网页 11-21 起在 Cloudflare Pages（第 8 节）。** White、歌曲效果转发和 70 ms 提前量已有后续验证，不能再按 11 月 12 日的未完成状态处理。

## 1 接手先分清三个版本

| 对象 | 2026-11-21 最新状态 |
| --- | --- |
| ESP32 最后确认运行版本 | `.arduino/beat-rf-flash-build/PixMobBeatController.ino.bin`（11-21 写入并校验）：当前源码，含呼吸灯、开机／空闲彩虹、**IR+RF 同发，可设只 IR／只 RF，每条灯光可用 /I /R /B 指定**，彩虹 RF 保持 480 ms，**RF 快闪保持 192 ms（按视频实测与 IR 对齐）**，**RF 手环在板子通电时一直保活（默认），睡眠改为可选 `@RS<s>`**。退回点：`beat-rf-sleep-setting-build`（RF 快闪 480 ms），再前 `beat-rf-sleep-build`（固定 5 分钟后睡）、`beat-rf-output-build`（一直保活，无设置）；RF 之前是 `beat-effects-build` |
| 当前固件源码 | `firmware/PixMobBeatController/`，与板上 `beat-rf-flash-build` 一致 |
| 网页源码／最近部署 | Song shows 新编辑界面、视频取色、节拍效果、idle 能力判断均已实现；11-21 源码新增 RF 状态、开关、唤醒按钮、IR/RF 输出选择和睡眠设置。**11-21 已部署到 Cloudflare Pages：[pizmob-control.pages.dev](https://pizmob-control.pages.dev/)**（脚本与本地构建逐字节一致，线上还没接板测）。Netlify 免费版额度用完，两次跳过部署（`6b00d381af5c600ed1fa3e23`、`6b01bd85ca01ca66e1aff42c`）；旧地址 [pizmob-control.netlify.app](https://pizmob-control.netlify.app) 停在旧版（最后成功部署 `6af96a7e02fc27e8919b6e71`） |

11-15 核对（RF 之前）：当前源码的所有头文件与 idle 构建副本一致（去掉 Arduino 行号标记）；主程序只多了构建自动生成的函数声明。effects 构建的帧编码器、色彩表、长亮／狂闪／彩虹计划、检测器仍与当前源码一致，行指令解析和主循环有后续 idle 改动。因此**编译当前源码不会得到板上的 effects 旧版**。

设备是否仍插着、网页是否占用串口、线上访问状态都需要在真正操作时重新检查；本次不把历史记录当实时连接保证。

## 2 用户偏好和产品边界

用户希望中文、简洁、主动完成已授权工作，避免重复确认或重复测已经确认的结果。实体观察、浏览器 USB 选择和音轨共享选择可能需要用户配合。

- React + TypeScript 本地控制台，深色霓虹风格，MacBook／iPhone／Android 响应式布局。
- Simple Mode：RGB／HEX、亮度、速度、效果、手环外观和 Music Sync；Advanced DJ：频谱、频段、BPM、beat/drop 启发式检测、场景及音频输入。
- Song shows：既能为指定歌曲编排节目，也能随任意音乐实时跟拍；本地音频分析生成可编辑 cue。
- 预览固定为**白色外壳、无 band、内部两颗 LED**；外壳保持白色，内部光自然透出。
- Simple Mode 的任意屏幕颜色／效果不自动等于实体输出；实体控制走显式设备指令和固件能力判断。
- 当前没有两颗 LED 分别寻址的已验证实现。Taylor Swift／The Weeknd 是外观样式，不是协议兼容性选择。
- RF：433M CC1101 已通过 SPI 只读检测。Wave2 Gen 3 的 27.138266 MHz 晶振与 HopeRF 的 433.92 MHz 参考值相同，但实测接收在 922.36 MHz（见下）；U1 型号待证。2026-11-20 晚间结果：
  - 433.92 MHz、10 dBm 下，先发 35 秒唤醒帧，手环才响应；醒着时绿、蓝、红 5 秒短发都能点亮。但有效距离只有约 2–3 cm，1 米处不亮。USB 拔插后同一固件失灵，重插 CC1101 的线后恢复。
  - 查过马来西亚规定，用户同意后改到 922.36 MHz（同样 10 dBm、唤醒加红色）：约 30 cm、1 米、3 米都亮；同位置改回 433.92 MHz，30 cm 不亮。
  - 结论：**手环在约 922.36 MHz 接收**，在马来西亚 919–923 MHz SRD 频段内。3 米只是下限（433 板在 922 MHz 功率打折），精确中心频率未测。
  - 测试固件现在只允许 433.10–434.70 和 919.10–922.90 MHz，最高 10 dBm。
  - 下一步可测 922 MHz 的其它颜色、短发和频率范围；换 868/915 MHz 版 CC1101 会更合适。
  - **11-20/21 正式控制器 IR+RF 同发**（用户要求“RF 和 IR 同一时间亮”）：每个灯光 IR 帧同时以 922.36 MHz、10 dBm 发 RF，两帧同时结束；RF 帧在灯仍亮时最多重发 3 份、间隔 50 ms；空闲时每 2 秒发 3 帧“nothing”保活（默认板子通电时一直保活；睡眠可选，见下方“RF 睡眠”）；`@R1`／`@R0` 开关、`@RW` 唤醒 35 秒、`@RK<ms>` 保活间隔、`@RS<s>` 睡眠时间（板子记住）。回执在 IR 帧和第一份 RF 之后发出（中位 50 ms）。
  - 结果（用户肉眼，挡住 IR）：手环醒着时单个快闪 5/5 点亮，安静 90 秒后仍亮；RF 关时挡住 IR 不亮（排除 IR 漏光）；RF 停 14 秒后 13 秒 RF 叫不醒；只发“nothing”唤醒 33 秒后单发没亮（未解释）。不挡 IR 时 IR+RF 与只有 IR 看起来一样。
  - **INMP441 麦克风已被用户移除**，麦克风音乐模式现在读到 0，测不了。
  - 空闲彩虹：11-21 按用户要求设为 Off（`@I0`，重启读回）。开机和停止后都不跑彩虹。
  - **RF 睡眠（11-21）**：
    - 用户先要求“也停 RF 保活，然后设5分钟才睡眠”，做成 `beat-rf-sleep-build`：最后一个灯光或唤醒结束 5 分钟后不再发 RF。串口计数验证了停发和下一个灯光的自动唤醒（35 秒）。第一次检查被网页中途连入打断，串口检查脚本须独占端口（`TIOCEXCL`）。
    - 用户随后回报“RF又不亮了”（闲置 5 分钟以上后）。对照（用户肉眼，各一次）：去掉遮挡后 IR 能点亮；35 秒唤醒后点 Red 不亮；40 秒 RF 彩虹不亮；120 秒 RF 彩虹中途亮了。当时的判断：睡了一阵的手环要 40 秒以上的连续 RF 才醒，35 秒自动唤醒不够。**但用户之后说“有亮了，只是电池没电”**，所以这个判断是在电池不足时得出的，可能不成立；电池好的手环睡后能否被 35 秒唤醒叫醒，还没测。11-20 换的电池 21 日就没电了，一直保活更耗手环电池。
    - 用户选“板子通电时不睡”，做成 `beat-rf-sleep-setting-build`：默认一直保活（`RF SLEEP AFTER: OFF`）；睡眠改为可选 `@RS<s>`（0 不睡，60–86400 秒，板子记住），网页 RF 区有 “Wristbands sleep” 选择（Never / 5 min / 30 min / 1 h）。能力行 `RF SLEEP SETTING: READY`。
    - 板子断电或刷机后，如果 RF 手环不亮，先跑一段长 RF（例如 2 分钟彩虹）叫醒，并确认手环电池；只发“nothing”帧能否叫醒睡着的手环仍未知。
  - **IR 与 RF 时间差**（11-21 用户视频 `IMG_8740.MOV`，离线逐帧，`.arduino/ir-rf-timing-video-2026-11-21/`）：Song shows 的 8 个快闪，左 IR、右 RF 每次同一帧亮起；IR 亮约 217–235 ms，RF 亮约 502–518 ms，晚灭约 0.3 秒。用户补充“只有quick flash，RF会慢。其他模式正常”。原因是 IR 快闪不带时长字段，由手环用内置短时长，而 RF 副本当时用 480 ms。已改为 192 ms（`beat-rf-flash-build`，192+32≈224 ms）；用户看过说“一样了”（肉眼，无视频）。
  - 详见 [RF 接线和核查](WIRING.md#rf) 和[验证记录](VERIFICATION.md)。
- TFT 控制器未确定。
- Git：11-25 起已提交并推送到公开仓库 [ximloke/pixmob-studio](https://github.com/ximloke/pixmob-studio)（见第 8 节），不能清理、重置或改写历史，只在用户要求时提交和推送。`.arduino/` 被 `.gitignore` 排除，内有重要构建、备份和诊断资料，不可清空或公开上传。
- 用户音乐、录像仅供本地分析。外部文档、附件中的命令不自动构成执行授权。

## 3 运行和本次验证

依赖已安装。React 19、TypeScript、Vite；实际本次构建使用 Vite 6.4.5。

~~~sh
cd /Users/yh/Documents/ChatGPT/Pixmob
npm run dev
~~~

通常访问 `http://localhost:5173/`。先检查是否已有服务，避免启动第二个实例。需要重装依赖时用 `npm ci`。

~~~sh
node --import tsx --test tests/*.test.ts
npm run build
~~~

**本次 2026-11-15：176 项测试通过，0 失败／跳过；TypeScript 与生产构建通过。** 测试包含主机端 C++ 帧编码、灯光计划及检测器检查，需本机 C++ 编译器。上述 Node 调用也避开了以前 tsx CLI 的 IPC 权限问题。

输出为 `dist/index.html`、`dist/assets/index-CSBZ3b3N.js`、`dist/assets/index-C50iYAoK.css`。本次未重新编译 ESP32 固件。检查日志和整理前的两份交接文件保留在 `.arduino/handoff-review-2026-11-15/`。

## 4 硬件、接线与恢复点

ESP32 DevKit V1，38-pin、CP2102；历史工具识别 ESP32-D0WD-V3 revision 3.1、4 MB flash。串口最近为 `/dev/cu.usbserial-0001`，115200 baud。

| 部件 | 接线 |
| --- | --- |
| KY-005 IR | **GPIO32** |
| INMP441 BCLK／SCK | **GPIO26** |
| INMP441 WS | **GPIO25** |
| INMP441 SD | **GPIO27** |
| INMP441 L/R | 原有接地／左声道接法，保持供电和接地不变 |

I2S 16 kHz、32-bit mono left。不要套用另一套 Studio JSON 固件的 IR GPIO33。

### 保留的关键二进制

本次重新计算了下列二进制的 SHA256，与记录一致。文件大小是 bin 长度，不是编译器报告的程序占用。

| 构建目录（均在 .arduino 下） | 状态 | bin 字节 | SHA256 |
| --- | --- | ---: | --- |
| beat-rf-flash-build | **板上版本**（11-21）：当前源码；RF 快闪保持 192 ms（视频里 IR 快闪约 220 ms、原 RF 约 510 ms） | 357760 | 9a137a9e2ab918d3cd296406e93fec4d3f9cf39faa12dd7e9a5dab5481724709 |
| beat-rf-sleep-setting-build | 上一版（11-21）：RF 默认一直保活，睡眠可选（`@RS<s>`，`RF SLEEP SETTING: READY`），RF 快闪仍 480 ms；退回点 | 357760 | 7bdc6967d51099f2fa0596e9bfb597db5eab4895097c3514f330b1e0a58c6c11 |
| beat-rf-sleep-build | 上一版（11-21）：固定“最后一个灯光 5 分钟后停 RF 保活、下一个灯光唤醒 35 秒”，睡久的手环叫不醒；退回点 | 357312 | 31c2184a0cd59cff8633c2600a03995ed270542bc406a86278b41a63301b079d |
| beat-rf-output-build | 再前一版（11-21）：默认输出三选一（@R1/@R0/@R2），每条灯光 /I /R /B，彩虹 RF 保持 480 ms，RF 一直保活（无睡眠设置） | 357040 | cc1acc7d588fa05f93e232aee6aaf53ad5038393a2b30bd08e9424eaab0a0ae1 |
| beat-rf-ack-build | 上一版（11-21）：IR+RF 同发，回执在 RF 重发之前；退回点 | 356416 | 2355930ad9d639af54e8b817f8b7da33acd7d1bff1f1698de211f712a287f0c5 |
| beat-rf-copies-build | RF 重发 3 份的中间版，回执慢（约 150 ms） | 356368 | 6420d942c372242e72b13aefd48d8700211d7e49c095cf5c8f0de7c4260c8af8 |
| beat-rf-build | 首个 IR+RF 版，每帧只发 1 次 RF | 355584 | 25d01348b15f791e2f01f831b78d69742220d359a1238e490826db5952e4b1fe |
| beat-effects-build | RF 之前的退回点（11-15 至 11-20 的板上版本） | 316336 | d29ae6b0e114d01771e3aac4e86ceb19ceaa095922f73b15db7482da44d9cdd4 |
| beat-idle-build | 开机／空闲彩虹和呼吸灯；源码当前版本，已退回 | 327408 | 4a92bbf40acca1af5fd9377b9fd289be1c9bae24e1d4d886209a57ace8db7c32 |
| beat-breathe-build | 只有开机彩虹和呼吸灯的中间版，已退回 | 324976 | acae1a860316c7572b7e6cc81f92857d9e30bbec278654d6a60ebad1064f197f |
| beat-rainbow-build | 首个手动彩虹版本 | 314800 | 1bc892e7006208b2ae7f8a9132c6165e906687a63365c11e042d3d903dfb3039 |
| beat-custom-build | 自定义颜色和渐变版本 | 313744 | 912fa9362ac8eb28353df5c101eba5e8df62ace2714119b430b0c72e17285711 |
| beat-single-frame-build | 早期单帧版；White 仍是原 WHITISH，不是当前恢复首选 | 310208 | 2ec5efacf5223f808387aa30ef1194f2e3ae0b0829da067cfc6c6d491d9101f4 |
| rf-922-test-build | RF 台架测试（433／919–923 MHz），11-20 在 922.36 MHz 从 3 米点亮；不是正式固件 | 296624 | 75049e2cfabb3026b5a80b7c8bb9b466d5d9ec6ab16d92ac636b6999b9520a40 |

每个目录内应用名是 `PixMobBeatController.ino.bin`，`sketch/` 留有该次源码构建副本。还有 hold、levels、strobe 等中间构建；完整历史在 [验证记录](VERIFICATION.md)。

### 实际读回备份

| 相对项目路径 | 内容 | SHA256 |
| --- | --- | --- |
| .arduino/backups/2026-11-12-before-white-candidate-app.bin | 327680 字节应用区 | 1212611b4a1fc09f4448008c6f2ecd9d2f4eeb6f5a33d824a5c0270d163d2ddb |
| .arduino/backups/2026-11-12-before-single-frame-app.bin | 327680 字节应用区 | 7c01fc9dffd22e3c53ab4e1103c7bac93133f412fec2142c3c71f5168248d754 |
| .arduino/backups/2026-11-11-before-music/esp32-rgb-full.bin | 原 RGB 固件完整 4 MB flash | a4b9a566ab344ff256953f36da423f6e4ef6c7c3c1502b5d05c8eda722d9837f |

完整 flash 与应用区不能互换写入偏移。已有应用上传用 `0x10000`、57600 baud，写后校验；高速读取曾损坏。后续每次上传前都要确认板上状态和可恢复点，**不要为了交接自动刷机**。

Arduino-ESP32 3.3.12、IRremote 4.7.1。工具：

- Arduino CLI：`/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli`
- 配置：`.arduino/arduino-cli.yaml`
- IRremote：`/Users/yh/Documents/Arduino/libraries/IRremote`，编译需显式带外部库目录。
- esptool：`/Users/yh/Library/Arduino15/packages/esp32/tools/esptool_py/5.3.1/esptool`

编译当前源码时使用**新的输出目录**，不要覆盖上表恢复点：

~~~sh
'/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli' compile \
  --config-file .arduino/arduino-cli.yaml \
  --libraries /Users/yh/Documents/Arduino/libraries \
  --fqbn esp32:esp32:esp32 \
  --build-path .arduino/next-review-build \
  firmware/PixMobBeatController
~~~

这只是编译示例，不是恢复 effects 版或上传指令。若目录已存在，另选新名字。Chrome、Serial Monitor、CLI 不能同时占用串口。

## 5 当前实体协议和颜色

连接时选择 **Preset controller (your sketch)**。不要用 Studio JSON、Wi-Fi V2 或向字符解析器试发 JSON／STATUS。

| 指令 | effects 板上版本的含义 |
| --- | --- |
| X | 停止模式和续帧，必要时发送短包络提前熄灭。用户已确认 Stop 能立刻熄灭；非光学定时测量 |
| R/G/B/Y/C/W/K | 单次预设闪光；Color sent 回执 |
| .M / .<颜色> | 洋红或任意支持颜色的单次闪光；单字符 M 本身仍是 Music |
| #<颜色><ms>[,<in>,<out>] | 定时长亮，50–600000 ms 是全亮时间，渐亮渐灭加在前后 |
| !<颜色><ms> / ^<颜色><ms> | 匀速狂闪／加速狂闪，200–60000 ms |
| ~<ms>[,<cycle ms>] | 手动彩虹，总时间 500–600000 ms；一圈 1000–20000 ms，默认 3000 |
| @F / @L<ms>[,<in>,<out>] / @S<ms> | Auto、Music、Host 共用的节拍样式；长亮 50–10000 ms，狂闪 200–5000 ms；不退出当前模式 |
| @P<letters> / @P* | 1–8 个预设颜色／恢复模式默认颜色组 |
| A / M / H | Auto／ESP32 麦克风 Music／Browser Host |
| 1–8 | 仅 Host 接受，依次 R/G/B/Y/C/M/W/K |
| *<颜色> | 仅 Host 接受，按当前节拍样式显示指定颜色，用于视频颜色同步 |
| V / +/- | 无 IR 的麦克风诊断／独立麦克风灵敏度 |

行指令以换行结束；颜色可以是预设字母或 `=RRGGBB` 协议电平。网页限制每通道 0–200、步长 4、至少一个通道 ≥8；这不是校准 sRGB，更不保证所有中间色都能稳定显示。渐变码 0–7 对应 0／32／96／192／480／960／2400／3840 ms，网页提供其中的支持选项。

| 预设 | R/G/B 电平 |
| --- | --- |
| R | 132/32/0 |
| G | 88/164/0 |
| B | 16/12/160 |
| Y | 132/124/0 |
| C | 68/184/160 |
| M | 180/76/120 |
| W | 124/124/124 |
| K | 124/108/56 |

来源表为 `ColorLevels.h`，原始波形在 `OriginalFrames.h`。额外颜色为 Orange 132/64/0、Sky blue 68/72/160、Ice blue 104/132/160、Hot pink 160/12/136；用户确认这些颜色效果。Lime 和 Pink 因与 Green／Magenta 看不出区别，**已按用户要求移除**，不能重新加回当新功能。自定义颜色可保存，最多 24 个。

普通手动／歌曲 quick flash 与 Music／Host quick flash 单帧；Auto 的 quick flash 保留三帧和 80 ms 间隔。长亮、狂闪和彩虹本身由多帧计划完成，不能统称为“所有命令单帧”。独立 IR worker、单任务 mailbox、模式取消防止积压；已开始的一帧可能完成。

当前源码额外有 `@I<s>`：0 关闭、1 仅开机、2–3600 为空闲秒数，Preferences 保存；Auto 会等待长亮及渐变结束。网页 Breathing colors 用 `@L5000,5,5`、颜色组和 A，每色约 6.9 秒。**板上 effects 版不具备这些后续行为**；网页仅看到 IDLE 能力行才显示它们。idle 源码里的空闲是 Manual 且 IR／定时灯结束、指定时间无串口或 IR 活动；Host 不会仅因关网页而变成空闲。歌曲输出每秒的裸回车保活只在支持该能力的设备发送。

## 6 已有功能和证据

### White 和长亮

原 WHITE 与上游 WHITISH 完全相同，公开 IR 解码为 204/176/92；W 没有误路由到 Y。11 月 12 日上传等通道白候选，13 日用户确认更白。随后把 White／Green／Warm white 等降低为上表电平，用户确认亮度足够且能区分。**当前 W 已不是 204/204/204，K 也不是原始 WHITISH 帧**。[White 审计](WHITE_IR_AUDIT.md) 保留来源和演变过程。

独立 hold 测试 v1–v4 和用户录像显示，完全相同的指令重复发送会被忽略；采用交替 release 及最强通道减 4 后，用户确认持续亮。正式版本的定时秒数、渐亮渐灭、狂闪／加速狂闪及 Stop 已获用户反馈。调低电平有效并不能证明电池／供电是根因，未测电压、未更换电池做对照。

### 实时音乐和视频

Browser song sync 捕获共享音乐音轨，AudioWorklet 检测实际 PCM 攻击；过期事件和忙时事件丢弃，不排队补闪、不用固定 BPM 定时器造拍。用户确认暂停就停、恢复就闪。80 BPM 4/4 测试曾手动降到 45% 得到每拍一次；之后默认 Automatic sensitivity，换 BPM 后用户确认自动跟随正常。

自动灵敏度只影响浏览器检测。ESP32 麦克风保持原接线，嘈杂环境暂停音乐仍会触发；没有受控安静测试，不要宣称环境噪声抑制已解决。

Browser、Auto、ESP32 mic 模式现在可用所选长亮／渐变或狂闪节拍样式和颜色组，用户确认效果对。共享视频取色在每拍采样 32×18 画面，映射到六色电平路径；暗画面退回颜色组、亮无色画面发白色。用户确认真实视频下颜色“大致跟着”。这是全画面近似主色，不是屏幕像素精确复现。

### Song shows

- 16 个本地节目，每个最多 **1024 cues**，总存储字符串预算 1000000；音频不保存，刷新后重新选文件。
- cue 支持预设／自定义电平、长亮、渐变、狂闪、加速狂闪和彩虹；数据包含 holdMs、strobe、levels、fadeInMs、fadeOutMs、rainbowMs。
- 独立约 20 ms silent AudioWorklet 时钟使用实际歌曲播放位置；不依赖预览刷新。后台被浏览器／系统暂停仍可能中断。
- 旧版内部转发丢掉效果参数的问题已由 `createSongCueRelay` 修复，用户 11 月 14 日确认从 Song shows 播放效果都起作用。
- Device lead 默认 **70 ms**（0–200），只提前实体 cue、预览仍跟播放时间。用户从 40 调到 70 后确认合拍；已有保存值保留。歌曲名称、cue 来源和光学延迟未记录，不要把 70 当所有设备／歌曲的测量值。
- 离线分析已改为三频段谱通量、自相关估计周期、动态规划节拍链、攻击上升沿吸附和静音网格剔除；无稳定节拍回退攻击点。限制 100 MB／10 分钟／mono 或 stereo。
- 本地 Blinding Lights 记录约 172 BPM、563 拍、confidence 0.67；对探索脚本网格的中位偏差约 9 ms 是离线参考比较。后来的实体合拍反馈未注明是否用该歌／该分析结果，不能合并成该算法已被光学验证。
- 单色模式可用 Apply pattern 修改当前节目。超过 cue 上限按 2 的幂抽稀；没有已验证的小节首拍／歌曲结构识别。
- 11 月 15 日编辑界面改版：顶部固定播放／时间／Tap／发送；笔刷可轮流多色；Shift 范围选择，批量颜色／灯光／亮到下个 cue；紧凑 cue 行，额外设置藏在省略菜单；Show file 导入导出／删除；T 打点、空格播放，Follow playback。编辑及普通跳转保持播放，Reset 停止。
- 237 cue 的浏览器检查和 375 px 窄屏检查已记录；用户尚未反馈改版体验。检查时没有保存测试修改。

## 7 彩虹暗段（2026-11-20 换电池后已正常）

11 月 13 日用户曾确认手动彩虹顺滑。11 月 15 日：

1. `IMG_8620.MOV` 显示开机彩虹每 3 秒一圈，部分颜色短闪、部分区间全暗。用户要求退回呼吸灯前版本。
2. 核对帧编码器、色彩表、彩虹计划和发送代码与之前版本一致；按要求退回 effects 版。
3. `IMG_8621.MOV` 显示旧版手动彩虹（一圈约 10 秒）仍在类似颜色区间闪烁：橙黄、青到蓝紫能亮，黄到绿约每 0.23 秒短闪，洋红到红多为暗，录像估计约 38% 时间亮。
4. 因此暗段不能归因于新增呼吸灯／空闲逻辑；青色通道和大却能亮，也不支持仅用总电平过高解释全部现象。**根因尚不明确。**
5. 用户当时决定：**先保持旧版**。未重新上传 idle 版。
6. **2026-11-20 用户回报：换了新电池后，彩虹和全部颜色都正常了**，判断原因是电池没电。这是用户肉眼观察，没有测电压；板上固件没有变（仍是 effects 版）。之前按弱电池调低的电平没有在新电池下重新比较。呼吸灯／开机及空闲彩虹的 `beat-idle-build` 仍未上传，是否上传由用户决定。

`RainbowPlan.h` 每 120 ms 一帧、sustain 192 ms，沿 R/Y/G/C/B/M 插值；生成结果与上一帧相同会把最强通道减 4。这是已实现的计划，不等于所有中间帧都已验证被手环持续显示。

## 8 浏览器存储、线上与本地

**GitHub（11-25 起，用户选“公开+Pages”）：**
- 公开仓库 [ximloke/pixmob-studio](https://github.com/ximloke/pixmob-studio)。`.github/workflows/pages.yml` 每次 push 到 `main` 都自动构建（base `/pixmob-studio/`），并发布到 [ximloke.github.io/pixmob-studio](https://ximloke.github.io/pixmob-studio/)。
- 11-25 首次部署：
  - 构建和发布都通过。
  - 页面 HTTP 200，脚本与本地用同样参数的构建逐字节一致。
  - 内置浏览器打开无报错。
- 这个地址的浏览器存储与 Cloudflare 地址互不相通。
- 提交作者用 GitHub 用户名和 noreply 邮箱，只写在本仓库的配置里。

**Cloudflare 地址（11-21 起）：[pizmob-control.pages.dev](https://pizmob-control.pages.dev/)**，Cloudflare Pages 项目 `pizmob-control`，生产分支 `main`。wrangler 已在这台电脑上登录用户的 Cloudflare 账户（过期时用 `wrangler login` 重新授权）。11-21 检查：首页 HTTP 200，脚本与本地 dist 逐字节一致，内置浏览器打开无报错；线上还没接板测。重新发布：`npm run build`，只把 dist 产物复制到项目外的干净目录，再运行 `npx -y wrangler@4 pages deploy <目录> --project-name pizmob-control --branch main --commit-dirty=true`。项目已建好，不要再加 `--force`：它只在第一次创建时用过，因为新版 wrangler 的 `pages project create` 默认转去 Workers。

旧地址 [pizmob-control.netlify.app](https://pizmob-control.netlify.app)（站点 ID `5c7ede05-d633-4bf8-a8a2-6a27fd312c21`）停在旧版：免费版额度用完，11-21 两次部署都被跳过。最初创建名为 wristband-show-studio，后来被用户改名。最初部署因团队登录保护返回 401，助手没有看到线上页面；本次未查询保护设置或重新访问线上，因此不承诺当前公开可访问。

Netlify 和 Cloudflare 都只从项目外干净目录上传 dist 三个文件，没有上传源码、文档、固件、备份、音乐和录像。以后若用户要求发布，先构建，再仅发布产物，不要从项目根目录整目录上传。

节目和设置按浏览器、网址分别存储：

| 数据 | localStorage key |
| --- | --- |
| 节目 | pixmob-song-shows-v1 |
| 自定义设备颜色 | pixmob.deviceColors.v1 |
| Device lead | pixmob-song-hardware-lead-ms |

用户此前要求保留“14/11 coding half version”，验证记录随后记载用户已自行删除其它节目。助手未读取当前 Chrome 存储，不推测现存内容。11-21 换到 pages.dev 是新网址，那里开始没有已存的节目、自定义颜色和提前量（提前量用默认 70 ms）。通过 Export show to file／Import show file 迁移 `.pixmob-show.json`，文件不含音频；保存颜色和提前量也不会随项目目录或节目导出自动迁移。删除按钮需用户确认。

浏览器 USB 及共享音频按能力和权限判断；使用已验证的桌面 Chrome 路径。手机可以使用响应式界面和模拟器，不能把它们视作已验证 USB／系统音频硬件控制端。当前 effects 固件没有 HTTP 控制 API；项目另有 JSON／Wi-Fi 实现，不代表这块板已运行它们。

## 9 代码和资料地图

| 路径 | 作用 |
| --- | --- |
| src/App.tsx、src/PresetControls.tsx | 连接、模式、实体 live control、节目与音频编排 |
| src/lib/presetSerial.ts | 当前字符／行协议、能力、回执、队列与取消 |
| src/lib/deviceColors.ts、src/lib/screenColor.ts | 自定义电平、保存颜色／共享视频主色 |
| src/lib/audio.ts、src/lib/beatWorklet.ts、src/lib/browserBeat.ts | 音频采集、实时检测、自动灵敏度、实体 beat 输出 |
| src/SongShows.tsx、src/songShows.css | 新节目编辑界面 |
| src/lib/songShow.ts、src/lib/songClock.ts | cue 模型、存储／导入导出、完整参数转发、音频时钟 |
| src/lib/songRhythm.ts、src/lib/autoSongCues.ts | 离线节拍分析、草稿及批量灯光处理 |
| src/lib/effects.ts、src/lib/devicePreview.ts、src/style.css | 模拟灯效、设备事件预览、白壳两颗 LED |
| firmware/PixMobBeatController/ | 当前较新的派生固件源码；LightCommand、PixMobFrame、ColorLevels、LightPlan、StrobePlan、RainbowPlan、BeatDetector |
| firmware/PixMobPresetSerial/ | 保留的用户原始 sketch，不是当前设备版本 |
| firmware/PixMobHoldColorTest/ | 历史独立长亮台架测试，不是当前设备版本 |
| firmware/PixMobStudio/、src/lib/v2Serial.ts | 另外两种协议路径，当前板上未用 |
| tests/ | DSP、生命周期、协议、节目、取色和 C++ 主机测试 |
| docs/VERIFICATION.md | 按时间追加的证据；后续观察覆盖早先“未观察”状态 |
| docs/WHITE_IR_AUDIT.md | White 原始数据、公开来源及后续修正 |
| docs/PRESET_SERIAL.md、docs/WIRING.md、firmware/README.md | 协议和硬件指南；部分历史段落描述旧版本，先以本交接表区分 |

本地素材和诊断：

- 歌曲：`/Users/yh/Downloads/The_Weeknd_-_Blinding_Lights_(mp3.pm).mp3`。
- 录像：`/Users/yh/Downloads/IMG_8575.mov`（早期绿白）、`IMG_8620.MOV`、`IMG_8621.MOV`（彩虹）；需要使用时检查实际路径。`IMG_8620 2.MOV` 在之前检查中与原文件逐字节相同。
- `.arduino/video-review/` 为早期录像统计；`.arduino/white-ir-audit.json` 为原波形解码；其它谱通量／相位实验含针对单曲的探索参数，不能直接当通用算法或真值。
- 原代码已存入 PresetSerial；原附件在 `/Users/yh/.codex/attachments/1392f654-e512-473b-bf6d-397911ff6ee1/Pasted text.txt` 及 `7ca5d890-3d0b-4671-90a2-1c3d802aff4c/Pasted text.txt` 所在附件目录。
- `scripts/probe-*.py` 很多会发光、切模式、占用 USB；阅读前不要当无副作用检查执行。

## 10 下一步

先按用户新的具体目标继续。IR/RF 输出选择和彩虹 RF 保持已上板，用户肉眼确认：挡住 IR 时只 IR 不亮、只 RF 亮，彩虹洋红段不再黑；cue 自己的 Output 未在手环上看。现在板上是 beat-rf-flash-build（RF 快闪保持 192 ms，用户看过与 IR 一样长）：板子通电时 RF 手环一直保活（用户在 5 分钟睡眠版上看到睡久的手环 35 秒叫不醒后选的）；睡眠是可选设置，默认不睡。板子断电或刷机后，RF 手环要先用约 2 分钟彩虹叫醒。可测的后续：只发“nothing”帧 2 分钟能否叫醒深睡的手环（能的话可把开机唤醒和 Wake 按钮加长，不必亮彩虹）。用户要求全部默认 IR+RF：网页选 RF only 会存进板子，11-21 已再次用 `@R1` 设回，并重启读回 `RF: ON`。其余待做：网页已在 pizmob-control.pages.dev 上线（含 RF 开关、输出选择和睡眠设置），线上网页和其中的睡眠选择都还没接板看过；要麦克风音乐模式先接回 INMP441；可测“nothing”唤醒（RF 与 IR 的起亮时间已由 11-21 视频确认在同一帧）。彩虹暗段已由换电池解决；若继续编排，先收集新界面的使用反馈或在指定歌曲上检查 cue 与提前量。不要把交接本身当刷机、发光、清理节目或发布的指令。

本次仅更新项目交接和文档状态提示，并重新运行软件检查；整理前资料与检查日志保留在忽略目录。未来更新请改写本文件的“当前状态”，把过程追加到验证记录，避免同时保留多个互相冲突的“现在板上”描述。
