import { 
  Currency, 
  CurrencyAmount, 
  Token as CoreToken,
  TradeType as CoreTradeType,
  Percent,
  Price,
  Fraction
} from "@summitx/swap-sdk-core"
import { parseUnits } from "viem"
import type { QuoteResult } from "../quoter/token-quoter"

// Types matching swap-quote-engine format
export enum ChainId {
  BASECAMP_TESTNET = 123420001114
}

export enum TradeType {
  EXACT_INPUT,
  EXACT_OUTPUT,
}

export enum PoolType {
  V2 = 'V2',
  V3 = 'V3',
  STABLE = 'STABLE',
}

export interface Token {
  chainId: ChainId
  address: string
  decimals: number
  symbol: string
  name: string
}

export interface Pool {
  type: PoolType
  token0: Token
  token1: Token
  reserve0?: SwapCurrencyAmount
  reserve1?: SwapCurrencyAmount
  fee: number
  liquidity?: bigint
  sqrtRatioX96?: bigint
  tick?: number
  address: string
  token0Price?: SwapPrice
  token1Price?: SwapPrice
  tvlUSD?: number
  tickSpacing?: number
  balances?: SwapCurrencyAmount[]
  amplifier?: number
  containsToken: (tokenAddress: string) => boolean
}

export interface SwapCurrency {
  isNative: boolean
  isToken: boolean
  chainId: ChainId
  decimals: number
  symbol: string
  name?: string
  address?: string
}

export interface SwapCurrencyAmount {
  currency: SwapCurrency
  quotient: bigint
  decimalScale: bigint
}

export interface SwapPrice {
  baseCurrency: SwapCurrency
  quoteCurrency: SwapCurrency
  fraction: SwapFraction
}

export interface SwapFraction {
  numerator: bigint
  denominator: bigint
}

export interface Route {
  pools: Pool[]
  tokenPath: Token[]
  input: SwapCurrency
  output: SwapCurrency
}

export interface RouteWithQuote {
  route: Route
  inputAmount: SwapCurrencyAmount
  outputAmount: SwapCurrencyAmount
  quote: bigint
  percent: number
  gasEstimate?: bigint
}

export interface Trade {
  tradeType: TradeType
  inputAmount: SwapCurrencyAmount
  outputAmount: SwapCurrencyAmount
  routes: RouteWithQuote[]
  gasEstimate?: bigint
  priceImpact?: any
  executionPrice?: SwapPrice
}

// Parse route string like "(50% [USDC-T12ETH V3 0.3% 0x...])"
interface ParsedRoute {
  percent: number
  hops: Array<{
    tokenIn: string
    tokenOut: string
    poolType: string
    fee?: number
    address?: string
  }>
}

function parseRouteString(routeStr: string): ParsedRoute {
  // Extract percentage
  const percentMatch = routeStr.match(/\((\d+)%/)
  const percent = percentMatch ? parseInt(percentMatch[1]) : 100

  // Extract hops between brackets
  const hopsMatch = routeStr.match(/\[(.*?)\]/)
  if (!hopsMatch) {
    throw new Error(`Invalid route format: ${routeStr}`)
  }

  const hopsString = hopsMatch[1]
  const hopParts = hopsString.split(", ")
  
  const hops = hopParts.map(hop => {
    // Parse "USDC-T12ETH V3 0.3% 0x..."
    const parts = hop.split(" ")
    const [tokenIn, tokenOut] = parts[0].split("-")
    const poolType = parts[1]
    
    let fee: number | undefined
    let address: string | undefined
    
    if (poolType === "V3" && parts[2]) {
      fee = parseFloat(parts[2].replace("%", "")) * 10000 // Convert to basis points
    }
    
    if (parts[poolType === "V3" ? 3 : 2]) {
      address = parts[poolType === "V3" ? 3 : 2]
    }
    
    return { tokenIn, tokenOut, poolType, fee, address }
  })

  return { percent, hops }
}

function convertCurrencyToSwapCurrency(currency: Currency): SwapCurrency {
  return {
    isNative: currency.isNative,
    isToken: currency.isToken,
    chainId: currency.chainId as ChainId,
    decimals: currency.decimals,
    symbol: currency.symbol || '',
    name: currency.name,
    address: currency.isToken ? currency.address : undefined,
  }
}

function convertCurrencyToToken(currency: Currency): Token {
  if (!currency.isToken) {
    throw new Error("Cannot convert native currency to token")
  }
  
  return {
    chainId: currency.chainId as ChainId,
    address: currency.address,
    decimals: currency.decimals,
    symbol: currency.symbol || '',
    name: currency.name || '',
  }
}

function createCurrencyAmount(currency: SwapCurrency, amount: string | bigint): SwapCurrencyAmount {
  const quotient = typeof amount === 'string' 
    ? parseUnits(amount, currency.decimals)
    : amount
    
  return {
    currency,
    quotient,
    decimalScale: BigInt(10 ** currency.decimals),
  }
}

function createPool(
  token0: Token,
  token1: Token,
  poolType: PoolType,
  fee: number,
  address: string
): Pool {
  // Create basic pool structure
  const pool: Pool = {
    type: poolType,
    token0,
    token1,
    fee,
    address,
    containsToken: (tokenAddress: string) => {
      return token0.address.toLowerCase() === tokenAddress.toLowerCase() ||
             token1.address.toLowerCase() === tokenAddress.toLowerCase()
    }
  }

  // Add pool-specific defaults
  if (poolType === PoolType.V3) {
    pool.tickSpacing = fee === 100 ? 1 : fee === 500 ? 10 : fee === 3000 ? 60 : 200
    pool.sqrtRatioX96 = BigInt("79228162514264337593543950336") // 1:1 price as default
    pool.tick = 0
    pool.liquidity = BigInt("1000000000000000000") // Default liquidity
  } else if (poolType === PoolType.V2) {
    // Default reserves for V2
    const reserve0 = createCurrencyAmount(
      { ...token0, isNative: false, isToken: true },
      BigInt("1000000000000000000")
    )
    const reserve1 = createCurrencyAmount(
      { ...token1, isNative: false, isToken: true },
      BigInt("1000000000000000000")
    )
    pool.reserve0 = reserve0
    pool.reserve1 = reserve1
  } else if (poolType === PoolType.STABLE) {
    pool.amplifier = 100
  }

  return pool
}

export class QuoteToTradeConverter {
  /**
   * Convert TokenQuoter output to swap-quote-engine Trade format
   */
  static convertQuoteToTrade(quote: QuoteResult): Trade {
    // Parse routes
    const parsedRoutes = Array.isArray(quote.route) 
      ? quote.route.map(r => parseRouteString(r))
      : [parseRouteString(quote.route)]

    // Convert input/output currencies
    const inputCurrency = convertCurrencyToSwapCurrency(quote.inputToken)
    const outputCurrency = convertCurrencyToSwapCurrency(quote.outputToken)

    // Create currency amounts
    const inputAmount = createCurrencyAmount(inputCurrency, quote.inputAmount)
    const outputAmount = createCurrencyAmount(outputCurrency, quote.outputAmount)

    // Build routes
    const routes: RouteWithQuote[] = parsedRoutes.map((parsedRoute, index) => {
      // Build token path and pools for this route
      const tokenPath: Token[] = []
      const pools: Pool[] = []

      // Start with input token
      let currentToken = convertCurrencyToToken(quote.inputToken)
      tokenPath.push(currentToken)

      // Build pools and token path from hops
      parsedRoute.hops.forEach((hop, hopIndex) => {
        // Find or create the output token
        let outputToken: Token
        
        if (hopIndex === parsedRoute.hops.length - 1) {
          // Last hop - use the final output token
          outputToken = convertCurrencyToToken(quote.outputToken)
        } else {
          // Intermediate token - create from hop info
          // In a real implementation, you'd look up the actual token details
          outputToken = {
            chainId: ChainId.BASECAMP_TESTNET,
            address: `0x${hop.tokenOut.toLowerCase()}`, // Placeholder
            decimals: 18, // Default, should be looked up
            symbol: hop.tokenOut,
            name: hop.tokenOut,
          }
        }

        tokenPath.push(outputToken)

        // Create pool
        const poolType = hop.poolType === "V3" ? PoolType.V3 : 
                        hop.poolType === "V2" ? PoolType.V2 : 
                        PoolType.STABLE

        const pool = createPool(
          currentToken,
          outputToken,
          poolType,
          hop.fee || (poolType === PoolType.V2 ? 3000 : 3000), // Default fees
          hop.address || "0x0000000000000000000000000000000000000000"
        )

        pools.push(pool)
        currentToken = outputToken
      })

      // Calculate route amounts based on percentage
      const routeInputAmount = createCurrencyAmount(
        inputCurrency,
        (inputAmount.quotient * BigInt(parsedRoute.percent)) / BigInt(100)
      )

      const routeOutputAmount = createCurrencyAmount(
        outputCurrency,
        (outputAmount.quotient * BigInt(parsedRoute.percent)) / BigInt(100)
      )

      const route: Route = {
        pools,
        tokenPath,
        input: inputCurrency,
        output: outputCurrency,
      }

      return {
        route,
        inputAmount: routeInputAmount,
        outputAmount: routeOutputAmount,
        quote: routeOutputAmount.quotient,
        percent: parsedRoute.percent,
        gasEstimate: quote.gasEstimate ? BigInt(quote.gasEstimate) : undefined,
      }
    })

    // Create execution price
    const executionPrice: SwapPrice = {
      baseCurrency: inputCurrency,
      quoteCurrency: outputCurrency,
      fraction: {
        numerator: outputAmount.quotient,
        denominator: inputAmount.quotient,
      }
    }

    // Build final trade
    const trade: Trade = {
      tradeType: TradeType.EXACT_INPUT,
      inputAmount,
      outputAmount,
      routes,
      gasEstimate: quote.gasEstimate ? BigInt(quote.gasEstimate) : undefined,
      priceImpact: parseFloat(quote.priceImpact.replace("%", "")),
      executionPrice,
    }

    return trade
  }

  /**
   * Convert multiple quotes to trades
   */
  static convertQuotesToTrades(quotes: QuoteResult[]): Trade[] {
    return quotes.map(quote => this.convertQuoteToTrade(quote))
  }

  /**
   * Validate that a converted trade matches the original quote
   */
  static validateConversion(quote: QuoteResult, trade: Trade): boolean {
    // Check input/output amounts match
    const inputMatches = trade.inputAmount.quotient === parseUnits(quote.inputAmount, quote.inputToken.decimals)
    const outputMatches = trade.outputAmount.quotient === parseUnits(quote.outputAmount, quote.outputToken.decimals)

    // Check route count matches
    const routeCount = Array.isArray(quote.route) ? quote.route.length : 1
    const tradeRouteCount = trade.routes.length

    // Check total percentage is 100%
    const totalPercent = trade.routes.reduce((sum, r) => sum + r.percent, 0)

    return inputMatches && outputMatches && routeCount === tradeRouteCount && totalPercent === 100
  }
}