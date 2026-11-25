#!/usr/bin/env python3
"""Controller verification with IR left unconfigured and standalone sync stopped.
Run only while browsers and Arduino Serial Monitor have released the USB port.
"""
import argparse
import json
import os
import select
import termios
import time

parser = argparse.ArgumentParser()
parser.add_argument('--port', default='/dev/cu.usbserial-0001')
args = parser.parse_args()
fd = os.open(args.port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
buffer = b''
audio = []

def receive(timeout):
    global buffer
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], min(.1, max(0, deadline-time.monotonic())))
        if not ready:
            continue
        try:
            chunk = os.read(fd, 8192)
        except BlockingIOError:
            continue
        if not chunk:
            raise RuntimeError('Serial stream closed.')
        buffer += chunk
        while b'\n' in buffer:
            line, buffer = buffer.split(b'\n', 1)
            try:
                value = json.loads(line)
            except (ValueError, UnicodeDecodeError):
                continue
            if isinstance(value, dict):
                if value.get('event') == 'audio':
                    audio.append(value)
                yield value

def command(request_id, operation, payload=None):
    request = {'id': request_id, 'op': operation}
    if payload is not None:
        request['payload'] = payload
    message = (json.dumps(request, separators=(',', ':')) + '\n').encode()
    select.select([], [fd], [], 1)
    os.write(fd, message)
    for result in receive(5):
        if result.get('id') == request_id:
            return result
    raise TimeoutError(f'No response to {operation}.')

try:
    settings = termios.tcgetattr(fd)
    settings[0] = 0
    settings[1] = 0
    settings[2] = (settings[2] & ~(termios.CSIZE | termios.PARENB | termios.CSTOPB)) | termios.CS8 | termios.CLOCAL | termios.CREAD
    settings[3] = 0
    settings[4] = termios.B115200
    settings[5] = termios.B115200
    settings[6][termios.VMIN] = 0
    settings[6][termios.VTIME] = 0
    termios.tcsetattr(fd, termios.TCSANOW, settings)
    # Allow any reset caused by the USB port open to finish.
    list(receive(3))
    status = command(1, 'status')
    assert status.get('mode') == 'controller', status
    assert status.get('firmware') == '1.1.0', status
    assert status.get('micPins') == {'bclk':26,'ws':25,'data':27}, status
    assert status.get('irPin') == 33, status
    assert status.get('micInitialized') is True, status
    assert status.get('irConfigured') is False, status
    assert status.get('rfSupported') is False, status
    assert not status.get('lastError'), status
    stopped = command(2, 'standalone', {'enabled':False})
    assert stopped.get('ok') is True, stopped
    rejected = command(3, 'ir/send', {})
    assert 'error' in rejected, rejected
    assert 'configured' in rejected['error'].lower(), rejected
    invalid = command(4, 'ir/config', {})
    assert 'error' in invalid, invalid
    list(receive(2))
    final = command(5, 'status')
    assert final.get('irConfigured') is False, final
    assert final.get('standaloneEnabled') is False, final
    assert final.get('irTransmitting') is False, final
    assert final.get('micAvailable') is True, final
    valid_audio = [a for a in audio if a.get('format') == 'rms-24-bit' and isinstance(a.get('micLevel'), (int,float)) and 0 <= a['micLevel'] <= 1 and isinstance(a.get('micRawLevel'), int) and 0 <= a['micRawLevel'] <= 8388608]
    assert len(valid_audio) >= 3, f'Only {len(valid_audio)} valid audio events.'
    print(json.dumps({'status': final, 'checks':{'controllerHandshake':True,'microphonePinsPreserved':True,'audioEvents':len(valid_audio),'audioRawMin':min(a['micRawLevel'] for a in valid_audio),'audioRawMax':max(a['micRawLevel'] for a in valid_audio),'unconfiguredIRRejected':True,'invalidIRConfigRejected':True,'standaloneStopped':True}}, indent=2))
finally:
    os.close(fd)
