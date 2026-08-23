/**
 * Server-side Irys price helpers (upload happens client-side; minter pays).
 */

export {
  IRYS_GATEWAY,
  IRYS_NODE_DEVNET,
  IRYS_NODE_MAINNET,
  fetchIrysPriceLamports,
  irysNodeFromRpc,
} from "./irys-shared";

import { fetchIrysPriceLamports } from "./irys-shared";
import { isDevnetNetwork } from "./solana-config";

/** @deprecated Server-side upload removed — minter pays via browser Irys uploader. */
export async function getIrysPrice(bytes: number): Promise<bigint> {
  return fetchIrysPriceLamports(bytes, isDevnetNetwork());
}
