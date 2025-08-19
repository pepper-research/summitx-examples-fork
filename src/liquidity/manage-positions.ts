import { config } from "dotenv";
import readlineSync from "readline-sync";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { basecampTestnet } from "../config/base-testnet";
import { logger } from "../utils/logger";

config();

// Contract addresses
const V2_FACTORY_ADDRESS = "0xFe5498944B504FBf57DE0C76FB770974C0C54821";
const V3_FACTORY_ADDRESS = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
const NFT_POSITION_MANAGER = "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1";

// ABIs
const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function totalSupply() view returns (uint256)",
]);

const V2_FACTORY_ABI = parseAbi([
  "function getPair(address tokenA, address tokenB) view returns (address pair)",
  "function allPairs(uint) view returns (address)",
  "function allPairsLength() view returns (uint)",
]);

const V2_PAIR_ABI = parseAbi([
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
]);

const NFT_POSITION_MANAGER_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
]);

const V3_POOL_ABI = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
]);

const V3_FACTORY_ABI = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)",
]);

interface V2Position {
  type: "V2";
  pairAddress: Address;
  token0: Address;
  token1: Address;
  symbol0: string;
  symbol1: string;
  decimals0: number;
  decimals1: number;
  lpBalance: bigint;
  totalSupply: bigint;
  reserve0: bigint;
  reserve1: bigint;
  poolShare: number;
  token0Amount: bigint;
  token1Amount: bigint;
}

interface V3Position {
  type: "V3";
  tokenId: bigint;
  token0: Address;
  token1: Address;
  symbol0: string;
  symbol1: string;
  decimals0: number;
  decimals1: number;
  fee: number;
  liquidity: bigint;
  tickLower: number;
  tickUpper: number;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
  inRange: boolean;
  currentTick: number;
}

async function getV2Positions(
  publicClient: any,
  userAddress: Address
): Promise<V2Position[]> {
  const positions: V2Position[] = [];

  const pairsLength = await publicClient.readContract({
    address: V2_FACTORY_ADDRESS,
    abi: V2_FACTORY_ABI,
    functionName: "allPairsLength",
  });

  for (let i = 0n; i < pairsLength; i++) {
    const pairAddress = await publicClient.readContract({
      address: V2_FACTORY_ADDRESS,
      abi: V2_FACTORY_ABI,
      functionName: "allPairs",
      args: [i],
    });

    const lpBalance = await publicClient.readContract({
      address: pairAddress,
      abi: V2_PAIR_ABI,
      functionName: "balanceOf",
      args: [userAddress],
    });

    if (lpBalance > 0n) {
      const [token0, token1, reserves, totalSupply] = await Promise.all([
        publicClient.readContract({
          address: pairAddress,
          abi: V2_PAIR_ABI,
          functionName: "token0",
        }),
        publicClient.readContract({
          address: pairAddress,
          abi: V2_PAIR_ABI,
          functionName: "token1",
        }),
        publicClient.readContract({
          address: pairAddress,
          abi: V2_PAIR_ABI,
          functionName: "getReserves",
        }),
        publicClient.readContract({
          address: pairAddress,
          abi: V2_PAIR_ABI,
          functionName: "totalSupply",
        }),
      ]);

      const [symbol0, symbol1, decimals0, decimals1] = await Promise.all([
        publicClient.readContract({
          address: token0,
          abi: ERC20_ABI,
          functionName: "symbol",
        }),
        publicClient.readContract({
          address: token1,
          abi: ERC20_ABI,
          functionName: "symbol",
        }),
        publicClient.readContract({
          address: token0,
          abi: ERC20_ABI,
          functionName: "decimals",
        }),
        publicClient.readContract({
          address: token1,
          abi: ERC20_ABI,
          functionName: "decimals",
        }),
      ]);

      const poolShare = Number((lpBalance * 10000n) / totalSupply) / 100;
      const token0Amount = (reserves[0] * lpBalance) / totalSupply;
      const token1Amount = (reserves[1] * lpBalance) / totalSupply;

      positions.push({
        type: "V2",
        pairAddress,
        token0,
        token1,
        symbol0,
        symbol1,
        decimals0,
        decimals1,
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

async function getV3Positions(
  publicClient: any,
  userAddress: Address
): Promise<V3Position[]> {
  const positions: V3Position[] = [];

  try {
    const balance = await publicClient.readContract({
      address: NFT_POSITION_MANAGER,
      abi: NFT_POSITION_MANAGER_ABI,
      functionName: "balanceOf",
      args: [userAddress],
    });

    for (let i = 0n; i < balance; i++) {
      const tokenId = await publicClient.readContract({
        address: NFT_POSITION_MANAGER,
        abi: NFT_POSITION_MANAGER_ABI,
        functionName: "tokenOfOwnerByIndex",
        args: [userAddress, i],
      });

      const position = await publicClient.readContract({
        address: NFT_POSITION_MANAGER,
        abi: NFT_POSITION_MANAGER_ABI,
        functionName: "positions",
        args: [tokenId],
      });

      // Get pool address
      const poolAddress = await publicClient.readContract({
        address: V3_FACTORY_ADDRESS,
        abi: V3_FACTORY_ABI,
        functionName: "getPool",
        args: [position.token0, position.token1, position.fee],
      });

      if (poolAddress === "0x0000000000000000000000000000000000000000") {
        continue;
      }

      // Get current tick
      const slot0 = await publicClient.readContract({
        address: poolAddress,
        abi: V3_POOL_ABI,
        functionName: "slot0",
      });

      // Get token details
      const [symbol0, symbol1, decimals0, decimals1] = await Promise.all([
        publicClient.readContract({
          address: position.token0,
          abi: ERC20_ABI,
          functionName: "symbol",
        }),
        publicClient.readContract({
          address: position.token1,
          abi: ERC20_ABI,
          functionName: "symbol",
        }),
        publicClient.readContract({
          address: position.token0,
          abi: ERC20_ABI,
          functionName: "decimals",
        }),
        publicClient.readContract({
          address: position.token1,
          abi: ERC20_ABI,
          functionName: "decimals",
        }),
      ]);

      const inRange =
        slot0.tick >= position.tickLower && slot0.tick < position.tickUpper;

      positions.push({
        type: "V3",
        tokenId,
        token0: position.token0,
        token1: position.token1,
        symbol0,
        symbol1,
        decimals0,
        decimals1,
        fee: Number(position.fee),
        liquidity: position.liquidity,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        tokensOwed0: position.tokensOwed0,
        tokensOwed1: position.tokensOwed1,
        inRange,
        currentTick: slot0.tick,
      });
    }
  } catch (error) {
    // User might not have any V3 positions
  }

  return positions;
}

function calculateV3PriceRange(tickLower: number, tickUpper: number) {
  const priceLower = Math.pow(1.0001, tickLower);
  const priceUpper = Math.pow(1.0001, tickUpper);
  return { priceLower, priceUpper };
}

async function main() {
  logger.header("📊 Manage Liquidity Positions");
  logger.info("View and manage all your liquidity positions");
  logger.divider();

  if (!process.env.PRIVATE_KEY) {
    logger.error("Please set PRIVATE_KEY in .env file");
    process.exit(1);
  }

  const account = privateKeyToAccount(process.env.PRIVATE_KEY as Hex);

  const publicClient = createPublicClient({
    chain: basecampTestnet,
    transport: http(
      process.env.BASE_TESTNET_RPC_URL || "https://rpc-campnetwork.xyz"
    ),
  });

  const walletClient = createWalletClient({
    account,
    chain: basecampTestnet,
    transport: http(
      process.env.BASE_TESTNET_RPC_URL || "https://rpc-campnetwork.xyz"
    ),
  });

  logger.info(`Wallet address: ${account.address}`);

  try {
    // Get all positions
    logger.info("\n🔍 Scanning for liquidity positions...");

    const [v2Positions, v3Positions] = await Promise.all([
      getV2Positions(publicClient, account.address),
      getV3Positions(publicClient, account.address),
    ]);

    const totalPositions = v2Positions.length + v3Positions.length;

    if (totalPositions === 0) {
      logger.warn("No liquidity positions found");
      logger.info("\nYou can add liquidity using:");
      logger.info("  • npm run liquidity:add-v2 (for V2 AMM pools)");
      logger.info(
        "  • npm run liquidity:add-v3 (for V3 concentrated liquidity)"
      );
      return;
    }

    logger.success(`\n✅ Found ${totalPositions} liquidity position(s)`);

    // Display V2 positions
    if (v2Positions.length > 0) {
      logger.header("\n🔷 V2 AMM Positions");
      v2Positions.forEach((pos, index) => {
        logger.info(`\n[V2-${index}] ${pos.symbol0}/${pos.symbol1}`);
        logger.info(`  LP Balance: ${formatUnits(pos.lpBalance, 18)}`);
        logger.info(`  Pool Share: ${pos.poolShare.toFixed(4)}%`);
        logger.info(
          `  ${pos.symbol0}: ${formatUnits(pos.token0Amount, pos.decimals0)}`
        );
        logger.info(
          `  ${pos.symbol1}: ${formatUnits(pos.token1Amount, pos.decimals1)}`
        );
        logger.info(`  Pair Address: ${pos.pairAddress}`);

        // Calculate position value (simplified - would need price data for accurate value)
        const totalReserve0 = formatUnits(pos.reserve0, pos.decimals0);
        const totalReserve1 = formatUnits(pos.reserve1, pos.decimals1);
        logger.info(
          `  Pool Reserves: ${totalReserve0} ${pos.symbol0} / ${totalReserve1} ${pos.symbol1}`
        );
      });
    }

    // Display V3 positions
    if (v3Positions.length > 0) {
      logger.header("\n🔶 V3 Concentrated Liquidity Positions");
      v3Positions.forEach((pos, index) => {
        const feePercentage = pos.fee / 10000;
        const { priceLower, priceUpper } = calculateV3PriceRange(
          pos.tickLower,
          pos.tickUpper
        );

        logger.info(
          `\n[V3-${index}] ${pos.symbol0}/${pos.symbol1} (${feePercentage}% fee)`
        );
        logger.info(`  NFT ID: #${pos.tokenId}`);
        logger.info(
          `  Status: ${pos.inRange ? "✅ IN RANGE" : "⚠️ OUT OF RANGE"}`
        );
        logger.info(`  Liquidity: ${pos.liquidity.toString()}`);

        // Price range
        logger.info(`  Price Range:`);
        logger.info(
          `    Lower: ${priceLower.toFixed(6)} ${pos.symbol1}/${pos.symbol0}`
        );
        logger.info(
          `    Upper: ${priceUpper.toFixed(6)} ${pos.symbol1}/${pos.symbol0}`
        );
        logger.info(`    Current Tick: ${pos.currentTick}`);

        // Unclaimed fees
        if (pos.tokensOwed0 > 0n || pos.tokensOwed1 > 0n) {
          logger.success(`  💰 Unclaimed Fees:`);
          if (pos.tokensOwed0 > 0n) {
            logger.info(
              `    ${pos.symbol0}: ${formatUnits(
                pos.tokensOwed0,
                pos.decimals0
              )}`
            );
          }
          if (pos.tokensOwed1 > 0n) {
            logger.info(
              `    ${pos.symbol1}: ${formatUnits(
                pos.tokensOwed1,
                pos.decimals1
              )}`
            );
          }
        }
      });
    }

    // Management options
    logger.divider();
    logger.info("\n📋 Management Options:");

    const options = [
      "View position details",
      "Add more liquidity",
      "Remove liquidity",
      "Collect V3 fees",
      "Exit",
    ];

    const choice = readlineSync.keyInSelect(
      options,
      "What would you like to do?"
    );

    switch (choice) {
      case 0:
        logger.info("\nPosition details displayed above");
        break;
      case 1:
        logger.info("\nTo add liquidity:");
        logger.info("  • V2: npm run liquidity:add-v2");
        logger.info("  • V3: npm run liquidity:add-v3");
        break;
      case 2:
        logger.info("\nTo remove liquidity:");
        logger.info("  • V2: npm run liquidity:remove-v2");
        logger.info("  • V3: npm run liquidity:remove-v3");
        break;
      case 3:
        if (v3Positions.length > 0) {
          logger.info("\nTo collect V3 fees: npm run liquidity:collect-v3");
        } else {
          logger.info("\nNo V3 positions with fees to collect");
        }
        break;
      default:
        logger.info("\nExiting...");
    }

    // Summary statistics
    logger.divider();
    logger.header("\n📈 Portfolio Summary");
    logger.info(`Total Positions: ${totalPositions}`);
    logger.info(`V2 Positions: ${v2Positions.length}`);
    logger.info(`V3 Positions: ${v3Positions.length}`);

    if (v3Positions.length > 0) {
      const inRangeCount = v3Positions.filter((p) => p.inRange).length;
      const outOfRangeCount = v3Positions.length - inRangeCount;
      logger.info(`V3 In Range: ${inRangeCount}`);
      logger.info(`V3 Out of Range: ${outOfRangeCount}`);

      const hasUnclaimedFees = v3Positions.some(
        (p) => p.tokensOwed0 > 0n || p.tokensOwed1 > 0n
      );
      if (hasUnclaimedFees) {
        logger.success("💰 You have unclaimed V3 fees!");
      }
    }
  } catch (error: any) {
    logger.error("Error:", error?.message || error);
    console.error("Full error:", error);
  }
}

main().catch((error) => {
  logger.error("Fatal error:", error?.message || error);
  process.exit(1);
});
