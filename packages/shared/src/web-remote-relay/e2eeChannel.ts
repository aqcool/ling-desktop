// 纯 TypeScript 实现的 RFC 7748 (X25519) + RFC 6234/2104/5869 (SHA-256/HMAC/HKDF) +
// RFC 8439 (ChaCha20-Poly1305) 端到端加密信道。
// 零 Node / 原生依赖，可在 Electron Main、浏览器与 React Native Hermes 间位级互通。

const P25519 = (1n << 255n) - 19n;
const A24 = 121665n;
const P1305 = (1n << 130n) - 5n;
const MASK128 = (1n << 128n) - 1n;
const POLY1305_CLAMP = 0x0ffffffc0ffffffc0ffffffc0fffffffn;
const MAX_PLAINTEXT_BYTES = 1_048_576;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) {
    throw new Error("Invalid hex string");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < B64_CHARS.length; i += 1) {
  B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += B64_CHARS[(triple >> 18) & 63];
    out += B64_CHARS[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? B64_CHARS[(triple >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64_CHARS[triple & 63] : "=";
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.trim();
  if (clean.length % 4 !== 0) throw new Error("Invalid base64 length");
  let pad = 0;
  if (clean.endsWith("==")) pad = 2;
  else if (clean.endsWith("=")) pad = 1;
  const outLen = (clean.length / 4) * 3 - pad;
  const out = new Uint8Array(outLen);
  let offset = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = clean.charCodeAt(i);
    const c1 = clean.charCodeAt(i + 1);
    const c2 = clean.charCodeAt(i + 2);
    const c3 = clean.charCodeAt(i + 3);
    const v0 = c0 < 128 ? B64_LOOKUP[c0]! : -1;
    const v1 = c1 < 128 ? B64_LOOKUP[c1]! : -1;
    const v2 = c2 === 61 ? 0 : c2 < 128 ? B64_LOOKUP[c2]! : -1;
    const v3 = c3 === 61 ? 0 : c3 < 128 ? B64_LOOKUP[c3]! : -1;
    if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) throw new Error("Invalid base64 character");
    const triple = (v0 << 18) | (v1 << 12) | (v2 << 6) | v3;
    if (offset < outLen) out[offset++] = (triple >> 16) & 0xff;
    if (offset < outLen) out[offset++] = (triple >> 8) & 0xff;
    if (offset < outLen) out[offset++] = triple & 0xff;
  }
  return out;
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const arr of arrays) total += arr.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

// --- SHA-256 (RFC 6234) ---

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(data: Uint8Array): Uint8Array {
  const bitLen = data.length * 8;
  const paddedLen = Math.ceil((data.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 =
        ((w[i - 15]! >>> 7) | (w[i - 15]! << 25)) ^
        ((w[i - 15]! >>> 18) | (w[i - 15]! << 14)) ^
        (w[i - 15]! >>> 3);
      const s1 =
        ((w[i - 2]! >>> 17) | (w[i - 2]! << 15)) ^
        ((w[i - 2]! >>> 19) | (w[i - 2]! << 13)) ^
        (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  const outView = new DataView(digest.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return digest;
}

export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  const blockKey = new Uint8Array(64);
  if (key.length > 64) blockKey.set(sha256(key));
  else blockKey.set(key);
  const ipad = new Uint8Array(64);
  const opad = new Uint8Array(64);
  for (let i = 0; i < 64; i += 1) {
    ipad[i] = blockKey[i]! ^ 0x36;
    opad[i] = blockKey[i]! ^ 0x5c;
  }
  return sha256(concatBytes(opad, sha256(concatBytes(ipad, data))));
}

export function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Uint8Array {
  const actualSalt = salt.length > 0 ? salt : new Uint8Array(32);
  const prk = hmacSha256(actualSalt, ikm);
  const blocks = Math.ceil(length / 32);
  const okm = new Uint8Array(blocks * 32);
  let prev: Uint8Array = new Uint8Array(0);
  for (let i = 1; i <= blocks; i += 1) {
    prev = hmacSha256(prk, concatBytes(prev, info, new Uint8Array([i])));
    okm.set(prev, (i - 1) * 32);
  }
  return okm.subarray(0, length);
}

// --- X25519 (RFC 7748) ---

function modP(n: bigint): bigint {
  const r = n % P25519;
  return r < 0n ? r + P25519 : r;
}

function modPowP(base: bigint, exp: bigint): bigint {
  let result = 1n;
  let b = modP(base);
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % P25519;
    b = (b * b) % P25519;
    e >>= 1n;
  }
  return result;
}

function decodeLittleEndian(bytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i -= 1) {
    n = (n << 8n) | BigInt(bytes[i]!);
  }
  return n;
}

function encodeLittleEndian32(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = modP(n);
  for (let i = 0; i < 32; i += 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function x25519(scalarBytes: Uint8Array, uBytes: Uint8Array): Uint8Array {
  if (scalarBytes.length !== 32 || uBytes.length !== 32) {
    throw new Error("X25519 keys must be 32 bytes");
  }
  const kBytes = new Uint8Array(scalarBytes);
  kBytes[0] = kBytes[0]! & 248;
  kBytes[31] = (kBytes[31]! & 127) | 64;
  const k = decodeLittleEndian(kBytes);

  const uCopy = new Uint8Array(uBytes);
  uCopy[31] = uCopy[31]! & 127;
  const u = decodeLittleEndian(uCopy) % P25519;

  const x1 = u;
  let x2 = 1n;
  let z2 = 0n;
  let x3 = u;
  let z3 = 1n;
  let swap = 0n;

  for (let t = 254n; t >= 0n; t -= 1n) {
    const kt = (k >> t) & 1n;
    swap ^= kt;
    if (swap === 1n) {
      [x2, x3] = [x3, x2];
      [z2, z3] = [z3, z2];
    }
    swap = kt;

    const A = modP(x2 + z2);
    const AA = modP(A * A);
    const B = modP(x2 - z2);
    const BB = modP(B * B);
    const E = modP(AA - BB);
    const C = modP(x3 + z3);
    const D = modP(x3 - z3);
    const DA = modP(D * A);
    const CB = modP(C * B);
    x3 = modP((DA + CB) * (DA + CB));
    z3 = modP(x1 * modP((DA - CB) * (DA - CB)));
    x2 = modP(AA * BB);
    z2 = modP(E * modP(AA + A24 * E));
  }
  if (swap === 1n) {
    [x2, x3] = [x3, x2];
    [z2, z3] = [z3, z2];
  }
  return encodeLittleEndian32(modP(x2 * modPowP(z2, P25519 - 2n)));
}

const X25519_BASEPOINT = new Uint8Array(32);
X25519_BASEPOINT[0] = 9;

export function x25519PublicKey(privateKey: Uint8Array): Uint8Array {
  return x25519(privateKey, X25519_BASEPOINT);
}

function assertNonZeroSharedSecret(secret: Uint8Array): void {
  let acc = 0;
  for (let i = 0; i < secret.length; i += 1) acc |= secret[i]!;
  if (acc === 0) throw new Error("Invalid X25519 shared secret");
}

// --- ChaCha20-Poly1305 (RFC 8439) ---

function rotl32(v: number, n: number): number {
  return ((v << n) | (v >>> (32 - n))) >>> 0;
}

function quarterRound(s: Uint32Array, a: number, b: number, c: number, d: number): void {
  s[a] = (s[a]! + s[b]!) >>> 0;
  s[d] = rotl32(s[d]! ^ s[a]!, 16);
  s[c] = (s[c]! + s[d]!) >>> 0;
  s[b] = rotl32(s[b]! ^ s[c]!, 12);
  s[a] = (s[a]! + s[b]!) >>> 0;
  s[d] = rotl32(s[d]! ^ s[a]!, 8);
  s[c] = (s[c]! + s[d]!) >>> 0;
  s[b] = rotl32(s[b]! ^ s[c]!, 7);
}

function chacha20Block(key: Uint8Array, counter: number, nonce: Uint8Array): Uint8Array {
  const keyView = new DataView(key.buffer, key.byteOffset, key.byteLength);
  const nonceView = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength);
  const initial = new Uint32Array([
    0x61707865,
    0x3320646e,
    0x79622d32,
    0x6b206574,
    keyView.getUint32(0, true),
    keyView.getUint32(4, true),
    keyView.getUint32(8, true),
    keyView.getUint32(12, true),
    keyView.getUint32(16, true),
    keyView.getUint32(20, true),
    keyView.getUint32(24, true),
    keyView.getUint32(28, true),
    counter >>> 0,
    nonceView.getUint32(0, true),
    nonceView.getUint32(4, true),
    nonceView.getUint32(8, true),
  ]);
  const state = new Uint32Array(initial);
  for (let i = 0; i < 10; i += 1) {
    quarterRound(state, 0, 4, 8, 12);
    quarterRound(state, 1, 5, 9, 13);
    quarterRound(state, 2, 6, 10, 14);
    quarterRound(state, 3, 7, 11, 15);
    quarterRound(state, 0, 5, 10, 15);
    quarterRound(state, 1, 6, 11, 12);
    quarterRound(state, 2, 7, 8, 13);
    quarterRound(state, 3, 4, 9, 14);
  }
  const out = new Uint8Array(64);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 16; i += 1) {
    outView.setUint32(i * 4, (state[i]! + initial[i]!) >>> 0, true);
  }
  return out;
}

function chacha20Xor(
  key: Uint8Array,
  counter: number,
  nonce: Uint8Array,
  data: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(data.length);
  let blockCounter = counter;
  for (let offset = 0; offset < data.length; offset += 64) {
    const block = chacha20Block(key, blockCounter, nonce);
    blockCounter = (blockCounter + 1) >>> 0;
    const end = Math.min(64, data.length - offset);
    for (let i = 0; i < end; i += 1) {
      out[offset + i] = data[offset + i]! ^ block[i]!;
    }
  }
  return out;
}

function poly1305(otk: Uint8Array, macData: Uint8Array): Uint8Array {
  const r = decodeLittleEndian(otk.subarray(0, 16)) & POLY1305_CLAMP;
  const s = decodeLittleEndian(otk.subarray(16, 32));
  let acc = 0n;
  for (let offset = 0; offset < macData.length; offset += 16) {
    const chunk = macData.subarray(offset, Math.min(offset + 16, macData.length));
    const n = decodeLittleEndian(chunk) | (1n << BigInt(chunk.length * 8));
    acc = ((acc + n) * r) % P1305;
  }
  let tagNum = (acc + s) & MASK128;
  const tag = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    tag[i] = Number(tagNum & 0xffn);
    tagNum >>= 8n;
  }
  return tag;
}

function pad16Length(len: number): number {
  const rem = len % 16;
  return rem === 0 ? 0 : 16 - rem;
}

function buildAeadMacData(aad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const aadPad = pad16Length(aad.length);
  const ctPad = pad16Length(ciphertext.length);
  const out = new Uint8Array(aad.length + aadPad + ciphertext.length + ctPad + 16);
  let offset = 0;
  out.set(aad, offset);
  offset += aad.length + aadPad;
  out.set(ciphertext, offset);
  offset += ciphertext.length + ctPad;
  const view = new DataView(out.buffer);
  view.setUint32(offset, aad.length >>> 0, true);
  view.setUint32(offset + 4, Math.floor(aad.length / 0x100000000), true);
  view.setUint32(offset + 8, ciphertext.length >>> 0, true);
  view.setUint32(offset + 12, Math.floor(ciphertext.length / 0x100000000), true);
  return out;
}

export function chacha20Poly1305Seal(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array = new Uint8Array(0),
): Uint8Array {
  const otk = chacha20Block(key, 0, nonce).subarray(0, 32);
  const ciphertext = chacha20Xor(key, 1, nonce, plaintext);
  const tag = poly1305(otk, buildAeadMacData(aad, ciphertext));
  return concatBytes(ciphertext, tag);
}

export function chacha20Poly1305Open(
  key: Uint8Array,
  nonce: Uint8Array,
  sealed: Uint8Array,
  aad: Uint8Array = new Uint8Array(0),
): Uint8Array {
  if (sealed.length < 16) throw new Error("Ciphertext too short");
  const ciphertext = sealed.subarray(0, sealed.length - 16);
  const tag = sealed.subarray(sealed.length - 16);
  const otk = chacha20Block(key, 0, nonce).subarray(0, 32);
  const expected = poly1305(otk, buildAeadMacData(aad, ciphertext));
  if (!constantTimeEqual(tag, expected)) {
    throw new Error("Authentication tag mismatch");
  }
  return chacha20Xor(key, 1, nonce, ciphertext);
}

// --- LING Remote Transport v2 Handshake & Encrypted Session ---

export interface LingV2HelloMessage {
  readonly t: "hello";
  readonly v: 2;
  readonly mid: string;
  readonly mpk: string;
  readonly mepk: string;
  readonly proof: string;
  readonly code?: string;
  readonly name?: string;
}

export interface LingV2WelcomeMessage {
  readonly t: "welcome";
  readonly depk: string;
  readonly mac: string;
}

export interface LingV2BoxMessage {
  readonly t: "box";
  readonly n: number;
  readonly c: string;
}

export interface LingV2ErrorMessage {
  readonly t: "err";
  readonly code: string;
}

export type LingV2WireMessage =
  | LingV2HelloMessage
  | LingV2WelcomeMessage
  | LingV2BoxMessage
  | LingV2ErrorMessage;

function makeNonce(seq: number): Uint8Array {
  if (!Number.isSafeInteger(seq) || seq < 0) throw new Error("Invalid sequence number");
  const nonce = new Uint8Array(12);
  const view = new DataView(nonce.buffer);
  view.setUint32(4, Math.floor(seq / 0x100000000), false);
  view.setUint32(8, seq >>> 0, false);
  return nonce;
}

export class LingE2eeSession {
  private txSeq = 0;
  private rxSeq = 0;

  constructor(
    private readonly txKey: Uint8Array,
    private readonly rxKey: Uint8Array,
  ) {}

  encrypt(plaintext: string): LingV2BoxMessage {
    const bytes = textEncoder.encode(plaintext);
    if (bytes.length > MAX_PLAINTEXT_BYTES) {
      throw new Error("Encrypted payload exceeds 1 MiB limit");
    }
    const seq = this.txSeq;
    this.txSeq += 1;
    const sealed = chacha20Poly1305Seal(this.txKey, makeNonce(seq), bytes);
    return { t: "box", n: seq, c: bytesToBase64(sealed) };
  }

  decrypt(box: LingV2BoxMessage): string {
    if (box.t !== "box" || box.n !== this.rxSeq || typeof box.c !== "string") {
      throw new Error("Invalid or replayed encrypted frame");
    }
    const sealed = base64ToBytes(box.c);
    if (sealed.length > MAX_PLAINTEXT_BYTES + 16) {
      throw new Error("Encrypted frame exceeds limit");
    }
    const plain = chacha20Poly1305Open(this.rxKey, makeNonce(box.n), sealed);
    this.rxSeq += 1;
    return textDecoder.decode(plain);
  }
}

function computeHelloProof(
  dh1: Uint8Array,
  dh2: Uint8Array,
  dpkHex: string,
  mpkHex: string,
  mepkHex: string,
  mid: string,
  code: string | undefined,
): Uint8Array {
  const salt = sha256(textEncoder.encode(`${dpkHex}|${mpkHex}|${mepkHex}`));
  const helloKey = hkdfSha256(
    concatBytes(dh1, dh2),
    salt,
    textEncoder.encode("ling-e2ee-v2-hello"),
    32,
  );
  return hmacSha256(helloKey, textEncoder.encode(`hello:${mid}:${code ?? ""}`));
}

function deriveSessionKeys(
  dh1: Uint8Array,
  dh2: Uint8Array,
  dh3: Uint8Array,
  dpkHex: string,
  mpkHex: string,
  mepkHex: string,
  depkHex: string,
): { c2sKey: Uint8Array; s2cKey: Uint8Array; welcomeMac: Uint8Array } {
  const salt = sha256(textEncoder.encode(`${dpkHex}|${mpkHex}|${mepkHex}|${depkHex}`));
  const okm = hkdfSha256(
    concatBytes(dh1, dh2, dh3),
    salt,
    textEncoder.encode("ling-e2ee-v2-session"),
    64,
  );
  const c2sKey = okm.subarray(0, 32);
  const s2cKey = okm.subarray(32, 64);
  const welcomeMac = hmacSha256(s2cKey, textEncoder.encode(`welcome:${depkHex}:${mepkHex}`));
  return { c2sKey, s2cKey, welcomeMac };
}

export interface MobileHandshakeState {
  readonly dh1: Uint8Array;
  readonly dh2: Uint8Array;
  readonly mEphPriv: Uint8Array;
  readonly dpkHex: string;
  readonly mpkHex: string;
  readonly mepkHex: string;
}

export function createMobileHello(input: {
  readonly mobileStaticPriv: Uint8Array;
  readonly mobileEphPriv: Uint8Array;
  readonly desktopPubHex: string;
  readonly mid: string;
  readonly code?: string;
  readonly name?: string;
}): { hello: LingV2HelloMessage; state: MobileHandshakeState } {
  const dpkBytes = hexToBytes(input.desktopPubHex);
  const mpkHex = bytesToHex(x25519PublicKey(input.mobileStaticPriv));
  const mepkHex = bytesToHex(x25519PublicKey(input.mobileEphPriv));
  const dh1 = x25519(input.mobileStaticPriv, dpkBytes);
  const dh2 = x25519(input.mobileEphPriv, dpkBytes);
  assertNonZeroSharedSecret(dh1);
  assertNonZeroSharedSecret(dh2);
  const proof = bytesToHex(
    computeHelloProof(dh1, dh2, input.desktopPubHex, mpkHex, mepkHex, input.mid, input.code),
  );
  return {
    hello: {
      t: "hello",
      v: 2,
      mid: input.mid,
      mpk: mpkHex,
      mepk: mepkHex,
      proof,
      ...(input.code ? { code: input.code } : {}),
      ...(input.name ? { name: input.name } : {}),
    },
    state: {
      dh1,
      dh2,
      mEphPriv: input.mobileEphPriv,
      dpkHex: input.desktopPubHex,
      mpkHex,
      mepkHex,
    },
  };
}

export function completeMobileHandshake(
  state: MobileHandshakeState,
  welcome: LingV2WelcomeMessage,
): LingE2eeSession {
  if (welcome.t !== "welcome" || !/^[0-9a-f]{64}$/.test(welcome.depk)) {
    throw new Error("Invalid desktop welcome message");
  }
  const dh3 = x25519(state.mEphPriv, hexToBytes(welcome.depk));
  assertNonZeroSharedSecret(dh3);
  const { c2sKey, s2cKey, welcomeMac } = deriveSessionKeys(
    state.dh1,
    state.dh2,
    dh3,
    state.dpkHex,
    state.mpkHex,
    state.mepkHex,
    welcome.depk,
  );
  if (!constantTimeEqual(hexToBytes(welcome.mac), welcomeMac)) {
    throw new Error("Desktop authentication failed");
  }
  return new LingE2eeSession(c2sKey, s2cKey);
}

export function acceptDesktopHello(input: {
  readonly desktopStaticPriv: Uint8Array;
  readonly desktopEphPriv: Uint8Array;
  readonly expectedMid: string;
  readonly hello: LingV2HelloMessage;
}): { welcome: LingV2WelcomeMessage; session: LingE2eeSession; peerPubHex: string } {
  const { hello } = input;
  if (
    hello.t !== "hello" ||
    hello.v !== 2 ||
    hello.mid !== input.expectedMid ||
    !/^[0-9a-f]{64}$/.test(hello.mpk) ||
    !/^[0-9a-f]{64}$/.test(hello.mepk) ||
    !/^[0-9a-f]{64}$/.test(hello.proof)
  ) {
    throw new Error("Invalid client hello");
  }
  const dpkHex = bytesToHex(x25519PublicKey(input.desktopStaticPriv));
  const depkHex = bytesToHex(x25519PublicKey(input.desktopEphPriv));
  const dh1 = x25519(input.desktopStaticPriv, hexToBytes(hello.mpk));
  const dh2 = x25519(input.desktopStaticPriv, hexToBytes(hello.mepk));
  assertNonZeroSharedSecret(dh1);
  assertNonZeroSharedSecret(dh2);
  const expectedProof = computeHelloProof(
    dh1,
    dh2,
    dpkHex,
    hello.mpk,
    hello.mepk,
    hello.mid,
    hello.code,
  );
  if (!constantTimeEqual(hexToBytes(hello.proof), expectedProof)) {
    throw new Error("Client hello proof mismatch");
  }
  const dh3 = x25519(input.desktopEphPriv, hexToBytes(hello.mepk));
  assertNonZeroSharedSecret(dh3);
  const { c2sKey, s2cKey, welcomeMac } = deriveSessionKeys(
    dh1,
    dh2,
    dh3,
    dpkHex,
    hello.mpk,
    hello.mepk,
    depkHex,
  );
  return {
    welcome: { t: "welcome", depk: depkHex, mac: bytesToHex(welcomeMac) },
    session: new LingE2eeSession(s2cKey, c2sKey),
    peerPubHex: hello.mpk,
  };
}
