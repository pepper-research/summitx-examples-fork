import { config } from "dotenv";
import readlineSync from "readline-sync";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  parseUnits,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { basecampTestnet, baseCampTestnetTokens } from "../config/base-testnet";
import { CONTRACTS, V3_FEE_TIERS, V3_TICK_SPACINGS, getDeadline, applySlippage } from "../config/contracts";
import { ABIS } from "../config/abis";
import { 
  LiquidityHelpers,
  type TokenInfo 
} from "../utils/liquidity-helpers";
import { logger } from "../utils/logger";

config();

// Fee tier options for V3
const FEE_TIER_OPTIONS = [
  { fee: V3_FEE_TIERS.LOWEST, name: "0.01%", tickSpacing: V3_TICK_SPACINGS[V3_FEE_TIERS.LOWEST] },
  { fee: V3_FEE_TIERS.LOW, name: "0.05%", tickSpacing: V3_TICK_SPACINGS[V3_FEE_TIERS.LOW] },
  { fee: V3_FEE_TIERS.MEDIUM, name: "0.3%", tickSpacing: V3_TICK_SPACINGS[V3_FEE_TIERS.MEDIUM] },
  { fee: V3_FEE_TIERS.HIGH, name: "1%", tickSpacing: V3_TICK_SPACINGS[V3_FEE_TIERS.HIGH] },
];

async function main() {
  logger.header("⚡ Native CAMP V3 Concentrated Liquidity");
  logger.info("Manage concentrated liquidity positions with native CAMP");
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
    // Get native CAMP balance
    const nativeBalance = await LiquidityHelpers.getNativeBalance(publicClient, account.address);
    logger.info(`\n💰 Native CAMP balance: ${formatUnits(nativeBalance, 18)}`);
    
    if (nativeBalance < parseUnits("0.1", 18)) {
      logger.error("Insufficient native CAMP balance (need at least 0.1 CAMP)");
      return;
    }

    // Select operation
    const operations = [
      "Add V3 Native Liquidity",
      "Remove V3 Native Liquidity", 
      "Collect V3 Fees",
      "View V3 Native Positions"
    ];
    const opIndex = readlineSync.keyInSelect(operations, "\nWhat would you like to do?");
    
    if (opIndex === -1) {
      logger.info("Cancelled");
      return;
    }

    if (opIndex === 0) {
      // Add V3 Native Liquidity
      await addV3NativeLiquidity(publicClient, walletClient, account.address, nativeBalance);
    } else if (opIndex === 1) {
      // Remove V3 Native Liquidity
      await removeV3NativeLiquidity(publicClient, walletClient, account.address);
    } else if (opIndex === 2) {
      // Collect V3 Fees
      await collectV3Fees(publicClient, walletClient, account.address);
    } else {
      // View V3 Native Positions
      await viewV3NativePositions(publicClient, account.address);
    }

  } catch (error: any) {
    logger.error("Error:", error?.message || error);
    console.error("Full error:", error);
  }
}

async function addV3NativeLiquidity(
  publicClient: any,
  walletClient: any,
  userAddress: Address,
  nativeBalance: bigint
) {
  logger.header("\n💧 Add V3 Native CAMP Concentrated Liquidity");
  
  // Get available tokens (excluding WCAMP since we're using native)
  const tokens = [
    baseCampTestnetTokens.usdc,
    baseCampTestnetTokens.usdt,
    baseCampTestnetTokens.dai,
    baseCampTestnetTokens.weth,
    baseCampTestnetTokens.wbtc,
  ];

  // Get token balances
  logger.info("\n📊 Available tokens to pair with native CAMP:");
  const tokenInfos: TokenInfo[] = [];
  
  for (const token of tokens) {
    const info = await LiquidityHelpers.getTokenInfo(
      publicClient,
      token.address as Address,
      userAddress
    );
    tokenInfos.push(info);
    logger.info(
      `${info.symbol}: ${formatUnits(info.balance, info.decimals)}`
    );
  }

  // Select token
  const tokenSymbols = tokenInfos.map((t) => t.symbol);
  const tokenIndex = readlineSync.keyInSelect(
    tokenSymbols,
    "\nSelect token to pair with native CAMP:"
  );
  
  if (tokenIndex === -1) {
    logger.info("Cancelled");
    return;
  }

  const selectedToken = tokenInfos[tokenIndex];
  
  // Sort tokens by address (required for V3)
  let token0, token1;
  let isNativeToken0 = false;
  
  if (CONTRACTS.WCAMP.toLowerCase() < selectedToken.address.toLowerCase()) {
    token0 = CONTRACTS.WCAMP;
    token1 = selectedToken.address;
    isNativeToken0 = true;
  } else {
    token0 = selectedToken.address;
    token1 = CONTRACTS.WCAMP;
    isNativeToken0 = false;
  }
  
  logger.success(
    `\n✅ Selected pair: ${isNativeToken0 ? "CAMP" : selectedToken.symbol}/${!isNativeToken0 ? "CAMP" : selectedToken.symbol}`
  );

  // Select fee tier
  logger.info("\n💰 Select fee tier:");
  const feeOptions = FEE_TIER_OPTIONS.map(
    (ft) => `${ft.name} (tick spacing: ${ft.tickSpacing})`
  );
  const feeIndex = readlineSync.keyInSelect(feeOptions, "Select fee tier:");
  if (feeIndex === -1) {
    logger.info("Cancelled");
    return;
  }

  const selectedFeeTier = FEE_TIER_OPTIONS[feeIndex];
  logger.success(`Selected fee tier: ${selectedFeeTier.name}`);

  // Check if pool exists
  const poolInfo = await LiquidityHelpers.getV3PoolInfo(
    publicClient,
    token0,
    token1,
    selectedFeeTier.fee
  );

  let currentTick = 0;
  let currentPrice = 1;

  if (poolInfo) {
    logger.info(`\n📊 Pool exists at: ${poolInfo.poolAddress}`);
    currentTick = poolInfo.tick;
    currentPrice = LiquidityHelpers.tickToPrice(currentTick);
    
    logger.info(`Current tick: ${currentTick}`);
    logger.info(`Current price: ${currentPrice.toFixed(6)}`);
  } else {
    logger.warn("⚠️ Pool doesn't exist - will be created");
    
    // Ask for initial price
    const initialPrice = readlineSync.question(
      `Enter initial price (${!isNativeToken0 ? selectedToken.symbol : "CAMP"} per ${isNativeToken0 ? selectedToken.symbol : "CAMP"}): `
    );
    
    if (!initialPrice || isNaN(Number(initialPrice))) {
      logger.error("Invalid price");
      return;
    }
    
    currentPrice = Number(initialPrice);
    currentTick = LiquidityHelpers.priceToTick(currentPrice);
  }

  // Set price range
  logger.info("\n📈 Set your price range:");
  const rangeOptions = [
    "Narrow range (±10%)",
    "Medium range (±25%)",
    "Wide range (±50%)",
    "Full range",
    "Custom range",
  ];
  
  const rangeIndex = readlineSync.keyInSelect(rangeOptions, "Select price range:");
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
      const lowerPrice = readlineSync.question("Enter lower price bound: ");
      const upperPrice = readlineSync.question("Enter upper price bound: ");
      
      if (!lowerPrice || !upperPrice || isNaN(Number(lowerPrice)) || isNaN(Number(upperPrice))) {
        logger.error("Invalid price range");
        return;
      }
      
      tickLower = LiquidityHelpers.priceToTick(Number(lowerPrice));
      tickUpper = LiquidityHelpers.priceToTick(Number(upperPrice));
      break;
    default:
      return;
  }

  // Adjust ticks to nearest usable tick
  tickLower = LiquidityHelpers.getNearestUsableTick(tickLower, selectedFeeTier.tickSpacing);
  tickUpper = LiquidityHelpers.getNearestUsableTick(tickUpper, selectedFeeTier.tickSpacing);

  const { priceLower, priceUpper } = LiquidityHelpers.calculateV3PriceRange(tickLower, tickUpper);

  logger.info("\n📊 Selected price range:");
  logger.info(`  Lower: ${priceLower.toFixed(6)}`);
  logger.info(`  Upper: ${priceUpper.toFixed(6)}`);
  logger.info(`  Tick Lower: ${tickLower}`);
  logger.info(`  Tick Upper: ${tickUpper}`);

  // Get amounts
  const maxNativeAmount = formatUnits(nativeBalance - parseUnits("0.01", 18), 18);
  const nativeAmountInput = readlineSync.question(
    `\nEnter amount of native CAMP to add (max: ${maxNativeAmount}): `
  );
  
  if (!nativeAmountInput || isNaN(Number(nativeAmountInput))) {
    logger.error("Invalid amount");
    return;
  }

  const nativeAmount = parseUnits(nativeAmountInput, 18);
  
  if (!await LiquidityHelpers.hasEnoughNativeForGas(publicClient, userAddress, nativeAmount)) {
    logger.error("Insufficient native balance (need to keep some for gas)");
    return;
  }

  // Calculate token amount based on current price and range
  // This is simplified - actual calculation depends on position within range
  const tokenAmount = isNativeToken0 
    ? nativeAmount / BigInt(Math.floor(currentPrice * 1000)) * 1000n
    : nativeAmount * BigInt(Math.floor(currentPrice * 1000)) / 1000n;

  const tokenAmountFormatted = formatUnits(tokenAmount, selectedToken.decimals);
  logger.info(`\n📊 Estimated ${selectedToken.symbol} needed: ${tokenAmountFormatted}`);
  
  if (tokenAmount > selectedToken.balance) {
    logger.error(`Insufficient ${selectedToken.symbol} balance`);
    return;
  }

  // Prepare mint parameters
  const amount0Desired = isNativeToken0 ? nativeAmount : tokenAmount;
  const amount1Desired = isNativeToken0 ? tokenAmount : nativeAmount;
  const amount0Min = applySlippage(amount0Desired);
  const amount1Min = applySlippage(amount1Desired);

  logger.info("\n📝 Transaction Summary:");
  logger.info(`  Native CAMP: ${formatUnits(nativeAmount, 18)}`);
  logger.info(`  ${selectedToken.symbol}: ${tokenAmountFormatted}`);
  logger.info(`  Fee Tier: ${selectedFeeTier.name}`);
  logger.info(`  Price Range: ${priceLower.toFixed(4)} - ${priceUpper.toFixed(4)}`);
  logger.info(`  Slippage: 0.5%`);

  const confirm = readlineSync.keyInYNStrict("\nProceed with adding liquidity?");
  if (!confirm) {
    logger.info("Cancelled");
    return;
  }

  // Approve token
  logger.info("\n🔐 Approving token...");
  await LiquidityHelpers.checkAndApproveToken(
    walletClient,
    publicClient,
    selectedToken.address,
    tokenAmount,
    CONTRACTS.NFT_POSITION_MANAGER,
    selectedToken.symbol
  );

  // Create and initialize pool if necessary
  if (!poolInfo) {
    logger.info("\n🏊 Creating pool...");
    const sqrtPriceX96 = LiquidityHelpers.encodePriceSqrt(
      isNativeToken0 ? tokenAmount : nativeAmount,
      isNativeToken0 ? nativeAmount : tokenAmount
    );
    
    const createPoolData = encodeFunctionData({
      abi: ABIS.NFT_POSITION_MANAGER,
      functionName: "createAndInitializePoolIfNecessary",
      args: [token0, token1, selectedFeeTier.fee, sqrtPriceX96],
    });
    
    // We'll include this in the multicall
  }

  // Prepare mint parameters
  const mintParams = {
    token0,
    token1,
    fee: selectedFeeTier.fee,
    tickLower,
    tickUpper,
    amount0Desired,
    amount1Desired,
    amount0Min,
    amount1Min,
    recipient: userAddress,
    deadline: getDeadline(),
  };

  logger.info("\n💧 Adding V3 concentrated liquidity with native CAMP...");

  // Use multicall to mint position with native CAMP
  const multicallData = [];
  
  // If pool doesn't exist, create it first
  if (!poolInfo) {
    const sqrtPriceX96 = LiquidityHelpers.encodePriceSqrt(
      isNativeToken0 ? tokenAmount : nativeAmount,
      isNativeToken0 ? nativeAmount : tokenAmount
    );
    
    multicallData.push(
      encodeFunctionData({
        abi: ABIS.NFT_POSITION_MANAGER,
        functionName: "createAndInitializePoolIfNecessary",
        args: [token0, token1, selectedFeeTier.fee, sqrtPriceX96],
      })
    );
  }
  
  // Add mint call
  multicallData.push(
    encodeFunctionData({
      abi: ABIS.NFT_POSITION_MANAGER,
      functionName: "mint",
      args: [mintParams],
    })
  );
  
  // Add refund call for any excess native token
  multicallData.push(
    encodeFunctionData({
      abi: ABIS.NFT_POSITION_MANAGER,
      functionName: "refundETH",
    })
  );

  const txHash = await walletClient.writeContract({
    address: CONTRACTS.NFT_POSITION_MANAGER,
    abi: ABIS.NFT_POSITION_MANAGER,
    functionName: "multicall",
    args: [multicallData],
    value: nativeAmount, // Send native CAMP
  });

  logger.info(`Transaction sent: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status === "success") {
    logger.success("✅ V3 native liquidity added successfully!");
    logger.info(`Gas used: ${receipt.gasUsed}`);
    logger.success("\n🎉 Position created as NFT!");
    logger.info("Use 'npm run liquidity:native-v3' to manage your positions");
  } else {
    logger.error("❌ Transaction failed");
  }
}

async function removeV3NativeLiquidity(
  publicClient: any,
  walletClient: any,
  userAddress: Address
) {
  logger.header("\n💧 Remove V3 Native CAMP Liquidity");
  
  // Get user's V3 positions
  const positions = await LiquidityHelpers.getUserV3Positions(publicClient, userAddress);
  
  if (positions.length === 0) {
    logger.warn("No V3 positions found");
    return;
  }
  
  // Filter positions with WCAMP (native)
  const nativePositions = positions.filter(
    p => p.token0 === CONTRACTS.WCAMP || p.token1 === CONTRACTS.WCAMP
  );
  
  if (nativePositions.length === 0) {
    logger.warn("No native CAMP V3 positions found");
    return;
  }
  
  // Display positions
  logger.success(`\n📊 Found ${nativePositions.length} native CAMP V3 position(s):\n`);
  
  for (let i = 0; i < nativePositions.length; i++) {
    const pos = nativePositions[i];
    const [token0Info, token1Info] = await Promise.all([
      pos.token0 === CONTRACTS.WCAMP 
        ? { symbol: "CAMP", decimals: 18 }
        : LiquidityHelpers.getTokenInfo(publicClient, pos.token0, userAddress),
      pos.token1 === CONTRACTS.WCAMP
        ? { symbol: "CAMP", decimals: 18 }
        : LiquidityHelpers.getTokenInfo(publicClient, pos.token1, userAddress),
    ]);
    
    const feePercentage = pos.fee / 10000;
    logger.info(`[${i}] ${token0Info.symbol}/${token1Info.symbol} (${feePercentage}% fee)`);
    logger.info(`    NFT ID: #${pos.tokenId}`);
    logger.info(`    Liquidity: ${pos.liquidity.toString()}`);
    
    if (pos.tokensOwed0 > 0n || pos.tokensOwed1 > 0n) {
      logger.success(`    💰 Unclaimed Fees:`);
      if (pos.tokensOwed0 > 0n) {
        logger.info(`      ${token0Info.symbol}: ${formatUnits(pos.tokensOwed0, token0Info.decimals)}`);
      }
      if (pos.tokensOwed1 > 0n) {
        logger.info(`      ${token1Info.symbol}: ${formatUnits(pos.tokensOwed1, token1Info.decimals)}`);
      }
    }
    logger.divider();
  }
  
  // Select position
  const posIndex = readlineSync.keyInSelect(
    nativePositions.map((p, i) => `Position #${i}`),
    "\nSelect position to remove:"
  );
  
  if (posIndex === -1) {
    logger.info("Cancelled");
    return;
  }
  
  const selectedPosition = nativePositions[posIndex];
  
  // Select percentage to remove
  const percentageOptions = ["25%", "50%", "75%", "100% (Max)"];
  const percentageIndex = readlineSync.keyInSelect(
    percentageOptions,
    "\nHow much liquidity to remove?"
  );
  
  if (percentageIndex === -1) {
    logger.info("Cancelled");
    return;
  }
  
  const percentages = [25, 50, 75, 100];
  const removalPercentage = percentages[percentageIndex];
  const liquidityToRemove = (selectedPosition.liquidity * BigInt(removalPercentage)) / 100n;
  
  logger.info("\n📝 Removal Summary:");
  logger.info(`  NFT ID: #${selectedPosition.tokenId}`);
  logger.info(`  Liquidity to remove: ${liquidityToRemove} (${removalPercentage}%)`);
  logger.info(`  Will receive native CAMP + ${selectedPosition.token0 === CONTRACTS.WCAMP ? "token" : "WCAMP"}`);
  
  const confirm = readlineSync.keyInYNStrict("\nProceed with removing liquidity?");
  if (!confirm) {
    logger.info("Cancelled");
    return;
  }
  
  logger.info("\n💧 Removing V3 liquidity...");
  
  // Use multicall to decrease liquidity, collect, and unwrap
  const multicallData = [];
  
  // Decrease liquidity
  multicallData.push(
    encodeFunctionData({
      abi: ABIS.NFT_POSITION_MANAGER,
      functionName: "decreaseLiquidity",
      args: [{
        tokenId: selectedPosition.tokenId,
        liquidity: liquidityToRemove,
        amount0Min: 0n,
        amount1Min: 0n,
        deadline: getDeadline(),
      }],
    })
  );
  
  // Collect tokens
  multicallData.push(
    encodeFunctionData({
      abi: ABIS.NFT_POSITION_MANAGER,
      functionName: "collect",
      args: [{
        tokenId: selectedPosition.tokenId,
        recipient: CONTRACTS.NFT_POSITION_MANAGER, // Collect to position manager for unwrapping
        amount0Max: 2n ** 128n - 1n,
        amount1Max: 2n ** 128n - 1n,
      }],
    })
  );
  
  // Unwrap WCAMP to native
  multicallData.push(
    encodeFunctionData({
      abi: ABIS.NFT_POSITION_MANAGER,
      functionName: "unwrapWETH9",
      args: [0n, userAddress], // Unwrap all and send to user
    })
  );
  
  // Sweep any remaining tokens
  const otherToken = selectedPosition.token0 === CONTRACTS.WCAMP 
    ? selectedPosition.token1 
    : selectedPosition.token0;
    
  multicallData.push(
    encodeFunctionData({
      abi: ABIS.NFT_POSITION_MANAGER,
      functionName: "sweepToken",
      args: [otherToken, 0n, userAddress],
    })
  );
  
  const txHash = await walletClient.writeContract({
    address: CONTRACTS.NFT_POSITION_MANAGER,
    abi: ABIS.NFT_POSITION_MANAGER,
    functionName: "multicall",
    args: [multicallData],
  });
  
  logger.info(`Transaction sent: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  
  if (receipt.status === "success") {
    logger.success("✅ Liquidity removed successfully!");
    logger.success("Native CAMP and tokens received!");
    
    if (removalPercentage === 100 && liquidityToRemove === selectedPosition.liquidity) {
      logger.info("\n✨ Position fully closed");
    } else {
      logger.info(`\n📊 Remaining liquidity: ${selectedPosition.liquidity - liquidityToRemove}`);
    }
    
    logger.info(`Gas used: ${receipt.gasUsed}`);
  } else {
    logger.error("❌ Transaction failed");
  }
}

async function collectV3Fees(
  publicClient: any,
  walletClient: any,
  userAddress: Address
) {
  logger.header("\n💰 Collect V3 Fees");
  
  // Get user's V3 positions
  const positions = await LiquidityHelpers.getUserV3Positions(publicClient, userAddress);
  
  if (positions.length === 0) {
    logger.warn("No V3 positions found");
    return;
  }
  
  // Filter positions with unclaimed fees
  const positionsWithFees = positions.filter(
    p => p.tokensOwed0 > 0n || p.tokensOwed1 > 0n
  );
  
  if (positionsWithFees.length === 0) {
    logger.warn("No unclaimed fees found");
    return;
  }
  
  logger.success(`\n📊 Found ${positionsWithFees.length} position(s) with unclaimed fees:\n`);
  
  let totalFees = { token0: 0n, token1: 0n };
  
  for (const pos of positionsWithFees) {
    const [token0Info, token1Info] = await Promise.all([
      pos.token0 === CONTRACTS.WCAMP 
        ? { symbol: "CAMP", decimals: 18 }
        : LiquidityHelpers.getTokenInfo(publicClient, pos.token0, userAddress),
      pos.token1 === CONTRACTS.WCAMP
        ? { symbol: "CAMP", decimals: 18 }
        : LiquidityHelpers.getTokenInfo(publicClient, pos.token1, userAddress),
    ]);
    
    logger.info(`NFT #${pos.tokenId}:`);
    if (pos.tokensOwed0 > 0n) {
      logger.info(`  ${token0Info.symbol}: ${formatUnits(pos.tokensOwed0, token0Info.decimals)}`);
      totalFees.token0 += pos.tokensOwed0;
    }
    if (pos.tokensOwed1 > 0n) {
      logger.info(`  ${token1Info.symbol}: ${formatUnits(pos.tokensOwed1, token1Info.decimals)}`);
      totalFees.token1 += pos.tokensOwed1;
    }
  }
  
  const confirm = readlineSync.keyInYNStrict("\nCollect all fees?");
  if (!confirm) {
    logger.info("Cancelled");
    return;
  }
  
  logger.info("\n💰 Collecting fees...");
  
  // Collect fees from all positions
  const multicallData = [];
  
  for (const pos of positionsWithFees) {
    multicallData.push(
      encodeFunctionData({
        abi: ABIS.NFT_POSITION_MANAGER,
        functionName: "collect",
        args: [{
          tokenId: pos.tokenId,
          recipient: userAddress,
          amount0Max: 2n ** 128n - 1n,
          amount1Max: 2n ** 128n - 1n,
        }],
      })
    );
  }
  
  const txHash = await walletClient.writeContract({
    address: CONTRACTS.NFT_POSITION_MANAGER,
    abi: ABIS.NFT_POSITION_MANAGER,
    functionName: "multicall",
    args: [multicallData],
  });
  
  logger.info(`Transaction sent: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  
  if (receipt.status === "success") {
    logger.success("✅ Fees collected successfully!");
    logger.info(`Gas used: ${receipt.gasUsed}`);
  } else {
    logger.error("❌ Transaction failed");
  }
}

async function viewV3NativePositions(
  publicClient: any,
  userAddress: Address
) {
  logger.header("\n📊 V3 Native CAMP Positions");
  
  const positions = await LiquidityHelpers.getUserV3Positions(publicClient, userAddress);
  
  if (positions.length === 0) {
    logger.warn("No V3 positions found");
    logger.info("\nAdd liquidity using: npm run liquidity:native-v3");
    return;
  }
  
  // Filter positions with WCAMP (native)
  const nativePositions = positions.filter(
    p => p.token0 === CONTRACTS.WCAMP || p.token1 === CONTRACTS.WCAMP
  );
  
  if (nativePositions.length === 0) {
    logger.warn("No native CAMP V3 positions found");
    logger.info("\nAdd native liquidity using: npm run liquidity:native-v3");
    return;
  }
  
  logger.success(`\n✅ Found ${nativePositions.length} native CAMP V3 position(s):\n`);
  
  for (const pos of nativePositions) {
    const [token0Info, token1Info] = await Promise.all([
      pos.token0 === CONTRACTS.WCAMP 
        ? { symbol: "CAMP", decimals: 18 }
        : LiquidityHelpers.getTokenInfo(publicClient, pos.token0, userAddress),
      pos.token1 === CONTRACTS.WCAMP
        ? { symbol: "CAMP", decimals: 18 }
        : LiquidityHelpers.getTokenInfo(publicClient, pos.token1, userAddress),
    ]);
    
    const feePercentage = pos.fee / 10000;
    const { priceLower, priceUpper } = LiquidityHelpers.calculateV3PriceRange(pos.tickLower, pos.tickUpper);
    
    // Get pool info to check if in range
    const poolInfo = await LiquidityHelpers.getV3PoolInfo(
      publicClient,
      pos.token0,
      pos.token1,
      pos.fee
    );
    
    const inRange = poolInfo && poolInfo.tick >= pos.tickLower && poolInfo.tick < pos.tickUpper;
    
    logger.info(`${token0Info.symbol}/${token1Info.symbol} (${feePercentage}% fee)`);
    logger.info(`  NFT ID: #${pos.tokenId}`);
    logger.info(`  Status: ${inRange ? "✅ IN RANGE" : "⚠️ OUT OF RANGE"}`);
    logger.info(`  Liquidity: ${pos.liquidity.toString()}`);
    logger.info(`  Price Range:`);
    logger.info(`    Lower: ${priceLower.toFixed(6)}`);
    logger.info(`    Upper: ${priceUpper.toFixed(6)}`);
    
    if (poolInfo) {
      logger.info(`  Current Tick: ${poolInfo.tick}`);
    }
    
    if (pos.tokensOwed0 > 0n || pos.tokensOwed1 > 0n) {
      logger.success(`  💰 Unclaimed Fees:`);
      if (pos.tokensOwed0 > 0n) {
        logger.info(`    ${token0Info.symbol}: ${formatUnits(pos.tokensOwed0, token0Info.decimals)}`);
      }
      if (pos.tokensOwed1 > 0n) {
        logger.info(`    ${token1Info.symbol}: ${formatUnits(pos.tokensOwed1, token1Info.decimals)}`);
      }
    }
    
    logger.divider();
  }
  
  logger.info("\n📋 Management Options:");
  logger.info("  • Add more liquidity: npm run liquidity:native-v3");
  logger.info("  • Remove liquidity: npm run liquidity:native-v3");
  logger.info("  • Collect fees: npm run liquidity:native-v3");
}

main().catch((error) => {
  logger.error("Fatal error:", error?.message || error);
  process.exit(1);
});