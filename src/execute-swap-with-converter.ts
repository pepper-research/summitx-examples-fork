import { config } from "dotenv"
import { createWalletClient, createPublicClient, http, parseUnits, formatUnits, encodeFunctionData, type Address, type Hash } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { TradeType } from "@summitx/swap-sdk-core"
import { TokenQuoter } from "./quoter/token-quoter"
import { baseCampTestnetTokens } from "./config/base-testnet"
import { logger } from "./utils/logger"
import { QuoteToTradeConverter, type Trade, type SwapCurrency, PoolType } from "./utils/quote-to-trade-converter"

// Load environment variables
config()

// Chain configuration
export enum ChainId {
  BASECAMP_TESTNET = 123420001114
}

const CHAIN_CONFIG = {
  id: ChainId.BASECAMP_TESTNET,
  name: 'Base Camp Testnet',
  network: 'basecamp',
  nativeCurrency: { name: 'CAMP', symbol: 'CAMP', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc-campnetwork.xyz'] },
    public: { http: ['https://rpc-campnetwork.xyz'] }
  }
}

// Router addresses
const V2_ROUTER_ADDRESS = "0x03B38A5C3cf55cB3B8D61Dc7eaB7BBC0ec276708" as Address
const SMART_ROUTER_ADDRESS = "0x197b7c9fC5c8AeA84Ab2909Bf94f24370539722D" as Address

// Router ABIs
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
] as const

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
  {
    name: "swapExactTokensForTokens",
    type: "function",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "nonpayable",
  },
] as const

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

interface SwapCalldata {
  to: Address
  data: `0x${string}`
  value: bigint
  description: string
}

// Build swap calldata from converted Trade
function buildSwapCalldata(
  trade: Trade,
  walletAddress: Address,
  slippageToleranceBps: number
): SwapCalldata {
  const deadline = Math.floor(Date.now() / 1000) + 300 // 5 minutes
  const slippageMultiplier = BigInt(10000 - slippageToleranceBps)
  const minAmountOut = (trade.outputAmount.quotient * slippageMultiplier) / BigInt(10000)

  // Determine routing strategy
  const hasMultipleRoutes = trade.routes.length > 1
  const hasV3Pool = trade.routes.some(route => 
    route.route.pools.some(pool => pool.type === PoolType.V3)
  )
  const hasV2Pool = trade.routes.some(route => 
    route.route.pools.some(pool => pool.type === PoolType.V2)
  )

  logger.info(`Route analysis: ${trade.routes.length} routes, V2: ${hasV2Pool}, V3: ${hasV3Pool}`)

  if (hasMultipleRoutes || hasV3Pool) {
    // Use Smart Router for V3 or split routes
    return buildSmartRouterCalldata(trade, walletAddress, minAmountOut, deadline, slippageMultiplier)
  } else {
    // Use V2 Router for simple V2 swaps
    return buildV2RouterCalldata(trade, walletAddress, minAmountOut, deadline)
  }
}

function buildV2RouterCalldata(
  trade: Trade,
  walletAddress: Address,
  minAmountOut: bigint,
  deadline: number
): SwapCalldata {
  const route = trade.routes[0]
  const path = route.route.tokenPath.map(token => token.address as Address)

  const data = encodeFunctionData({
    abi: ROUTER_V2_ABI,
    functionName: "swapExactTokensForTokens",
    args: [trade.inputAmount.quotient, minAmountOut, path, walletAddress, BigInt(deadline)],
  })

  return {
    to: V2_ROUTER_ADDRESS,
    data,
    value: BigInt(0),
    description: `Swap ${formatAmount(trade.inputAmount)} for ${formatAmount(trade.outputAmount)} via V2`,
  }
}

function buildSmartRouterCalldata(
  trade: Trade,
  walletAddress: Address,
  minAmountOut: bigint,
  deadline: number,
  slippageMultiplier: bigint
): SwapCalldata {
  const calldatas: `0x${string}`[] = []

  // Handle each route
  for (const routeWithQuote of trade.routes) {
    const route = routeWithQuote.route
    const amountIn = routeWithQuote.inputAmount.quotient
    const routeMinAmountOut = (routeWithQuote.outputAmount.quotient * slippageMultiplier) / BigInt(10000)

    if (route.pools.length === 1) {
      // Single hop
      const pool = route.pools[0]
      
      if (pool.type === PoolType.V3) {
        // V3 single hop
        const params = {
          tokenIn: route.tokenPath[0].address as Address,
          tokenOut: route.tokenPath[1].address as Address,
          fee: pool.fee,
          recipient: walletAddress,
          deadline: BigInt(deadline),
          amountIn,
          amountOutMinimum: routeMinAmountOut,
          sqrtPriceLimitX96: BigInt(0),
        }

        calldatas.push(
          encodeFunctionData({
            abi: SMART_ROUTER_ABI,
            functionName: "exactInputSingle",
            args: [params],
          })
        )
      } else if (pool.type === PoolType.V2) {
        // V2 single hop via smart router
        const path = route.tokenPath.map(t => t.address as Address)
        
        calldatas.push(
          encodeFunctionData({
            abi: SMART_ROUTER_ABI,
            functionName: "swapExactTokensForTokens",
            args: [amountIn, routeMinAmountOut, path, walletAddress],
          })
        )
      }
    } else {
      // Multi-hop
      const allV3 = route.pools.every(p => p.type === PoolType.V3)
      const allV2 = route.pools.every(p => p.type === PoolType.V2)

      if (allV3) {
        // Pure V3 multi-hop
        const path = encodeV3Path(route)
        
        const params = {
          path,
          recipient: walletAddress,
          amountIn,
          amountOutMinimum: routeMinAmountOut,
        }

        calldatas.push(
          encodeFunctionData({
            abi: SMART_ROUTER_ABI,
            functionName: "exactInput",
            args: [params],
          })
        )
      } else if (allV2) {
        // Pure V2 multi-hop
        const path = route.tokenPath.map(t => t.address as Address)
        
        calldatas.push(
          encodeFunctionData({
            abi: SMART_ROUTER_ABI,
            functionName: "swapExactTokensForTokens",
            args: [amountIn, routeMinAmountOut, path, walletAddress],
          })
        )
      } else {
        // Mixed protocol - need special handling
        logger.warn("Mixed protocol routes require more complex encoding")
        // For now, skip mixed routes
      }
    }
  }

  // Wrap in multicall if multiple routes
  let finalCalldata: `0x${string}`
  if (calldatas.length === 1) {
    finalCalldata = calldatas[0]
  } else {
    finalCalldata = encodeFunctionData({
      abi: SMART_ROUTER_ABI,
      functionName: "multicall",
      args: [calldatas],
    })
  }

  return {
    to: SMART_ROUTER_ADDRESS,
    data: finalCalldata,
    value: BigInt(0),
    description: `Swap ${formatAmount(trade.inputAmount)} for ${formatAmount(trade.outputAmount)} via Smart Router`,
  }
}

function encodeV3Path(route: any): `0x${string}` {
  let encoded = '0x'
  
  for (let i = 0; i < route.pools.length; i++) {
    const pool = route.pools[i]
    const tokenIn = route.tokenPath[i]
    
    // Add token address (remove 0x prefix)
    encoded += tokenIn.address.slice(2)
    
    // Add fee (3 bytes)
    encoded += pool.fee.toString(16).padStart(6, '0')
  }
  
  // Add the last token
  const lastToken = route.tokenPath[route.tokenPath.length - 1]
  encoded += lastToken.address.slice(2)
  
  return encoded as `0x${string}`
}

function formatAmount(amount: any): string {
  const value = Number(amount.quotient) / Number(amount.decimalScale)
  return `${value.toFixed(6)} ${amount.currency.symbol}`
}

async function main() {
  logger.header("SummitX Swap Execution with Quote Converter")

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
    chain: CHAIN_CONFIG as any,
    transport: http("https://rpc-campnetwork.xyz/8708df38d9cc4bb39ac813ae005be495"),
  })

  const publicClient = createPublicClient({
    chain: CHAIN_CONFIG as any,
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
  
  const usdcBalance = await publicClient.readContract({
    address: inputToken.address as Address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  })

  logger.info(`USDC Balance: ${formatUnits(usdcBalance, inputToken.decimals)} USDC`)

  if (usdcBalance < parseUnits(inputAmount, inputToken.decimals)) {
    logger.error(`Insufficient USDC balance. Need at least ${inputAmount} USDC`)
    return
  }

  logger.header("Step 2: Get Quote and Convert to Trade")

  try {
    // Get quote
    const quote = await quoter.getQuote(
      inputToken,
      outputToken,
      inputAmount,
      TradeType.EXACT_INPUT,
      false
    )

    if (!quote) {
      logger.error("No quote available")
      return
    }

    logger.success("Quote received:", {
      input: `${quote.inputAmount} ${quote.inputToken.symbol}`,
      output: `${quote.outputAmount} ${quote.outputToken.symbol}`,
      route: Array.isArray(quote.route) ? quote.route : [quote.route],
      pools: quote.pools,
    })

    // Convert quote to Trade format
    logger.header("Step 3: Convert Quote to Trade Format")
    
    const trade = QuoteToTradeConverter.convertQuoteToTrade(quote)
    
    logger.success("Trade converted:", {
      inputAmount: formatAmount(trade.inputAmount),
      outputAmount: formatAmount(trade.outputAmount),
      routes: trade.routes.length,
      routeDetails: trade.routes.map(r => ({
        percent: `${r.percent}%`,
        pools: r.route.pools.map(p => `${p.type} ${p.token0.symbol}-${p.token1.symbol}`),
        path: r.route.tokenPath.map(t => t.symbol).join(" → "),
      })),
    })

    // Validate conversion
    const isValid = QuoteToTradeConverter.validateConversion(quote, trade)
    logger.info(`Conversion validation: ${isValid ? "✓ PASSED" : "✗ FAILED"}`)

    // Build swap calldata
    logger.header("Step 4: Build Swap Transaction")
    
    const swapCalldata = buildSwapCalldata(trade, account.address, slippageToleranceBps)
    
    logger.info(`Router: ${swapCalldata.to}`)
    logger.info(`Description: ${swapCalldata.description}`)

    // Handle approval
    const inputTokenAddress = trade.inputAmount.currency.address as Address
    const currentAllowance = await publicClient.readContract({
      address: inputTokenAddress,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [account.address, swapCalldata.to],
    })

    if (currentAllowance < trade.inputAmount.quotient) {
      logger.header("Step 5: Approve Router")
      
      const approvalTx = await walletClient.writeContract({
        address: inputTokenAddress,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [swapCalldata.to, trade.inputAmount.quotient],
      })

      logger.info(`Approval transaction: ${approvalTx}`)
      
      const approvalReceipt = await publicClient.waitForTransactionReceipt({
        hash: approvalTx,
      })
      
      logger.success(`Approval confirmed in block ${approvalReceipt.blockNumber}`)
    }

    logger.header("Step 6: Execute Swap")
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

    logger.success(`Swap confirmed!`, {
      block: swapReceipt.blockNumber,
      gasUsed: swapReceipt.gasUsed.toString(),
      txHash: swapReceipt.transactionHash,
    })

    // Check final balance
    const finalUsdcBalance = await publicClient.readContract({
      address: inputToken.address as Address,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    })

    const usdcSpent = formatUnits(usdcBalance - finalUsdcBalance, inputToken.decimals)
    logger.success(`Successfully swapped ${usdcSpent} USDC`)

  } catch (error) {
    logger.error("Failed to execute swap", error)
  }
}

// Run the example
main().catch((error) => {
  logger.error("Failed to run swap execution", error)
  process.exit(1)
})