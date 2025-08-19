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
import { basecampTestnet, WCAMP_ADDRESS } from "../config/base-testnet";
import { logger } from "../utils/logger";

config();

// V2 Router address for Base Camp Testnet
const V2_ROUTER_ADDRESS = "0x03B38A5C3cf55cB3B8D61Dc7eaB7BBC0ec276708";
const V2_FACTORY_ADDRESS = "0xFe5498944B504FBf57DE0C76FB770974C0C54821";

// ABIs
const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function totalSupply() view returns (uint256)",
]);

const V2_ROUTER_ABI = parseAbi([
  "function removeLiquidity(address tokenA, address tokenB, uint liquidity, uint amountAMin, uint amountBMin, address to, uint deadline) returns (uint amountA, uint amountB)",
  "function removeLiquidityETH(address token, uint liquidity, uint amountTokenMin, uint amountETHMin, address to, uint deadline) returns (uint amountToken, uint amountETH)",
  "function removeLiquidityETHSupportingFeeOnTransferTokens(address token, uint liquidity, uint amountTokenMin, uint amountETHMin, address to, uint deadline) returns (uint amountETH)",
  "function getAmountsOut(uint amountIn, address[] calldata path) view returns (uint[] memory amounts)",
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
  "function name() view returns (string)",
  "function symbol() view returns (string)",
]);

interface LiquidityPosition {
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

async function getUserLiquidityPositions(
  publicClient: any,
  userAddress: Address
): Promise<LiquidityPosition[]> {
  const positions: LiquidityPosition[] = [];

  // Get all pairs
  const pairsLength = await publicClient.readContract({
    address: V2_FACTORY_ADDRESS,
    abi: V2_FACTORY_ABI,
    functionName: "allPairsLength",
  });

  logger.info(`Scanning ${pairsLength} pairs for your positions...`);

  // Check each pair for user balance
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
      // Get pair details
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

      // Get token details
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

      // Calculate user's share of the pool
      const poolShare = Number((lpBalance * 10000n) / totalSupply) / 100;
      const token0Amount = (reserves[0] * lpBalance) / totalSupply;
      const token1Amount = (reserves[1] * lpBalance) / totalSupply;

      positions.push({
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

async function checkAndApproveLP(
  walletClient: any,
  publicClient: any,
  lpTokenAddress: Address,
  amount: bigint
) {
  const account = walletClient.account.address;

  const allowance = await publicClient.readContract({
    address: lpTokenAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account, V2_ROUTER_ADDRESS as Address],
  });

  if (allowance < amount) {
    logger.info(`Approving LP tokens for router...`);
    const hash = await walletClient.writeContract({
      address: lpTokenAddress,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [V2_ROUTER_ADDRESS as Address, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    logger.success("✅ LP tokens approved");
  }
}

async function main() {
  logger.header("💧 Remove Liquidity V2 Example");
  logger.info("Remove liquidity from V2 AMM pools on Base Camp Testnet");
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
    // Get user's liquidity positions
    logger.info("\n🔍 Finding your liquidity positions...");
    const positions = await getUserLiquidityPositions(
      publicClient,
      account.address
    );

    if (positions.length === 0) {
      logger.warn("No liquidity positions found");
      logger.info("Add liquidity first using: npm run liquidity:add-v2");
      return;
    }

    // Display positions
    logger.success(`\n📊 Found ${positions.length} liquidity position(s):\n`);
    positions.forEach((pos, index) => {
      logger.info(`[${index}] ${pos.symbol0}/${pos.symbol1}`);
      logger.info(`    LP Balance: ${formatUnits(pos.lpBalance, 18)}`);
      logger.info(`    Pool Share: ${pos.poolShare.toFixed(4)}%`);
      logger.info(
        `    ${pos.symbol0}: ${formatUnits(pos.token0Amount, pos.decimals0)}`
      );
      logger.info(
        `    ${pos.symbol1}: ${formatUnits(pos.token1Amount, pos.decimals1)}`
      );
      logger.info(`    Pair: ${pos.pairAddress}`);
      logger.divider();
    });

    // Select position to remove
    const positionIndex = readlineSync.keyInSelect(
      positions.map((p) => `${p.symbol0}/${p.symbol1}`),
      "\nSelect position to remove liquidity from:"
    );

    if (positionIndex === -1) {
      logger.info("Cancelled");
      return;
    }

    const selectedPosition = positions[positionIndex];
    logger.success(
      `\n✅ Selected: ${selectedPosition.symbol0}/${selectedPosition.symbol1}`
    );

    // Select removal percentage
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
    const lpAmountToRemove =
      (selectedPosition.lpBalance * BigInt(removalPercentage)) / 100n;

    // Calculate expected amounts
    const expectedToken0 =
      (selectedPosition.token0Amount * BigInt(removalPercentage)) / 100n;
    const expectedToken1 =
      (selectedPosition.token1Amount * BigInt(removalPercentage)) / 100n;

    // Set slippage tolerance (0.5%)
    const slippageTolerance = 50n; // 0.5%
    const amountToken0Min =
      (expectedToken0 * (10000n - slippageTolerance)) / 10000n;
    const amountToken1Min =
      (expectedToken1 * (10000n - slippageTolerance)) / 10000n;

    logger.info("\n📝 Removal Summary:");
    logger.info(
      `  LP Tokens to remove: ${formatUnits(
        lpAmountToRemove,
        18
      )} (${removalPercentage}%)`
    );
    logger.info(
      `  Expected ${selectedPosition.symbol0}: ${formatUnits(
        expectedToken0,
        selectedPosition.decimals0
      )}`
    );
    logger.info(
      `  Expected ${selectedPosition.symbol1}: ${formatUnits(
        expectedToken1,
        selectedPosition.decimals1
      )}`
    );
    logger.info(`  Slippage: 0.5%`);
    logger.info(
      `  Min ${selectedPosition.symbol0}: ${formatUnits(
        amountToken0Min,
        selectedPosition.decimals0
      )}`
    );
    logger.info(
      `  Min ${selectedPosition.symbol1}: ${formatUnits(
        amountToken1Min,
        selectedPosition.decimals1
      )}`
    );

    // Check if one token is WCAMP and offer to receive native CAMP
    const hasWCAMP =
      selectedPosition.token0.toLowerCase() === WCAMP_ADDRESS.toLowerCase() ||
      selectedPosition.token1.toLowerCase() === WCAMP_ADDRESS.toLowerCase();

    let receiveNative = false;
    if (hasWCAMP) {
      receiveNative = readlineSync.keyInYNStrict(
        "\nWould you like to receive native CAMP instead of WCAMP?"
      );
    }

    const confirm = readlineSync.keyInYNStrict(
      "\nProceed with removing liquidity?"
    );
    if (!confirm) {
      logger.info("Cancelled");
      return;
    }

    // Approve LP tokens
    logger.info("\n🔐 Approving LP tokens...");
    await checkAndApproveLP(
      walletClient,
      publicClient,
      selectedPosition.pairAddress,
      lpAmountToRemove
    );

    // Remove liquidity
    logger.info("\n💧 Removing liquidity...");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);

    let txHash: Hex;

    if (receiveNative && hasWCAMP) {
      // Use removeLiquidityETH
      const otherToken =
        selectedPosition.token0.toLowerCase() === WCAMP_ADDRESS.toLowerCase()
          ? selectedPosition.token1
          : selectedPosition.token0;

      const otherTokenMin =
        selectedPosition.token0.toLowerCase() === WCAMP_ADDRESS.toLowerCase()
          ? amountToken1Min
          : amountToken0Min;

      const campMin =
        selectedPosition.token0.toLowerCase() === WCAMP_ADDRESS.toLowerCase()
          ? amountToken0Min
          : amountToken1Min;

      txHash = await walletClient.writeContract({
        address: V2_ROUTER_ADDRESS as Address,
        abi: V2_ROUTER_ABI,
        functionName: "removeLiquidityETH",
        args: [
          otherToken,
          lpAmountToRemove,
          otherTokenMin,
          campMin,
          account.address,
          deadline,
        ],
      });
    } else {
      // Regular remove liquidity
      txHash = await walletClient.writeContract({
        address: V2_ROUTER_ADDRESS as Address,
        abi: V2_ROUTER_ABI,
        functionName: "removeLiquidity",
        args: [
          selectedPosition.token0,
          selectedPosition.token1,
          lpAmountToRemove,
          amountToken0Min,
          amountToken1Min,
          account.address,
          deadline,
        ],
      });
    }

    logger.info(`Transaction sent: ${txHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    if (receipt.status === "success") {
      logger.success("✅ Liquidity removed successfully!");

      // Check received amounts
      const [newBalance0, newBalance1] = await Promise.all([
        selectedPosition.token0.toLowerCase() === WCAMP_ADDRESS.toLowerCase() &&
        receiveNative
          ? publicClient.getBalance({ address: account.address })
          : publicClient.readContract({
              address: selectedPosition.token0,
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [account.address],
            }),
        selectedPosition.token1.toLowerCase() === WCAMP_ADDRESS.toLowerCase() &&
        receiveNative
          ? publicClient.getBalance({ address: account.address })
          : publicClient.readContract({
              address: selectedPosition.token1,
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [account.address],
            }),
      ]);

      logger.success("\n🎉 Tokens received:");

      // Check remaining LP balance
      const remainingLP = await publicClient.readContract({
        address: selectedPosition.pairAddress,
        abi: V2_PAIR_ABI,
        functionName: "balanceOf",
        args: [account.address],
      });

      if (remainingLP > 0n) {
        logger.info(
          `\n📊 Remaining LP tokens: ${formatUnits(remainingLP, 18)}`
        );
        const newPoolShare =
          Number((remainingLP * 10000n) / selectedPosition.totalSupply) / 100;
        logger.info(`Remaining pool share: ${newPoolShare.toFixed(4)}%`);
      } else {
        logger.info("\n✨ All liquidity removed from this pool");
      }

      logger.info(`\nGas used: ${receipt.gasUsed}`);
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
