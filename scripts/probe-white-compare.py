#!/usr/bin/env python3
"""Observable W/K comparison on the neutral-white candidate build.

Each color is sent as a burst of single frames (one manual command per
frame, spaced by --spacing seconds) so the wristband blinks repeatedly and the
eye can compare the candidate White (W) with the original warm WHITISH (K).
It needs the firmware that prints `WHITE PRESET: NEUTRAL CANDIDATE (K = WHITISH)`
and refuses to run otherwise. Serial completion lines prove transmission
completion only, not reception or color. Release the browser's serial
connection first.
"""
import argparse
import json
import os
import select
import sys
import termios
import time

parser = argparse.ArgumentParser()
parser.add_argument("--port", default="/dev/cu.usbserial-0001")
parser.add_argument("--colors", default="WK", help="Burst order per round, e.g. WK or KW")
parser.add_argument("--frames", type=int, default=6, help="Single frames per burst (1..20)")
parser.add_argument("--spacing", type=float, default=0.5, help="Seconds between frames in a burst (0.2..2)")
parser.add_argument("--pause", type=float, default=2.5, help="Dark seconds between bursts (1..10)")
parser.add_argument("--rounds", type=int, default=2, help="Rounds of the whole order (1..5)")
parser.add_argument("--countdown", type=int, default=8, help="Seconds before the first frame (0..30)")
args = parser.parse_args()
if not args.colors or any(c not in "RGBYCWK" for c in args.colors) or len(set(args.colors)) != len(args.colors):
    parser.error("Choose distinct colors from RGBYCWK.")
if not 1 <= args.frames <= 20 or not 0.2 <= args.spacing <= 2 or not 1 <= args.pause <= 10 or not 1 <= args.rounds <= 5 or not 0 <= args.countdown <= 30:
    parser.error("Argument out of range.")

fd = os.open(args.port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
original = termios.tcgetattr(fd)
buffer = b""

def receive(seconds, expected=None):
    global buffer
    lines = []
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        ready, _, _ = select.select([fd], [], [], min(.02, max(0, end - time.monotonic())))
        if not ready:
            continue
        try:
            buffer += os.read(fd, 8192)
        except BlockingIOError:
            continue
        while b"\n" in buffer:
            line, buffer = buffer.split(b"\n", 1)
            lines.append(line.decode(errors="replace").strip())
        if expected in lines:
            break
    return lines

def say(message):
    print(message, flush=True)

try:
    settings = termios.tcgetattr(fd)
    settings[0] = settings[1] = settings[3] = 0
    settings[2] = (settings[2] & ~(termios.CSIZE | termios.PARENB | termios.CSTOPB)) | termios.CS8 | termios.CLOCAL | termios.CREAD
    settings[4] = settings[5] = termios.B115200
    settings[6][termios.VMIN] = settings[6][termios.VTIME] = 0
    termios.tcsetattr(fd, termios.TCSANOW, settings)
    receive(1.5)
    os.write(fd, b"X\n")
    handshake = receive(1.5)
    assert "AUTO / MUSIC STOPPED" in handshake, "Stop was not acknowledged."
    assert "PRESET FRAMES: 1" in handshake, "Single-frame manual firmware was not confirmed. No color sent."
    if "K" in args.colors:
        assert "WHITE PRESET: NEUTRAL CANDIDATE (K = WHITISH)" in handshake, "This build has no K command. No color sent."
    for remaining in range(args.countdown, 0, -1):
        say(f"starting in {remaining} s")
        time.sleep(1)
    results = []
    for round_index in range(1, args.rounds + 1):
        for color in args.colors:
            say(f"=== round {round_index}: {color} x{args.frames}")
            completions = []
            expected = "Color sent: " + color
            for frame in range(args.frames):
                started = time.monotonic()
                os.write(fd, (color + "\n").encode())
                lines = receive(1, expected)
                elapsed = round((time.monotonic() - started) * 1000, 1)
                if expected in lines:
                    completions.append(elapsed)
                else:
                    say(f"frame {frame + 1}: no completion reply within 1 s")
                leftover = args.spacing - (time.monotonic() - started)
                if leftover > 0:
                    time.sleep(leftover)
            idle = receive(args.pause)
            autonomous = [line for line in idle if "Color sent:" in line]
            results.append({"round": round_index, "color": color, "requested": args.frames,
                            "completed": len(completions),
                            "completionMs": [min(completions), max(completions)] if completions else None,
                            "autonomousOutput": bool(autonomous)})
            say(json.dumps(results[-1]))
    os.write(fd, b"X\n")
    receive(1, "AUTO / MUSIC STOPPED")
    say(json.dumps({"summary": results, "note": "completion = serial transmission finished; reception and color need observation"}))
except AssertionError as error:
    say(f"ABORTED: {error}")
    sys.exit(1)
finally:
    try:
        termios.tcsetattr(fd, termios.TCSANOW, original)
    finally:
        os.close(fd)
