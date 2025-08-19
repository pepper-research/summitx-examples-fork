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
  const [symbol, decimals, balance, name] = await Promise.all([
    publicClient.readContract({
      address: tokenAddress,
      abi: ABIS.ERC20,
      functionName: "symbol",
    }),
    publicClient.readContract({
      address: tokenAddress,
      abi: ABIS.ERC20,
      functionName: "decimals",
    }),
    publicClient.readContract({
      address: tokenAddress,
      abi: ABIS.ERC20,
      functionName: "balanceOf",
      args: [userAddress],
    }),
    publicClient.readContract({
      address: tokenAddress,
      abi: ABIS.ERC20,
      functionName: "name",
    }).catch(() => undefined),
  ]);

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
    logger.info(`Approving ${tokenSymbol || tokenAddress} for ${formatUnits(amount, 18)}...`);
    
    const hash = await walletClient.writeContract({
      address: tokenAddress,
      abi: ABIS.ERC20,
      functionName: "approve",
      args: [spender, amount],
    });
    
    await publicClient.waitForTransactionReceipt({ hash });
    logger.success("✅ Token approved");
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

  return {
    poolAddress,
    token0,
    token1,
    fee,
    tickSpacing,
    sqrtPriceX96: slot0.sqrtPriceX96,
    tick: slot0.tick,
    liquidity,
  };
}

// Price and tick calculations for V3
export function tickToPrice(tick: number): number {
  return Math.pow(1.0001, tick);
}

export function priceToTick(price: number): number {
  return Math.floor(Math.log(price) / Math.log(1.0001));
}

export function getNearestUsableTick(tick: number, tickSpacing: number): number {
  return Math.round(tick / tickSpacing) * tickSpacing;
}

export function calculateV3PriceRange(tickLower: number, tickUpper: number) {
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

      positions.push({
        tokenId,
        ...position,
      });
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