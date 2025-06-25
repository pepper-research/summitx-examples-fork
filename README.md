# SummitX Token Quoter

A token swap quoter for Base testnet using the SummitX ecosystem. This package provides utilities to get swap quotes between different tokens.

## Overview

This package contains two implementations:
1. **Simple Quoter** - A demonstration implementation with mock calculations
2. **Token Quoter** - Full integration with the SummitX smart-router for real quotes

## Installation

```bash
pnpm install
```

## Usage

### Simple Example (Mock Data)

The simple example demonstrates the quoter interface with mock calculations:

```bash
pnpm dev:simple
```

This will show example quotes for various token pairs using hardcoded exchange rates.

### Smart Router Example (Real Quotes)

The smart router example uses the actual SummitX smart-router to find the best trade routes:

```bash
pnpm dev:smart
```

This connects to Base testnet and attempts to find real liquidity pools for token swaps.

### Interactive CLI

Run the interactive command-line interface:

```bash
pnpm dev
```

## Features

- Get swap quotes for token pairs using SummitX smart-router
- Support for exact input and exact output trades
- Slippage tolerance configuration
- Batch quote requests
- Multi-hop routing through intermediate tokens
- Pool discovery across V2, V3, and stable swap pools
- Gas estimation and price impact calculation
- Formatted output with execution prices and minimum received amounts

## Configuration

### Environment Variables

Create a `.env` file:

```env
BASE_TESTNET_RPC_URL=https://goerli.base.org
```

### Supported Tokens

The following tokens are pre-configured for Base testnet:
- WETH (Wrapped Ether)
- USDC (USD Coin)
- SUMMIT (SummitX native token)
- MockA (Test token)

## API

### SimpleQuoter (Mock Implementation)

```typescript
const quoter = new SimpleQuoter(slippageTolerance: number)

// Get a single quote
const quote = await quoter.getQuote(
  inputToken: Currency,
  outputToken: Currency,
  inputAmount: string,
  tradeType: TradeType
)

// Get multiple quotes
const quotes = await quoter.getMultipleQuotes(pairs: Array<{
  inputToken: Currency,
  outputToken: Currency,
  amount: string
}>)
```

### TokenQuoter (Smart Router Implementation)

```typescript
import { TokenQuoter } from './quoter/token-quoter'

const quoter = new TokenQuoter({
  rpcUrl?: string,              // Custom RPC URL (optional)
  maxHops?: number,             // Maximum routing hops (default: 3)
  maxSplits?: number,           // Maximum route splits (default: 3)
  distributionPercent?: number, // Split distribution percentage (default: 5)
  slippageTolerance?: number    // Slippage tolerance % (default: 0.5)
})

// Get a quote using smart router
const quote = await quoter.getQuote(
  inputToken: Currency,
  outputToken: Currency,
  inputAmount: string,
  tradeType: TradeType
)
```

### Quote Result

```typescript
interface QuoteResult {
  inputToken: Currency
  outputToken: Currency
  inputAmount: string
  outputAmount: string
  outputAmountWithSlippage: string
  priceImpact: string
  route: string | string[]       // Route path(s) taken
  pools: string[]                // Pool addresses used
  gasEstimate?: string           // Estimated gas cost
  executionPrice: string
  minimumReceived: string
}
```

## Development

```bash
# Type checking
npm run typecheck

# Linting
npm run lint

# Build
npm run build

# Clean build artifacts
npm run clean
```

## Smart Router Integration

The TokenQuoter class integrates with the SummitX smart-router using the following components:

### 1. Pool Provider
```typescript
const poolProvider = createPoolProvider({
  onChainProvider,
  v2SubgraphProvider,  // Optional: for V2 pools
  v3SubgraphProvider,  // Optional: for V3 pools
})
```

### 2. Quote Provider
```typescript
const quoteProvider = createQuoteProvider({
  onChainProvider,
  multicallConfigs,
  gasLimit,
})
```

### 3. Trade Configuration
```typescript
const tradeConfig: TradeConfig = {
  gasPriceWei: bigint | (() => Promise<bigint>),
  blockNumber?: number,
  poolProvider,
  quoteProvider,
  maxHops?: number,
  maxSplits?: number,
  distributionPercent?: number,
  allowedPoolTypes?: PoolType[],
  quoterOptimization?: boolean,
}
```

### 4. Utility Functions
- `minimumAmountOut()`: Calculate minimum output with slippage
- `getPriceImpact()`: Get the price impact of the trade
- `getExecutionPrice()`: Get the execution price for the trade

**Note**: For production use, you should provide subgraph endpoints to the pool provider for better pool discovery.

## License

MIT