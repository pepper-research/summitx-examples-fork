# Swap Execution with TokenQuoter

This guide shows how to use the TokenQuoter from `summitx-example` to get optimal swap routes and execute them on-chain using the same patterns as the SummitX interface.

## Overview

The integration consists of three main parts:
1. **TokenQuoter** - Gets optimal swap routes using the SummitX smart router
2. **Quote Converter** - Converts TokenQuoter output to SmartRouterTrade format
3. **Swap Execution** - Executes trades using SwapRouter (interface style)

## Prerequisites

1. Install dependencies:
```bash
yarn install
```

2. Set up your environment:
```bash
cp .env.example .env
```

Add your private key to `.env`:
```
PRIVATE_KEY=0x... # Your wallet private key
```

3. Ensure you have:
   - CAMP tokens for gas fees
   - Input tokens (e.g., USDC) for swapping

## Examples

### 1. Basic Integration Pattern

The `execute-swap-with-quoter.ts` example shows the basic integration pattern:

```bash
npx ts-node src/execute-swap-with-quoter.ts
```

### 2. Simple Swap Execution

The `execute-swap-complete.ts` example shows a basic working implementation:

```bash
npx ts-node src/execute-swap-complete.ts
```

### 3. Interface-Style Execution (Recommended)

The `execute-swap-interface-style.ts` example uses the same patterns as the SummitX interface:

```bash
npx ts-node src/execute-swap-interface-style.ts
```

This example:
- Gets quotes using TokenQuoter
- Converts quotes to SmartRouterTrade format using QuoteToTradeConverterV2
- Uses SwapRouter.swapCallParameters() to build calldata
- Executes swaps with full support for:
  - V2, V3, and Stable pools
  - Multi-hop routes
  - Split routes across multiple pools
  - Mixed protocol routes

## How It Works

### 1. Getting Quotes

```typescript
const quoter = new TokenQuoter({
  rpcUrl: "your-rpc-url",
  slippageTolerance: 1.0, // 1%
  maxHops: 3,
  maxSplits: 3
})

const quote = await quoter.getQuote(
  inputToken,
  outputToken,
  "100", // amount
  TradeType.EXACT_INPUT
)
```

### 2. Quote Structure

The quote contains:
- `inputAmount` / `outputAmount` - Token amounts
- `route` - Path taken (may include multiple hops)
- `pools` - Specific pools used (V2, V3, or Stable)
- `priceImpact` - Expected price impact
- `minimumReceived` - Minimum output after slippage

### 3. Building Swap Transactions

Based on the pools used:
- **V2 Pools Only** → Use V2 Router
- **V3 Pools or Split Routes** → Use Smart Router

```typescript
// Determine router based on pools
const hasV3Pool = quote.pools.some(p => p.includes("V3"))
const routerAddress = hasV3Pool ? SMART_ROUTER_ADDRESS : V2_ROUTER_ADDRESS

// Build calldata
const swapCalldata = buildSwapCalldata(quote, walletAddress, slippageBps)
```

### 4. Executing Swaps

```typescript
// 1. Approve router (if needed)
await walletClient.writeContract({
  address: tokenAddress,
  abi: ERC20_ABI,
  functionName: "approve",
  args: [routerAddress, amount]
})

// 2. Execute swap
const tx = await walletClient.sendTransaction({
  to: swapCalldata.to,
  data: swapCalldata.data,
  value: swapCalldata.value
})

// 3. Wait for confirmation
const receipt = await publicClient.waitForTransactionReceipt({ hash: tx })
```

## Supported Features

### Pool Types
- ✅ V2 Pools (Uniswap V2 style)
- ✅ V3 Pools (Concentrated liquidity)
- ✅ Stable Pools (For stablecoins)

### Route Types
- ✅ Direct swaps (single pool)
- ✅ Multi-hop swaps (through intermediary tokens)
- ⚠️  Split routes (partial support - simple cases only)

## Quote to Trade Conversion

The `QuoteToTradeConverterV2` class provides full conversion from TokenQuoter output to SmartRouterTrade format:

```typescript
import { QuoteToTradeConverterV2 } from "./utils/quote-to-trade-converter-v2"

// Convert quote to trade
const trade = QuoteToTradeConverterV2.convertQuoteToTrade(quote)

// Validate conversion
const isValid = QuoteToTradeConverterV2.validateConversion(quote, trade)
```

### Supported Features

- ✅ Single-hop swaps (V2, V3, Stable)
- ✅ Multi-hop swaps through intermediary tokens
- ✅ Split routes across multiple pools
- ✅ Mixed protocol routes (V2 + V3 in same path)
- ✅ Percentage-based route splitting
- ✅ Automatic pool type detection
- ✅ Fee tier parsing for V3 pools

## Using SwapRouter (Interface Pattern)

The recommended approach follows the SummitX interface pattern:

```typescript
// 1. Get quote
const quote = await quoter.getQuote(inputToken, outputToken, amount)

// 2. Convert to SmartRouterTrade
const trade = QuoteToTradeConverterV2.convertQuoteToTrade(quote)

// 3. Build swap parameters
const swapOptions = {
  slippageTolerance: new Percent(100, 10000), // 1%
  recipient: walletAddress,
  deadlineOrPreviousBlockhash: Math.floor(Date.now() / 1000) + 300,
}

const { calldata, value } = SwapRouter.swapCallParameters(trade, swapOptions)

// 4. Execute swap
const tx = await walletClient.sendTransaction({
  to: SMART_ROUTER_ADDRESS,
  data: calldata,
  value: BigInt(value),
})
```

## Production Considerations

For production use, consider:

1. **Gas Estimation**: Add proper gas estimation before sending transactions
2. **MEV Protection**: Use private mempools or MEV-protected RPCs
3. **Error Handling**: Add comprehensive error handling and retry logic
4. **Monitoring**: Track swap success rates and slippage
5. **Token Validation**: Verify token addresses and decimals
6. **Liquidity Checks**: Ensure sufficient liquidity exists before swapping

## Security Notes

- Never commit private keys to git
- Always verify token addresses
- Use reasonable slippage (0.5-3%)
- Test with small amounts first
- Monitor for sandwich attacks

## Next Steps

1. Test with small amounts on testnet
2. Implement full Trade conversion for complex routes
3. Add support for native token swaps
4. Integrate with swap-quote-engine's SwapCalldataBuilder for production use