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
import { CONTRACTS } from "../config/contracts";
import { NFT_POSITION_MANAGER_ABI } from "../config/abis";
import { LiquidityHelpers } from "../utils/liquidity-helpers";
import { logger } from "../utils/logger";

config();

async function main() {
  logger.header("💰 Collect V3 Fees");
  logger.info("Collect accumulated fees from Uniswap V3 positions");
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
    
    // Filter positions with unclaimed fees
    const positionsWithFees = positions.filter(
      p => p.tokensOwed0 > 0n || p.tokensOwed1 > 0n
    );
    
    if (positionsWithFees.length === 0) {
      logger.warn("No unclaimed fees found in any position");
      logger.info("\nYour positions may not have earned fees yet.");
      return;
    }
    
    logger.success(`\n📊 Found ${positionsWithFees.length} position(s) with unclaimed fees:\n`);
    
    let totalFeesDisplay = [];
    const tokenTotals = new Map<string, { amount: bigint, decimals: number, symbol: string }>();
    
    for (const pos of positionsWithFees) {
      const [token0Info, token1Info] = await Promise.all([
        LiquidityHelpers.getTokenInfo(publicClient, pos.token0, account.address),
        LiquidityHelpers.getTokenInfo(publicClient, pos.token1, account.address),
      ]);
      
      const feePercentage = pos.fee / 10000;
      logger.info(`NFT #${pos.tokenId} (${token0Info.symbol}/${token1Info.symbol} - ${feePercentage}% fee):`);
      
      if (pos.tokensOwed0 > 0n) {
        const amount = formatUnits(pos.tokensOwed0, token0Info.decimals);
        logger.info(`  ${token0Info.symbol}: ${amount}`);
        
        // Accumulate totals
        const key = pos.token0.toLowerCase();
        if (!tokenTotals.has(key)) {
          tokenTotals.set(key, { amount: 0n, decimals: token0Info.decimals, symbol: token0Info.symbol });
        }
        const current = tokenTotals.get(key)!;
        current.amount += pos.tokensOwed0;
      }
      
      if (pos.tokensOwed1 > 0n) {
        const amount = formatUnits(pos.tokensOwed1, token1Info.decimals);
        logger.info(`  ${token1Info.symbol}: ${amount}`);
        
        // Accumulate totals
        const key = pos.token1.toLowerCase();
        if (!tokenTotals.has(key)) {
          tokenTotals.set(key, { amount: 0n, decimals: token1Info.decimals, symbol: token1Info.symbol });
        }
        const current = tokenTotals.get(key)!;
        current.amount += pos.tokensOwed1;
      }
      
      logger.divider();
    }
    
    // Display totals
    logger.success("\n💰 Total fees to collect:");
    for (const [_, tokenData] of tokenTotals) {
      logger.info(`  ${tokenData.symbol}: ${formatUnits(tokenData.amount, tokenData.decimals)}`);
    }
    
    // Options for collection
    const options = [
      "Collect from all positions",
      "Select specific position",
      "Cancel"
    ];
    
    const choice = readlineSync.keyInSelect(options, "\nWhat would you like to do?");
    
    if (choice === -1 || choice === 2) {
      logger.info("Cancelled");
      return;
    }
    
    let positionsToCollect = [];
    
    if (choice === 0) {
      // Collect from all
      positionsToCollect = positionsWithFees;
    } else {
      // Select specific position
      const positionOptions = positionsWithFees.map(p => `NFT #${p.tokenId}`);
      const selectedIndex = readlineSync.keyInSelect(
        positionOptions,
        "\nSelect position to collect from:"
      );
      
      if (selectedIndex === -1) {
        logger.info("Cancelled");
        return;
      }
      
      positionsToCollect = [positionsWithFees[selectedIndex]];
    }
    
    const confirm = readlineSync.keyInYNStrict(
      `\nCollect fees from ${positionsToCollect.length} position(s)?`
    );
    
    if (!confirm) {
      logger.info("Cancelled");
      return;
    }
    
    logger.info("\n💰 Collecting fees...");
    
    // Prepare multicall data for all selected positions
    const multicallData = [];
    
    for (const pos of positionsToCollect) {
      logger.info(`Preparing collect for NFT #${pos.tokenId}`);
      
      // The collect function expects a tuple with these parameters in order
      const collectParams = [
        pos.tokenId,
        account.address,
        2n ** 128n - 1n, // amount0Max - collect all
        2n ** 128n - 1n, // amount1Max - collect all
      ];
      
      try {
        const encoded = encodeFunctionData({
          abi: NFT_POSITION_MANAGER_ABI,
          functionName: "collect",
          args: [collectParams], // Pass as array/tuple
        });
        multicallData.push(encoded);
      } catch (e: any) {
        logger.error(`Failed to encode collect for NFT #${pos.tokenId}: ${e?.message}`);
        throw e;
      }
    }
    
    logger.info(`Sending transaction with ${multicallData.length} collect calls...`);
    logger.info(`NFT Position Manager: ${CONTRACTS.NFT_POSITION_MANAGER}`);
    
    let txHash: string;
    
    try {
      // Try to estimate gas first
      const gasEstimate = await publicClient.estimateContractGas({
        address: CONTRACTS.NFT_POSITION_MANAGER,
        abi: NFT_POSITION_MANAGER_ABI,
        functionName: "multicall",
        args: [multicallData],
        account: account.address,
      });
      
      logger.info(`Gas estimate: ${gasEstimate}`);
      
      txHash = await walletClient.writeContract({
        address: CONTRACTS.NFT_POSITION_MANAGER,
        abi: NFT_POSITION_MANAGER_ABI,
        functionName: "multicall",
        args: [multicallData],
        gas: gasEstimate * 120n / 100n, // Add 20% buffer
      });
      
      logger.info(`Transaction sent: ${txHash}`);
    } catch (e: any) {
      logger.error(`Transaction failed: ${e?.message}`);
      
      // If multicall fails, try collecting individually
      if (positionsToCollect.length === 1) {
        throw e; // Already single, can't retry
      }
      
      logger.info("\nMulticall failed, trying individual collects...");
      
      for (const pos of positionsToCollect) {
        try {
          logger.info(`Collecting fees for NFT #${pos.tokenId}...`);
          
          const individualTxHash = await walletClient.writeContract({
            address: CONTRACTS.NFT_POSITION_MANAGER,
            abi: NFT_POSITION_MANAGER_ABI,
            functionName: "collect",
            args: [[
              pos.tokenId,
              account.address,
              2n ** 128n - 1n,
              2n ** 128n - 1n,
            ]],
          });
          
          logger.info(`Transaction sent: ${individualTxHash}`);
          const receipt = await publicClient.waitForTransactionReceipt({ hash: individualTxHash });
          
          if (receipt.status === "success") {
            logger.success(`✅ Collected fees for NFT #${pos.tokenId}`);
          }
        } catch (e2: any) {
          logger.error(`Failed to collect for NFT #${pos.tokenId}: ${e2?.message}`);
        }
      }
      
      return;
    }
    
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    
    if (receipt.status === "success") {
      logger.success("✅ Fees collected successfully!");
      logger.info(`Gas used: ${receipt.gasUsed}`);
      
      // Display collected amounts
      logger.success("\n💰 Fees collected:");
      for (const [address, tokenData] of tokenTotals) {
        logger.info(`  ${tokenData.symbol}: ${formatUnits(tokenData.amount, tokenData.decimals)}`);
      }
      
      logger.info("\n📊 To view updated positions: npm run liquidity:manage");
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