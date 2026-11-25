#!/usr/bin/env python3
"""Measure the supplied sketch's music telemetry, using only X/M commands."""
import argparse
import json
import os
import re
import select
import termios
import time

parser = argparse.ArgumentParser()
parser.add_argument("--port", default="/dev/cu.usbserial-0001")
parser.add_argument("--seconds", type=float, default=20)
parser.add_argument("--output")
parser.add_argument("--leave-music-on", action="store_true", help="Keep the acknowledged Music mode running after the probe.")
parser.add_argument("--listen-only", action="store_true", help="Use the new Beat Controller's V diagnostic mode without IR output.")
args = parser.parse_args()
if not 1 <= args.seconds <= 60:
    parser.error("Use 1–60 seconds.")
fd = os.open(args.port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
original = termios.tcgetattr(fd)
buffer = b""
events = []
start = time.monotonic()
music_started = False


def receive(seconds):
    global buffer
    deadline = time.monotonic() + seconds
    received = []
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], min(.05, max(0, deadline - time.monotonic())))
        if not ready:
            continue
        try:
            chunk = os.read(fd, 8192)
        except BlockingIOError:
            continue
        buffer += chunk
        while b"\n" in buffer:
            line, buffer = buffer.split(b"\n", 1)
            text = line.decode("utf-8", errors="replace").rstrip("\r")
            received.append(text)
            event = {"t": round(time.monotonic() - start, 3)}
            level = re.fullmatch(r"Level:(\d+) Threshold:(\d+)(?: Beat:([01]))?", text)
            beat = re.fullmatch(r"BEAT! Color sent: ([RGB])", text)
            analysis = re.fullmatch(r"Analysis:Full:(\d+) BassFraction:(\d+(?:\.\d+)?)", text)
            if level:
                event.update(level=int(level[1]), threshold=int(level[2]))
                if level[3] is not None:
                    event["beat"] = level[3] == "1"
                events.append(event)
            elif beat:
                events.append({**event, "beat": True, "color": beat[1]})
            elif text == "ONSET DETECTED":
                events.append({**event, "onset": True})
            elif analysis:
                events.append({**event, "fullLevel": int(analysis[1]), "bassFraction": float(analysis[2])})
        if len(buffer) > 8192:
            buffer = b""
    return received


try:
    settings = termios.tcgetattr(fd)
    settings[0] = settings[1] = settings[3] = 0
    settings[2] = (settings[2] & ~(termios.CSIZE | termios.PARENB | termios.CSTOPB)) | termios.CS8 | termios.CLOCAL | termios.CREAD
    settings[4] = settings[5] = termios.B115200
    settings[6][termios.VMIN] = settings[6][termios.VTIME] = 0
    termios.tcsetattr(fd, termios.TCSANOW, settings)
    receive(2)
    os.write(fd, b"X\n")
    reply = receive(1)
    if "AUTO / MUSIC STOPPED" not in reply:
        raise RuntimeError("The supplied music sketch did not acknowledge Stop; no Music command sent.")
    events.clear()
    start = time.monotonic()
    os.write(fd, b"V\n" if args.listen_only else b"M\n")
    reply = receive(args.seconds)
    levels = [e["level"] for e in events if "level" in e]
    beats = [e for e in events if e.get("beat")]
    onsets = [e for e in events if e.get("onset")]
    diagnostics = [e for e in events if "bassFraction" in e]
    summary = {
        "musicAcknowledged": "MUSIC SYNC ON" in reply,
        "diagnosticAcknowledged": "MIC DIAGNOSTIC ON" in reply,
        "format": "bass-envelope-16-bit" if "AUDIO FORMAT: BASS ENVELOPE 16-BIT" in reply else "mean-absolute-16-bit",
        "seconds": args.seconds,
        "samples": len(levels),
        "levelMin": min(levels) if levels else None,
        "levelMax": max(levels) if levels else None,
        "beats": len(beats),
        "detectedOnsets": len(onsets),
        "bassFractionMedian": sorted(e["bassFraction"] for e in diagnostics)[len(diagnostics)//2] if diagnostics else None,
        "fullLevelMax": max(e["fullLevel"] for e in diagnostics) if diagnostics else None,
        "beatIntervalsSeconds": [round(b["t"] - a["t"], 3) for a, b in zip(beats, beats[1:])],
    }
    music_started = summary["musicAcknowledged"]
    if args.output:
        with open(args.output, "w") as target:
            json.dump({"summary": summary, "events": events}, target, indent=2)
    print(json.dumps(summary, indent=2))
finally:
    if not (args.leave_music_on and music_started):
        os.write(fd, b"X\n")
        receive(.5)
    termios.tcsetattr(fd, termios.TCSANOW, original)
    os.close(fd)
