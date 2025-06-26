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
      '	https://api.goldsky.com/api/public/project_cllrma24857iy38x0a3oq836e/subgraphs/summitx-exchange-v2/1.0.0/gn',
    )
  }

  async getQuote(
    inputToken: Currency,
    outputToken: Currency,
    inputAmountRaw: string,
    tradeType: TradeType = TradeType.EXACT_INPUT,
    shouldAdjustQuoteForGas?: boolean | true
  ): Promise<QuoteResult | null> {
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

      // Create on-chain provider
      const onChainProvider: OnChainProvider = ({ chainId }: { chainId?: ChainId }) => {
        const client = this.clients[0]
        
        return client as any // Type compatibility workaround for viem versions
      }

      // Create quote provider
      const quoteProvider = SmartRouter.createQuoteProvider({
        onChainProvider,
       // gasLimit: BigInt(1000000),
      })

      // Create pool provider based on configuration
      let poolProvider: PoolProvider

      if (this.options.useMockPools) {
        // Use mock pools for testing
        poolProvider = {
          getCandidatePools: async (params: { currencyA?: Currency, currencyB?: Currency }) => {
            logger.debug(`Using mock pools for ${params.currencyA?.symbol} -> ${params.currencyB?.symbol}`)
            // Return empty array to simulate no pools found
            return []
          }
        }
        logger.debug("Using mock pool provider for testing")
      } else if (this.options.useStaticPools) {
        // Use static pool provider for faster performance but potentially outdated data
        poolProvider = SmartRouter.createStaticPoolProvider([])
        logger.debug("Using static pool provider")
      } else {
        // Use dynamic pool provider that fetches candidate pools
        poolProvider = {
          getCandidatePools: async (params: { currencyA?: Currency, currencyB?: Currency }) => {
            try {
              logger.debug(`Fetching candidate pools for ${params.currencyA?.symbol} -> ${params.currencyB?.symbol}`)
              
              // Get V2 and V3 candidate pools
              const [v2Pools, v3Pools] = await Promise.all([
                SmartRouter.getV2CandidatePools({
                  onChainProvider,
                  currencyA: params.currencyA!,
                  currencyB: params.currencyB!,
                  v2SubgraphProvider:  () => this.v2SubgraphClient as any,
                  v3SubgraphProvider: () => this.v3SubgraphClient as any,
                }),
                SmartRouter.getV3CandidatePools({
                  onChainProvider,
                  currencyA: params.currencyA!,
                  currencyB: params.currencyB!,
                  subgraphProvider: () => this.v3SubgraphClient as any,
                }),
              ])

              logger.debug(`Found ${v2Pools.length} V2 pools and ${v3Pools.length} V3 pools`)
              
              return [...v2Pools, ...v3Pools]
            } catch (error) {
              logger.warn("Failed to fetch candidate pools, using empty array", error)
              return []
            }
          }
        }
      }

      // Define trade config
      const tradeConfig: TradeConfig = {
        gasPriceWei: async () => BigInt(1000000000), // 1 gwei default
        poolProvider,
        quoteProvider,
        maxHops: this.options.maxHops,
        maxSplits: this.options.maxSplits,
        distributionPercent: this.options.distributionPercent,
        allowedPoolTypes: [PoolType.V2, PoolType.V3],
        quoterOptimization: true
      }

      // Get best trade
      logger.info("tradedata", {inputAmount: inputAmount.toExact(),inputToken: inputToken.symbol, outputToken: outputToken.symbol, tradeType, tradeConfig, shouldAdjustQuoteForGas})

      const trade = await SmartRouter.getBestTrade(
        inputAmount,
        outputToken,
        tradeType,
        tradeConfig,
        shouldAdjustQuoteForGas
      )

      if (!trade) {
        logger.warn("No trade route found")
        return null
      }

      // Calculate slippage
      const slippagePercent = new Percent(
        Math.floor(this.options.slippageTolerance * 100),
        10000
      )

      // Format results
      const result = this.formatQuoteResult(trade, inputAmountRaw, slippagePercent)
      
      logger.success("Quote found!", {
        outputAmount: result.outputAmount,
        priceImpact: result.priceImpact,
        route: result.route.join(" → "),
      })

      return result
    } catch (error) {
      logger.error("Failed to get quote", error)
      return null
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
    logger.info(`Getting quotes for ${pairs.length} pairs...`)
    
    const quotes = await Promise.all(
      pairs.map(({ inputToken, outputToken, amount, shouldAdjustQuoteForGas }) =>
        this.getQuote(inputToken, outputToken, amount, TradeType.EXACT_INPUT, shouldAdjustQuoteForGas)
      )
    )

    const successCount = quotes.filter(q => q !== null).length
    logger.info(`Successfully quoted ${successCount}/${pairs.length} pairs`)

    return quotes
  }


  private formatQuoteResult(
    trade: SmartRouterTrade<TradeType>,
    inputAmountRaw: string,
    slippagePercent: Percent
  ): QuoteResult {
    const inputToken = trade.inputAmount.currency
    const outputToken = trade.outputAmount.currency

    // Calculate minimum amount out with slippage
    const outputAmountWithSlippage = trade.outputAmount.multiply(
      new Percent(10000 - Math.floor(Number(slippagePercent.numerator.toString())), 10000)
    )

    // Get route path
    const routePath = trade.routes.map((route: any) => 
      route.path.map((token: any) => token.symbol || "Unknown").join(" → ")
    )

    // Get pool info
    const pools: string[] = []
    trade.routes.forEach((route: any) => {
      route.pools.forEach((pool: any) => {
        if ('address' in pool && pool.address) {
          pools.push(pool.address)
        } else {
          pools.push("Unknown Pool")
        }
      })
    })

    // Calculate price impact (simplified)
    const priceImpact = "0.1" // Placeholder - actual calculation would be more complex

    // Calculate execution price
    const executionPrice = trade.outputAmount.divide(trade.inputAmount).toSignificant(6)

    return {
      inputToken,
      outputToken,
      inputAmount: inputAmountRaw,
      outputAmount: formatUnits(
        BigInt(trade.outputAmount.quotient.toString()),
        outputToken.decimals
      ),
      outputAmountWithSlippage: formatUnits(
        BigInt(outputAmountWithSlippage.quotient.toString()),
        outputToken.decimals
      ),
      priceImpact: priceImpact + "%",
      route: routePath,
      pools,
      gasEstimate: trade.gasEstimate?.toString(),
      executionPrice,
      minimumReceived: formatUnits(
        BigInt(outputAmountWithSlippage.quotient.toString()),
        outputToken.decimals
      ),
    }
  }
}