# SummitX DEX Integration Examples - Base Camp Testnet

A comprehensive suite of examples for interacting with the SummitX DEX on Base Camp Testnet, including token swaps, wrapping/unwrapping, and smart routing with optimized gas usage.

## 🚀 Features

- **Token Swapping**: Native to ERC20, ERC20 to Native, and ERC20 to ERC20 swaps
- **Multicall Support**: Combine swap + unwrap operations in a single transaction
- **Wrap/Unwrap**: Convert between native CAMP and wrapped WCAMP tokens
- **Smart Routing**: Automatic route finding across V3 and Stable pools
- **Quote System**: Real-time quotes with price impact and slippage calculations
- **Multi-hop Support**: Find optimal routes through multiple pools
- **Rate Limit Protection**: Built-in delays to avoid RPC rate limiting

## 📋 Prerequisites

- Node.js 18+
- Private key with Base Camp Testnet tokens
- CAMP tokens for gas fees

## 🛠️ Installation

```bash
# Clone the repository
git clone <repository-url>
cd summitx-example

# Install dependencies
npm install
# or
pnpm install

# Copy environment file
cp .env.example .env

# Add your private key to .env
# PRIVATE_KEY=your_private_key_here
```

## 🏗️ Project Structure

```
src/
├── archive/                   # Archived/unused files
├── config/                    # Chain and token configurations
│   └── base-testnet.ts        # Base Camp testnet config
├── debug/                     # Debug utilities
│   ├── check-balance.ts       # Check wallet balances
│   ├── debug-gas.ts           # Gas estimation debugging
│   ├── debug-swap.ts          # Swap parameter debugging
│   ├── quote-example.ts       # Quote testing
│   └── verify-calldata.ts     # Verify swap calldata
├── quoter/                    # Token quoter implementation
│   └── token-quoter.ts        # Main quoter class
├── utils/                     # Helper utilities
│   ├── logger.ts              # Logging utility
│   └── quote-to-trade-converter.ts # Convert quotes to trades
├── index.ts                   # Main entry point (runs all examples)
├── native-to-erc20-swap.ts    # Native CAMP to ERC20 swap
├── erc20-to-native-swap.ts    # ERC20 to native CAMP swap (with unwrap)
├── erc20-to-native-multicall.ts     # ERC20 to native using multicall (single tx)
├── erc20-to-native-multicall-v2.ts  # Alternative multicall approach
├── erc20-to-native-router-multicall.ts # Router-based multicall implementation
├── erc20-to-erc20-swap.ts     # ERC20 to ERC20 swaps
├── swap-examples.ts           # Legacy comprehensive swap examples
├── check-balance.ts           # Balance checking utility
└── wrap-unwrap-example.ts     # Wrap/unwrap CAMP ↔ WCAMP
```

## 🎯 Quick Start

```bash
# Check your wallet balances
npm run check:balance

# Run all examples (wrap/unwrap + all swap types)
npm start

# Run individual swap examples
npm run swap:native-to-erc20  # Swap native CAMP to USDC
npm run swap:erc20-to-native  # Swap USDC to native CAMP
npm run swap:erc20-to-erc20   # Multiple ERC20 swaps

# Run wrap/unwrap example
npm run wrap-unwrap            # Convert CAMP ↔ WCAMP
```

## 📝 Available Scripts

### Main Commands

| Command                         | Description                                        |
| ------------------------------- | -------------------------------------------------- |
| `npm start`                     | Run all examples (wrap/unwrap + all swap types)   |
| `npm run dev`                   | Same as npm start                                 |
| `npm run wrap-unwrap`           | Run wrap/unwrap CAMP ↔ WCAMP example              |
| `npm run check:balance`         | Check wallet token balances                        |

### Swap Commands

| Command                         | Description                                        |
| ------------------------------- | -------------------------------------------------- |
| `npm run swap:all`              | Run legacy comprehensive swap examples            |
| `npm run swap:native-to-erc20` | Swap native CAMP to USDC                          |
| `npm run swap:erc20-to-native` | Swap USDC to native CAMP (includes unwrap)        |
| `npm run swap:erc20-to-native-multicall` | ERC20 to native in single transaction    |
| `npm run swap:erc20-to-erc20`  | Run multiple ERC20 to ERC20 swaps                 |

### Debug Commands

| Command                  | Description                       |
| ------------------------ | --------------------------------- |
| `npm run quote`          | Test quoter functionality         |
| `npm run debug:gas`      | Debug gas estimation issues       |
| `npm run debug:verify`   | Verify swap calldata generation  |

## 💱 Supported Tokens

| Token        | Symbol | Decimals | Address                                      |
| ------------ | ------ | -------- | -------------------------------------------- |
| Native CAMP  | CAMP   | 18       | Native                                       |
| Wrapped CAMP | WCAMP  | 18       | `0x1aE9c40eCd2DD6ad5858E5430A556d7aff28A44b` |
| USD Coin     | USDC   | 6        | `0x71002dbf6cC7A885cE6563682932370c056aAca9` |
| Tether       | USDT   | 6        | `0xA745f7A59E70205e6040BdD3b33eD21DBD23FEB3` |
| Wrapped ETH  | WETH   | 18       | `0xC42BAA20e3a159cF7A8aDFA924648C2a2d59E062` |
| Wrapped BTC  | WBTC   | 18       | `0x587aF234D373C752a6F6E9eD6c4Ce871e7528BCF` |
| DAI          | DAI    | 18       | `0x5d3011cCc6d3431D671c9e69EEddA9C5C654B97F` |

## 🔄 Swap Examples

### Native to ERC20 Swap

```typescript
// Swap 0.01 CAMP to USDC
const quote = await quoter.getQuote(
  baseCampTestnetTokens.wcamp, // Use WCAMP for native
  baseCampTestnetTokens.usdc,
  "0.01", // Amount in decimal format
  TradeType.EXACT_INPUT,
  false
);

// For native swaps, send CAMP value with transaction
const swapValue = parseUnits("0.01", 18);
const tx = await walletClient.sendTransaction({
  to: SMART_ROUTER_ADDRESS,
  data: methodParameters.calldata,
  value: swapValue, // Native CAMP value
});
```

### ERC20 to Native Swap (with automatic unwrap)

```typescript
// Swap 0.5 USDC to native CAMP
const quote = await quoter.getQuote(
  baseCampTestnetTokens.usdc,
  baseCampTestnetTokens.wcamp, // Quote to WCAMP first
  "0.5",
  TradeType.EXACT_INPUT,
  false
);

// Execute swap to WCAMP
const swapTx = await walletClient.sendTransaction({
  to: SMART_ROUTER_ADDRESS,
  data: methodParameters.calldata,
  value: 0n,
});

// If WCAMP received, automatically unwrap to native CAMP
if (wcampReceived > 0n) {
  const unwrapHash = await walletClient.writeContract({
    address: WCAMP_ADDRESS,
    abi: WETH_ABI,
    functionName: "withdraw",
    args: [wcampReceived],
  });
}
```

### ERC20 to Native Swap (Multicall - Single Transaction)

```typescript
// Using router multicall to combine swap + unwrap in one transaction
const swapParams = SwapRouter.swapCallParameters(trade, {
  slippageTolerance: new Percent(100, 10000), // 1%
  deadline: Math.floor(Date.now() / 1000) + 60 * 20,
  recipient: SMART_ROUTER_ADDRESS, // Router holds WCAMP temporarily
});

// Create multicall data array
const multicallData = [
  swapParams.calldata, // Swap USDC to WCAMP
  encodeFunctionData({
    abi: ROUTER_MULTICALL_ABI,
    functionName: "unwrapWETH9",
    args: [minAmountOut, account.address], // Unwrap and send to user
  }),
];

// Execute both operations atomically
const txHash = await walletClient.writeContract({
  address: SMART_ROUTER_ADDRESS,
  abi: ROUTER_MULTICALL_ABI,
  functionName: "multicall",
  args: [multicallData],
  value: 0n,
});
```

### ERC20 to ERC20 Swap

```typescript
// Swap 1 USDC to USDT
const quote = await quoter.getQuote(
  baseCampTestnetTokens.usdc,
  baseCampTestnetTokens.usdt,
  "1",
  TradeType.EXACT_INPUT,
  false
);

// Approve and execute swap
const tx = await walletClient.sendTransaction({
  to: SMART_ROUTER_ADDRESS,
  data: methodParameters.calldata,
  value: 0n,
});
```

### Wrap/Unwrap Native Token

```typescript
// Wrap 0.01 CAMP to WCAMP
const wrapHash = await walletClient.writeContract({
  address: WCAMP_ADDRESS,
  abi: WETH_ABI,
  functionName: "deposit",
  value: parseUnits("0.01", 18),
});

// Unwrap 0.01 WCAMP to CAMP
const unwrapHash = await walletClient.writeContract({
  address: WCAMP_ADDRESS,
  abi: WETH_ABI,
  functionName: "withdraw",
  args: [parseUnits("0.01", 18)],
});
```

## ⚙️ Configuration

### Environment Variables

Create a `.env` file with:

```env
# Required
PRIVATE_KEY=your_private_key_here

# Optional (defaults provided)
BASE_TESTNET_RPC_URL=https://rpc-campnetwork.xyz
```

### Quoter Options

```typescript
const quoter = new TokenQuoter({
  rpcUrl: "https://rpc-campnetwork.xyz",
  slippageTolerance: 1.0, // 1% slippage
  maxHops: 2, // Maximum route hops
  maxSplits: 2, // Maximum split routes
  enableV2: false, // V2 pools (disabled due to chain ID issue)
  enableV3: true, // V3 pools enabled
});
```

## 🔧 Troubleshooting

### Common Issues

1. **Rate Limiting (429 errors)**

   - The examples include 5-second delays between operations
   - Initial 3-second delay before starting operations
   - Consider using a private RPC endpoint for high-frequency operations

2. **Contract Creation Instead of Swap**

   - Fixed: Router address is now properly set for all transactions
   - All swaps go to: `0x197b7c9fC5c8AeA84Ab2909Bf94f24370539722D`

3. **Insufficient Balance**

   - Check balances: `npm run check:balance`
   - Ensure you have enough CAMP for gas fees
   - Native swaps need value + gas, not just gas

4. **No Route Found**

   - Some token pairs may not have liquidity
   - Try smaller amounts or different token pairs
   - V3 pools are enabled, V2 disabled due to chain ID issues

5. **Gas Estimation Failed**
   - Use `npm run debug:gas` to debug
   - May indicate insufficient balance
   - Gas limit removed to allow automatic estimation

### Debug Tools

```bash
# Check what's happening with gas estimation
npm run debug:gas

# Test quoter with various token pairs
npm run debug:quote

# Debug swap parameters and calldata
npm run debug:swap
```

## 🏗️ Architecture

### TokenQuoter

The main class for getting swap quotes:

- Fetches pool information from subgraphs
- Calculates optimal routes using SmartRouter
- Returns quotes with price impact and slippage
- Supports both `trade` and `rawTrade` properties for compatibility

### SmartRouter Integration

- Uses `@summitx/smart-router` for route finding
- Supports V3 and Stable pools (V2 disabled)
- Automatic route optimization
- Multi-hop and split route support

### Transaction Flow

1. Get quote from TokenQuoter
2. Generate swap parameters using SwapRouter.swapCallParameters
3. For native swaps: add value to transaction
4. For ERC20 swaps: approve token first
5. Send transaction to Smart Router contract
6. Router handles the actual swap

## 📊 Network Information

- **Network**: Base Camp Testnet
- **Chain ID**: 123420001114
- **RPC URL**: https://rpc-campnetwork.xyz
- **Explorer**: https://basecamp.cloud.blockscout.com/
- **Smart Router**: `0x197b7c9fC5c8AeA84Ab2909Bf94f24370539722D`
- **V2 Router**: `0x03B38A5C3cf55cB3B8D61Dc7eaB7BBC0ec276708`

## 🎯 Key Features & Fixes

### New Features
1. **Separated Swap Examples**: Individual files for each swap type (native-to-erc20, erc20-to-native, erc20-to-erc20)
2. **Automatic Unwrapping**: ERC20 to native swaps automatically unwrap WCAMP to native CAMP
3. **Multicall Implementation**: Single-transaction swap + unwrap using router multicall functionality
4. **Comprehensive Logging**: Detailed balance tracking and transaction status reporting
5. **Multiple Token Support**: Swaps between USDC, USDT, DAI, WETH, WBTC, and native CAMP

### Key Fixes Implemented
1. **Quote System**: Updated to match reference implementation with proper decimal handling
2. **Native Swaps**: Fixed by manually setting transaction value for native CAMP
3. **Router Address**: Fixed contract creation issue by explicitly setting router address
4. **Gas Estimation**: Removed hardcoded gas limits, let viem estimate automatically
5. **Rate Limiting**: Added 5-second delays between operations
6. **Pool Types**: Using PoolType enum for proper pool identification
7. **ERC20 to Native**: Added automatic WCAMP unwrapping for true native output
8. **Multicall Support**: Implemented single-transaction swap + unwrap using router multicall

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

MIT - This project is provided as-is for educational purposes.

## 🔗 Resources

- [SummitX Documentation](https://docs.summitx.finance)
- [Base Camp Testnet Faucet](https://faucet.basecamp.network)
- [Block Explorer](https://basecamp.cloud.blockscout.com/)
- [SummitX V3 Subgraph](https://api.goldsky.com/api/public/project_cllrma24857iy38x0a3oq836e/subgraphs/summitx-exchange-v3-users/1.0.1/gn)

## ⚠️ Disclaimer

This is example code for testnet use only. Always test thoroughly before using in production. Never share your private keys or commit them to version control.
