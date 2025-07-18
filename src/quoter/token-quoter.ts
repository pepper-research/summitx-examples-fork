import { 
  SmartRouter, 
  type SmartRouterTrade,
  type TradeConfig,
  PoolType,
  type OnChainProvider,
  type PoolProvider,
} from "@summitx/smart-router/evm"
import { TradeType, CurrencyAmount, Currency, Percent } from "@summitx/swap-sdk-core"
import type { PublicClient } from "viem"
import { parseUnits, formatUnits } from "viem"
import { ChainId } from "@summitx/chains"

import { GraphQLClient } from 'graphql-request'

import { 
  createBaseTestnetClient,
  createAllRpcClients,
} from "../config/base-testnet"
import { logger } from "../utils/logger"

export interface TokenQuoterOptions {
  rpcUrl?: string
  maxHops?: number
  maxSplits?: number
  distributionPercent?: number
  slippageTolerance?: number // percentage (e.g., 0.5 for 0.5%)
  useStaticPools?: boolean // Use static pool provider instead of dynamic fetching
  useMockPools?: boolean // Use mock pools for testing
}

export interface QuoteResult {
  inputToken: Currency
  outputToken: Currency
  inputAmount: string
  outputAmount: string
  outputAmountWithSlippage: string
  priceImpact: string
  route: string[]
  pools: string[]
  gasEstimate?: string
  executionPrice: string
  minimumReceived: string
  routerTime?: string
  // Add the raw trade object for proper conversion
  rawTrade?: SmartRouterTrade<TradeType>
}

export class TokenQuoter {
  private client: PublicClient
  private clients: PublicClient[]
  private options: Required<TokenQuoterOptions>
  private v3SubgraphClient: GraphQLClient
  private v2SubgraphClient: GraphQLClient

  constructor(options: TokenQuoterOptions = {}) {
    this.options = {
      rpcUrl: options.rpcUrl || "",
      maxHops: options.maxHops ?? 3,
      maxSplits: options.maxSplits ?? 3,
      distributionPercent: options.distributionPercent ?? 5,
      slippageTolerance: options.slippageTolerance ?? 0.5,
      useStaticPools: options.useStaticPools ?? false,
      useMockPools: options.useMockPools ?? false,
    }

    this.client = createBaseTestnetClient(this.options.rpcUrl || undefined)
    this.clients = this.options.rpcUrl ? [this.client] : createAllRpcClients()
    this.v3SubgraphClient = new GraphQLClient(
      'https://api.goldsky.com/api/public/project_cllrma24857iy38x0a3oq836e/subgraphs/summitx-exchange-v3-users/1.0.1/gn', 
    )
    this.v2SubgraphClient = new GraphQLClient(
      'https://api.goldsky.com/api/public/project_cllrma24857iy38x0a3oq836e/subgraphs/summitx-exchange-v2/1.0.0/gn',
    )
  }

  async getQuote(
    inputToken: Currency,
    outputToken: Currency,
    inputAmountRaw: string,
    tradeType: TradeType = TradeType.EXACT_INPUT,
    shouldAdjustQuoteForGas?: boolean | true
  ): Promise<QuoteResult | null> {
    const startTime = Date.now()
    let routerStartTime: number
    
    try {
      logger.info("Getting quote... with shouldAdjustQuoteForGas", {
        inputToken: inputToken.symbol,
        outputToken: outputToken.symbol,
        amount: inputAmountRaw,
        tradeType: tradeType === TradeType.EXACT_INPUT ? "EXACT_INPUT" : "EXACT_OUTPUT",
        shouldAdjustQuoteForGas
      })

      // Parse input amount
      const inputAmount = CurrencyAmount.fromRawAmount(
        inputToken,
        parseUnits(inputAmountRaw, inputToken.decimals).toString()
      )

      // Create on-chain provider (same as UI)
      const onChainProvider: OnChainProvider = ({ chainId }: { chainId?: ChainId }) => {
        const client = this.clients[0]
        return client as any
      }

      // TODO
      

      // Create quote provider (same as UI's useQuoteProvider)
      const gasLimit = BigInt(100000000) // Use default gas limit like UI
      const quoteProvider = SmartRouter.createQuoteProvider({
        onChainProvider,
        gasLimit,
      })

      // Fetch candidate pools (same as UI's useCommonPoolsLite)
      const poolFetchStartTime = Date.now()
      console.log(`Fetching candidate pools for ${inputToken.symbol} -> ${outputToken.symbol}`)
      
      const [v2Pools, v3Pools, stablePools] = await Promise.all([
        SmartRouter.getV2CandidatePools({
          onChainProvider,
          currencyA: inputToken,
          currencyB: outputToken,
          v2SubgraphProvider: () => this.v2SubgraphClient as any,
          v3SubgraphProvider: () => this.v3SubgraphClient as any,
        }),
        SmartRouter.getV3CandidatePools({
          onChainProvider,
          currencyA: inputToken,
          currencyB: outputToken,
          subgraphProvider: () => this.v3SubgraphClient as any,
        }),
        SmartRouter.getStableCandidatePools({
          onChainProvider,
          currencyA: inputToken,
          currencyB: outputToken,
        }),
      ])

      const candidatePools = [...v2Pools, ...v3Pools, ...stablePools]
      const poolFetchTime = Date.now() - poolFetchStartTime
      console.log(`Found ${v2Pools.length} V2 pools, ${v3Pools.length} V3 pools, and ${stablePools.length} stable pools in ${poolFetchTime}ms`)
      console.log("Candidate pools v2: ", v2Pools.map((pool) => pool.reserve0.currency.symbol + " - " + pool.reserve1.currency.symbol))
      console.log("Candidate pools v3: ", v3Pools.map((pool) => pool.token0.symbol + " - " + pool.token1.symbol))
      console.log("Candidate pools stable: ", stablePools.map((pool) => pool.address))
      // Create static pool provider (same as UI)
      const poolProvider = SmartRouter.createStaticPoolProvider(candidatePools)

      // Define trade config (same as UI)
      const tradeConfig: TradeConfig = {
        gasPriceWei: async () => BigInt(1000000000), // 1 gwei default
        poolProvider,
        quoteProvider,
        maxHops: this.options.maxHops,
        maxSplits: this.options.maxSplits,
        distributionPercent: this.options.distributionPercent,
        allowedPoolTypes: [PoolType.V2, PoolType.V3, PoolType.STABLE],
        quoterOptimization: false, // Same as UI
      }

      // Get best trade (same as UI)
      routerStartTime = Date.now()
      const trade = await SmartRouter.getBestTrade(inputAmount, outputToken, tradeType, tradeConfig)
      const routerTime = Date.now() - routerStartTime

      if (!trade) {
        logger.warn("No trade found")
        return null
      }

      // Calculate slippage
      const slippagePercent = new Percent(Math.floor(this.options.slippageTolerance * 100), 10000)

      // Format result
      const result = this.formatQuoteResult(trade, inputAmountRaw, slippagePercent, routerTime)
      
      const totalTime = Date.now() - startTime
      logger.info(`Quote completed in ${totalTime}ms (router: ${routerTime}ms)`, {
        inputToken: inputToken.symbol,
        outputToken: outputToken.symbol,
        inputAmount: inputAmountRaw,
        outputAmount: result.outputAmount,
        priceImpact: result.priceImpact,
        route: result.route.join(" → "),
        routerTime: `${routerTime}ms`,
        totalTime: `${totalTime}ms`
      })

      return result

    } catch (error) {
      const totalTime = Date.now() - startTime
      logger.error(`Quote failed after ${totalTime}ms`, {
        inputToken: inputToken.symbol,
        outputToken: outputToken.symbol,
        amount: inputAmountRaw,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  async getMultipleQuotes(
    pairs: Array<{
      inputToken: Currency
      outputToken: Currency
      amount: string
      shouldAdjustQuoteForGas?: boolean
    }>
  ): Promise<Array<QuoteResult | null>> {
    const results = await Promise.all(
      pairs.map(async (pair) => {
        try {
          return await this.getQuote(
            pair.inputToken,
            pair.outputToken,
            pair.amount,
            TradeType.EXACT_INPUT,
            pair.shouldAdjustQuoteForGas
          )
        } catch (error) {
          logger.error(`Failed to get quote for ${pair.inputToken.symbol} -> ${pair.outputToken.symbol}`, error)
          return null
        }
      })
    )

    return results
  }

  private formatQuoteResult(
    trade: SmartRouterTrade<TradeType>,
    inputAmountRaw: string,
    slippagePercent: Percent,
    routerTime: number
  ): QuoteResult {
    const outputAmountWithSlippage = trade.outputAmount.multiply(
      new Percent(1).subtract(slippagePercent)
    )

    // Calculate price impact manually
    const priceImpact = trade.inputAmount.divide(trade.outputAmount).toFixed(2)
    const executionPrice = trade.outputAmount.divide(trade.inputAmount).toFixed(6)
    const minimumReceived = formatUnits(
      outputAmountWithSlippage.quotient,
      trade.outputAmount.currency.decimals
    )

    // Extract route information
    const route = trade.routes.map(route => {
      return route.path.map(token => token.symbol).join(' -> ')
    })
    
    const routePath = trade.routes.map((route: any) => {
      const pathSegments = []
      
      for (let i = 0; i < route.path.length - 1; i++) {
        const currentToken = route.path[i]
        const nextToken = route.path[i + 1]

        const pool = route.pools[i]
        
        
        let poolInfo = "Unknown"
        if (pool) {
          if (pool.type === 0) {
            poolInfo = "V2"
          } else if (pool.type === 1) {
            const fee = pool.fee || "Unknown"
            poolInfo = `V3 ${typeof fee === 'bigint' ? Number(fee)/10000 : fee/10000}%`
          }
          
          if (pool.address) {
            poolInfo += ` ${pool.address}`
          }
        }
        
        pathSegments.push(`${currentToken.symbol || "Unknown"}-${nextToken.symbol || "Unknown"} ${poolInfo}`)
      }
      
      const pathString = pathSegments.join(", ")
      const percent = route.percent || 0
      
      return `(${percent}% [${pathString}])`
    })
    // Extract pool information
    const pools = trade.routes.flatMap(route => 
      route.pools.map(pool => {
        if (pool.type === PoolType.V3) {
          return `V3 ${pool.address}`
        } else if (pool.type === PoolType.V2) {
          return `V2 ${pool.reserve0.currency.symbol}-${pool.reserve1.currency.symbol}`
        } else {
          return `Stable ${pool.address}`
        }
      })
    )

    return {
      inputToken: trade.inputAmount.currency,
      outputToken: trade.outputAmount.currency,
      inputAmount: inputAmountRaw,
      outputAmount: formatUnits(trade.outputAmount.quotient, trade.outputAmount.currency.decimals),
      outputAmountWithSlippage: minimumReceived,
      priceImpact: `${priceImpact}%`,
      route:routePath,
      pools,
      gasEstimate: trade.gasEstimate?.toString(),
      executionPrice,
      minimumReceived,
      routerTime: `${routerTime}ms`,
      rawTrade: trade,
    }
  }
}