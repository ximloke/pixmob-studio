# Third-party notices

This project is under the MIT License (see [LICENSE](LICENSE)). It builds on the published work below, which keeps its own licence.

## danielweidman/pixmob-ir-reverse-engineering (MIT)

https://github.com/danielweidman/pixmob-ir-reverse-engineering
Copyright (c) 2022 Dani Weidman

This project uses two parts of it:
- the IR effect definitions (`effect_definitions.py`) that `tests/pixmob-frame.cpp` checks against;
- the published 915 MHz RF captures (the bit time, and the "nothing" and wine red frames) used in `firmware/*/PixMobRFFrame.h` and checked in `tests/rf-frame.cpp`.

## jamesw343/PixMob_IR (MIT)

https://github.com/jamesw343/PixMob_IR
Copyright (c) 2024-2025 James Wang

This project uses the IR frame format and line-code table in `firmware/*/PixMobFrame.h`, which come from its `docs/ir_protocol.md`.

Both MIT-licensed works above carry this permission notice:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## sueppchen/PixMob_waveband, pixmob_cement library (BSD licence notice)

https://github.com/sueppchen/PixMob_waveband
Copyright (c) 2024 Sueppchen & Serge-45

The RF frame layout, the 6b8b line code and the CRC12 in `firmware/PixMobBeatController/PixMobRFFrame.h` and `firmware/PixMobRFTest/PixMobRFFrame.h` follow its `pixmob_cement` library (v0.2.1). `tests/rf-frame.cpp` also checks against example frames from its `basic.ino`. The library's licence notice is kept in full in both `PixMobRFFrame.h` files and is repeated here:

> Software License Agreement (BSD License)
>
> Copyright (c) 2024 Sueppchen & Serge-45
>
> All rights reserved.
>
> Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
> 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
> 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
> 3. Neither the name of the copyright holders nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.
>
> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS ''AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
