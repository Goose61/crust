#!/usr/bin/env node
/**
 * One-off: send devnet SOL from ARWEAVE_SOLANA_KEY wallet to a recipient.
 * Usage: node scripts/send-devnet-sol.mjs <recipient> [solAmount]
 * Default amount: all balance minus ~0.001 SOL fee reserve.
 */

import fs from "node:fs";
import path from "node:path";
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58decode(s) {
  const bytes = [];
  for (const c of s) {
    let carry = ALPHA.indexOf(c);
    if (carry < 0) throw new Error("Invalid base58 in ARWEAVE_SOLANA_KEY");
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 255;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 255);
      carry >>= 8;
    }
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes.reverse());
}

function loadKey() {
  const envPath = path.join(process.cwd(), ".env.local");
  const env = fs.readFileSync(envPath, "utf8");
  const m = env.match(/^ARWEAVE_SOLANA_KEY=(.+)$/m);
  if (!m) throw new Error("ARWEAVE_SOLANA_KEY not found in .env.local");
  return Keypair.fromSecretKey(b58decode(m[1].trim()));
}

const recipient = process.argv[2];
if (!recipient) {
  console.error("Usage: node scripts/send-devnet-sol.mjs <recipient> [solAmount]");
  process.exit(1);
}

const rpc = process.env.SOLANA_RPC_URL_DEVNET ?? "https://api.devnet.solana.com";
const kp = loadKey();
const conn = new Connection(rpc, "confirmed");

const balance = await conn.getBalance(kp.publicKey);
console.log("From:", kp.publicKey.toBase58());
console.log("Balance:", balance / LAMPORTS_PER_SOL, "SOL");

const feeReserve = 5000; // lamports
let lamports;
if (process.argv[3]) {
  lamports = Math.floor(parseFloat(process.argv[3]) * LAMPORTS_PER_SOL);
} else {
  lamports = balance - feeReserve;
}

if (lamports <= 0) {
  console.error("Insufficient balance to send.");
  process.exit(1);
}

const tx = new Transaction().add(
  SystemProgram.transfer({
    fromPubkey: kp.publicKey,
    toPubkey: recipient,
    lamports,
  }),
);

const sig = await sendAndConfirmTransaction(conn, tx, [kp]);
console.log("Sent", lamports / LAMPORTS_PER_SOL, "SOL to", recipient);
console.log("Signature:", sig);
console.log("Explorer:", `https://explorer.solana.com/tx/${sig}?cluster=devnet`);
