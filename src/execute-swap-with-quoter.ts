import { config } from "dotenv"
import { createWalletClient, createPublicClient, http, parseUnits, formatUnits, type Address, type Hash } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { TradeType } from "@summitx/swap-sdk-core"
import { TokenQuoter } from "./quoter/token-quoter"
import { baseCampTestnetTokens } from "./config/base-testnet"
import { logger } from "./utils/logger"

// Load environment variables
config()

export enum ChainId {
  
  BASECAMP_TESTNET = 123420001114
}

const CHAIN_ID = ChainId.BASECAMP_TESTNET

// Import SwapCalldata types and builder from swap-quote-engine
interface SwapCalldata {
  to: Address
  data: `0x${string}`
  value: bigint
  description: string
}

interface SwapConfig {
  slippageToleranceBps: number
  deadline?: number
  recipient?: Address
}

// Router addresses
const V2_ROUTER_ADDRESS = "0x03B38A5C3cf55cB3B8D61Dc7eaB7BBC0ec276708"
const SMART_ROUTER_ADDRESS = "0x197b7c9fC5c8AeA84Ab2909Bf94f24370539722D"

// ERC20 ABI for approval
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

async function main() {
  logger.header("SummitX Execute Swap with TokenQuoter - Base Testnet")

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
    chain: {
      id: CHAIN_ID,
      name: 'Base Camp Testnet',
      network: 'basecamp',
      nativeCurrency: { name: 'CAMP', symbol: 'CAMP', decimals: 18 },
      rpcUrls: {
        default: { http: ['https://rpc-campnetwork.xyz'] },
        public: { http: ['https://rpc-campnetwork.xyz'] }
      }
    },
    transport: http('https://rpc-campnetwork.xyz'),
  })

  const publicClient = createPublicClient({
    chain: {
      id: CHAIN_ID,
      name: 'Base Camp Testnet',
      network: 'basecamp',
      nativeCurrency: { name: 'CAMP', symbol: 'CAMP', decimals: 18 },
      rpcUrls: {
        default: { http: ['https://rpc-campnetwork.xyz'] },
        public: { http: ['https://rpc-campnetwork.xyz'] }
      }
    },
    transport: http('https://rpc-campnetwork.xyz'),
      })

  logger.info(`Wallet address: ${account.address}`)

  // Initialize token quoter
  const quoter = new TokenQuoter({
    rpcUrl: "https://rpc-campnetwork.xyz/8708df38d9cc4bb39ac813ae005be495",
    slippageTolerance: 1.0, // 1.0% slippage
    maxHops: 3,
    maxSplits: 3,
  })

  // Define swap parameters
  const inputToken = baseCampTestnetTokens.usdc
  const outputToken = baseCampTestnetTokens.t12eth
  const inputAmount = "100" // 100 USDC
  const slippageToleranceBps = 100 // 1% slippage

  logger.header("Step 1: Check Balances")
  
  // Check USDC balance
  const usdcBalance = await publicClient.readContract({
    address: inputToken.address as Address,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  })

  logger.info(`USDC Balance: ${formatUnits(usdcBalance, inputToken.decimals)} USDC`)

  if (usdcBalance === BigInt(0)) {
    logger.error("No USDC balance. Please get some USDC first.")
    return
  }

  logger.header("Step 2: Get Quote from TokenQuoter")

  try {
    const quote = await quoter.getQuote(
      inputToken,
      outputToken,
      inputAmount,
      TradeType.EXACT_INPUT,
      false // No gas adjustment for execution
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
      poolsUsed: quote.pools.length,
      routerTime: quote.routerTime || "N/A",
    })

    logger.header("Step 3: Build Swap Transaction")

    // Determine which router to use based on the pools
    const hasV3Pool = quote.pools.some(pool => pool.includes("V3"))
    const hasMultipleRoutes = quote.route.length > 1
    const routerAddress = (hasV3Pool || hasMultipleRoutes) ? SMART_ROUTER_ADDRESS : V2_ROUTER_ADDRESS
    
    logger.info(`Using router: ${hasV3Pool || hasMultipleRoutes ? "Smart Router" : "V2 Router"} at ${routerAddress}`)

    // Check current allowance
    const currentAllowance = await publicClient.readContract({
      address: inputToken.address as Address,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [account.address, routerAddress as Address],
    })

    logger.info(`Current allowance: ${formatUnits(currentAllowance, inputToken.decimals)} USDC`)

    // Approve if needed
    const inputAmountBigInt = parseUnits(inputAmount, inputToken.decimals)
    if (currentAllowance < inputAmountBigInt) {
      logger.header("Step 4: Approve Router")
      
      const approvalTx = await walletClient.writeContract({
        address: inputToken.address as Address,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [routerAddress as Address, inputAmountBigInt],
      })

      logger.info(`Approval transaction sent: ${approvalTx}`)
      
      const approvalReceipt = await publicClient.waitForTransactionReceipt({
        hash: approvalTx,
      })
      
      logger.success(`Approval confirmed in block ${approvalReceipt.blockNumber}`)
    }

    logger.header("Step 5: Execute Swap")

    // For now, we'll create a simple swap transaction
    // In a real implementation, you would convert the quote to the proper Trade format
    // and use SwapCalldataBuilder from swap-quote-engine
    
    logger.info("Building swap calldata...")
    logger.info("Note: This example shows the integration pattern. For production use,")
    logger.info("you would need to convert the TokenQuoter output to the Trade format")
    logger.info("expected by SwapCalldataBuilder from the swap-quote-engine project.")

    // Example of what the full integration would look like:
    /*
    // Convert quote to Trade format
    const trade = convertQuoteToTrade(quote)
    
    // Build swap calldata using SwapCalldataBuilder
    const swapCalldata = SwapCalldataBuilder.buildSwapCalldata(
      trade,
      account.address,
      {
        slippageToleranceBps,
        deadline: Math.floor(Date.now() / 1000) + 300, // 5 minutes
      }
    )
    
    // Execute the swap
    const swapTx = await walletClient.sendTransaction({
      to: swapCalldata.to,
      data: swapCalldata.data,
      value: swapCalldata.value,
    })
    
    logger.info(`Swap transaction sent: ${swapTx}`)
    
    const swapReceipt = await publicClient.waitForTransactionReceipt({
      hash: swapTx,
    })
    
    logger.success(`Swap confirmed in block ${swapReceipt.blockNumber}`)
    */

    logger.divider()
    logger.success("Integration example completed!")
    logger.info("To fully execute swaps, implement the conversion from TokenQuoter")
    logger.info("output to the Trade format used by swap-quote-engine's SwapCalldataBuilder.")

  } catch (error) {
    logger.error("Failed to execute swap", error)
  }
}

// Run the example
main().catch((error) => {
  logger.error("Failed to run swap execution", error)
  process.exit(1)
})