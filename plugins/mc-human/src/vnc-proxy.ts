/**
 * vnc-proxy.ts — WebSocket → TCP VNC proxy (pure Node.js, no websockify needed)
 *
 * Upgrades HTTP connections to WebSocket, then pipes data bidirectionally
 * to the local VNC server (default: 127.0.0.1:5900).
 *
 * This replaces the external websockify dependency so no system packages
 * need to be installed.
 */

import * as net from "node:net";
import * as http from "node:http";
import * as crypto from "node:crypto";

type Logger = { info(m: string): void; warn(m: string): void; error(m: string): void };

function parseWebSocketKey(req: http.IncomingMessage): string | null {
  return req.headers["sec-websocket-key"] as string ?? null;
}

function wsAccept(key: string): string {
  return crypto
    .createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
}

/** Frame a WebSocket binary frame (opcode 2). */
function frameWsMessage(payload: Buffer): Buffer {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x82; // FIN + binary
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x82;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x82;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

interface WsFrame {
  opcode: number;
  payload: Buffer;
  fin: boolean;
}

/** Parse a complete WebSocket frame from a buffer. Returns null if incomplete. */
function parseWsFrame(buf: Buffer): { frame: WsFrame; consumed: number } | null {
  if (buf.length < 2) return null;
  const fin = !!(buf[0] & 0x80);
  const opcode = buf[0] & 0x0f;
  const masked = !!(buf[1] & 0x80);
  let payloadLen = buf[1] & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buf.length < 4) return null;
    payloadLen = buf.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buf.length < 10) return null;
    payloadLen = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }

  const maskLen = masked ? 4 : 0;
  if (buf.length < offset + maskLen + payloadLen) return null;

  let payload = buf.slice(offset + maskLen, offset + maskLen + payloadLen);
  if (masked) {
    const mask = buf.slice(offset, offset + 4);
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= mask[i % 4];
    }
  }

  return { frame: { opcode, payload, fin }, consumed: offset + maskLen + payloadLen };
}

export function attachVncProxy(
  server: http.Server,
  wsPath: string,
  logger: Logger,
  lookupVnc: (token: string) => { host: string; port: number } | null
): void {
  server.on("upgrade", (req, socket, _head) => {
    const reqUrl = new URL(req.url ?? "/", "http://localhost");
    if (reqUrl.pathname !== wsPath) {
      socket.destroy();
      return;
    }

    const token = reqUrl.searchParams.get("token") ?? "";
    const vnc = lookupVnc(token);
    if (!vnc) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    const key = parseWebSocketKey(req);
    if (!key) {
      socket.destroy();
      return;
    }

    // Complete WebSocket handshake
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${wsAccept(key)}\r\n` +
      "Sec-WebSocket-Protocol: binary\r\n" +
      "\r\n"
    );

    logger.info(`mc-human: WS→VNC proxy connecting to ${vnc.host}:${vnc.port}`);

    const vncSock = net.createConnection({ host: vnc.host, port: vnc.port });
    let wsBuffer = Buffer.alloc(0);

    // VNC → WebSocket: wrap VNC bytes in WS frames
    vncSock.on("data", (chunk: Buffer) => {
      if (!socket.writable) return;
      socket.write(frameWsMessage(chunk));
    });

    vncSock.on("end", () => {
      // Send WS close frame
      if (socket.writable) {
        socket.write(Buffer.from([0x88, 0x00]));
        socket.end();
      }
    });

    vncSock.on("error", (err: Error) => {
      logger.error(`mc-human: VNC connection error: ${err.message}`);
      if (socket.writable) socket.destroy();
    });

    // WebSocket → VNC: parse WS frames, extract payload bytes, send to VNC
    socket.on("data", (chunk: Buffer) => {
      wsBuffer = Buffer.concat([wsBuffer, chunk]);

      while (wsBuffer.length > 0) {
        const result = parseWsFrame(wsBuffer);
        if (!result) break;
        const { frame, consumed } = result;
        wsBuffer = wsBuffer.slice(consumed);

        if (frame.opcode === 8) {
          // Close frame
          vncSock.end();
          socket.end();
          return;
        }
        if (frame.opcode === 9) {
          // Ping → Pong
          socket.write(Buffer.from([0x8a, 0x00]));
          continue;
        }
        if ((frame.opcode === 2 || frame.opcode === 1) && vncSock.writable) {
          vncSock.write(frame.payload);
        }
      }
    });

    socket.on("error", () => vncSock.destroy());
    socket.on("close", () => vncSock.destroy());
  });
}
