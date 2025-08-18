import { ChainId } from "@summitx/chains";
import { Token } from "@summitx/swap-sdk-core";
import type { PublicClient } from "viem";
import { createPublicClient, http } from "viem";

// Base testnet configuration
export const BASECAMP_TESTNET = ChainId.BASECAMP_TESTNET;

export const basecampTestnet = {
  id: 123420001114,
  name: "Basecamp",
  network: "Basecamp",
  nativeCurrency: {
    decimals: 18,
    name: "CAMP",
    symbol: "CAMP",
  },
  rpcUrls: {
    default: {
      http: ["https://rpc-campnetwork.xyz"],
    },
    public: {
      http: ["https://rpc-campnetwork.xyz"],
    },
  },
  blockExplorers: {
    etherscan: {
      name: "Basecamp Explorer",
      url: "https://basecamp.cloud.blockscout.com/",
    },
    default: {
      name: "Basecamp Explorer",
      url: "https://basecamp.cloud.blockscout.com/",
    },
  },
  contracts: {
    multicall3: {
      address: "0xe70E6Acc51fc76ceCd98ae97bD3052e3aD02Db31" as `0x${string}`,
      blockCreated: 8755587,
    },
  },
};

// RPC endpoints for Base testnet
export const RPC_ENDPOINTS = ["https://rpc-campnetwork.xyz"];

// Smart router addresses
export const SMART_ROUTER_ADDRESS =
  "0x197b7c9fC5c8AeA84Ab2909Bf94f24370539722D";
export const V2_ROUTER_ADDRESS = "0x03B38A5C3cf55cB3B8D61Dc7eaB7BBC0ec276708";
export const V3_QUOTER_ADDRESS = "0x5EA31C4313553B46317A54Cb0a922F8E4DE9166D";
export const MIXED_ROUTE_QUOTER_ADDRESS =
  "0x5Fe5d9c8a98858694a314e96bfb8377Aa18826d1";

// Common tokens on Base testnet
export const WCAMP_ADDRESS = "0x1aE9c40eCd2DD6ad5858E5430A556d7aff28A44b";
export const USDC_ADDRESS = "0x71002dbf6cC7A885cE6563682932370c056aAca9";
export const USDT_ADDRESS = "0xA745f7A59E70205e6040BdD3b33eD21DBD23FEB3";
export const DAI_ADDRESS = "0x5d3011cCc6d3431D671c9e69EEddA9C5C654B97F";
export const WBTC_ADDRESS = "0x587aF234D373C752a6F6E9eD6c4Ce871e7528BCF";
export const WETH_ADDRESS = "0xC42BAA20e3a159cF7A8aDFA924648C2a2d59E062";

// Token instances
export const baseCampTestnetTokens = {
  wcamp: new Token(
    BASECAMP_TESTNET,
    WCAMP_ADDRESS, // WCAMP and WETH share the same address on Base Camp testnet
    18,
    "WCAMP",
    "Wrapped CAMP",
    ""
  ),
  weth: new Token(
    BASECAMP_TESTNET,
    WETH_ADDRESS,
    18,
    "WETH",
    "Wrapped Ether",
    "https://ethereum.org"
  ),
  wbtc: new Token(
    BASECAMP_TESTNET,
    WBTC_ADDRESS,
    18,
    "WBTC",
    "Wrapped Bitcoin",
    "https://bitcoin.org"
  ),
  usdc: new Token(
    BASECAMP_TESTNET,
    USDC_ADDRESS,
    6,
    "USDC",
    "USD Coin",
    "https://www.circle.com/usdc"
  ),
  usdt: new Token(
    BASECAMP_TESTNET,
    USDT_ADDRESS,
    6,
    "USDT",
    "Tether USD",
    "https://tether.to"
  ),
  dai: new Token(
    BASECAMP_TESTNET,
    DAI_ADDRESS,
    18,
    "DAI",
    "Dai Stablecoin",
    "https://dai.io"
  ),
};

// Export alias for backward compatibility
export const baseTestnetTokens = baseCampTestnetTokens;

// Base tokens for routing
export const BASE_TOKENS = [
  baseCampTestnetTokens.wcamp,
  baseCampTestnetTokens.usdc,
  baseCampTestnetTokens.usdt,
  baseCampTestnetTokens.dai,
  baseCampTestnetTokens.wbtc,
  baseCampTestnetTokens.weth,
];

// Multicall configuration
export const MULTICALL_CONFIG = {
  defaultConfig: {
    gasLimitPerCall: 1_000_000,
  },
  gasErrorFailureOverride: {
    gasLimitPerCall: 2_000_000,
  },
  successRateFailureOverrides: {
    gasLimitPerCall: 2_000_000,
  },
};

// Create public client for RPC calls
export function createBaseTestnetClient(rpcUrl?: string): PublicClient {
  return createPublicClient({
    chain: basecampTestnet,
    transport: http(rpcUrl || RPC_ENDPOINTS[0]),
    batch: {
      multicall: true,
    },
  }) as PublicClient;
}

// Get all RPC clients for fallback
export function createAllRpcClients(): PublicClient[] {
  return RPC_ENDPOINTS.map((url) => createBaseTestnetClient(url));
}
