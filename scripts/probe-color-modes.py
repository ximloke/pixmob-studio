#!/usr/bin/env python3
"""Finite manual color/mode comparison; dry run unless --run is supplied.

The website must release USB first. Never uploads firmware or changes wiring.
Acknowledgements prove the first frame was sent, not optical reception.
"""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import termios
import time

COLORS = {
    "red": "R", "green": "G", "blue": "B", "yellow": "Y",
    "cyan": "C", "magenta": "M", "white": "W", "warm-white": "K",
    "orange": "=844000", "sky-blue": "=4448A0",
    "ice-blue": "=6884A0", "hot-pink": "=A00C88",
}


def plan(color=None, rainbow=None):
    if rainbow:
        ms, cycle = (12000, 3000) if rainbow == "fast" else (20000, 10000)
        return [("Rainbow " + rainbow, f"~{ms},{cycle}", f"Rainbow: {ms} {cycle}", ms / 1000 + 1.2)]
    token = COLORS[color]
    line_flash = token == "M" or token.startswith("=")
    command = "." + token if line_flash else token
    reply = ("Flash: " if line_flash else "Color sent: ") + token
    steps = [(f"Quick flash {n}/3", command, reply, 1.5) for n in range(1, 4)]
    steps += [
        ("Stay lit 5 s, no fades", "#" + token + "5000", "Light: " + token + " 5000", 6.2),
        ("Strobe 5 s", "!" + token + "5000", "Strobe: " + token + " 5000", 6.2),
        ("Build-up 5 s", "^" + token + "5000", "Build: " + token + " 5000", 6.2),
    ]
    return steps


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--color", choices=COLORS)
    target.add_argument("--rainbow", choices=["fast", "slow"])
    parser.add_argument("--port", default="/dev/cu.usbserial-0001")
    parser.add_argument("--run", action="store_true", help="Actually send the finite test")
    parser.add_argument("--log", default=".arduino/color-mode-recheck-2026-11-15/serial.jsonl")
    args = parser.parse_args()
    steps = plan(args.color, args.rainbow)
    if not args.run:
        print(json.dumps(steps, indent=2))
        return
    owners = subprocess.run(["/usr/sbin/lsof", "-t", args.port], capture_output=True, text=True)
    if owners.stdout.strip():
        raise SystemExit("Port is in use; disconnect the website/serial monitor first.")
    if owners.returncode not in (0, 1):
        raise SystemExit("Could not check serial-port ownership.")
    log = Path(args.log)
    log.parent.mkdir(parents=True, exist_ok=True)

    def record(event, **data):
        entry = {"time": datetime.datetime.now().astimezone().isoformat(timespec="milliseconds"),
                 "target": args.color or "rainbow-" + args.rainbow, "event": event, **data}
        line = json.dumps(entry, ensure_ascii=False)
        with log.open("a") as out:
            out.write(line + "\n")
        print(line, flush=True)

    fd = os.open(args.port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    original = termios.tcgetattr(fd)
    buffer = b""

    def receive(seconds, expected=None):
        nonlocal buffer
        lines = []
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            ready, _, _ = select.select([fd], [], [], min(.02, max(0, end - time.monotonic())))
            if not ready:
                continue
            try:
                chunk = os.read(fd, 8192)
            except BlockingIOError:
                continue
            if not chunk:
                raise RuntimeError("Serial device disconnected")
            buffer += chunk
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                lines.append(line.decode(errors="replace").strip())
            if expected is not None and expected in lines:
                break
        return lines

    def send(command):
        data = (command + "\n").encode("ascii")
        if os.write(fd, data) != len(data):
            raise RuntimeError("Incomplete serial write")

    def is_effect_reply(line):
        return any(label in line for label in ("Color sent:", "Flash:", "Light:",
                                               "Strobe:", "Build:", "Rainbow:", "REJECTED"))

    def interrupted(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    try:
        fcntl.ioctl(fd, termios.TIOCEXCL)
        settings = termios.tcgetattr(fd)
        settings[0] = settings[1] = settings[3] = 0
        settings[2] = ((settings[2] & ~(termios.CSIZE | termios.PARENB | termios.CSTOPB))
                       | termios.CS8 | termios.CLOCAL | termios.CREAD)
        settings[4] = settings[5] = termios.B115200
        settings[6][termios.VMIN] = settings[6][termios.VTIME] = 0
        termios.tcsetattr(fd, termios.TCSANOW, settings)
        receive(2)
        send("X")
        handshake = receive(1)
        required = {"AUTO / MUSIC STOPPED", "CAPABILITIES: BROWSER BEATS", "PRESET FRAMES: 1",
                    "TIMED LIGHT: READY", "STROBE: READY", "CUSTOM LIGHT: READY", "RAINBOW: READY",
                    "BEAT EFFECTS: READY"}
        if not required.issubset(handshake):
            raise RuntimeError("Required capabilities absent: " + str(required - set(handshake)))
        if any(line.startswith("IDLE ") for line in handshake):
            raise RuntimeError("Idle-capable firmware detected; expected the retained effects build")
        record("handshake", lines=handshake)
        record("countdown", seconds=3)
        receive(3)
        for name, command, expected, wait in steps:
            record("send", mode=name, command=command)
            start = time.monotonic()
            send(command)
            reply = receive(1.5, expected)
            if expected not in reply:
                raise RuntimeError("Missing reply for " + command + ": " + str(reply))
            record("ack", mode=name, reply=expected, lines=reply,
                   firstFrameMs=round((time.monotonic() - start) * 1000, 1))
            other = reply.copy()
            other.remove(expected)
            if any(is_effect_reply(line) for line in other):
                raise RuntimeError("Unexpected reply alongside acknowledgement: " + str(other))
            extra = receive(max(0, start + wait - time.monotonic()))
            if extra:
                record("during_observation", lines=extra)
                if any(is_effect_reply(line) for line in extra):
                    raise RuntimeError("Unexpected controller output")
        record("finished", note="User observation required for every color/mode")
    finally:
        try:
            send("X")
            reply = receive(.4)
            record("stop", acknowledged="AUTO / MUSIC STOPPED" in reply)
        finally:
            termios.tcsetattr(fd, termios.TCSANOW, original)
            os.close(fd)


if __name__ == "__main__":
    main()
