import { config } from "dotenv";
import readlineSync from "readline-sync";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  parseAbi,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  basecampTestnet,
  baseCampTestnetTokens,
  WCAMP_ADDRESS,
} from "../config/base-testnet";
import { logger } from "../utils/logger";
import { approveTokenWithWait, waitForTransaction, delay } from "../utils/transaction-helpers";

config();

// V2 Router address for Base Camp Testnet
const V2_ROUTER_ADDRESS = "0x03B38A5C3cf55cB3B8D61Dc7eaB7BBC0ec276708";

// ABIs
const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
]);

const V2_ROUTER_ABI = parseAbi([
  "function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) returns (uint amountA, uint amountB, uint liquidity)",
  "function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) payable returns (uint amountToken, uint amountETH, uint liquidity)",
  "function quote(uint amountA, uint reserveA, uint reserveB) pure returns (uint amountB)",
  "function getAmountsOut(uint amountIn, address[] calldata path) view returns (uint[] memory amounts)",
]);

const V2_FACTORY_ABI = parseAbi([
  "function getPair(address tokenA, address tokenB) view returns (address pair)",
]);

const V2_PAIR_ABI = parseAbi([
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
]);

// V2 Factory address
const V2_FACTORY_ADDRESS = "0xFe5498944B504FBf57DE0C76FB770974C0C54821";

interface TokenInfo {
  address: Address;
  symbol: string;
  decimals: number;
  balance: bigint;
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


async function getPairInfo(
  publicClient: any,
  tokenA: Address,
  tokenB: Address
) {
  // Get pair address
  const pairAddress = await publicClient.readContract({
    address: V2_FACTORY_ADDRESS,
    abi: V2_FACTORY_ABI,
    functionName: "getPair",
    args: [tokenA, tokenB],
  });

  if (pairAddress === "0x0000000000000000000000000000000000000000") {
    return null;
  }

  // Get pair reserves and tokens
  const [reserves, token0, token1, totalSupply] = await Promise.all([
    publicClient.readContract({
      address: pairAddress,
      abi: V2_PAIR_ABI,
      functionName: "getReserves",
    }),
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
      functionName: "totalSupply",
    }),
  ]);

  // Order reserves based on token addresses
  const [reserveA, reserveB] =
    token0.toLowerCase() === tokenA.toLowerCase()
      ? [reserves[0], reserves[1]]
      : [reserves[1], reserves[0]];

  return {
    pairAddress,
    reserveA,
    reserveB,
    totalSupply,
  };
}

async function calculateOptimalAmounts(
  publicClient: any,
  tokenA: Address,
  tokenB: Address,
  amountA: bigint,
  decimalsA: number,
  decimalsB: number
) {
  const pairInfo = await getPairInfo(publicClient, tokenA, tokenB);

  if (!pairInfo) {
    // New pair - use provided amounts
    return { amountBOptimal: 0n, isNewPair: true };
  }

  // Calculate optimal amount B based on current reserves
  const amountBOptimal = await publicClient.readContract({
    address: V2_ROUTER_ADDRESS,
    abi: V2_ROUTER_ABI,
    functionName: "quote",
    args: [amountA, pairInfo.reserveA, pairInfo.reserveB],
  });

  return {
    amountBOptimal,
    isNewPair: false,
    reserveA: pairInfo.reserveA,
    reserveB: pairInfo.reserveB,
  };
}

async function main() {
  logger.header("💧 Add Liquidity V2 Example");
  logger.info("Add liquidity to V2 AMM pools on Base Camp Testnet");
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
    logger.info("\n🔄 Select tokens for liquidity pool:");
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

    const tokenA = tokenInfos[tokenAIndex];
    const tokenB = tokenInfos[actualTokenBIndex];

    logger.success(`\n✅ Selected pair: ${tokenA.symbol}/${tokenB.symbol}`);

    // Check if pair exists
    const pairInfo = await getPairInfo(
      publicClient,
      tokenA.address,
      tokenB.address
    );

    if (pairInfo) {
      const reserveAFormatted = formatUnits(pairInfo.reserveA, tokenA.decimals);
      const reserveBFormatted = formatUnits(pairInfo.reserveB, tokenB.decimals);
      logger.info(`📊 Pool exists with reserves:`);
      logger.info(`  ${tokenA.symbol}: ${reserveAFormatted}`);
      logger.info(`  ${tokenB.symbol}: ${reserveBFormatted}`);
      logger.info(`  LP Supply: ${formatUnits(pairInfo.totalSupply, 18)}`);
    } else {
      logger.warn("⚠️ This will create a new pool");
    }

    // Get amount for token A
    const maxAmountA = formatUnits(tokenA.balance, tokenA.decimals);
    const amountAInput = readlineSync.question(
      `\nEnter amount of ${tokenA.symbol} to add (max: ${maxAmountA}): `
    );

    if (!amountAInput || isNaN(Number(amountAInput))) {
      logger.error("Invalid amount");
      return;
    }

    const amountA = parseUnits(amountAInput, tokenA.decimals);
    if (amountA > tokenA.balance) {
      logger.error("Insufficient balance");
      return;
    }

    // Calculate optimal amount for token B
    let amountB: bigint;

    if (pairInfo) {
      // Existing pair - calculate optimal amount
      const { amountBOptimal } = await calculateOptimalAmounts(
        publicClient,
        tokenA.address,
        tokenB.address,
        amountA,
        tokenA.decimals,
        tokenB.decimals
      );

      amountB = amountBOptimal;
      logger.info(
        `\n📊 Optimal ${tokenB.symbol} amount: ${formatUnits(
          amountB,
          tokenB.decimals
        )}`
      );

      if (amountB > tokenB.balance) {
        logger.error(`Insufficient ${tokenB.symbol} balance`);
        logger.info(
          `Need: ${formatUnits(amountB, tokenB.decimals)} ${tokenB.symbol}`
        );
        logger.info(
          `Have: ${formatUnits(tokenB.balance, tokenB.decimals)} ${
            tokenB.symbol
          }`
        );
        return;
      }
    } else {
      // New pair - ask for token B amount
      const maxAmountB = formatUnits(tokenB.balance, tokenB.decimals);
      const amountBInput = readlineSync.question(
        `Enter amount of ${tokenB.symbol} to add (max: ${maxAmountB}): `
      );

      if (!amountBInput || isNaN(Number(amountBInput))) {
        logger.error("Invalid amount");
        return;
      }

      amountB = parseUnits(amountBInput, tokenB.decimals);
      if (amountB > tokenB.balance) {
        logger.error("Insufficient balance");
        return;
      }
    }

    // Set slippage tolerance (0.5%)
    const slippageTolerance = 50n; // 0.5%
    const amountAMin = (amountA * (10000n - slippageTolerance)) / 10000n;
    const amountBMin = (amountB * (10000n - slippageTolerance)) / 10000n;

    logger.info("\n📝 Transaction Summary:");
    logger.info(`  ${tokenA.symbol}: ${formatUnits(amountA, tokenA.decimals)}`);
    logger.info(`  ${tokenB.symbol}: ${formatUnits(amountB, tokenB.decimals)}`);
    logger.info(`  Slippage: 0.5%`);
    logger.info(
      `  Min ${tokenA.symbol}: ${formatUnits(amountAMin, tokenA.decimals)}`
    );
    logger.info(
      `  Min ${tokenB.symbol}: ${formatUnits(amountBMin, tokenB.decimals)}`
    );

    const confirm = readlineSync.keyInYNStrict(
      "\nProceed with adding liquidity?"
    );
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
      V2_ROUTER_ADDRESS as Address,
      amountA,
      tokenA.symbol,
      3000 // 3 second wait after approval
    );
    await approveTokenWithWait(
      walletClient,
      publicClient,
      tokenB.address,
      V2_ROUTER_ADDRESS as Address,
      amountB,
      tokenB.symbol,
      3000 // 3 second wait after approval
    );

    // Add liquidity
    logger.info("\n💧 Adding liquidity...");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);

    let txHash: Hex;

    // Check if one of the tokens is WCAMP and user wants to use native CAMP
    const isTokenAWCAMP =
      tokenA.address.toLowerCase() === WCAMP_ADDRESS.toLowerCase();
    const isTokenBWCAMP =
      tokenB.address.toLowerCase() === WCAMP_ADDRESS.toLowerCase();

    if (isTokenAWCAMP || isTokenBWCAMP) {
      // Check native balance
      const nativeBalance = await publicClient.getBalance({
        address: account.address,
      });

      const campAmount = isTokenAWCAMP ? amountA : amountB;
      const nativeFormatted = formatUnits(nativeBalance, 18);

      logger.info(`\n💰 Native CAMP balance: ${nativeFormatted}`);

      const useNative = readlineSync.keyInYNStrict(
        "\nWould you like to use native CAMP instead of WCAMP?"
      );

      if (useNative) {
        // Verify sufficient native balance (including gas)
        const estimatedGas = parseUnits("0.01", 18); // Reserve for gas
        const totalNeeded = campAmount + estimatedGas;

        if (nativeBalance < totalNeeded) {
          logger.error(`Insufficient native CAMP balance`);
          logger.info(`Need: ${formatUnits(campAmount, 18)} CAMP + gas`);
          logger.info(`Have: ${nativeFormatted} CAMP`);
          return;
        }

        const otherToken = isTokenAWCAMP ? tokenB : tokenA;
        const otherAmount = isTokenAWCAMP ? amountB : amountA;
        const otherAmountMin = isTokenAWCAMP ? amountBMin : amountAMin;
        const campAmountMin =
          (campAmount * (10000n - slippageTolerance)) / 10000n;

        logger.info("\n💧 Adding liquidity with native CAMP...");
        logger.info(`Native CAMP: ${formatUnits(campAmount, 18)}`);
        logger.info(
          `${otherToken.symbol}: ${formatUnits(
            otherAmount,
            otherToken.decimals
          )}`
        );

        // Use addLiquidityETH for native CAMP
        txHash = await walletClient.writeContract({
          address: V2_ROUTER_ADDRESS as Address,
          abi: V2_ROUTER_ABI,
          functionName: "addLiquidityETH",
          args: [
            otherToken.address,
            otherAmount,
            otherAmountMin,
            campAmountMin,
            account.address,
            deadline,
          ],
          value: campAmount,
        });
      } else {
        // Regular add liquidity with WCAMP
        txHash = await walletClient.writeContract({
          address: V2_ROUTER_ADDRESS as Address,
          abi: V2_ROUTER_ABI,
          functionName: "addLiquidity",
          args: [
            tokenA.address,
            tokenB.address,
            amountA,
            amountB,
            amountAMin,
            amountBMin,
            account.address,
            deadline,
          ],
        });
      }
    } else {
      // Regular add liquidity
      txHash = await walletClient.writeContract({
        address: V2_ROUTER_ADDRESS as Address,
        abi: V2_ROUTER_ABI,
        functionName: "addLiquidity",
        args: [
          tokenA.address,
          tokenB.address,
          amountA,
          amountB,
          amountAMin,
          amountBMin,
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
      logger.success("✅ Liquidity added successfully!");

      // Get LP token balance
      const newPairInfo = await getPairInfo(
        publicClient,
        tokenA.address,
        tokenB.address
      );

      if (newPairInfo) {
        const lpBalance = await publicClient.readContract({
          address: newPairInfo.pairAddress,
          abi: V2_PAIR_ABI,
          functionName: "balanceOf",
          args: [account.address],
        });

        logger.success(
          `\n🎉 LP Tokens received: ${formatUnits(lpBalance, 18)}`
        );
        logger.info(`LP Token address: ${newPairInfo.pairAddress}`);

        // Calculate pool share
        const poolShare = (lpBalance * 10000n) / newPairInfo.totalSupply;
        logger.info(`Your pool share: ${Number(poolShare) / 100}%`);
      }

      logger.info(`Gas used: ${receipt.gasUsed}`);
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
