#!/usr/bin/env python3
"""Identify the known PixMob sketches using X (Stop), never a JSON probe.

Close the browser serial connection and Arduino Serial Monitor first.
Only the newer V2's exact OK response permits a subsequent STATUS query.
"""
import argparse
import json
import os
import re
import select
import termios
import time

parser = argparse.ArgumentParser()
parser.add_argument("--port", default="/dev/cu.usbserial-0001")
parser.add_argument("--color", choices=("R", "G", "B"))
args = parser.parse_args()
fd = os.open(args.port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
buffer = b""
lines = []
byte_count = 0
original = termios.tcgetattr(fd)


def receive(seconds):
    global buffer, byte_count
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], min(.1, max(0, deadline - time.monotonic())))
        if not ready:
            continue
        try:
            chunk = os.read(fd, 8192)
        except BlockingIOError:
            continue
        if not chunk:
            continue
        byte_count += len(chunk)
        buffer += chunk
        while b"\n" in buffer:
            line, buffer = buffer.split(b"\n", 1)
            lines.append(line.decode("utf-8", errors="replace").rstrip("\r"))
        if len(buffer) > 8192:
            buffer = b""


try:
    settings = termios.tcgetattr(fd)
    settings[0] = settings[1] = settings[3] = 0
    settings[2] = (settings[2] & ~(termios.CSIZE | termios.PARENB | termios.CSTOPB)) | termios.CS8 | termios.CLOCAL | termios.CREAD
    settings[4] = settings[5] = termios.B115200
    settings[6][termios.VMIN] = settings[6][termios.VTIME] = 0
    termios.tcsetattr(fd, termios.TCSANOW, settings)
    receive(2)
    os.write(fd, b"X\n")
    receive(2)
    if "OK" in lines:
        os.write(fd, b"STATUS\n")
        receive(2)
    if args.color:
        if "AUTO / MUSIC STOPPED" not in lines:
            raise RuntimeError("The supplied music sketch must acknowledge Stop before the color test.")
        os.write(fd, (args.color + "\n").encode())
        receive(1)
    known = []
    for line in lines:
        if line in ("OK", "AUTO / MUSIC STOPPED", "Auto Mode OFF", "PIXMOB STUDIO V2 READY!", "PixMob RGB Studio Ready!", "MICROPHONE ERROR", "waiting for download") or re.fullmatch(r"(?:Sound Level: |Level:)\d+(?: Threshold:\d+(?: Beat:[01])?)?", line) or re.fullmatch(r"Color sent: [RGBYCMW]", line):
            known.append(line)
        elif line.startswith("{"):
            try:
                value = json.loads(line)
                if isinstance(value, dict):
                    known.append({key: value[key] for key in ("mode", "sensitivity", "rms", "micOk", "clip", "busy", "color", "frames", "clients") if key in value})
            except ValueError:
                pass
    print(json.dumps({"bytesReceived": byte_count, "lineCount": len(lines), "recognized": known[-20:]}, indent=2))
finally:
    termios.tcsetattr(fd, termios.TCSANOW, original)
    os.close(fd)
