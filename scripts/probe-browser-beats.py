#!/usr/bin/env python3
"""Verify Host isolation and explicit single-frame commands; not a music test."""
import argparse
import json
import os
import statistics
import select
import termios
import time

parser = argparse.ArgumentParser()
parser.add_argument("--port", default="/dev/cu.usbserial-0001")
parser.add_argument("--samples", type=int, default=4)
parser.add_argument("--output")
args = parser.parse_args()
if not 4 <= args.samples <= 32:
    parser.error("Use 4–32 samples.")
fd = os.open(args.port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
original = termios.tcgetattr(fd)
buffer = b""
all_lines = []


def receive(seconds, until=None):
    global buffer
    end = time.monotonic() + seconds
    output = []
    while time.monotonic() < end:
        ready, _, _ = select.select([fd], [], [], min(.02, max(0, end - time.monotonic())))
        if not ready:
            continue
        try:
            chunk = os.read(fd, 8192)
        except BlockingIOError:
            continue
        buffer += chunk
        while b"\n" in buffer:
            line, buffer = buffer.split(b"\n", 1)
            value = line.decode("utf-8", errors="replace").rstrip("\r")
            output.append(value)
            all_lines.append(value)
        if until is not None and until in output:
            return output
        if len(buffer) > 8192:
            buffer = b""
    return output


try:
    settings = termios.tcgetattr(fd)
    settings[0] = settings[1] = settings[3] = 0
    settings[2] = (settings[2] & ~(termios.CSIZE | termios.PARENB | termios.CSTOPB)) | termios.CS8 | termios.CLOCAL | termios.CREAD
    settings[4] = settings[5] = termios.B115200
    settings[6][termios.VMIN] = settings[6][termios.VTIME] = 0
    termios.tcsetattr(fd, termios.TCSANOW, settings)
    receive(2)
    os.write(fd, b"X\n")
    assert "AUTO / MUSIC STOPPED" in receive(.5), "Stop was not acknowledged."
    assert "CAPABILITIES: BROWSER BEATS" in all_lines, "Browser beats capability absent."
    os.write(fd, b"H\n")
    assert "BROWSER SYNC ON" in receive(.5), "Host mode was not acknowledged."
    idle_before = receive(2)
    assert not any(line.startswith("BEAT!") for line in idle_before), "Host emitted without a browser beat."
    start = time.monotonic()
    timings = []
    offsets = [0, .48, 1.13, 2.05]
    gaps = (.51, .83, .74, .61, .96, .64, .78, .55)
    while len(offsets) < args.samples:
        offsets.append(offsets[-1] + gaps[(len(offsets) - 4) % len(gaps)])
    for index, offset in enumerate(offsets):
        digit = "123"[index % 3]
        color = "RGB"[index % 3]
        receive(max(0, start + offset - time.monotonic()))
        sent_at = time.monotonic()
        os.write(fd, (digit + "\n").encode())
        expected = "BEAT! Color sent: " + color
        confirmed = False
        while time.monotonic() - sent_at < 1:
            if expected in receive(.02, until=expected):
                confirmed = True
                timings.append(round((time.monotonic() - sent_at) * 1000, 1))
                break
        assert confirmed, "Missing completed frame for " + color
    idle_after = receive(2)
    assert not any(line.startswith("BEAT!") for line in idle_after), "Host continued generating output without input."
    assert sum(line.startswith("BEAT!") for line in all_lines) == args.samples, "Unexpected extra frames."
    result = {"hostAcknowledged": True, "idleWithoutCommands": "no output", "completedCommands": args.samples, "completionLatencyMs": timings, "medianCompletionMs": statistics.median(timings), "musicInputUsed": False}
    if args.output:
        with open(args.output, "w") as target:
            json.dump(result, target, indent=2)
    print(json.dumps(result, indent=2))
finally:
    os.write(fd, b"X\n")
    receive(.25)
    termios.tcsetattr(fd, termios.TCSANOW, original)
    os.close(fd)
