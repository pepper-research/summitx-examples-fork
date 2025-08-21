/**
 * Reusable liquidity helper functions
 * Standard utilities for liquidity management across V2 and V3
 */

import {
  type Address,
  type PublicClient,
  type WalletClient,
  formatUnits,
  parseUnits,
} from "viem";
import { CONTRACTS, TX_DEFAULTS, getDeadline, applySlippage } from "../config/contracts";
import { ABIS } from "../config/abis";
import { logger } from "./logger";
import { waitForTransaction, delay } from "./transaction-helpers";

// Types
export interface TokenInfo {
  address: Address;
  symbol: string;
  decimals: number;
  balance: bigint;
  name?: string;
}

export interface V2PairInfo {
  pairAddress: Address;
  token0: Address;
  token1: Address;
  reserve0: bigint;
  reserve1: bigint;
  totalSupply: bigint;
}

export interface V3PoolInfo {
  poolAddress: Address;
  token0: Address;
  token1: Address;
  fee: number;
  tickSpacing: number;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
}

export interface LiquidityPosition {
  protocol: "V2" | "V3";
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  liquidity: bigint;
  share?: number; // For V2
  tokenId?: bigint; // For V3
  tickLower?: number; // For V3
  tickUpper?: number; // For V3
}

// Token helpers
export async function getTokenInfo(
  publicClient: PublicClient,
  tokenAddress: Address,
  userAddress: Address
): Promise<TokenInfo> {
  // Handle undefined or invalid addresses
  if (!tokenAddress) {
    return {
      address: "0x0000000000000000000000000000000000000000" as Address,
      symbol: "UNKNOWN",
      decimals: 18,
      balance: 0n,
      name: "Unknown Token"
    };
  }
  
  // Known token mappings for Base Camp testnet (fallback for buggy contracts)
  const knownTokens: Record<string, { symbol: string, decimals: number, name: string }> = {
    "0x1ae9c40ecd2dd6ad5858e5430a556d7aff28a44b": { symbol: "wCAMP", decimals: 18, name: "Wrapped CAMP" },
    "0x71002dbf6cc7a885ce6563682932370c056aaca9": { symbol: "MUSDC", decimals: 6, name: "Mock USDC" },
    "0xa745f7a59e70205e6040bdd3b33ed21dbd23feb3": { symbol: "MUSDT", decimals: 6, name: "Mock USDT" },
    "0x5d3011ccc6d3431d671c9e69eedda9c5c654b97f": { symbol: "DAI", decimals: 18, name: "DAI Stablecoin" },
    "0xc42baa20e3a159cf7a8adfa924648c2a2d59e062": { symbol: "WETH", decimals: 18, name: "Wrapped ETH" },
    "0x587af234d373c752a6f6e9ed6c4ce871e7528bcf": { symbol: "WBTC", decimals: 8, name: "Wrapped BTC" }
  };
  
  const addressLower = tokenAddress?.toLowerCase() || "";
  const fallback = knownTokens[addressLower];
  
  // Try to get actual values, but use fallbacks if contracts are buggy
  let symbol = fallback?.symbol || "UNKNOWN";
  let decimals = fallback?.decimals || 18;
  let balance = 0n;
  let name = fallback?.name;
  
  try {
    // Try to get balance (usually works even when symbol/decimals fail)
    balance = await publicClient.readContract({
      address: tokenAddress,
      abi: ABIS.ERC20,
      functionName: "balanceOf",
      args: [userAddress],
    });
  } catch (e) {
    console.warn(`Failed to get balance for ${tokenAddress}`);
  }
  
  // Only try symbol/decimals if we don't have fallback or if explicitly needed
  if (!fallback) {
    try {
      symbol = await publicClient.readContract({
        address: tokenAddress,
        abi: ABIS.ERC20,
        functionName: "symbol",
      });
    } catch (e: any) {
      if (e.message?.includes('StackOverflow')) {
        console.warn(`Token ${tokenAddress} has StackOverflow bug in symbol(), using fallback`);
      }
      symbol = `TOKEN_${tokenAddress.slice(0, 6)}`;
    }
    
    try {
      decimals = await publicClient.readContract({
        address: tokenAddress,
        abi: ABIS.ERC20,
        functionName: "decimals",
      });
    } catch (e) {
      console.warn(`Failed to get decimals for ${tokenAddress}, using 18`);
      decimals = 18;
    }
    
    try {
      name = await publicClient.readContract({
        address: tokenAddress,
        abi: ABIS.ERC20,
        functionName: "name",
      });
    } catch (e) {
      // Name is optional
    }
  }

  return { address: tokenAddress, symbol, decimals, balance, name };
}

export async function checkAndApproveToken(
  walletClient: WalletClient,
  publicClient: PublicClient,
  tokenAddress: Address,
  amount: bigint,
  spender: Address,
  tokenSymbol?: string
): Promise<void> {
  const account = walletClient.account?.address;
  if (!account) throw new Error("No account connected");

  const allowance = await publicClient.readContract({
    address: tokenAddress,
    abi: ABIS.ERC20,
    functionName: "allowance",
    args: [account, spender],
  });

  if (allowance < amount) {
    logger.info(`📝 Approving ${tokenSymbol || tokenAddress} for ${formatUnits(amount, 18)}...`);
    
    const hash = await walletClient.writeContract({
      address: tokenAddress,
      abi: ABIS.ERC20,
      functionName: "approve",
      args: [spender, amount],
    });
    
    await waitForTransaction(publicClient, hash, `${tokenSymbol || "token"} approval`);
    
    // Add a delay after approval to ensure the transaction is fully processed
    await delay(3000, "⏳ Waiting 3 seconds after approval before proceeding...");
  } else {
    logger.info(`✅ ${tokenSymbol || "Token"} already approved`);
  }
}

// V2 Liquidity helpers
export async function getV2PairInfo(
  publicClient: PublicClient,
  tokenA: Address,
  tokenB: Address
): Promise<V2PairInfo | null> {
  const pairAddress = await publicClient.readContract({
    address: CONTRACTS.V2_FACTORY,
    abi: ABIS.V2_FACTORY,
    functionName: "getPair",
    args: [tokenA, tokenB],
  });

  if (pairAddress === "0x0000000000000000000000000000000000000000") {
    return null;
  }

  const [reserves, token0, token1, totalSupply] = await Promise.all([
    publicClient.readContract({
      address: pairAddress,
      abi: ABIS.V2_PAIR,
      functionName: "getReserves",
    }),
    publicClient.readContract({
      address: pairAddress,
      abi: ABIS.V2_PAIR,
      functionName: "token0",
    }),
    publicClient.readContract({
      address: pairAddress,
      abi: ABIS.V2_PAIR,
      functionName: "token1",
    }),
    publicClient.readContract({
      address: pairAddress,
      abi: ABIS.V2_PAIR,
      functionName: "totalSupply",
    }),
  ]);

  // Order reserves based on input token order
  const isOrderCorrect = token0.toLowerCase() === tokenA.toLowerCase();
  const [reserve0, reserve1] = isOrderCorrect 
    ? [reserves[0], reserves[1]] 
    : [reserves[1], reserves[0]];

  return {
    pairAddress,
    token0: tokenA,
    token1: tokenB,
    reserve0,
    reserve1,
    totalSupply,
  };
}

export async function calculateV2OptimalAmounts(
  publicClient: PublicClient,
  tokenA: Address,
  tokenB: Address,
  amountA: bigint
): Promise<{ amountB: bigint; isNewPair: boolean }> {
  const pairInfo = await getV2PairInfo(publicClient, tokenA, tokenB);
  
  if (!pairInfo) {
    return { amountB: 0n, isNewPair: true };
  }

  // Calculate optimal amount B based on current reserves
  const amountB = await publicClient.readContract({
    address: CONTRACTS.V2_ROUTER,
    abi: ABIS.V2_ROUTER,
    functionName: "quote",
    args: [amountA, pairInfo.reserve0, pairInfo.reserve1],
  });

  return { amountB, isNewPair: false };
}

// V3 Liquidity helpers
export async function getV3PoolInfo(
  publicClient: PublicClient,
  tokenA: Address,
  tokenB: Address,
  fee: number
): Promise<V3PoolInfo | null> {
  const poolAddress = await publicClient.readContract({
    address: CONTRACTS.V3_FACTORY,
    abi: ABIS.V3_FACTORY,
    functionName: "getPool",
    args: [tokenA, tokenB, fee],
  });

  if (poolAddress === "0x0000000000000000000000000000000000000000") {
    return null;
  }

  const [slot0, liquidity, tickSpacing, token0, token1] = await Promise.all([
    publicClient.readContract({
      address: poolAddress,
      abi: ABIS.V3_POOL,
      functionName: "slot0",
    }),
    publicClient.readContract({
      address: poolAddress,
      abi: ABIS.V3_POOL,
      functionName: "liquidity",
    }),
    publicClient.readContract({
      address: poolAddress,
      abi: ABIS.V3_POOL,
      functionName: "tickSpacing",
    }),
    publicClient.readContract({
      address: poolAddress,
      abi: ABIS.V3_POOL,
      functionName: "token0",
    }),
    publicClient.readContract({
      address: poolAddress,
      abi: ABIS.V3_POOL,
      functionName: "token1",
    }),
  ]);

  // slot0 returns a tuple: [sqrtPriceX96, tick, observationIndex, observationCardinality, observationCardinalityNext, feeProtocol, unlocked]
  const [sqrtPriceX96, tick] = slot0 as any;

  return {
    poolAddress,
    token0,
    token1,
    fee,
    tickSpacing,
    sqrtPriceX96,
    tick,
    liquidity,
  };
}

// Price and tick calculations for V3
export function tickToPrice(tick: number): number {
  if (!isFinite(tick)) {
    throw new Error(`Invalid tick value: ${tick}`);
  }
  return Math.pow(1.0001, tick);
}

export function priceToTick(price: number): number {
  if (!price || price <= 0 || !isFinite(price)) {
    throw new Error(`Invalid price value: ${price}`);
  }
  return Math.floor(Math.log(price) / Math.log(1.0001));
}

export function getNearestUsableTick(tick: number, tickSpacing: number): number {
  if (!isFinite(tick) || !tickSpacing) {
    throw new Error(`Invalid tick (${tick}) or tickSpacing (${tickSpacing})`);
  }
  return Math.round(tick / tickSpacing) * tickSpacing;
}

export function calculateV3PriceRange(tickLower: number, tickUpper: number) {
  if (!isFinite(tickLower) || !isFinite(tickUpper)) {
    throw new Error(`Invalid tick range: tickLower=${tickLower}, tickUpper=${tickUpper}`);
  }
  const priceLower = tickToPrice(tickLower);
  const priceUpper = tickToPrice(tickUpper);
  return { priceLower, priceUpper };
}

export function encodePriceSqrt(reserve1: bigint, reserve0: bigint): bigint {
  return (BigInt(reserve1) << 96n) / BigInt(reserve0);
}

// Native token helpers
export async function getNativeBalance(
  publicClient: PublicClient,
  address: Address
): Promise<bigint> {
  return publicClient.getBalance({ address });
}

export function isNativeToken(tokenAddress: Address): boolean {
  return tokenAddress.toLowerCase() === CONTRACTS.WCAMP.toLowerCase();
}

export async function hasEnoughNativeForGas(
  publicClient: PublicClient,
  address: Address,
  amount: bigint,
  gasBuffer: string = TX_DEFAULTS.gasBuffer
): Promise<boolean> {
  const balance = await getNativeBalance(publicClient, address);
  const buffer = parseUnits(gasBuffer, 18);
  return balance >= amount + buffer;
}

// Position helpers
export async function getUserV2Positions(
  publicClient: PublicClient,
  userAddress: Address
): Promise<any[]> {
  const positions = [];
  
  const pairsLength = await publicClient.readContract({
    address: CONTRACTS.V2_FACTORY,
    abi: ABIS.V2_FACTORY,
    functionName: "allPairsLength",
  });

  for (let i = 0n; i < pairsLength; i++) {
    const pairAddress = await publicClient.readContract({
      address: CONTRACTS.V2_FACTORY,
      abi: ABIS.V2_FACTORY,
      functionName: "allPairs",
      args: [i],
    });

    const lpBalance = await publicClient.readContract({
      address: pairAddress,
      abi: ABIS.V2_PAIR,
      functionName: "balanceOf",
      args: [userAddress],
    });

    if (lpBalance > 0n) {
      const [token0, token1, reserves, totalSupply] = await Promise.all([
        publicClient.readContract({
          address: pairAddress,
          abi: ABIS.V2_PAIR,
          functionName: "token0",
        }),
        publicClient.readContract({
          address: pairAddress,
          abi: ABIS.V2_PAIR,
          functionName: "token1",
        }),
        publicClient.readContract({
          address: pairAddress,
          abi: ABIS.V2_PAIR,
          functionName: "getReserves",
        }),
        publicClient.readContract({
          address: pairAddress,
          abi: ABIS.V2_PAIR,
          functionName: "totalSupply",
        }),
      ]);

      const poolShare = Number((lpBalance * 10000n) / totalSupply) / 100;
      const token0Amount = (reserves[0] * lpBalance) / totalSupply;
      const token1Amount = (reserves[1] * lpBalance) / totalSupply;

      positions.push({
        pairAddress,
        token0,
        token1,
        lpBalance,
        totalSupply,
        reserve0: reserves[0],
        reserve1: reserves[1],
        poolShare,
        token0Amount,
        token1Amount,
      });
    }
  }

  return positions;
}

export async function getUserV3Positions(
  publicClient: PublicClient,
  userAddress: Address
): Promise<any[]> {
  const positions = [];
  
  try {
    const balance = await publicClient.readContract({
      address: CONTRACTS.NFT_POSITION_MANAGER,
      abi: ABIS.NFT_POSITION_MANAGER,
      functionName: "balanceOf",
      args: [userAddress],
    });

    for (let i = 0n; i < balance; i++) {
      const tokenId = await publicClient.readContract({
        address: CONTRACTS.NFT_POSITION_MANAGER,
        abi: ABIS.NFT_POSITION_MANAGER,
        functionName: "tokenOfOwnerByIndex",
        args: [userAddress, i],
      });

      const position = await publicClient.readContract({
        address: CONTRACTS.NFT_POSITION_MANAGER,
        abi: ABIS.NFT_POSITION_MANAGER,
        functionName: "positions",
        args: [tokenId],
      });

      // The positions function returns a tuple with these fields in order:
      // nonce, operator, token0, token1, fee, tickLower, tickUpper, liquidity,
      // feeGrowthInside0LastX128, feeGrowthInside1LastX128, tokensOwed0, tokensOwed1
      
      let positionData;
      if (Array.isArray(position)) {
        // If it's an array, extract by index
        positionData = {
          tokenId,
          nonce: position[0],
          operator: position[1],
          token0: position[2],
          token1: position[3],
          fee: position[4],
          tickLower: position[5],
          tickUpper: position[6],
          liquidity: position[7],
          feeGrowthInside0LastX128: position[8],
          feeGrowthInside1LastX128: position[9],
          tokensOwed0: position[10],
          tokensOwed1: position[11],
        };
      } else if (position && typeof position === 'object') {
        // If it's an object, try to extract named properties
        positionData = {
          tokenId,
          token0: position.token0 || position[2],
          token1: position.token1 || position[3],
          fee: position.fee || position[4],
          tickLower: position.tickLower || position[5],
          tickUpper: position.tickUpper || position[6],
          liquidity: position.liquidity || position[7],
          tokensOwed0: position.tokensOwed0 || position[10],
          tokensOwed1: position.tokensOwed1 || position[11],
          ...position
        };
      } else {
        // Fallback - skip this position
        console.warn(`Invalid position data for tokenId ${tokenId}`);
        continue;
      }

      positions.push(positionData);
    }
  } catch (error) {
    // User might not have any V3 positions
  }

  return positions;
}

// Transaction helpers
export function formatTokenAmount(amount: bigint, decimals: number, symbol?: string): string {
  const formatted = formatUnits(amount, decimals);
  return symbol ? `${formatted} ${symbol}` : formatted;
}

export function parseTokenAmount(amount: string, decimals: number): bigint {
  return parseUnits(amount, decimals);
}

// Slippage calculations
export function calculateMinAmount(amount: bigint, slippageBps: bigint = TX_DEFAULTS.slippageTolerance): bigint {
  return applySlippage(amount, slippageBps);
}

export function calculateMaxAmount(amount: bigint, slippageBps: bigint = TX_DEFAULTS.slippageTolerance): bigint {
  return (amount * (10000n + slippageBps)) / 10000n;
}

// Export all helpers
export const LiquidityHelpers = {
  // Token
  getTokenInfo,
  checkAndApproveToken,
  
  // V2
  getV2PairInfo,
  calculateV2OptimalAmounts,
  getUserV2Positions,
  
  // V3
  getV3PoolInfo,
  tickToPrice,
  priceToTick,
  getNearestUsableTick,
  calculateV3PriceRange,
  encodePriceSqrt,
  getUserV3Positions,
  
  // Native
  getNativeBalance,
  isNativeToken,
  hasEnoughNativeForGas,
  
  // Utils
  formatTokenAmount,
  parseTokenAmount,
  calculateMinAmount,
  calculateMaxAmount,
  getDeadline,
};

export default LiquidityHelpers;