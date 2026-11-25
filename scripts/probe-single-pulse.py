#!/usr/bin/env python3
"""Controlled one-frame RGB comparison using the existing Host protocol."""
import argparse
import json
import os
import select
import termios
import time

parser = argparse.ArgumentParser()
parser.add_argument("--port", default="/dev/cu.usbserial-0001")
parser.add_argument("--color", choices=["R", "G", "B", "Y", "C", "W", "K"], default="G")
parser.add_argument("--manual", action="store_true")
parser.add_argument("--all", action="store_true", help="Test the six manual single-frame presets")
parser.add_argument("--interval", type=float, default=2, help="Observation seconds after each color in --all mode (1..15)")
parser.add_argument("--colors", default="RGBYCW", help="Ordered manual colors for --all, e.g. GW or WK (K = original warm WHITISH, candidate builds only)")
args = parser.parse_args()
if not 1 <= args.interval <= 15:
    parser.error("Choose an observation interval from 1 to 15 seconds.")
if not args.colors or len(args.colors) > 7 or any(color not in "RGBYCWK" for color in args.colors) or len(set(args.colors)) != len(args.colors):
    parser.error("Choose up to seven different colors from RGBYCWK.")
if not args.manual and not args.all and args.color not in "RGB":
    parser.error("Host mode supports RGB only; use --manual with single-frame firmware.")
fd = os.open(args.port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
original = termios.tcgetattr(fd)
buffer = b""

def receive(seconds, expected=None):
    global buffer
    lines = []
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        ready, _, _ = select.select([fd], [], [], min(.02, max(0, end-time.monotonic())))
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

try:
    settings = termios.tcgetattr(fd)
    settings[0] = settings[1] = settings[3] = 0
    settings[2] = (settings[2] & ~(termios.CSIZE | termios.PARENB | termios.CSTOPB)) | termios.CS8 | termios.CLOCAL | termios.CREAD
    settings[4] = settings[5] = termios.B115200
    settings[6][termios.VMIN] = settings[6][termios.VTIME] = 0
    termios.tcsetattr(fd, termios.TCSANOW, settings)
    receive(2)
    os.write(fd, b"X\n")
    handshake = receive(1)
    assert "AUTO / MUSIC STOPPED" in handshake, "Stop was not acknowledged."
    assert "CAPABILITIES: BROWSER BEATS" in handshake, "Expected Host firmware was not confirmed."
    manual = args.manual or args.all
    if manual:
        assert "PRESET FRAMES: 1" in handshake, "Single-frame manual firmware was not confirmed. No color sent."
    else:
        os.write(fd, b"H\n")
        assert "BROWSER SYNC ON" in receive(.5), "Host mode was not acknowledged."
    for color in args.colors if args.all else [args.color]:
        command = color if manual else {"R":"1", "G":"2", "B":"3"}[color]
        expected = ("" if manual else "BEAT! ") + "Color sent: " + color
        start = time.monotonic()
        os.write(fd, (command + "\n").encode())
        assert expected in receive(1, expected), "No transmission-completion reply."
        elapsed = round((time.monotonic() - start)*1000, 1)
        idle = receive(args.interval if args.all else 1)
        assert not any("Color sent:" in line for line in idle), "Unexpected autonomous output."
        print(json.dumps({"color":color, "requestedFrames":1,
            "completed":True, "completionMs":elapsed, "additionalOutput":False}), flush=True)
finally:
    os.write(fd, b"X\n")
    receive(.25)
    termios.tcsetattr(fd, termios.TCSANOW, original)
    os.close(fd)
