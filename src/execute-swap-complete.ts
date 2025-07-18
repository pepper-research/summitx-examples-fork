import { config } from "dotenv"
import { createWalletClient, createPublicClient, http, parseUnits, formatUnits, encodeFunctionData, type Address, type Hash } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { baseTestnet } from "viem/chains"
import { TradeType, Percent } from "@summitx/swap-sdk-core"
import { TokenQuoter } from "./quoter/token-quoter"
import { baseCampTestnetTokens } from "./config/base-testnet"
import { logger } from "./utils/logger"

// Load environment variables
config()

// Router addresses
const V2_ROUTER_ADDRESS = "0x03B38A5C3cf55cB3B8D61Dc7eaB7BBC0ec276708"
const SMART_ROUTER_ADDRESS = "0x197b7c9fC5c8AeA84Ab2909Bf94f24370539722D"

// Router V2 ABI (simplified)
const ROUTER_V2_ABI = [
  {
    name: "swapExactTokensForTokens",
    type: "function",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
    stateMutability: "nonpayable",
  },
  {
    name: "swapExactETHForTokens",
    type: "function",
    inputs: [
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
    stateMutability: "payable",
  },
  {
    name: "swapExactTokensForETH",
    type: "function",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
    stateMutability: "nonpayable",
  },
] as const

// Smart Router ABI (simplified for V3)
const SMART_ROUTER_ABI = [
  {
    name: "exactInputSingle",
    type: "function",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "payable",
  },
  {
    name: "exactInput",
    type: "function",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "path", type: "bytes" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "payable",
  },
  {
    name: "multicall",
    type: "function",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "results", type: "bytes[]" }],
    stateMutability: "payable",
  },
] as const

// ERC20 ABI
const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    name: "allowance",
    type: "function",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    name: "balanceOf",
    type: "function",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const

interface PoolInfo {
  type: "V2" | "V3"
  address: string
  fee?: number
}

function parsePoolInfo(poolStr: string): PoolInfo {
  if (poolStr.startsWith("V3")) {
    const parts = poolStr.split(" ")
    return {
      type: "V3",
      address: parts[1],
      fee: parts[2] ? parseInt(parts[2].replace("%", "")) * 10000 : 3000, // Convert percentage to basis points
    }
  } else if (poolStr.startsWith("V2")) {
    return {
      type: "V2",
      address: poolStr.split(" ")[1] || "",
    }
  }
  return { type: "V2", address: "" }
}

function buildSwapCalldata(
  quote: any,
  walletAddress: Address,
  slippageToleranceBps: number
): { to: Address; data: `0x${string}`; value: bigint; description: string } {
  const deadline = Math.floor(Date.now() / 1000) + 300 // 5 minutes
  const inputAmountBigInt = parseUnits(quote.inputAmount, quote.inputToken.decimals)
  const outputAmountBigInt = parseUnits(quote.outputAmount, quote.outputToken.decimals)
  const minAmountOut = (outputAmountBigInt * BigInt(10000 - slippageToleranceBps)) / BigInt(10000)

  // Parse pool information
  const pools = quote.pools.map(parsePoolInfo)
  const hasV3Pool = pools.some(p => p.type === "V3")
  const hasMultipleRoutes = quote.route.length > 1

  // Determine router and build calldata
  if (hasV3Pool || hasMultipleRoutes) {
    // Use Smart Router for V3 or split routes
    if (pools.length === 1 && pools[0].type === "V3") {
      // Single V3 swap
      const params = {
        tokenIn: quote.inputToken.address as Address,
        tokenOut: quote.outputToken.address as Address,
        fee: pools[0].fee || 3000,
        recipient: walletAddress,
        deadline: BigInt(deadline),
        amountIn: inputAmountBigInt,
        amountOutMinimum: minAmountOut,
        sqrtPriceLimitX96: BigInt(0),
      }

      const data = encodeFunctionData({
        abi: SMART_ROUTER_ABI,
        functionName: "exactInputSingle",
        args: [params],
      })

      return {
        to: SMART_ROUTER_ADDRESS as Address,
        data,
        value: BigInt(0),
        description: `Swap ${quote.inputAmount} ${quote.inputToken.symbol} for ${quote.outputAmount} ${quote.outputToken.symbol} via V3`,
      }
    } else {
      // Multi-hop or split routes - use multicall
      logger.warn("Multi-hop and split routes require more complex encoding")
      logger.info("For production use, implement full Trade conversion logic")
      
      // For now, return a simple V2 swap if possible
      if (!hasV3Pool) {
        const path = [quote.inputToken.address, quote.outputToken.address] as Address[]
        
        const data = encodeFunctionData({
          abi: ROUTER_V2_ABI,
          functionName: "swapExactTokensForTokens",
          args: [inputAmountBigInt, minAmountOut, path, walletAddress, BigInt(deadline)],
        })

        return {
          to: V2_ROUTER_ADDRESS as Address,
          data,
          value: BigInt(0),
          description: `Swap ${quote.inputAmount} ${quote.inputToken.symbol} for ${quote.outputAmount} ${quote.outputToken.symbol} via V2`,
        }
      }
      
      throw new Error("Complex routes not fully implemented in this example")
    }
  } else {
    // Use V2 Router for simple V2 swaps
    const path = [quote.inputToken.address, quote.outputToken.address] as Address[]
    
    const data = encodeFunctionData({
      abi: ROUTER_V2_ABI,
      functionName: "swapExactTokensForTokens",
      args: [inputAmountBigInt, minAmountOut, path, walletAddress, BigInt(deadline)],
    })

    return {
      to: V2_ROUTER_ADDRESS as Address,
      data,
      value: BigInt(0),
      description: `Swap ${quote.inputAmount} ${quote.inputToken.symbol} for ${quote.outputAmount} ${quote.outputToken.symbol} via V2`,
    }
  }
}

async function main() {
  logger.header("SummitX Complete Swap Execution - Base Testnet")

  // Check for private key
  const privateKey = process.env.PRIVATE_KEY
  if (!privateKey) {
    logger.error("Please set PRIVATE_KEY in your .env file")
    process.exit(1)
  }

  // Setup account and clients
  const account = privateKeyToAccount(privateKey as `0x${string}`)
  const walletClient = createWalletClient({
    account,
    chain: baseTestnet,
    transport: http("https://rpc-campnetwork.xyz/8708df38d9cc4bb39ac813ae005be495"),
  })

  const publicClient = createPublicClient({
    chain: baseTestnet,
    transport: http("https://rpc-campnetwork.xyz/8708df38d9cc4bb39ac813ae005be495"),
  })

  logger.info(`Wallet address: ${account.address}`)

  // Initialize token quoter
  const quoter = new TokenQuoter({
    rpcUrl: "https://rpc-campnetwork.xyz/8708df38d9cc4bb39ac813ae005be495",
    slippageTolerance: 1.0,
    maxHops: 3,
    maxSplits: 3,
  })

  // Define swap parameters
  const inputToken = baseCampTestnetTokens.usdc
  const outputToken = baseCampTestnetTokens.t12eth
  const inputAmount = "10" // 10 USDC
  const slippageToleranceBps = 100 // 1% slippage

  logger.header("Step 1: Check Balances")
  
  // Check balances
  const [usdcBalance, t12ethBalance] = await Promise.all([
    publicClient.readContract({
      address: inputToken.address as Address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    }),
    publicClient.readContract({
      address: outputToken.address as Address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    }),
  ])

  logger.info(`USDC Balance: ${formatUnits(usdcBalance, inputToken.decimals)} USDC`)
  logger.info(`T12ETH Balance: ${formatUnits(t12ethBalance, outputToken.decimals)} T12ETH`)

  if (usdcBalance < parseUnits(inputAmount, inputToken.decimals)) {
    logger.error(`Insufficient USDC balance. Need at least ${inputAmount} USDC`)
    return
  }

  logger.header("Step 2: Get Quote")

  try {
    const quote = await quoter.getQuote(
      inputToken,
      outputToken,
      inputAmount,
      TradeType.EXACT_INPUT,
      false
    )

    if (!quote) {
      logger.error("No quote available for this swap")
      return
    }

    logger.success("Quote received:", {
      input: `${quote.inputAmount} ${quote.inputToken.symbol}`,
      output: `${quote.outputAmount} ${quote.outputToken.symbol}`,
      minimumReceived: `${quote.minimumReceived} ${quote.outputToken.symbol}`,
      priceImpact: quote.priceImpact,
      executionPrice: `1 ${quote.inputToken.symbol} = ${quote.executionPrice} ${quote.outputToken.symbol}`,
      route: Array.isArray(quote.route) ? quote.route.join(" → ") : quote.route,
      pools: quote.pools,
    })

    logger.header("Step 3: Build Swap Transaction")

    const swapCalldata = buildSwapCalldata(quote, account.address, slippageToleranceBps)
    logger.info(`Router: ${swapCalldata.to}`)
    logger.info(`Description: ${swapCalldata.description}`)

    // Check and handle approval
    const currentAllowance = await publicClient.readContract({
      address: inputToken.address as Address,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [account.address, swapCalldata.to],
    })

    const inputAmountBigInt = parseUnits(inputAmount, inputToken.decimals)
    
    if (currentAllowance < inputAmountBigInt) {
      logger.header("Step 4: Approve Router")
      
      const approvalTx = await walletClient.writeContract({
        address: inputToken.address as Address,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [swapCalldata.to, inputAmountBigInt],
      })

      logger.info(`Approval transaction: ${approvalTx}`)
      
      const approvalReceipt = await publicClient.waitForTransactionReceipt({
        hash: approvalTx,
      })
      
      logger.success(`Approval confirmed in block ${approvalReceipt.blockNumber}`)
    }

    logger.header("Step 5: Execute Swap")
    logger.info("Sending swap transaction in 3 seconds... (Ctrl+C to cancel)")
    await new Promise(resolve => setTimeout(resolve, 3000))

    const swapTx = await walletClient.sendTransaction({
      to: swapCalldata.to,
      data: swapCalldata.data,
      value: swapCalldata.value,
    })

    logger.info(`Swap transaction sent: ${swapTx}`)
    logger.info("Waiting for confirmation...")

    const swapReceipt = await publicClient.waitForTransactionReceipt({
      hash: swapTx,
    })

    logger.success(`Swap confirmed in block ${swapReceipt.blockNumber}`)
    logger.info(`Gas used: ${swapReceipt.gasUsed}`)
    logger.info(`Transaction hash: ${swapReceipt.transactionHash}`)

    // Check final balances
    logger.header("Step 6: Verify Results")
    
    const [finalUsdcBalance, finalT12ethBalance] = await Promise.all([
      publicClient.readContract({
        address: inputToken.address as Address,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [account.address],
      }),
      publicClient.readContract({
        address: outputToken.address as Address,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [account.address],
      }),
    ])

    const usdcSpent = formatUnits(usdcBalance - finalUsdcBalance, inputToken.decimals)
    const t12ethReceived = formatUnits(finalT12ethBalance - t12ethBalance, outputToken.decimals)

    logger.success("Swap completed successfully!", {
      spent: `${usdcSpent} USDC`,
      received: `${t12ethReceived} T12ETH`,
      finalUsdcBalance: `${formatUnits(finalUsdcBalance, inputToken.decimals)} USDC`,
      finalT12ethBalance: `${formatUnits(finalT12ethBalance, outputToken.decimals)} T12ETH`,
    })

  } catch (error) {
    logger.error("Failed to execute swap", error)
  }
}

// Run the example
main().catch((error) => {
  logger.error("Failed to run swap execution", error)
  process.exit(1)
})