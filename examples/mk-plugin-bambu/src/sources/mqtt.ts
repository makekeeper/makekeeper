// A minimal MQTT 3.1.1 client over TLS — enough to watch a printer, and
// nothing more (#142).
//
// Why hand-rolled instead of the `mqtt` package: an external plugin owns its
// own protocol problems, and this file is the demonstration. It is ~150 lines
// because we need exactly four packet types (CONNECT, SUBSCRIBE, PUBLISH,
// PINGREQ) at QoS 0, which is what a status feed is.
//
// If you are copying this into a plugin that needs QoS 1/2, retained messages
// or persistent sessions, take the npm package instead — this is deliberately
// the smallest thing that correctly reads a topic.

import { connect as tlsConnect, type TLSSocket } from 'node:tls';

const PACKET_CONNECT = 0x10;
const PACKET_CONNACK = 0x20;
const PACKET_PUBLISH = 0x30;
const PACKET_SUBSCRIBE = 0x80;
const PACKET_PINGREQ = 0xc0;

const KEEPALIVE_S = 60;

// MQTT strings are length-prefixed UTF-8.
const mqttString = (value: string): Buffer => {
  const body = Buffer.from(value, 'utf8');
  const header = Buffer.alloc(2);
  header.writeUInt16BE(body.length, 0);
  return Buffer.concat([header, body]);
};

// Remaining Length is a 1-4 byte varint, 7 bits per byte with a continuation
// flag — the one piece of MQTT framing that trips people up.
const remainingLength = (length: number): Buffer => {
  const bytes: number[] = [];
  let value = length;
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) byte |= 0x80;
    bytes.push(byte);
  } while (value > 0);
  return Buffer.from(bytes);
};

const readRemainingLength = (
  buffer: Buffer,
  offset: number,
): { value: number; bytes: number } | null => {
  let value = 0;
  let multiplier = 1;
  for (let i = 0; i < 4; i++) {
    if (offset + i >= buffer.length) return null;
    const byte = buffer[offset + i];
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return { value, bytes: i + 1 };
    multiplier *= 128;
  }
  return null;
};

export interface MqttOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  clientId: string;
  topic: string;
  onMessage: (topic: string, payload: string) => void;
  onStatus: (status: 'connected' | 'disconnected', detail?: string) => void;
}

export interface MqttConnection {
  publish(topic: string, payload: string): void;
  close(): void;
}

export function connectMqtt(options: MqttOptions): MqttConnection {
  let socket: TLSSocket | null = null;
  let pinger: NodeJS.Timeout | undefined;
  let buffer = Buffer.alloc(0);
  let closed = false;

  const send = (packet: Buffer): void => {
    socket?.write(packet);
  };

  const publish = (topic: string, payload: string): void => {
    const body = Buffer.concat([mqttString(topic), Buffer.from(payload, 'utf8')]);
    send(
      Buffer.concat([
        Buffer.from([PACKET_PUBLISH]),
        remainingLength(body.length),
        body,
      ]),
    );
  };

  const handlePublish = (packet: Buffer): void => {
    const topicLength = packet.readUInt16BE(0);
    const topic = packet.subarray(2, 2 + topicLength).toString('utf8');
    // QoS 0 only: no packet identifier follows the topic.
    const payload = packet.subarray(2 + topicLength).toString('utf8');
    options.onMessage(topic, payload);
  };

  const consume = (): void => {
    // One TCP read can carry several packets, or half of one — MQTT is a
    // stream protocol, so the buffer is drained frame by frame.
    for (;;) {
      if (buffer.length < 2) return;
      const header = readRemainingLength(buffer, 1);
      if (!header) return;
      const total = 1 + header.bytes + header.value;
      if (buffer.length < total) return;

      const type = buffer[0] & 0xf0;
      const body = buffer.subarray(1 + header.bytes, total);
      buffer = buffer.subarray(total);

      if (type === PACKET_CONNACK) {
        const returnCode = body[1];
        if (returnCode !== 0) {
          options.onStatus('disconnected', `connack ${returnCode}`);
          close();
          return;
        }
        // Subscribe as soon as the broker accepts us.
        const payload = Buffer.concat([
          Buffer.from([0x00, 0x01]), // packet id
          mqttString(options.topic),
          Buffer.from([0x00]), // QoS 0
        ]);
        send(
          Buffer.concat([
            Buffer.from([PACKET_SUBSCRIBE | 0x02]),
            remainingLength(payload.length),
            payload,
          ]),
        );
        options.onStatus('connected');
      } else if (type === PACKET_PUBLISH) {
        handlePublish(body);
      }
      // SUBACK and PINGRESP need no action; ignoring them is correct here.
    }
  };

  const close = (): void => {
    closed = true;
    clearInterval(pinger);
    socket?.destroy();
    socket = null;
  };

  socket = tlsConnect(
    {
      host: options.host,
      port: options.port,
      // The printer presents a self-signed certificate for its own IP. There
      // is no CA to validate against, and the access code is the real secret
      // here — this is the same trade the vendor's own tools make.
      rejectUnauthorized: false,
    },
    () => {
      const flags = 0xc2; // username + password + clean session
      const payload = Buffer.concat([
        mqttString('MQTT'),
        Buffer.from([0x04, flags]), // protocol level 3.1.1, connect flags
        Buffer.from([(KEEPALIVE_S >> 8) & 0xff, KEEPALIVE_S & 0xff]),
        mqttString(options.clientId),
        mqttString(options.username),
        mqttString(options.password),
      ]);
      send(
        Buffer.concat([
          Buffer.from([PACKET_CONNECT]),
          remainingLength(payload.length),
          payload,
        ]),
      );
      pinger = setInterval(() => {
        send(Buffer.from([PACKET_PINGREQ, 0x00]));
      }, (KEEPALIVE_S / 2) * 1000);
    },
  );

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    consume();
  });
  socket.on('error', (err) => {
    if (!closed) options.onStatus('disconnected', err.message);
  });
  socket.on('close', () => {
    if (!closed) options.onStatus('disconnected');
  });

  return { publish, close };
}
