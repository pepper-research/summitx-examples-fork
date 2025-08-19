/**
 * Centralized contract addresses for Base Camp Testnet
 * Chain ID: 123420001114
 */

import type { Address } from "viem";

// Core token addresses
export const NATIVE_TOKEN = "CAMP"; // Native token symbol
export const WCAMP_ADDRESS = "0x1aE9c40eCd2DD6ad5858E5430A556d7aff28A44b" as Address;

// DEX Router addresses
export const SMART_ROUTER_ADDRESS = "0x197b7c9fC5c8AeA84Ab2909Bf94f24370539722D" as Address;
export const V2_ROUTER_ADDRESS = "0x03B38A5C3cf55cB3B8D61Dc7eaB7BBC0ec276708" as Address;

// Factory addresses
export const V2_FACTORY_ADDRESS = "0xFe5498944B504FBf57DE0C76FB770974C0C54821" as Address;
export const V3_FACTORY_ADDRESS = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD" as Address;
export const STABLE_FACTORY_ADDRESS = "0xe6DF37F17A2261E6716E8B983cB8136581d02A8f" as Address;

// Position managers
export const NFT_POSITION_MANAGER = "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1" as Address;
export const MASTER_CHEF_V3 = "0xe9AE2Ea3B0edb4763a6Ca3Ee72e3f69D59db3Efb" as Address;

// Quoter addresses
export const QUOTER_V2_ADDRESS = "0x74b9D86e58dD86df5DA0e4B640bF1352f24624e5" as Address;
export const MIXED_ROUTE_QUOTER_V1 = "0xD96FE6bA10ced8C93f4Dd87819f432Cb97ED1dF0" as Address;

// Multicall addresses
export const MULTICALL3_ADDRESS = "0xe70E6Acc51fc76ceCd98ae97bD3052e3aD02Db31" as Address;

// Stable swap addresses
export const STABLE_SWAP_FACTORY = "0xe6DF37F17A2261E6716E8B983cB8136581d02A8f" as Address;
export const STABLE_SWAP_INFO = "0x30D33e1b36E4c8BDB638587e88572B6B1c1B26aa" as Address;

// Fee tiers for V3 pools (in basis points)
export const V3_FEE_TIERS = {
  LOWEST: 100,    // 0.01%
  LOW: 500,       // 0.05%
  MEDIUM: 3000,   // 0.3%
  HIGH: 10000,    // 1%
} as const;

// Tick spacings for V3 fee tiers
export const V3_TICK_SPACINGS = {
  [V3_FEE_TIERS.LOWEST]: 1,
  [V3_FEE_TIERS.LOW]: 10,
  [V3_FEE_TIERS.MEDIUM]: 60,
  [V3_FEE_TIERS.HIGH]: 200,
} as const;

// Network configuration
export const NETWORK_CONFIG = {
  chainId: 123420001114,
  name: "Base Camp Testnet",
  rpcUrl: "https://rpc-campnetwork.xyz",
  explorer: "https://basecamp.cloud.blockscout.com",
  nativeCurrency: {
    name: "CAMP",
    symbol: "CAMP",
    decimals: 18,
  },
} as const;

// Transaction defaults
export const TX_DEFAULTS = {
  slippageTolerance: 50n, // 0.5% in basis points
  deadlineMinutes: 20,
  gasBuffer: "0.01", // Reserve 0.01 native token for gas
} as const;

// Helper function to get deadline
export function getDeadline(minutes: number = TX_DEFAULTS.deadlineMinutes): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + minutes * 60);
}

// Helper function to apply slippage
export function applySlippage(amount: bigint, slippageBps: bigint = TX_DEFAULTS.slippageTolerance): bigint {
  return (amount * (10000n - slippageBps)) / 10000n;
}

// Export all addresses in a single object for convenience
export const CONTRACTS = {
  // Tokens
  WCAMP: WCAMP_ADDRESS,
  
  // Routers
  SMART_ROUTER: SMART_ROUTER_ADDRESS,
  V2_ROUTER: V2_ROUTER_ADDRESS,
  
  // Factories
  V2_FACTORY: V2_FACTORY_ADDRESS,
  V3_FACTORY: V3_FACTORY_ADDRESS,
  STABLE_FACTORY: STABLE_FACTORY_ADDRESS,
  
  // Position Management
  NFT_POSITION_MANAGER,
  MASTER_CHEF_V3,
  
  // Quoters
  QUOTER_V2: QUOTER_V2_ADDRESS,
  MIXED_ROUTE_QUOTER: MIXED_ROUTE_QUOTER_V1,
  
  // Utilities
  MULTICALL3: MULTICALL3_ADDRESS,
  
  // Stable
  STABLE_SWAP_FACTORY,
  STABLE_SWAP_INFO,
} as const;

export default CONTRACTS;