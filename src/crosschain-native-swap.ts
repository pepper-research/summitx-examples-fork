import {
  createWalletClient,
  http,
  parseUnits,
  getAddress,
  formatEther,
  defineChain,
  createPublicClient,
  Call,
  Authorization,
  Chain,
  encodeFunctionData
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { basecampTestnet, WCAMP_ADDRESS } from "./config/base-testnet";
import { SEPOLIA_DELEGATE, BASECAMP_DELEGATE } from "./config/contracts";
import { ChainBatch, getIntentHash, hashChainBatches, TxSubmitRequest } from "./utils/delegate-helpers";
import { submitTransaction } from "./utils/delegate-helpers";
import { TokenQuoter } from "./quoter/token-quoter";
import { WETH_ABI } from "./config/abis";
import { get } from "http";

// A sample user account
const user = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

// const solver = privateKeyToAccount(process.env.SOLVER_KEY as `0x${string}`);

// The escrow contract address where the initial deposit is sent
const escrowAddress = getAddress("0x...");

const baseCamp = defineChain(basecampTestnet);

// const userClient = createWalletClient({
//   account: user,
//   chain: sepolia,
//   transport: http(),
// });

// const solverClient = createWalletClient({
//   account: solver,
//   chain: sepolia,
//   transport: http(),
// });

const sourceClient = createPublicClient({
  chain: sepolia,
  transport: http(),
});

const destinationClient = createPublicClient({
  chain: baseCamp,
  transport: http(),
});

const depositAmount = parseUnits("0.0001", 18);

// Fetch the current nonce for the user on each chain
const nonceSepolia = await sourceClient.getTransactionCount(user);
const nonceBaseCamp = await destinationClient.getTransactionCount(user);

const delegateAddressSource = getAddress(SEPOLIA_DELEGATE);
const delegateAddressDestination = getAddress(BASECAMP_DELEGATE);

// User signs an authorization for Sepolia
const userAuthSource = await user.signAuthorization({
  address: delegateAddressSource,
  chainId: sepolia.id,
  nonce: nonceSepolia,
});

// User signs another authorization for baseCamp
const userAuthDestination = await user.signAuthorization({
  address: delegateAddressDestination,
  chainId: baseCamp.id,
  nonce: nonceBaseCamp,
});

const recentBlockSepolia = await sourceClient.getBlockNumber();
const recentBlockBaseCamp = await destinationClient.getBlockNumber();

// Initialize quoter
// const quoter = new TokenQuoter({
//   rpcUrl: basecampTestnet.rpcUrls.default.http[0],
//   slippageTolerance: 1.0,
//   maxHops: 2,
//   maxSplits: 2,
//   enableV2: false,
//   enableV3: true,
// });


// ether (sepolia) -> escrow (sepolia) -> WCAMP (baseCamp) -> CAMP (baseCamp)

const sourceCalls = [
  // deposit ether to escrow
  {
    to: escrowAddress,
    value: depositAmount,
    data: "0x" as `0x${string}`
  }
]

const destinationCalls = [
  // approve delegate contract on baseCamp to spend WCAMP
  {
    to: getAddress(WCAMP_ADDRESS),
    value: 0n,
    data: encodeFunctionData({
      abi: WETH_ABI, // WETH/WCAMP abi
      functionName: 'approve',
      args: [delegateAddressDestination, depositAmount]
    }),
  },
  // withdraw (unwrap) WCAMP to CAMP
  {
    to: getAddress(WCAMP_ADDRESS),
    value: depositAmount,
    data: encodeFunctionData({
      abi: WETH_ABI, // WETH/WCAMP abi
      functionName: 'withdraw',
      args: [depositAmount]
    })
  }
]

const chainBatches = hashChainBatches([
  { chainId: sepolia.id, calls: sourceCalls, recentBlock: recentBlockSepolia },
  { chainId: baseCamp.id, calls: destinationCalls, recentBlock: recentBlockBaseCamp + 10n }
]);

const digest = getIntentHash(chainBatches);

const signature = await user.signMessage({
  message: { raw: digest },
});

const submitRequest: TxSubmitRequest = {
  authorization: [userAuthSource, userAuthDestination] as Authorization[],
  intentAuthorization: {
    signature: signature,
    chainBatches: chainBatches as ChainBatch[]
  }
}

const delegateTxResponse = await submitTransaction(submitRequest);

console.log("Submitted transaction with hash:", delegateTxResponse.hash);
console.log("Submitted transaction with intent ID:", delegateTxResponse.intentId);
