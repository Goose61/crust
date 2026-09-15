/** Irys bundler top-up adds 10% above the quoted byte price (see ensureIrysFundedForBytes). */
export const IRYS_BUNDLER_BUFFER_MULTIPLIER = 1.1;

/** Wallet payment adds 2% headroom (see payPlatformForArweaveStorage). */
export const STORAGE_WALLET_BUFFER_MULTIPLIER = 1.02;

/** Combined multiplier: Irys quote → amount sent to platform wallet. */
export const STORAGE_PAYMENT_MULTIPLIER =
  IRYS_BUNDLER_BUFFER_MULTIPLIER * STORAGE_WALLET_BUFFER_MULTIPLIER;

/** Typical Solana fee for the creator's storage payment transaction. */
export const STORAGE_PAYMENT_GAS_SOL = 0.00005;
