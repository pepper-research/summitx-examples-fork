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
import { approveTokenWithWait, waitForTransaction, delay } from "../utils/transaction-helpers";
import readlineSync from "readline-sync";

config();

// V3 contracts for Base Camp Testnet
const NFT_POSITION_MANAGER = "0x86e08b14ABb30d4E19811EC5C42074b87f6E46b1";
const V3_FACTORY_ADDRESS = "0x56e72729b46fc7a5C18C3333ACDA52cB57936022";

// ABIs
const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

const NFT_POSITION_MANAGER_ABI = parseAbi([
  "struct MintParams { address token0; address token1; uint24 fee; int24 tickLower; int24 tickUpper; uint256 amount0Desired; uint256 amount1Desired; uint256 amount0Min; uint256 amount1Min; address recipient; uint256 deadline; }",
  "function mint(MintParams params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
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
  if (price <= 0 || !isFinite(price)) {
    throw new Error(`Invalid price for tick calculation: ${price}`);
  }
  const tick = Math.floor(Math.log(price) / Math.log(1.0001));
  if (!isFinite(tick)) {
    throw new Error(`Tick calculation resulted in invalid value for price: ${price}`);
  }
  return tick;
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
    let poolAddress: string = "0x0000000000000000000000000000000000000000";
    let poolCheckFailed = false;
    
    try {
      logger.info(`Checking for pool: ${tokenA.symbol}/${tokenB.symbol} with fee ${selectedFeeTier.fee}`);
      const result = await publicClient.readContract({
        address: V3_FACTORY_ADDRESS,
        abi: V3_FACTORY_ABI,
        functionName: "getPool",
        args: [tokenA.address, tokenB.address, selectedFeeTier.fee],
      });
      poolAddress = result || "0x0000000000000000000000000000000000000000";
      logger.info(`Pool check successful, result: ${poolAddress}`);
    } catch (error: any) {
      logger.warn(`Could not check pool existence: ${error.message}`);
      if (error.message.includes("returned no data")) {
        logger.warn(`V3 Factory contract may not be deployed or accessible`);
        poolCheckFailed = true;
      }
      logger.warn(`Assuming pool doesn't exist, will create new pool`);
      poolAddress = "0x0000000000000000000000000000000000000000";
    }

    let currentTick: number = NaN;
    let currentPrice: number = NaN;
    let poolExists = false;

    // If pool check failed completely, we need to handle this specially
    if (poolCheckFailed) {
      logger.warn("⚠️ V3 Factory check failed - assuming new deployment needed");
      // Force pool creation flow
      poolExists = false;
    } else {
      logger.info(`Pool address returned: ${poolAddress}`);
      logger.info(`Checking if pool exists: ${poolAddress !== "0x0000000000000000000000000000000000000000"}`);
    }

    if (!poolCheckFailed && poolAddress && poolAddress.toLowerCase() !== "0x0000000000000000000000000000000000000000") {
      poolExists = true;
      logger.info(`\n📊 Pool exists at: ${poolAddress}`);
      
      try {
        // Get current pool state
        logger.info("Reading pool state from slot0...");
        const slot0 = await publicClient.readContract({
          address: poolAddress,
          abi: V3_POOL_ABI,
          functionName: "slot0",
        });
        
        logger.info(`Raw slot0 data: ${JSON.stringify(slot0)}`);
        
        // slot0 returns a tuple/object with: sqrtPriceX96, tick, observationIndex, etc.
        // The tick is either at index 1 or accessible as .tick property
        let tickValue;
        if (Array.isArray(slot0)) {
          tickValue = slot0[1];
        } else if (typeof slot0 === 'object' && slot0 !== null) {
          tickValue = (slot0 as any).tick ?? (slot0 as any)[1];
        } else {
          tickValue = slot0;
        }
        
        logger.info(`Extracted tick value: ${tickValue}`);
        
        if (tickValue !== undefined && tickValue !== null) {
          // Handle BigInt conversion if needed
          if (typeof tickValue === 'bigint') {
            currentTick = Number(tickValue);
          } else {
            currentTick = Number(tickValue);
          }
          
          // Check if the pool is initialized (tick should be non-zero for initialized pools)
          if (Number.isFinite(currentTick) && currentTick !== 0) {
            currentPrice = tickToPrice(currentTick);
            logger.info(`Current tick: ${currentTick}`);
            logger.info(`Current price: ${currentPrice.toFixed(6)} ${tokenB.symbol}/${tokenA.symbol}`);
          } else if (currentTick === 0) {
            logger.warn("Pool exists but appears uninitialized (tick = 0)");
            logger.warn("You'll need to set an initial price");
            poolExists = false; // Treat as non-existent if uninitialized
          } else {
            logger.warn(`Invalid tick value from pool: ${tickValue}`);
            poolExists = false; // Treat as non-existent if we can't read it
          }
        } else {
          logger.warn("Could not extract tick from slot0 data");
          poolExists = false; // Treat as non-existent if we can't read it
        }
      } catch (error: any) {
        logger.warn(`Failed to read pool state: ${error.message}`);
        logger.warn("Pool may be uninitialized, treating as new pool");
        poolExists = false; // Treat as non-existent if we can't read it
      }
    } 
    
    // If pool doesn't exist OR we couldn't get pool data, need to set initial price
    if (!poolExists || !Number.isFinite(currentTick)) {
      logger.warn("⚠️ Pool doesn't exist or couldn't get pool data - will be created");
      
      // For new pools, we need to set an initial price
      // Default to 1:1 ratio if tokens have same decimals, otherwise adjust
      const decimalDiff = tokenB.decimals - tokenA.decimals;
      const defaultPrice = Math.pow(10, decimalDiff);
      
      logger.info(`\nToken decimals: ${tokenA.symbol}=${tokenA.decimals}, ${tokenB.symbol}=${tokenB.decimals}`);
      logger.info(`Suggested initial price: ${defaultPrice} ${tokenB.symbol} per ${tokenA.symbol}`);
      logger.info("(Based on decimal difference between tokens)");
      logger.info("Note: For stablecoins paired with non-stables, you may want to adjust this.");
      
      // Ask for initial price
      const initialPrice = readlineSync.question(
        `Enter initial price (${tokenB.symbol} per ${tokenA.symbol}) [${defaultPrice}]: `
      );
      
      if (initialPrice === "") {
        currentPrice = defaultPrice;
      } else if (!initialPrice || isNaN(Number(initialPrice)) || Number(initialPrice) <= 0) {
        logger.error("Invalid price - must be a positive number");
        return;
      } else {
        currentPrice = Number(initialPrice);
      }
      
      try {
        currentTick = priceToTick(currentPrice);
        logger.info(`Using price: ${currentPrice} (tick: ${currentTick})`);
      } catch (error: any) {
        logger.error(`Failed to calculate tick: ${error.message}`);
        return;
      }
    }

    // Validate that we have valid price and tick values before continuing
    if (!Number.isFinite(currentPrice) || !Number.isFinite(currentTick)) {
      logger.error("Failed to establish current price and tick values.");
      logger.error(`Current price: ${currentPrice}, Current tick: ${currentTick}`);
      logger.error("Cannot proceed without valid price information.");
      return;
    }

    // Set price range
    logger.info("\n📈 Set your price range:");
    logger.info(`Current price: ${currentPrice.toFixed(6)} ${tokenB.symbol}/${tokenA.symbol}`);
    logger.info(`Current tick: ${currentTick}`);
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

    let tickLower: number = 0;
    let tickUpper: number = 0;

    logger.info(`Current tick before range selection: ${currentTick}`);
    logger.info(`Range option selected: ${rangeIndex}`);

    // Ensure currentTick is valid before proceeding
    if (!Number.isFinite(currentTick)) {
      logger.error(`Invalid currentTick value: ${currentTick}`);
      logger.error("Cannot proceed with price range selection.");
      return;
    }

    switch (rangeIndex) {
      case 0: // Narrow
        tickLower = currentTick - 1000;
        tickUpper = currentTick + 1000;
        logger.debug(`Narrow range: currentTick=${currentTick}, tickLower=${tickLower}, tickUpper=${tickUpper}`);
        break;
      case 1: // Medium
        tickLower = currentTick - 2500;
        tickUpper = currentTick + 2500;
        logger.debug(`Medium range: currentTick=${currentTick}, tickLower=${tickLower}, tickUpper=${tickUpper}`);
        break;
      case 2: // Wide
        tickLower = currentTick - 5000;
        tickUpper = currentTick + 5000;
        logger.debug(`Wide range: currentTick=${currentTick}, tickLower=${tickLower}, tickUpper=${tickUpper}`);
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

    // Validate tick values
    if (isNaN(tickLower) || isNaN(tickUpper)) {
      logger.error("Invalid tick values calculated. Please check your price inputs.");
      logger.error(`Details: currentTick=${currentTick}, tickLower=${tickLower}, tickUpper=${tickUpper}`);
      logger.error(`This usually happens when the initial price wasn't set correctly.`);
      return;
    }

    // Adjust ticks to nearest usable tick
    tickLower = getNearestUsableTick(tickLower, selectedFeeTier.tickSpacing);
    tickUpper = getNearestUsableTick(tickUpper, selectedFeeTier.tickSpacing);

    // Ensure tickLower < tickUpper
    if (tickLower >= tickUpper) {
      logger.error("Lower tick must be less than upper tick");
      return;
    }

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

    // Approve tokens with waiting period
    logger.info("\n🔐 Approving tokens...");
    await approveTokenWithWait(
      walletClient,
      publicClient,
      tokenA.address,
      NFT_POSITION_MANAGER as Address,
      amount0Desired,
      tokenA.symbol,
      3000 // 3 second wait after approval
    );
    await approveTokenWithWait(
      walletClient,
      publicClient,
      tokenB.address,
      NFT_POSITION_MANAGER as Address,
      amount1Desired,
      tokenB.symbol,
      3000 // 3 second wait after approval
    );

    // Prepare mint parameters
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);

    // Final validation before minting
    if (isNaN(tickLower) || isNaN(tickUpper) || !Number.isInteger(tickLower) || !Number.isInteger(tickUpper)) {
      logger.error("Invalid tick values. Cannot proceed with minting.");
      return;
    }

    const mintParams = {
      token0: tokenA.address,
      token1: tokenB.address,
      fee: selectedFeeTier.fee,
      tickLower: tickLower,
      tickUpper: tickUpper,
      amount0Desired,
      amount1Desired,
      amount0Min,
      amount1Min,
      recipient: account.address,
      deadline,
    };

    logger.info("\n💧 Adding liquidity to V3 pool...");
    if (!poolExists) {
      logger.info("📝 Pool will be created automatically with your liquidity");
    }

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