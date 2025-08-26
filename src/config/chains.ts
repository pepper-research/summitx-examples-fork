/**
 * Unified chain configuration with ChainMap pattern
 * Supports both Camp Testnet and Camp Mainnet
 */

import { ChainId } from "@summitx/chains";
import type { Address } from "viem";

// Type for chain-specific addresses
export type ChainMap<T> = {
  [ChainId.BASECAMP_TESTNET]: T;
  [ChainId.BASECAMP]: T;
};

// WCAMP addresses
export const WCAMP_ADDRESSES: ChainMap<Address> = {
  [ChainId.BASECAMP_TESTNET]: "0x1aE9c40eCd2DD6ad5858E5430A556d7aff28A44b",
  [ChainId.BASECAMP]: "0x3bd5C81a8Adf3355078Dc5F73c41d3194B316690",
};

// DEX Router addresses
export const SMART_ROUTER_ADDRESSES: ChainMap<Address> = {
  [ChainId.BASECAMP_TESTNET]: "0x197b7c9fC5c8AeA84Ab2909Bf94f24370539722D",
  [ChainId.BASECAMP]: "0xA688154E04544A9bc8F10F7B6717bF67d2fFCe9A",
};

export const V2_ROUTER_ADDRESSES: ChainMap<Address> = {
  [ChainId.BASECAMP_TESTNET]: "0x03B38A5C3cf55cB3B8D61Dc7eaB7BBC0ec276708",
  [ChainId.BASECAMP]: "0x38F7EE129C72ca0192eB58222942A88B7B33CC3C",
};

// Factory addresses
export const V2_FACTORY_ADDRESSES: ChainMap<Address> = {
  [ChainId.BASECAMP_TESTNET]: "0xFe5498944B504FBf57DE0C76FB770974C0C54821",
  [ChainId.BASECAMP]: "0x726ca2CB6bbFd7E288626f71A64E55A12ADf7cc7",
};

export const V3_FACTORY_ADDRESSES: ChainMap<Address> = {
  [ChainId.BASECAMP_TESTNET]: "0x56e72729b46fc7a5C18C3333ACDA52cB57936022",
  [ChainId.BASECAMP]: "0xBa08235b05d06A8A27822faCF3BaBeF4f972BF7d",
};

export const STABLE_FACTORY_ADDRESSES: ChainMap<Address> = {
  [ChainId.BASECAMP_TESTNET]: "0xe6DF37F17A2261E6716E8B983cB8136581d02A8f",
  [ChainId.BASECAMP]: "0xe6DF37F17A2261E6716E8B983cB8136581d02A8f",
};

// Position managers
export const NFT_POSITION_MANAGER_ADDRESSES: ChainMap<Address> = {
  [ChainId.BASECAMP_TESTNET]: "0x86e08b14ABb30d4E19811EC5C42074b87f6E46b1",
  [ChainId.BASECAMP]: "0x1D96b819DE6AE9Bab504Fb16E5273FCFA9A0Ff18",
};

export const MASTER_CHEF_V3_ADDRESSES: ChainMap<Address> = {
  [ChainId.BASECAMP_TESTNET]: "0xe9AE2Ea3B0edb4763a6Ca3Ee72e3f69D59db3Efb",
  [ChainId.BASECAMP]: "0xe9AE2Ea3B0edb4763a6Ca3Ee72e3f69D59db3Efb",
};

// Quoter addresses
export const QUOTER_V2_ADDRESSES: ChainMap<Address> = {
  [ChainId.BASECAMP_TESTNET]: "0x74b9D86e58dD86df5DA0e4B640bF1352f24624e5",
  [ChainId.BASECAMP]: "0xb9c37ab1abAD8DdD0F880C8A014fF7e9Eb5C2B60",
};

export const MIXED_ROUTE_QUOTER_ADDRESSES: ChainMap<Address> = {
  [ChainId.BASECAMP_TESTNET]: "0xD96FE6bA10ced8C93f4Dd87819f432Cb97ED1dF0",
  [ChainId.BASECAMP]: "0x465220a91ac19a7da174FFacA3178738034c2AB7",
};

// Multicall addresses
export const MULTICALL3_ADDRESSES: ChainMap<Address> = {
  [ChainId.BASECAMP_TESTNET]: "0xe70E6Acc51fc76ceCd98ae97bD3052e3aD02Db31",
  [ChainId.BASECAMP]: "0x9C585cbD20C7770E234e4184b840034395581101",
};

// Stable swap addresses
export const STABLE_SWAP_FACTORY_ADDRESSES: ChainMap<Address> = {
  [ChainId.BASECAMP_TESTNET]: "0xe6DF37F17A2261E6716E8B983cB8136581d02A8f",
  [ChainId.BASECAMP]: "0xe6DF37F17A2261E6716E8B983cB8136581d02A8f",
};

export const STABLE_SWAP_INFO_ADDRESSES: ChainMap<Address> = {
  [ChainId.BASECAMP_TESTNET]: "0x30D33e1b36E4c8BDB638587e88572B6B1c1B26aa",
  [ChainId.BASECAMP]: "0x30D33e1b36E4c8BDB638587e88572B6B1c1B26aa",
};

// Token addresses
export const USDC_ADDRESSES: ChainMap<Address> = {
  [ChainId.BASECAMP_TESTNET]: "0x71002dbf6cC7A885cE6563682932370c056aAca9",
  [ChainId.BASECAMP]: "0x977fdEF62CE095Ae8750Fd3496730F24F60dea7a",
};

export const USDT_ADDRESSES: ChainMap<Address> = {
  [ChainId.BASECAMP_TESTNET]: "0xA745f7A59E70205e6040BdD3b33eD21DBD23FEB3",
  [ChainId.BASECAMP]: "0xA745f7A59E70205e6040BdD3b33eD21DBD23FEB3", // Placeholder - needs actual mainnet address
};

export const DAI_ADDRESSES: ChainMap<Address> = {
  [ChainId.BASECAMP_TESTNET]: "0x5d3011cCc6d3431D671c9e69EEddA9C5C654B97F",
  [ChainId.BASECAMP]: "0x5d3011cCc6d3431D671c9e69EEddA9C5C654B97F", // Placeholder - needs actual mainnet address
};

export const WBTC_ADDRESSES: ChainMap<Address> = {
  [ChainId.BASECAMP_TESTNET]: "0x587aF234D373C752a6F6E9eD6c4Ce871E7528BCF",
  [ChainId.BASECAMP]: "0x587aF234D373C752a6F6E9eD6c4Ce871E7528BCF", // Placeholder - needs actual mainnet address
};

export const WETH_ADDRESSES: ChainMap<Address> = {
  [ChainId.BASECAMP_TESTNET]: "0xC42BAA20e3a159cF7A8aDFA924648C2a2d59E062",
  [ChainId.BASECAMP]: "0xC42BAA20e3a159cF7A8aDFA924648C2a2d59E062", // Placeholder - needs actual mainnet address
};

// RPC URLs
export const RPC_URLS: ChainMap<string[]> = {
  [ChainId.BASECAMP_TESTNET]: [
    "https://rpc-campnetwork.xyz",
  ],
  [ChainId.BASECAMP]: [
    "https://rpc.camp.raas.gelato.cloud",
  ],
};

// Block explorers
export const BLOCK_EXPLORERS: ChainMap<{ name: string; url: string }> = {
  [ChainId.BASECAMP_TESTNET]: {
    name: "Basecamp Explorer",
    url: "https://basecamp.cloud.blockscout.com",
  },
  [ChainId.BASECAMP]: {
    name: "Camp Explorer",
    url: "https://explorer.camp.raas.gelato.cloud",
  },
};

// Network names
export const NETWORK_NAMES: ChainMap<string> = {
  [ChainId.BASECAMP_TESTNET]: "Base Camp Testnet",
  [ChainId.BASECAMP]: "Camp Mainnet",
};

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

// Helper function to get contracts for a specific chain
export function getContractsForChain(chainId: ChainId.BASECAMP_TESTNET | ChainId.BASECAMP) {
  return {
    // Tokens
    WCAMP: WCAMP_ADDRESSES[chainId],
    
    // Routers
    SMART_ROUTER: SMART_ROUTER_ADDRESSES[chainId],
    V2_ROUTER: V2_ROUTER_ADDRESSES[chainId],
    
    // Factories
    V2_FACTORY: V2_FACTORY_ADDRESSES[chainId],
    V3_FACTORY: V3_FACTORY_ADDRESSES[chainId],
    STABLE_FACTORY: STABLE_FACTORY_ADDRESSES[chainId],
    
    // Position Management
    NFT_POSITION_MANAGER: NFT_POSITION_MANAGER_ADDRESSES[chainId],
    MASTER_CHEF_V3: MASTER_CHEF_V3_ADDRESSES[chainId],
    
    // Quoters
    QUOTER_V2: QUOTER_V2_ADDRESSES[chainId],
    MIXED_ROUTE_QUOTER: MIXED_ROUTE_QUOTER_ADDRESSES[chainId],
    
    // Utilities
    MULTICALL3: MULTICALL3_ADDRESSES[chainId],
    
    // Stable
    STABLE_SWAP_FACTORY: STABLE_SWAP_FACTORY_ADDRESSES[chainId],
    STABLE_SWAP_INFO: STABLE_SWAP_INFO_ADDRESSES[chainId],
  };
}

// Export default chain configurations
export const CHAIN_CONFIGS = {
  [ChainId.BASECAMP_TESTNET]: {
    id: ChainId.BASECAMP_TESTNET,
    name: NETWORK_NAMES[ChainId.BASECAMP_TESTNET],
    network: "Basecamp",
    nativeCurrency: {
      decimals: 18,
      name: "CAMP",
      symbol: "CAMP",
    },
    rpcUrls: {
      default: {
        http: RPC_URLS[ChainId.BASECAMP_TESTNET],
      },
      public: {
        http: RPC_URLS[ChainId.BASECAMP_TESTNET],
      },
    },
    blockExplorers: {
      default: BLOCK_EXPLORERS[ChainId.BASECAMP_TESTNET],
    },
    contracts: {
      multicall3: {
        address: MULTICALL3_ADDRESSES[ChainId.BASECAMP_TESTNET],
        blockCreated: 8755587,
      },
    },
  },
  [ChainId.BASECAMP]: {
    id: ChainId.BASECAMP,
    name: NETWORK_NAMES[ChainId.BASECAMP],
    network: "Camp",
    nativeCurrency: {
      decimals: 18,
      name: "CAMP",
      symbol: "CAMP",
    },
    rpcUrls: {
      default: {
        http: RPC_URLS[ChainId.BASECAMP],
      },
      public: {
        http: RPC_URLS[ChainId.BASECAMP],
      },
    },
    blockExplorers: {
      default: BLOCK_EXPLORERS[ChainId.BASECAMP],
    },
    contracts: {
      multicall3: {
        address: MULTICALL3_ADDRESSES[ChainId.BASECAMP],
        blockCreated: 0,
      },
    },
  },
};