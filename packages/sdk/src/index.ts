export * from "./client.ts";
export * from "./crypto.ts";
export type * from "../../shared/src/types.ts";

/** Plaintext shapes that get sealed. */
export interface SealedBudget { maxPrice: number; asset: "USDC"; note?: string }
export interface SealedBidBody { price: number; etaMinutes?: number; note?: string }
