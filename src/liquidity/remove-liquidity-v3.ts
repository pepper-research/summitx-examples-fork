import { config } from "dotenv";
import readlineSync from "readline-sync";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { basecampTestnet } from "../config/base-testnet";
import { CONTRACTS, getDeadline } from "../config/contracts";
import { NFT_POSITION_MANAGER_ABI } from "../config/abis";
import { LiquidityHelpers } from "../utils/liquidity-helpers";
import { logger } from "../utils/logger";

config();

async function main() {
  logger.header("💧 Remove V3 Liquidity");
  logger.info("Remove liquidity from Uniswap V3 concentrated positions");
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
    // Get user's V3 positions
    const positions = await LiquidityHelpers.getUserV3Positions(publicClient, account.address);
    
    if (positions.length === 0) {
      logger.warn("No V3 positions found");
      logger.info("\nAdd liquidity using: npm run liquidity:add-v3");
      return;
    }
    
    // Display positions
    logger.success(`\n📊 Found ${positions.length} V3 position(s):\n`);
    
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      
      // Debug: log position structure
      if (i === 0) {
        logger.info(`Debug - First position structure: ${JSON.stringify(Object.keys(pos))}`);
        logger.info(`Debug - token0: ${pos.token0}, token1: ${pos.token1}`);
      }
      
      // getTokenInfo now handles fallbacks internally
      const [token0Info, token1Info] = await Promise.all([
        LiquidityHelpers.getTokenInfo(publicClient, pos.token0, account.address),
        LiquidityHelpers.getTokenInfo(publicClient, pos.token1, account.address),
      ]);
      
      const feePercentage = pos.fee / 10000;
      logger.info(`[${i}] ${token0Info.symbol}/${token1Info.symbol} (${feePercentage}% fee)`);
      logger.info(`    NFT ID: #${pos.tokenId}`);
      logger.info(`    Liquidity: ${pos.liquidity.toString()}`);
      
      // Check if position is in range
      const poolInfo = await LiquidityHelpers.getV3PoolInfo(
        publicClient,
        pos.token0,
        pos.token1,
        pos.fee
      );
      
      if (poolInfo) {
        const inRange = poolInfo.tick >= pos.tickLower && poolInfo.tick < pos.tickUpper;
        logger.info(`    Status: ${inRange ? "✅ IN RANGE" : "⚠️ OUT OF RANGE"}`);
      }
      
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
      positions.map((p, i) => `Position #${i} (NFT #${p.tokenId})`),
      "\nSelect position to remove:"
    );
    
    if (posIndex === -1) {
      logger.info("Cancelled");
      return;
    }
    
    const selectedPosition = positions[posIndex];
    
    // Get token info for display (getTokenInfo now handles fallbacks internally)
    const [token0Info, token1Info] = await Promise.all([
      LiquidityHelpers.getTokenInfo(publicClient, selectedPosition.token0, account.address),
      LiquidityHelpers.getTokenInfo(publicClient, selectedPosition.token1, account.address),
    ]);
    
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
    logger.info(`  Pair: ${token0Info.symbol}/${token1Info.symbol}`);
    logger.info(`  NFT ID: #${selectedPosition.tokenId}`);
    logger.info(`  Liquidity to remove: ${liquidityToRemove} (${removalPercentage}%)`);
    logger.info(`  Slippage: 0.5%`);
    
    const confirm = readlineSync.keyInYNStrict("\nProceed with removing liquidity?");
    if (!confirm) {
      logger.info("Cancelled");
      return;
    }
    
    logger.info("\n💧 Removing V3 liquidity...");
    
    // Prepare multicall data
    const multicallData = [];
    
    // 1. Decrease liquidity
    multicallData.push(
      encodeFunctionData({
        abi: NFT_POSITION_MANAGER_ABI,
        functionName: "decreaseLiquidity",
        args: [{
          tokenId: selectedPosition.tokenId,
          liquidity: liquidityToRemove,
          amount0Min: 0n, // Can be set to apply slippage
          amount1Min: 0n, // Can be set to apply slippage
          deadline: getDeadline(),
        }],
      })
    );
    
    // 2. Collect tokens (including fees)
    multicallData.push(
      encodeFunctionData({
        abi: NFT_POSITION_MANAGER_ABI,
        functionName: "collect",
        args: [{
          tokenId: selectedPosition.tokenId,
          recipient: account.address,
          amount0Max: 2n ** 128n - 1n, // Collect all
          amount1Max: 2n ** 128n - 1n, // Collect all
        }],
      })
    );
    
    // 3. If removing 100%, burn the NFT
    if (removalPercentage === 100 && liquidityToRemove === selectedPosition.liquidity) {
      multicallData.push(
        encodeFunctionData({
          abi: NFT_POSITION_MANAGER_ABI,
          functionName: "burn",
          args: [selectedPosition.tokenId],
        })
      );
    }
    
    const txHash = await walletClient.writeContract({
      address: CONTRACTS.NFT_POSITION_MANAGER,
      abi: NFT_POSITION_MANAGER_ABI,
      functionName: "multicall",
      args: [multicallData],
    });
    
    logger.info(`Transaction sent: ${txHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    
    if (receipt.status === "success") {
      logger.success("✅ Liquidity removed successfully!");
      
      if (removalPercentage === 100 && liquidityToRemove === selectedPosition.liquidity) {
        logger.info("✨ Position fully closed and NFT burned");
      } else {
        logger.info(`📊 Remaining liquidity: ${selectedPosition.liquidity - liquidityToRemove}`);
      }
      
      logger.info(`Gas used: ${receipt.gasUsed}`);
      
      // Show balances received
      const [newToken0Info, newToken1Info] = await Promise.all([
        LiquidityHelpers.getTokenInfo(publicClient, selectedPosition.token0, account.address),
        LiquidityHelpers.getTokenInfo(publicClient, selectedPosition.token1, account.address),
      ]);
      
      logger.success("\n💰 Tokens received (including fees if any):");
      logger.info(`  ${token0Info.symbol}: ${formatUnits(newToken0Info.balance, token0Info.decimals)}`);
      logger.info(`  ${token1Info.symbol}: ${formatUnits(newToken1Info.balance, token1Info.decimals)}`);
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