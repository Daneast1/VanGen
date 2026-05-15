/// <reference lib="webworker" />
import * as secp from "@noble/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha2";
import { ripemd160 } from "@noble/hashes/legacy";
import { base58check } from "@scure/base";

const b58check = base58check(sha256);

type StartMsg = {
  type: "start";
  chain: "btc" | "eth";
  pattern: string;
  position: "prefix" | "suffix";
  caseSensitive: boolean;
};
type StopMsg = { type: "stop" };
type Msg = StartMsg | StopMsg;

let running = false;
const HEX = "0123456789abcdef";
const bytesToHex = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i++) s += HEX[b[i] >> 4] + HEX[b[i] & 15];
  return s;
};

const ethAddress = (pub: Uint8Array) =>
  "0x" + bytesToHex(keccak_256(pub.slice(1)).slice(-20));

const btcAddress = (pub: Uint8Array) => {
  const rip = ripemd160(sha256(pub));
  const payload = new Uint8Array(21);
  payload[0] = 0x00;
  payload.set(rip, 1);
  return b58check.encode(payload);
};

function matches(
  addr: string,
  pattern: string,
  position: "prefix" | "suffix",
  cs: boolean,
  chain: "btc" | "eth"
) {
  const target = chain === "btc" && position === "prefix" ? addr.slice(1) : addr;
  const a = cs ? target : target.toLowerCase();
  const p = cs ? pattern : pattern.toLowerCase();
  const haystack = chain === "eth" && position === "prefix" ? a.slice(2) : a;
  return position === "prefix" ? haystack.startsWith(p) : haystack.endsWith(p);
}

self.onmessage = (e: MessageEvent<Msg>) => {
  const msg = e.data;
  if (msg.type === "stop") {
    running = false;
    return;
  }
  if (msg.type !== "start") return;

  running = true;
  const { chain, pattern, position, caseSensitive } = msg;
  let attempts = 0;
  const BATCH = 500;
  let lastReport = performance.now();

  const tick = () => {
    if (!running) return;
    for (let i = 0; i < BATCH; i++) {
      const priv = secp.utils.randomSecretKey();
      const pub = secp.getPublicKey(priv, chain === "btc");
      const addr = chain === "eth" ? ethAddress(pub) : btcAddress(pub);
      attempts++;
      if (matches(addr, pattern, position, caseSensitive, chain)) {
        (self as unknown as Worker).postMessage({
          type: "found",
          address: addr,
          privateKey: bytesToHex(priv),
          attempts,
        });
        running = false;
        return;
      }
    }
    const now = performance.now();
    if (now - lastReport > 250) {
      (self as unknown as Worker).postMessage({ type: "progress", attempts });
      attempts = 0;
      lastReport = now;
    }
    setTimeout(tick, 0);
  };
  tick();
};

export {};
