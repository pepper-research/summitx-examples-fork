import { ChainId } from "@summitx/chains";
import {
  PoolType,
  SmartRouter,
  type OnChainProvider,
  type SmartRouterTrade,
  type TradeConfig,
} from "@summitx/smart-router/evm";
import {
  Currency,
  CurrencyAmount,
  Percent,
  TradeType,
} from "@summitx/swap-sdk-core";
import { GraphQLClient } from "graphql-request";
import type { PublicClient } from "viem";
import { createPublicClient, formatUnits, http, parseUnits } from "viem";
import { campMainnet } from "../config/camp-mainnet";
import { logger } from "../utils/logger";

export interface TokenQuoterOptions {
  rpcUrl?: string;
  maxHops?: number;
  maxSplits?: number;
  distributionPercent?: number;
  slippageTolerance?: number; // percentage (e.g., 0.5 for 0.5%)
  enableV2?: boolean; // Enable V2 pools
  enableV3?: boolean; // Enable V3 pools
  chainId?: ChainId;
}

export interface QuoteResult {
  inputToken: Currency;
  outputToken: Currency;
  inputAmount: string;
  outputAmount: string;
  outputAmountWithSlippage: string;
  priceImpact: string;
  route: string[];
  pools: string[];
  gasEstimate?: string;
  executionPrice: string;
  minimumReceived: string;
  routerTime?: string;
  trade?: SmartRouterTrade<TradeType>; // The original trade object
  rawTrade?: SmartRouterTrade<TradeType>; // Alias for compatibility
}

// V3 and V2 subgraph URLs for Camp mainnet
const V3_SUBGRAPH_URL =
  "https://lb.graph.mainnet.summitx.finance/subgraphs/name/summitx-exchange-v3";
const V2_SUBGRAPH_URL =
  "https://lb.graph.mainnet.summitx.finance/subgraphs/name/summitx-exchange-v2";

export class TokenQuoter {
  private chainId: ChainId;
  private client: PublicClient;
  private options: Required<Omit<TokenQuoterOptions, "chainId">>;
  private v3SubgraphClient: GraphQLClient;
  private v2SubgraphClient: GraphQLClient;

  constructor(options: TokenQuoterOptions = {}) {
    this.chainId = options.chainId || ChainId.BASECAMP;

    this.options = {
      rpcUrl: options.rpcUrl || campMainnet.rpcUrls.default.http[0],
      maxHops: options.maxHops ?? 3,
      maxSplits: options.maxSplits ?? 3,
      distributionPercent: options.distributionPercent ?? 10,
      slippageTolerance: options.slippageTolerance ?? 0.5,
      enableV2: options.enableV2 ?? true,
      enableV3: options.enableV3 ?? true,
    };

    this.client = createPublicClient({
      chain: campMainnet,
      transport: http(this.options.rpcUrl),
      batch: {
        multicall: true,
      },
    }) as PublicClient;

    this.clients = [this.client];

    this.v3SubgraphClient = new GraphQLClient(V3_SUBGRAPH_URL);
    this.v2SubgraphClient = new GraphQLClient(V2_SUBGRAPH_URL);
  }

  async getQuote(
    inputToken: Currency,
    outputToken: Currency,
    inputAmountRaw: string,
    tradeType: TradeType = TradeType.EXACT_INPUT,
    shouldAdjustQuoteForGas: boolean = false
  ): Promise<QuoteResult | null> {
    const startTime = Date.now();
    let routerStartTime: number;

    try {
      logger.info("Getting quote...", {
        inputToken: inputToken.symbol,
        outputToken: outputToken.symbol,
        amount: inputAmountRaw,
        tradeType: TradeType[tradeType],
        shouldAdjustQuoteForGas,
      });

      // Parse input amount - expects decimal string like "0.1" or "100"
      const inputAmount = CurrencyAmount.fromRawAmount(
        inputToken,
        parseUnits(inputAmountRaw, inputToken.decimals).toString()
      );

      // Create on-chain provider
      const onChainProvider: OnChainProvider = () => {
        return this.client as any;
      };

      // Create quote provider
      const gasLimit = BigInt(100000000); // Use default gas limit
      const quoteProvider = SmartRouter.createQuoteProvider({
        onChainProvider,
        gasLimit,
      });

      // Fetch candidate pools
      logger.info(
        `Fetching candidate pools for ${inputToken.symbol} -> ${outputToken.symbol}`
      );

      const poolPromises: Promise<any[]>[] = [];

      if (!this.options.enableV2 && !this.options.enableV3) {
        logger.warn("Both V2 and V3 are disabled. No pools will be fetched.");
        return null;
      }

      if (this.options.enableV2) {
        poolPromises.push(
          SmartRouter.getV2CandidatePools({
            onChainProvider,
            currencyA: inputToken,
            currencyB: outputToken,
            v2SubgraphProvider: () => this.v2SubgraphClient as any,
            v3SubgraphProvider: () => this.v3SubgraphClient as any,
          })
        );
      }

      if (this.options.enableV3) {
        poolPromises.push(
          SmartRouter.getV3CandidatePools({
            onChainProvider,
            currencyA: inputToken,
            currencyB: outputToken,
            subgraphProvider: () => this.v3SubgraphClient as any,
          })
        );
      }

      // Always include stable pools
      poolPromises.push(
        SmartRouter.getStableCandidatePools({
          onChainProvider,
          currencyA: inputToken,
          currencyB: outputToken,
        })
      );

      const poolResults = await Promise.all(poolPromises);
      const candidatePools = poolResults.flat();

      const v2Pools = candidatePools.filter((p) => p.type === "v2-pool").length;
      const v3Pools = candidatePools.filter((p) => p.type === "v3-pool").length;
      const stablePools = candidatePools.filter(
        (p) => p.type === "stable-pool"
      ).length;

      logger.info(
        `Found ${v2Pools} V2 pools, ${v3Pools} V3 pools, and ${stablePools} stable pools in ${
          Date.now() - startTime
        }ms`
      );

      if (candidatePools.length === 0) {
        logger.warn("No pools found for this pair");
        return null;
      }

      // Log candidate pools for debugging
      if (v2Pools > 0) {
        logger.info(
          "Candidate pools v2: ",
          candidatePools
            .filter((p) => p.type === "v2-pool")
            .map(
              (p) =>
                `${p.reserve0.currency.symbol} - ${p.reserve1.currency.symbol}`
            )
        );
      }

      if (v3Pools > 0) {
        logger.info(
          "Candidate pools v3: ",
          candidatePools
            .filter((p) => p.type === "v3-pool")
            .map(
              (p) =>
                `${p.token0.symbol} - ${p.token1.symbol} (${p.fee / 10000}%)`
            )
        );
      }

      // Create static pool provider
      const poolProvider = SmartRouter.createStaticPoolProvider(candidatePools);

      // Define allowed pool types based on preferences
      const allowedPoolTypes: PoolType[] = [];
      if (this.options.enableV2) allowedPoolTypes.push(PoolType.V2);
      if (this.options.enableV3) allowedPoolTypes.push(PoolType.V3);
      allowedPoolTypes.push(PoolType.STABLE); // Always include stable

      // Define trade config
      const tradeConfig: TradeConfig = {
        gasPriceWei: async () => BigInt(1000000000), // 1 gwei default
        poolProvider,
        quoteProvider,
        maxHops: this.options.maxHops,
        maxSplits: this.options.maxSplits,
        distributionPercent: this.options.distributionPercent,
        allowedPoolTypes:
          allowedPoolTypes.length > 0
            ? allowedPoolTypes
            : [PoolType.V2, PoolType.V3, PoolType.STABLE],
        quoterOptimization: false, // Disable optimization to reduce calls
      };

      // Get best trade
      routerStartTime = Date.now();
      const trade = await SmartRouter.getBestTrade(
        inputAmount,
        outputToken,
        tradeType,
        tradeConfig
      );
      const routerTime = Date.now() - routerStartTime;

      if (!trade) {
        logger.warn("No trade route found");
        return null;
      }

      // Calculate slippage
      const slippagePercent = new Percent(
        Math.floor(this.options.slippageTolerance * 100),
        10000
      );

      // Format result
      const result = await this.formatQuoteResult(
        trade,
        inputAmountRaw,
        slippagePercent,
        routerTime
      );

      const totalTime = Date.now() - startTime;
      logger.info(
        `Quote completed in ${totalTime}ms (router: ${routerTime}ms)`,
        {
          outputAmount: result.outputAmount,
          priceImpact: result.priceImpact,
          route: result.route,
        }
      );

      return result;
    } catch (error) {
      const totalTime = Date.now() - startTime;
      logger.error(`Quote failed after ${totalTime}ms`, {
        inputToken: inputToken.symbol,
        outputToken: outputToken.symbol,
        amount: inputAmountRaw,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getMultipleQuotes(
    pairs: Array<{
      inputToken: Currency;
      outputToken: Currency;
      amount: string;
      shouldAdjustQuoteForGas?: boolean;
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
            pair.shouldAdjustQuoteForGas || false
          );
        } catch (error) {
          logger.error(
            `Failed to get quote for ${pair.inputToken.symbol} -> ${pair.outputToken.symbol}`,
            error
          );
          return null;
        }
      })
    );

    return results;
  }

  private async formatQuoteResult(
    trade: SmartRouterTrade<TradeType>,
    inputAmountRaw: string, // This is already in smallest units
    slippagePercent: Percent,
    routerTime: number
  ): Promise<QuoteResult> {
    const outputAmountWithSlippage = trade.outputAmount.multiply(
      new Percent(1).subtract(slippagePercent)
    );

    // Calculate price impact
    let priceImpact: string;

    const calculateFallbackPriceImpact = (): string => {
      const inputAmount = parseFloat(
        formatUnits(
          trade.inputAmount.quotient,
          trade.inputAmount.currency.decimals
        )
      );
      const outputAmount = parseFloat(
        formatUnits(
          trade.outputAmount.quotient,
          trade.outputAmount.currency.decimals
        )
      );

      if (inputAmount > 0 && outputAmount > 0) {
        const expectedRate = trade.route?.midPrice?.toSignificant(6);
        const actualRate = (outputAmount / inputAmount).toFixed(6);
        if (expectedRate && actualRate) {
          const impact =
            Math.abs(
              (parseFloat(actualRate) - parseFloat(expectedRate)) /
                parseFloat(expectedRate)
            ) * 100;
          return `${impact.toFixed(2)}%`;
        }
      }
      return "0.01%";
    };

    try {
      // Try to calculate price impact from trade
      if (trade.priceImpact) {
        priceImpact = `${trade.priceImpact.toFixed(2)}%`;
      } else {
        priceImpact = calculateFallbackPriceImpact();
      }
    } catch (error) {
      logger.warn(
        "Failed to compute price impact, using fallback calculation",
        error
      );
      priceImpact = calculateFallbackPriceImpact();
    }

    const executionPrice = trade.outputAmount
      .divide(trade.inputAmount)
      .toFixed(6);
    const minimumReceived = formatUnits(
      outputAmountWithSlippage.quotient,
      trade.outputAmount.currency.decimals
    );

    // Format route path
    const routePath = trade.routes.map((route: any) => {
      const pathSegments = [];

      for (let i = 0; i < route.path.length - 1; i++) {
        const currentToken = route.path[i];
        const nextToken = route.path[i + 1];
        const pool = route.pools[i];

        let poolInfo = "Unknown";
        if (pool) {
          // Use PoolType enum for comparison
          if (pool.type === PoolType.V2) {
            poolInfo = "V2";
          } else if (pool.type === PoolType.V3) {
            const fee = pool.fee || "Unknown";
            poolInfo = `V3 ${
              typeof fee === "bigint" ? Number(fee) / 10000 : fee / 10000
            }%`;
          } else if (pool.type === PoolType.STABLE) {
            poolInfo = "Stable";
          } else {
            poolInfo = `Type${pool.type}`;
          }

          if (pool.address) {
            poolInfo += ` ${pool.address.slice(0, 8)}...`;
          }
        }

        pathSegments.push(
          `${currentToken.symbol || "Unknown"}-${
            nextToken.symbol || "Unknown"
          } ${poolInfo}`
        );
      }

      const pathString = pathSegments.join(", ");
      const percent = route.percent || 0;

      return `(${percent}% [${pathString}])`;
    });

    // Extract pool information
    const pools = trade.routes.flatMap((route) =>
      route.pools.map((pool) => {
        if (pool.type === PoolType.V3) {
          return `V3 ${pool.address}`;
        } else if (pool.type === PoolType.V2) {
          return `V2 ${pool.reserve0.currency.symbol}-${pool.reserve1.currency.symbol}`;
        } else {
          return `Stable ${pool.address}`;
        }
      })
    );

    return {
      inputToken: trade.inputAmount.currency,
      outputToken: trade.outputAmount.currency,
      inputAmount: inputAmountRaw, // Already in decimal format
      outputAmount: formatUnits(
        trade.outputAmount.quotient,
        trade.outputAmount.currency.decimals
      ),
      outputAmountWithSlippage: minimumReceived,
      priceImpact: priceImpact,
      route: routePath,
      pools: pools,
      gasEstimate: trade.gasEstimate
        ? formatUnits(trade.gasEstimate, 18)
        : undefined,
      executionPrice: executionPrice,
      minimumReceived: minimumReceived,
      routerTime: `${routerTime}ms`,
      trade: trade, // Include the actual SmartRouterTrade object
      rawTrade: trade, // Alias for backward compatibility
    };
  }
}
