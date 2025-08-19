import { config } from "dotenv";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  parseUnits,
  type Address,
  type Hex,
  parseAbi,
  encodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  basecampTestnet,
  baseCampTestnetTokens,
  WCAMP_ADDRESS,
} from "../config/base-testnet";
import { logger } from "../utils/logger";
import readlineSync from "readline-sync";

config();

// V3 contracts
const NFT_POSITION_MANAGER = "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1";
const V3_FACTORY_ADDRESS = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";

// ABIs
const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

const NFT_POSITION_MANAGER_ABI = parseAbi([
  "function mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) payable returns (address pool)",
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function multicall(bytes[] calldata data) payable returns (bytes[] memory)",
  "function refundETH() payable",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
]);

const V3_FACTORY_ABI = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)",
]);

const V3_POOL_ABI = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function tickSpacing() view returns (int24)",
  "function fee() view returns (uint24)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);

// Fee tiers available in V3
const FEE_TIERS = [
  { fee: 100, name: "0.01%", tickSpacing: 1 },
  { fee: 500, name: "0.05%", tickSpacing: 10 },
  { fee: 3000, name: "0.3%", tickSpacing: 60 },
  { fee: 10000, name: "1%", tickSpacing: 200 },
];

interface TokenInfo {
  address: Address;
  symbol: string;
  decimals: number;
  balance: bigint;
}

function tickToPrice(tick: number): number {
  return Math.pow(1.0001, tick);
}

function priceToTick(price: number): number {
  return Math.floor(Math.log(price) / Math.log(1.0001));
}

function getNearestUsableTick(tick: number, tickSpacing: number): number {
  return Math.round(tick / tickSpacing) * tickSpacing;
}

function encodePriceSqrt(reserve1: bigint, reserve0: bigint): bigint {
  return (BigInt(reserve1) << 96n) / BigInt(reserve0);
}

async function getTokenInfo(
  publicClient: any,
  tokenAddress: Address,
  userAddress: Address
): Promise<TokenInfo> {
  const [symbol, decimals, balance] = await Promise.all([
    publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "symbol",
    }),
    publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "decimals",
    }),
    publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [userAddress],
    }),
  ]);

  return { address: tokenAddress, symbol, decimals, balance };
}

async function checkAndApproveToken(
  walletClient: any,
  publicClient: any,
  tokenAddress: Address,
  amount: bigint,
  spender: Address
) {
  const account = walletClient.account.address;
  
  const allowance = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account, spender],
  });

  if (allowance < amount) {
    logger.info(`Approving ${tokenAddress} for NFT Position Manager...`);
    const hash = await walletClient.writeContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    logger.success("✅ Token approved");
  }
}

async function main() {
  logger.header("💧 Add Liquidity V3 Example");
  logger.info("Add concentrated liquidity to V3 pools on Base Camp Testnet");
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
    // Get available tokens
    const tokens = [
      baseCampTestnetTokens.wcamp,
      baseCampTestnetTokens.usdc,
      baseCampTestnetTokens.usdt,
      baseCampTestnetTokens.dai,
      baseCampTestnetTokens.weth,
      baseCampTestnetTokens.wbtc,
    ];

    // Get token balances
    logger.info("\n📊 Available tokens:");
    const tokenInfos: TokenInfo[] = [];
    for (const token of tokens) {
      const info = await getTokenInfo(
        publicClient,
        token.address as Address,
        account.address
      );
      tokenInfos.push(info);
      logger.info(
        `${info.symbol}: ${formatUnits(info.balance, info.decimals)}`
      );
    }

    // Interactive token selection
    logger.info("\n🔄 Select tokens for V3 liquidity pool:");
    const tokenSymbols = tokenInfos.map((t) => t.symbol);
    
    const tokenAIndex = readlineSync.keyInSelect(
      tokenSymbols,
      "Select first token:"
    );
    if (tokenAIndex === -1) {
      logger.info("Cancelled");
      return;
    }

    const tokenBOptions = tokenSymbols.filter((_, i) => i !== tokenAIndex);
    const tokenBIndex = readlineSync.keyInSelect(
      tokenBOptions,
      "Select second token:"
    );
    if (tokenBIndex === -1) {
      logger.info("Cancelled");
      return;
    }

    // Map back to original index
    const actualTokenBIndex = tokenSymbols.indexOf(tokenBOptions[tokenBIndex]);
    
    let tokenA = tokenInfos[tokenAIndex];
    let tokenB = tokenInfos[actualTokenBIndex];

    // Sort tokens by address (required for V3)
    if (tokenA.address.toLowerCase() > tokenB.address.toLowerCase()) {
      [tokenA, tokenB] = [tokenB, tokenA];
    }

    logger.success(
      `\n✅ Selected pair: ${tokenA.symbol}/${tokenB.symbol}`
    );

    // Select fee tier
    logger.info("\n💰 Select fee tier:");
    const feeOptions = FEE_TIERS.map(
      (ft) => `${ft.name} (tick spacing: ${ft.tickSpacing})`
    );
    const feeIndex = readlineSync.keyInSelect(feeOptions, "Select fee tier:");
    if (feeIndex === -1) {
      logger.info("Cancelled");
      return;
    }

    const selectedFeeTier = FEE_TIERS[feeIndex];
    logger.success(`Selected fee tier: ${selectedFeeTier.name}`);

    // Check if pool exists
    const poolAddress = await publicClient.readContract({
      address: V3_FACTORY_ADDRESS,
      abi: V3_FACTORY_ABI,
      functionName: "getPool",
      args: [tokenA.address, tokenB.address, selectedFeeTier.fee],
    });

    let currentTick = 0;
    let currentPrice = 1;
    let poolExists = false;

    if (poolAddress !== "0x0000000000000000000000000000000000000000") {
      poolExists = true;
      logger.info(`\n📊 Pool exists at: ${poolAddress}`);
      
      // Get current pool state
      const slot0 = await publicClient.readContract({
        address: poolAddress,
        abi: V3_POOL_ABI,
        functionName: "slot0",
      });

      currentTick = slot0.tick;
      currentPrice = tickToPrice(currentTick);
      
      logger.info(`Current tick: ${currentTick}`);
      logger.info(`Current price: ${currentPrice.toFixed(6)} ${tokenB.symbol}/${tokenA.symbol}`);
    } else {
      logger.warn("⚠️ Pool doesn't exist - will be created");
      
      // Ask for initial price
      const initialPrice = readlineSync.question(
        `Enter initial price (${tokenB.symbol} per ${tokenA.symbol}): `
      );
      
      if (!initialPrice || isNaN(Number(initialPrice))) {
        logger.error("Invalid price");
        return;
      }
      
      currentPrice = Number(initialPrice);
      currentTick = priceToTick(currentPrice);
    }

    // Set price range
    logger.info("\n📈 Set your price range:");
    logger.info("Current price is your reference point");
    
    const rangeOptions = [
      "Narrow range (±10%)",
      "Medium range (±25%)",
      "Wide range (±50%)",
      "Full range",
      "Custom range",
    ];
    
    const rangeIndex = readlineSync.keyInSelect(
      rangeOptions,
      "Select price range:"
    );
    
    if (rangeIndex === -1) {
      logger.info("Cancelled");
      return;
    }

    let tickLower: number;
    let tickUpper: number;

    switch (rangeIndex) {
      case 0: // Narrow
        tickLower = currentTick - 1000;
        tickUpper = currentTick + 1000;
        break;
      case 1: // Medium
        tickLower = currentTick - 2500;
        tickUpper = currentTick + 2500;
        break;
      case 2: // Wide
        tickLower = currentTick - 5000;
        tickUpper = currentTick + 5000;
        break;
      case 3: // Full range
        tickLower = -887220;
        tickUpper = 887220;
        break;
      case 4: // Custom
        const lowerPrice = readlineSync.question(
          `Enter lower price bound (${tokenB.symbol}/${tokenA.symbol}): `
        );
        const upperPrice = readlineSync.question(
          `Enter upper price bound (${tokenB.symbol}/${tokenA.symbol}): `
        );
        
        if (!lowerPrice || !upperPrice || isNaN(Number(lowerPrice)) || isNaN(Number(upperPrice))) {
          logger.error("Invalid price range");
          return;
        }
        
        tickLower = priceToTick(Number(lowerPrice));
        tickUpper = priceToTick(Number(upperPrice));
        break;
      default:
        return;
    }

    // Adjust ticks to nearest usable tick
    tickLower = getNearestUsableTick(tickLower, selectedFeeTier.tickSpacing);
    tickUpper = getNearestUsableTick(tickUpper, selectedFeeTier.tickSpacing);

    const priceLower = tickToPrice(tickLower);
    const priceUpper = tickToPrice(tickUpper);

    logger.info("\n📊 Selected price range:");
    logger.info(`  Lower: ${priceLower.toFixed(6)} ${tokenB.symbol}/${tokenA.symbol}`);
    logger.info(`  Upper: ${priceUpper.toFixed(6)} ${tokenB.symbol}/${tokenA.symbol}`);
    logger.info(`  Tick Lower: ${tickLower}`);
    logger.info(`  Tick Upper: ${tickUpper}`);

    // Get amounts
    const maxAmountA = formatUnits(tokenA.balance, tokenA.decimals);
    const amountAInput = readlineSync.question(
      `\nEnter amount of ${tokenA.symbol} to add (max: ${maxAmountA}): `
    );
    
    if (!amountAInput || isNaN(Number(amountAInput))) {
      logger.error("Invalid amount");
      return;
    }

    const amount0Desired = parseUnits(amountAInput, tokenA.decimals);
    if (amount0Desired > tokenA.balance) {
      logger.error("Insufficient balance");
      return;
    }

    // Calculate amount1 based on current price and range
    // This is simplified - actual calculation depends on position within range
    const amount1Desired = amount0Desired * BigInt(Math.floor(currentPrice * 10000)) / 10000n;

    const maxAmountB = formatUnits(tokenB.balance, tokenB.decimals);
    logger.info(`\n📊 Estimated ${tokenB.symbol} needed: ${formatUnits(amount1Desired, tokenB.decimals)}`);
    logger.info(`Your balance: ${maxAmountB} ${tokenB.symbol}`);

    if (amount1Desired > tokenB.balance) {
      logger.error(`Insufficient ${tokenB.symbol} balance`);
      return;
    }

    // Set slippage
    const slippageTolerance = 50n; // 0.5%
    const amount0Min = (amount0Desired * (10000n - slippageTolerance)) / 10000n;
    const amount1Min = (amount1Desired * (10000n - slippageTolerance)) / 10000n;

    logger.info("\n📝 Transaction Summary:");
    logger.info(`  ${tokenA.symbol}: ${formatUnits(amount0Desired, tokenA.decimals)}`);
    logger.info(`  ${tokenB.symbol}: ${formatUnits(amount1Desired, tokenB.decimals)}`);
    logger.info(`  Fee Tier: ${selectedFeeTier.name}`);
    logger.info(`  Price Range: ${priceLower.toFixed(4)} - ${priceUpper.toFixed(4)}`);
    logger.info(`  Slippage: 0.5%`);

    const confirm = readlineSync.keyInYNStrict("\nProceed with adding liquidity?");
    if (!confirm) {
      logger.info("Cancelled");
      return;
    }

    // Approve tokens
    logger.info("\n🔐 Approving tokens...");
    await checkAndApproveToken(
      walletClient,
      publicClient,
      tokenA.address,
      amount0Desired,
      NFT_POSITION_MANAGER as Address
    );
    await checkAndApproveToken(
      walletClient,
      publicClient,
      tokenB.address,
      amount1Desired,
      NFT_POSITION_MANAGER as Address
    );

    // Prepare mint parameters
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);

    const mintParams = {
      token0: tokenA.address,
      token1: tokenB.address,
      fee: selectedFeeTier.fee,
      tickLower,
      tickUpper,
      amount0Desired,
      amount1Desired,
      amount0Min,
      amount1Min,
      recipient: account.address,
      deadline,
    };

    logger.info("\n💧 Adding liquidity to V3 pool...");

    // Check if using native CAMP
    const isToken0WCAMP = tokenA.address.toLowerCase() === WCAMP_ADDRESS.toLowerCase();
    const isToken1WCAMP = tokenB.address.toLowerCase() === WCAMP_ADDRESS.toLowerCase();
    let value = 0n;

    if ((isToken0WCAMP || isToken1WCAMP) && !poolExists) {
      const useNative = readlineSync.keyInYNStrict(
        "\nWould you like to use native CAMP instead of WCAMP?"
      );
      
      if (useNative) {
        value = isToken0WCAMP ? amount0Desired : amount1Desired;
        const nativeBalance = await publicClient.getBalance({
          address: account.address,
        });
        
        if (nativeBalance < value) {
          logger.error("Insufficient native CAMP balance");
          return;
        }
      }
    }

    // Execute mint
    const txHash = await walletClient.writeContract({
      address: NFT_POSITION_MANAGER as Address,
      abi: NFT_POSITION_MANAGER_ABI,
      functionName: "mint",
      args: [mintParams],
      value,
    });

    logger.info(`Transaction sent: ${txHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status === "success") {
      logger.success("✅ V3 liquidity added successfully!");
      logger.info(`Gas used: ${receipt.gasUsed}`);
      
      // Parse events to get NFT token ID
      logger.success("\n🎉 Position created!");
      logger.info("Your position is represented as an NFT");
      logger.info("Use 'npm run liquidity:manage' to view your positions");
    } else {
      logger.error("❌ Transaction failed");
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