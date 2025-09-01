import {
  createWalletClient,
  http,
  parseUnits,
  getAddress,
  createPublicClient,
  encodeFunctionData,
  Hash
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, basecampTestnet } from "viem/chains";
import { SEPOLIA_DELEGATE, BASECAMP_DELEGATE } from "./config/contracts";
import { getIntentHash, hashChainBatches, selectChainForChainBatches } from "./utils/delegate-helpers";
import { DELEGATE_ABI } from "./config/abis";


async function main() {
  // A sample user account
  const user = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

  // The escrow contract address where the initial deposit is sent
  const escrow = getAddress("0xeee2b52e7CFe6e2168341a34cEB783b68FEdf1A2");

  // solver account that executes the cross-chain transaction
  const solver = privateKeyToAccount(process.env.SOLVER_PRIVATE_KEY as `0x${string}`);


  const sourceClient = createPublicClient({
    chain: sepolia,
    transport: http(),
  });

  const destinationClient = createPublicClient({
    chain: basecampTestnet,
    transport: http(),
  });

  const sourceWalletClient = createWalletClient({
    chain: sepolia,
    transport: http(),
  });

  const destinationWalletClient = createWalletClient({
    chain: basecampTestnet,
    transport: http(),
  });

  const waitForBlock = async (client: ReturnType<typeof createPublicClient>, block: bigint) => {
    console.warn(`Waiting for block ${block + 1n}...`);
    while (true) {
      const currentBlock = await client.getBlockNumber();
      if (currentBlock > block) {
        console.warn("Executing the chainbatches...");
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    console.warn();
  }

  const depositAmount = parseUnits("0.0001", 18);
  const gasFee = parseUnits("0.00001", 18);

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

  // User signs another authorization for baseCampTestnet
  const userAuthDestination = await user.signAuthorization({
    address: delegateAddressDestination,
    chainId: basecampTestnet.id,
    nonce: nonceBaseCamp,
  });

  const solverAuthSource = await solver.signAuthorization({
    address: delegateAddressSource,
    chainId: sepolia.id,
    nonce: nonceSepolia,
  });

  const solverAuthDestination = await solver.signAuthorization({
    address: delegateAddressDestination,
    chainId: basecampTestnet.id,
    nonce: nonceBaseCamp,
  });

  const recentBlockSepolia = await sourceClient.getBlockNumber();
  const recentBlockBaseCamp = await destinationClient.getBlockNumber();

  // user (sepolia) -> ether (sepolia) -> escrow (sepolia)
  // solver (baseCampTestnet) -> CAMP (baseCampTestnet) -> user (baseCampTestnet)

  const chainBatches = hashChainBatches([
    // user on sepolia sends ether to escrow
    {
      chainId: sepolia.id,
      recentBlock: recentBlockSepolia,
      calls: [
        {
          to: escrow,
          value: depositAmount + gasFee,
          data: "0x",
        }
      ]
    },
    // solver on baseCampTestnet sends CAMP to user
    {
      chainId: basecampTestnet.id,
      recentBlock: recentBlockBaseCamp + 8n,
      calls: [
        {
          to: user.address,
          value: depositAmount,
          data: "0x",
        }
      ]
    }
  ]);

  const digest = getIntentHash(chainBatches);

  const signature = await user.signMessage({
    message: { raw: digest },
  });

  waitForBlock(sourceClient, recentBlockSepolia).then(() => console.log("Source chain wait complete"));

  const sourceChainTx = await sourceWalletClient.writeContract({
    authorizationList: [solverAuthSource, userAuthSource],
    address: solver.address,
    abi: DELEGATE_ABI,
    account: solver,
    functionName: "selfExecute",
    args: [
      [{
        to: user.address,
        data: encodeFunctionData({
          abi: DELEGATE_ABI,
          functionName: "execute",
          args: [
            {
              signature: signature,
              chainBatches: selectChainForChainBatches(chainBatches, {
                chainId: BigInt(sepolia.id)
              }),
            }
          ]
        }),
        value: 0n
      }]
    ]
  }) as Hash;

  await sourceClient.waitForTransactionReceipt({ hash: sourceChainTx });
  console.log("Source chain tx:", sourceChainTx);

  waitForBlock(destinationClient, recentBlockBaseCamp + 8n).then(() => console.log("Destination chain wait complete"));

  const destinationChainTx = await destinationWalletClient.writeContract({
    authorizationList: [solverAuthDestination, userAuthDestination],
    address: solver.address,
    abi: DELEGATE_ABI,
    account: solver,
    functionName: "selfExecute",
    args: [
      [{
        to: user.address,
        data: encodeFunctionData({
          abi: DELEGATE_ABI,
          functionName: "execute",
          args: [
            {
              signature: signature,
              chainBatches: selectChainForChainBatches(chainBatches, {
                chainId: BigInt(basecampTestnet.id)
              }),
            }
          ]
        }),
        value: 0n
      }]
    ]
  }) as Hash;

  await destinationClient.waitForTransactionReceipt({ hash: destinationChainTx });
  console.log("Destination chain tx:", destinationChainTx);

};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
