// Sepolia TradeJournal writer. The journal is the verifiable on-chain
// mirror of the paper trades: one recordTrade() call per executed trade.
// Testnet only (Base Sepolia). The key is read ONLY from the environment
// (TRADE_JOURNAL_KEY) at run time — never from a file, never printed.

import { existsSync, readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { SEPOLIA_RPC } from "./config.js";
import type { ExecutedTrade } from "./types.js";

export const TRADE_JOURNAL_ABI = [
  {
    inputs: [
      { name: "symbol", type: "string" },
      { name: "isBuy", type: "bool" },
      { name: "amount", type: "uint256" },
      { name: "price", type: "uint256" },
      { name: "reasonHash", type: "bytes32" },
    ],
    name: "recordTrade",
    outputs: [{ name: "id", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

/** keccak256 of the UTF-8 reason string — deterministic, reproducible. */
export function reasonHash(reason: string): `0x${string}` {
  return keccak256(toHex(reason));
}

/** Pending nonce for an address on Base Sepolia (includes mempool txs). */
export async function getPendingNonce(address: `0x${string}`): Promise<number> {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(SEPOLIA_RPC),
  });
  return client.getTransactionCount({ address, blockTag: "pending" });
}

/** Record one executed trade on-chain. Returns the tx hash.
 *  amount: token units with 8 decimals (B20 decimals). price: USD with 8
 *  decimals (Chainlink style). Pass an explicit `nonce` when several
 *  writes are sent in quick succession — the node can hand out a stale
 *  pending nonce otherwise (observed: 3/10 writes failed that way). */
export async function recordTradeOnChain(
  contractAddress: `0x${string}`,
  privateKey: `0x${string}`,
  trade: ExecutedTrade,
  opts?: { nonce?: number },
): Promise<string> {
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(SEPOLIA_RPC),
  });
  const amount = BigInt(Math.round(trade.tokens * 1e8));
  const price = BigInt(Math.round(trade.price * 1e8));
  const hash = await wallet.writeContract({
    address: contractAddress,
    abi: TRADE_JOURNAL_ABI,
    functionName: "recordTrade",
    args: [
      trade.symbol,
      trade.side === "BUY",
      amount,
      price,
      reasonHash(trade.reason),
    ],
    ...(opts?.nonce !== undefined ? { nonce: opts.nonce } : {}),
  });
  return hash;
}

/** Read the deployed journal address from contracts/deployment-sepolia.json.
 *  Returns null when the contract is not deployed yet (journal is skipped,
 *  paper trades still run locally). */
export function readDeployment(
  path: string,
): { address: `0x${string}`; txHash?: string; chainId?: number } | null {
  try {
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      address?: string;
      txHash?: string;
      chainId?: number;
    };
    if (!raw.address || !raw.address.startsWith("0x")) return null;
    return {
      address: raw.address as `0x${string}`,
      txHash: raw.txHash,
      chainId: raw.chainId,
    };
  } catch {
    return null;
  }
}
