import { ChainId } from "@summitx/chains";
import { Token } from "@summitx/swap-sdk-core";
import type { PublicClient } from "viem";
import { createPublicClient, http } from "viem";

// Camp mainnet configuration
export const CAMP_MAINNET = ChainId.BASECAMP;

export const campMainnet = {
  id: CAMP_MAINNET,
  name: "Camp Mainnet",
  network: "Camp",
  nativeCurrency: {
    decimals: 18,
    name: "CAMP",
    symbol: "CAMP",
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.camp.raas.gelato.cloud"],
    },
    public: {
      http: ["https://rpc.camp.raas.gelato.cloud"],
    },
  },
  blockExplorers: {
    etherscan: {
      name: "Camp Explorer",
      url: "https://camp.cloud.blockscout.com",
    },
    default: {
      name: "Camp Explorer",
      url: "https://camp.cloud.blockscout.com",
    },
  },
  contracts: {
    multicall3: {
      address: "0x9C585cbD20C7770E234e4184b840034395581101" as `0x${string}`,
      blockCreated: 0,
    },
  },
};

// RPC endpoints for Camp mainnet
export const RPC_ENDPOINTS = ["https://rpc.camp.raas.gelato.cloud"];

// Smart router addresses - THESE NEED TO BE UPDATED WITH ACTUAL MAINNET ADDRESSES
export const SMART_ROUTER_ADDRESS =
  "0xA688154E04544A9bc8F10F7B6717bF67d2fFCe9A";
export const V2_ROUTER_ADDRESS = "0x38F7EE129C72ca0192eB58222942A88B7B33CC3C";
export const V2_FACTORY_ADDRESS = "0x726ca2CB6bbFd7E288626f71A64E55A12ADf7cc7";
export const V3_QUOTER_ADDRESS = "0xb9c37ab1abAD8DdD0F880C8A014fF7e9Eb5C2B60";
export const MIXED_ROUTE_QUOTER_ADDRESS =
  "0x465220a91ac19a7da174FFacA3178738034c2AB7";

// Common tokens on Camp mainnet - THESE NEED TO BE UPDATED WITH ACTUAL MAINNET ADDRESSES
export const WCAMP_ADDRESS = "0x3bd5C81a8Adf3355078Dc5F73c41d3194B316690";
export const USDC_ADDRESS = "0x977fdEF62CE095Ae8750Fd3496730F24F60dea7a";

// Token instances
export const campMainnetTokens = {
  wcamp: new Token(
    CAMP_MAINNET,
    WCAMP_ADDRESS,
    18,
    "WCAMP",
    "Wrapped CAMP",
    ""
  ),
  // weth: new Token(
  //   CAMP_MAINNET,
  //   WETH_ADDRESS,
  //   18,
  //   "WETH",
  //   "Wrapped Ether",
  //   "https://ethereum.org"
  // ),
  // wbtc: new Token(
  //   CAMP_MAINNET,
  //   WBTC_ADDRESS,
  //   18,
  //   "WBTC",
  //   "Wrapped Bitcoin",
  //   "https://bitcoin.org"
  // ),
  usdc: new Token(
    CAMP_MAINNET,
    USDC_ADDRESS,
    6,
    "USDC",
    "USD Coin",
    "https://www.circle.com/usdc"
  ),
  // usdt: new Token(
  //   CAMP_MAINNET,
  //   USDT_ADDRESS,
  //   6,
  //   "USDT",
  //   "Tether USD",
  //   "https://tether.to"
  // ),
  // dai: new Token(
  //   CAMP_MAINNET,
  //   DAI_ADDRESS,
  //   18,
  //   "DAI",
  //   "Dai Stablecoin",
  //   "https://dai.io"
  // ),
};

// Base tokens for routing
export const BASE_TOKENS = [
  campMainnetTokens.wcamp,
  campMainnetTokens.usdc,
  // campMainnetTokens.usdt,
  // campMainnetTokens.dai,
  // campMainnetTokens.wbtc,
  // campMainnetTokens.weth,
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
export function createCampMainnetClient(rpcUrl?: string): PublicClient {
  return createPublicClient({
    chain: campMainnet,
    transport: http(rpcUrl || RPC_ENDPOINTS[0]),
    batch: {
      multicall: true,
    },
  }) as PublicClient;
}

// Get all RPC clients for fallback
export function createAllRpcClients(): PublicClient[] {
  return RPC_ENDPOINTS.map((url) => createCampMainnetClient(url));
}
