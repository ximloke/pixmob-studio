# PixMob Studio 接手入口

更新：2026-11-21，Asia/Kuala_Lumpur。先完整阅读 [当前交接资料](docs/CLAUDE_HANDOFF.md)，需要历史证据再看 [验证记录](docs/VERIFICATION.md) 的相关日期。

继续这个文件夹里的已有项目：`/Users/yh/Documents/ChatGPT/Pixmob`。用户希望中文、简洁、直接推进；不要重新创建项目。

## 当前状态

- **板上是 `.arduino/beat-rf-flash-build/`**（SHA256 `9a137a9e2ab918d3cd296406e93fec4d3f9cf39faa12dd7e9a5dab5481724709`，2026-11-21 写入并校验）：当前源码。默认每个灯光同时发 IR 和 922.36 MHz RF（用户要求全部默认 IR+RF；网页选 RF only 会存进板子，11-21 两次测试后板上留在只 RF，都已用 `@R1` 设回并重启读回 `RF: ON`）；可设为只 IR 或只 RF（`@R1`/`@R0`/`@R2`，板子记住），每条灯光指令也可加 `/I` `/R` `/B` 单独指定；彩虹的 RF 帧保持 480 ms；RF 快闪保持 192 ms（见下方“IR 与 RF 时间差”）；板子通电时 RF 手环一直保活，睡眠是可选设置（见下方“RF 睡眠”）。上一版 `beat-rf-sleep-setting-build`（`7bdc6967…6c11`，RF 快闪 480 ms）是退回点，再前是 `beat-rf-sleep-build`（`31c2184a…079d`，固定 5 分钟后睡）、`beat-rf-output-build`（`cc1acc7d…0aae1`，一直保活、无设置）和 `beat-rf-ack-build`（`2355930a…f0c5`）；RF 之前的退回点是 `beat-effects-build`（`d29ae6b0…cdd4`）。
- **IR+RF 同发（2026-11-20/21，用户肉眼）**：RF 帧与 IR 帧同时结束，灯仍亮时最多重发 3 份（间隔 50 ms）；空闲每 2 秒发 3 帧“nothing”保活；`@R1`／`@R0` 开关、`@RW` 唤醒 35 秒、`@RK<ms>` 保活间隔、`@RS<s>` 睡眠时间，板子记住。挡住 IR 时，手环醒着单个快闪 5/5 点亮、安静 90 秒后仍亮；RF 关时挡住 IR 不亮；RF 停 14 秒后 13 秒叫不醒；不挡 IR 时与只有 IR 看起来一样。回执中位 50 ms。规则在 `RfPlan.h`，详见 [验证记录](docs/VERIFICATION.md)。
- **IR 与 RF 时间差（11-21 用户视频 `IMG_8740.MOV`，离线逐帧，`.arduino/ir-rf-timing-video-2026-11-21/`）**：Song shows 的 8 个快闪，左 IR、右 RF 每次在同一帧亮起（60 fps 下差 0）。但 IR 只亮约 220 ms，RF 亮约 510 ms，晚灭约 0.3 秒。原因：IR 快闪是不带时长的 6 字节指令，由手环用内置短时长；RF 副本当时用 `RF_FLASH_SUSTAIN` 480 ms。用户补充“只有quick flash，RF会慢。其他模式正常”。已改为 192 ms（192+32≈224 ms，`beat-rf-flash-build`，串口读回正常）；用户看过说“一样了”（肉眼，无视频）。
- **INMP441 麦克风已被用户移除（2026-11-21）**，麦克风 Music 模式现在测不了。
- **空闲彩虹已关**（11-21 用户要求，`@I0`，重启读回 `IDLE RAINBOW: OFF`）：开机和停止后都不再自己跑彩虹，IR、RF 手环都暗。
- **RF 睡眠**（11-21，规则在 `RfPlan.h`）：
  - **现在默认不睡**：板子通电时 RF 手环一直保活（`RF SLEEP AFTER: OFF`）。串口计数验证（无肉眼）：临时 `@RS60` 在唤醒结束 60 秒后停发；改回 `@RS0` 并发灯光后，唤醒结束 79 秒仍在保活；重启读回 OFF。网页上的新选择还没接板看过。
  - 用户要求过“5 分钟后睡眠”（`beat-rf-sleep-build`，串口计数验证了停发）。之后回报“RF又不亮了”：闲置 5 分钟以上后，35 秒唤醒和 40 秒 RF 彩虹都叫不醒，120 秒 RF 彩虹中途才亮；去掉遮挡 IR 能亮（用户肉眼，各一次）。
  - 所以用户选了“板子通电时不睡”。睡眠留作可选：`@RS<s>`（0 不睡，60–86400 秒，板子记住），网页 RF 区 “Wristbands sleep”，能力行 `RF SLEEP SETTING: READY`。设了睡眠的话，下一个灯光只唤醒 35 秒。
  - **之后用户说“有亮了，只是电池没电”**：上面“睡久要 40 秒以上 RF 才醒”是在手环电池不足时测的，可能不成立。电池好的手环睡后能否被 35 秒唤醒叫醒，还没测。11-20 换的电池，21 日就没电了；一直保活会让手环的 RF 接收一直开着，更耗电。
  - 板子断电或刷机后，如果 RF 手环不亮，先跑一段长 RF（例如 2 分钟彩虹）叫醒，并确认手环电池。只发“nothing”帧能否叫醒睡着的手环还不知道。
  - 串口检查时要独占端口（`TIOCEXCL`），否则网页能同时连上并干扰，第一次检查就是这样被打断的。
- 网页：实时控制 “Lights go out by: IR and RF / IR only / RF only”，歌曲每个 cue 有 Output（Board setting / IR + RF / IR only / RF only，存进节目文件）。11-21 用户在本地网页接板测过（肉眼，挡住 IR，各一次）：只 IR 点 Red 不亮，只 RF 点 Red 亮；cue 自己的 Output 还没在手环上看。**11-21 已上线到 Cloudflare Pages：`https://pizmob-control.pages.dev/`**（Netlify 免费版额度用完、两次跳过部署后，用户要求换免费平台）。线上脚本与本地构建逐字节一致、打开无报错，但线上还没接板测。本地 `npm run dev` 的 localhost:5173 仍可用。两处都在用户自己的 Chrome 里连接（应用内置浏览器会拒绝串口选择框）。
- **彩虹 RF 熄灭**（11-21 视频，`.arduino/rf-rainbow-video-2026-11-21/`）：只收 RF 的手环每个 3 秒周期在洋红转红处黑 0.1–0.2 秒，IR 手环不黑；推断手环不收其中一两帧，未证实。已把彩虹 RF 保持从 192 改为 480 ms（同版刷入）；用户看过，洋红段不再黑（肉眼，一次，无视频）。
- **CC1101 已接好**（2026-11-16 只读检测）：蓝色 433M V2.0 模块，排针 1 GND、2 3V3、3 GPIO4、4 GPIO5、5 GPIO18、6 GPIO23、7 GPIO19、8 GPIO22（见 `docs/WIRING.md`）。没有 CC1101 时固件只发 IR。
- **手环识别（2026-11-20）**：PixMob Wave2 Gen 3，CEMENT V1.1r3，晶振 27.138266 MHz（与 HopeRF 的 433.92 MHz 参考晶振几乎一致），但**实测在约 922.36 MHz 接收**（见下条），与 LH 公式 RF =（N − 1/80）× 晶振的 N=34 计算一致，落在马来西亚 919–923 MHz SRD 频段。精确中心频率和带宽未测，U1 型号仍未确认。见 [RF 接线与核查](docs/WIRING.md#rf)。
- **RF 控制（2026-11-20，用户肉眼，每项一次）：** 用 `PixMobRFTest`、10 dBm，先用 `Z` 发 35 秒公开唤醒帧再发 5 秒红色。
  - **922.36 MHz：约 30 cm、1 米、3 米都点亮。** 同位置只把频率改回 433.92 MHz，30 cm 不亮。3 米只是下限：这块 433 板在 922 MHz 功率会打折，更远没测。
  - 433.92 MHz 的早前结果：只在约 2–3 cm 内点亮，应是贴近时强信号漏进手环。只发 90 秒红色没叫醒（仅一次）；醒着时绿、蓝、红各 5 秒短发都能点亮，自己编码的颜色帧也有效。这些短发和颜色在 922 MHz 还没测。
  - USB 拔插后，连 18:15 点亮过的同一个固件也失灵；按图重插 CC1101 的线后恢复，问题出在接线，不是代码。
  - `PixMobRFTest` 的所有发射走同一条路径：GDO0 在 CC1101 一侧保持高阻，发射前检查 GDO0 线，并有 TX 状态监测。`Z<秒>` 可设 5–90 秒唤醒。922 MHz 测试固件：`.arduino/rf-922-test-build/`（SHA256 `75049e2c…0a40`）。详见 [验证记录](docs/VERIFICATION.md)。
- **源码与板上一致**：`firmware/PixMobBeatController/` 对应 `beat-rf-flash-build`。不要为接手自动上传。
- 当前板上支持预设与自定义颜色、定时长亮、渐亮渐灭、狂闪、加速狂闪、手动彩虹、节拍效果、颜色组、呼吸灯和开机／空闲彩虹。
- **彩虹暗段／闪烁已解决（2026-11-20，用户观察）**：用户给手环换了新电池后，彩虹和全部颜色都正常。用户判断原因是电池没电；这是换电池前后的肉眼对比，没有测电压。11 月 13–15 日按当时电池调低的电平（G/W/K/M、粉色红 ≤180 等）是在电池可能不足时定的，换电池后没有重新比较，暂不改动。恢复后以 IR 点亮作为 RF 对照，结果见上方 RF 测试。
- White 已修正：当前 W 为 124/124/124，K 暖白为 124/108/56。用户确认颜色能区分。原始 WHITISH 波形保留在 `OriginalFrames.h`，当前 K 已不是原始波形。
- 实时 Browser song sync 自动适应节奏已获用户确认；Song shows 效果转发已修复；Device lead 默认 **70 ms**，用户确认真实歌曲看起来合拍，但没有光学延迟测量。
- Song shows 11 月 15 日改版已部署：固定播放栏、笔刷、批量选取、紧凑 cue 行、T 打点、空格播放、跟随滚动。用户尚未反馈新版编辑体验。
- **线上地址 `https://pizmob-control.pages.dev/`**：Cloudflare Pages 项目 `pizmob-control`，生产分支 `main`，wrangler 已在这台电脑登录。
  - 重新发布：先 `npm run build`，只把 dist 产物复制到项目外的干净目录，再运行 `npx -y wrangler@4 pages deploy <目录> --project-name pizmob-control --branch main --commit-dirty=true`。
  - 不要再加 `--force`，它只在第一次创建项目时用过。
  - 旧的 `https://pizmob-control.netlify.app` 停在旧版。本地仍可独立运行。
  - 节目、颜色和提前量存在各网址自己的浏览器存储里，**不会随项目文件夹或换网址迁移**。新网址开始是空的，节目通过导出／导入转移。
- **上游 issue（2026-11-25）**：用户让把 IR+RF 结果分享到 RF 编码器的来源项目，已用用户的 GitHub 账号发了 [sueppchen/PixMob_waveband#10](https://github.com/sueppchen/PixMob_waveband/issues/10)。内容经用户确认，写了 922.36 MHz、唤醒、IR+RF 时间和 CRC 核对，不含名字、邮箱和国家。还没有回复；没有提 PR。
- **GitHub 仓库与 Pages（2026-11-25，用户选“公开+Pages”）**：
  - 公开仓库 [ximloke/pixmob-studio](https://github.com/ximloke/pixmob-studio)，分支 `main`，第一次提交 `658dc20`。
  - 本仓库的提交作者设为 GitHub 用户名和 noreply 邮箱，只写在本仓库的 git 配置里，不暴露 Gmail 和真名。
  - 11-25 按用户要求加了 MIT 许可证（`LICENSE`），版权人写的是 GitHub 用户名 ximloke。`THIRD_PARTY_NOTICES.md` 列出借用的公开资料和各自的许可：danielweidman（MIT）、jamesw343（MIT）、sueppchen 的 pixmob_cement（BSD 声明）。
  - `.github/workflows/pages.yml`：每次 push 到 main 都自动构建（base `/pixmob-studio/`），并发布到 **https://ximloke.github.io/pixmob-studio/**。
  - 11-25 首次部署通过，页面无报错，内容含 11-23 加的 Song shows Cue pads。
  - Cloudflare 那份还是 11-21 的版本，没有 Cue pads；要一致，需再用 wrangler 发布。
  - 两个地址的浏览器存储互不相通。
- **内置节目（2026-11-25，用户要求“把blinding light 放进我的网站，wristband profile the weeknd”）**：
  - 用户的 “blinding light (half version)” 已内置到网站：数据在 `src/shows/blinding-light-half-version.pixmob-show.json`，逻辑在 `src/lib/builtInShows.ts`。
  - 每个浏览器第一次打开 Song shows 时，节目自动加进已存节目，只加一次。
    - 用户删掉后不会再加回（记在 `pixmob-song-shows-built-in-v1`）。
    - 已存的同 id 副本保持原样。
    - 已存节目满 16 个时先不加，有空位再加。
  - 237 个 cue 全用 The Weeknd 手环样式（原文件有 2 个是 Taylor Swift）。
  - 新 cue 的 Preview profile 跟随打开的节目。
  - 已推送到 GitHub Pages，在内置浏览器看过：节目出现，无报错。
  - 音频不在里面，播放时要自己选歌曲文件。Cloudflare 那份没更新（用户说不用）。

## 必须保留的边界

- 保持接线：**IR GPIO32**；INMP441（现已移除）接回时用 **BCLK26 / WS25 / SD27**，原有供电、接地及 L/R 接法不变。
- 网页选 **Preset controller (your sketch)**，不是 Studio JSON 或 Wi-Fi V2。单字符 `M` 是麦克风 Music；手动洋红用 `.M` 等行指令。
- 两颗预览 LED、白色外壳、没有 band；不要把两颗 LED 独立寻址或艺人样式当成已验证协议。
- 串口回执只证明发送完成。用户肉眼反馈、录像、离线分析、自动测试分别记录，不互相替代。
- CC1101 是 433M 模块，在 922 MHz 功率会打折。RF 台架测试只发有来源的灯光帧。
  - 频率只限 433.10–434.70 MHz 和 919.10–922.90 MHz，最高 10 dBm（`firmware/PixMobRFTest/PixMobRFLimits.h`，有测试）。要用其他频段，先确认马来西亚的使用规定并经用户同意。
  - MCMC 2025 年第 1 号类别指配允许 919–923 MHz SRD 最高 500 mW EIRP，无占空比条件。同一文件要求设备经认证，这对 433 MHz 也一样，自制板未认证；用户知情后同意了 922 MHz 测试。
  - 正式固件自 11-21 起发 RF，只发灯光帧和“nothing”帧（mode 0、group 0），固定 922.36 MHz、10 dBm；绝不发设置／EEPROM 帧。
- Git：11-25 起项目已提交并推送到**公开**仓库（见上方 GitHub 条），不要清理、重置或改写历史。
  - `.arduino/` 已被 `.gitignore` 排除，里面有重要的原始构建、备份和诊断资料，不能清空，也不能公开上传。
  - 用户的音乐、录像和任何账户信息也不能提交。
  - 只在用户要求时提交和推送。
- 网页和上传工具不能同时占用串口；需要硬件操作时先确认现场状态并保留恢复点。

2026-11-25：**194 项测试通过**（含 IR/RF 输出选择、彩虹 RF 保持、RF 睡眠设置、11-23 新增的 Song shows Cue pads 和内置节目的测试），`npm run build` 通过（JS 超过 500 kB 的提示来自内置节目数据，只是警告）。完整操作记录和构建哈希见交接资料与验证记录。
