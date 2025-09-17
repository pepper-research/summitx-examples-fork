import {
    createWalletClient,
    http,
    parseUnits,
    getAddress,
    createPublicClient,
    encodeFunctionData,
    Hash,
    Address,
    formatUnits,
} from "viem";
import { logger } from "./utils/logger";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, basecampTestnet as bct } from "viem/chains";
import { Percent, TradeType } from "@summitx/swap-sdk-core";
import { SEPOLIA_DELEGATE, BASECAMP_DELEGATE } from "./config/abis";
import { getIntentHash, hashChainBatches, selectChainForChainBatches } from "./utils/spiceflow-helpers";
import { DELEGATE_ABI } from "./config/abis";
import { TokenQuoter } from "./quoter/token-quoter";
import { approveTokenWithWait, delay } from "./utils/transaction-helpers";
import {
    basecampTestnet,
    baseCampTestnetTokens,
    SMART_ROUTER_ADDRESS,
} from "./config/base-testnet";
import { SwapRouter } from "@summitx/smart-router/evm";

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
        chain: bct,
        transport: http(),
    });

    const sourceWalletClient = createWalletClient({
        account: solver,
        chain: sepolia,
        transport: http(),
    });

    const destinationWalletClient = createWalletClient({
        account: solver,
        chain: bct,
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

    const quoter = new TokenQuoter({
        rpcUrl: basecampTestnet.rpcUrls.default.http[0],
        slippageTolerance: 1.0,
        maxHops: 2,
        maxSplits: 2,
        enableV2: true,
        enableV3: true,
    });

    await delay(2000);

    const swapAmount = "0.5"; // 0.5 USDC

    // Get quote
    const quote = await quoter.getQuote(
        baseCampTestnetTokens.usdc,
        baseCampTestnetTokens.usdt,
        swapAmount,
        TradeType.EXACT_INPUT,
        false
    )

    if (!quote || !quote.rawTrade) {
        logger.error("No route found for USDC → USDT... ");
        process.exit(1);
    }

    logger.success("Quote received:", {
        input: `${swapAmount} USDC`,
        output: `${quote.outputAmount} USDT`,
        priceImpact: quote.priceImpact,
        route: quote.route,
    });

    // Check initial native balance
    const initialNativeBalance = await sourceClient.getBalance({
        address: user.address,
    });
    logger.info(
        `Initial USDT balance: ${formatUnits(
            initialNativeBalance,
            basecampTestnet.nativeCurrency.decimals
        )}`
    );

    // Approve USDC for swap with waiting period
    await approveTokenWithWait(
        createWalletClient({
            account: user,
            chain: bct,
            transport: http(),
        }),
        destinationClient,
        baseCampTestnetTokens.usdc.address,
        SMART_ROUTER_ADDRESS,
        parseUnits(swapAmount, baseCampTestnetTokens.usdt.decimals),
        baseCampTestnetTokens.usdc.symbol,
        3000
    );

    const trade = quote.rawTrade;
    const methodParameters = SwapRouter.swapCallParameters(trade, {
        slippageTolerance: new Percent(100, 10000), // 1%
        deadline: Math.floor(Date.now() / 1000) + 60 * 20,
        recipient: user.address,
    });

    const nativeValue = parseUnits(swapAmount, 18);

    console.log("Method params:", methodParameters);

    const recentBlockSepolia = await sourceClient.getBlockNumber();
    const recentBlockBaseCamp = await destinationClient.getBlockNumber();

    // sepolia: user -> ether -> escrow
    // basecamp: USDC -swap-> USDT -> user

    const chainBatches = hashChainBatches([
        // user on sepolia sends ether to escrow
        {
            chainId: sepolia.id,
            recentBlock: recentBlockSepolia,
            calls: [
                {
                    to: escrow,
                    value: depositAmount,
                    data: "0x",
                }
            ]
        },
        // user swaps USDC to WCAMP
        {
            chainId: bct.id,
            recentBlock: recentBlockBaseCamp + 8n,
            calls: [
                {
                    to: SMART_ROUTER_ADDRESS as Address,
                    value: nativeValue,
                    data: methodParameters.calldata,
                }
            ]
        }
    ]);

    const digest = getIntentHash(chainBatches);

    const signature = await user.signMessage({
        message: { raw: digest },
    });

    // User signs an authorization for Sepolia
    const userAuthSource = await user.signAuthorization({
        address: SEPOLIA_DELEGATE,
        chainId: sepolia.id,
        nonce: await sourceClient.getTransactionCount(user),
    });

    // User signs another authorization for baseCampTestnet
    const userAuthDestination = await user.signAuthorization({
        address: BASECAMP_DELEGATE,
        chainId: bct.id,
        nonce: await destinationClient.getTransactionCount(user),
    });

    const solverAuthSource = await solver.signAuthorization({
        address: SEPOLIA_DELEGATE,
        chainId: sepolia.id,
        nonce: await sourceClient.getTransactionCount(solver) + 1,
    });

    const solverAuthDestination = await solver.signAuthorization({
        address: BASECAMP_DELEGATE,
        chainId: bct.id,
        nonce: await destinationClient.getTransactionCount(solver) + 1,
    });

    await waitForBlock(sourceClient, recentBlockSepolia).then(() => console.log("Source chain wait complete"));

    const sourceChainTx = await sourceWalletClient.writeContract({
        gas: 3000000n,
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

    await waitForBlock(destinationClient, recentBlockBaseCamp + 8n).then(() => console.log("Destination chain wait complete"));

    const destinationChainTx = await destinationWalletClient.writeContract({
        gas: 3000000n,
        authorizationList: [solverAuthDestination, userAuthDestination],
        address: solver.address,
        abi: DELEGATE_ABI,
        account: solver,
        functionName: "selfExecute",
        // args: [
        //     [
        //         {
        //             to: SMART_ROUTER_ADDRESS as Address,
        //             value: nativeValue,
        //             data: methodParameters.calldata,
        //         }
        //     ]
        // ]
        args: [
            [
                // {
                //     to: user.address,
                //     data: "0x",
                //     value: nativeValue + gasFee,
                // },
                {
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
                }
            ]
        ]
    }) as Hash;

    await destinationClient.waitForTransactionReceipt({ hash: destinationChainTx });
    console.log("Destination chain tx:", destinationChainTx);
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
