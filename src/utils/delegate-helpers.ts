import {
    Abi,
    AbiParameter,
    Address,
    Authorization,
    encodeAbiParameters,
    Hash,
    Hex,
    keccak256,
    PublicClient,
    WalletClient,
} from "viem";

export type Call =
    | never
    | {
        to: Address;
        value: bigint;
        data: Hex;
    };

export const CallAbi = {
    type: "tuple",
    components: [
        { name: "to", type: "address" },
        { name: "value", type: "uint" },
        { name: "data", type: "bytes" },
    ],
} as const;

export interface ChainBatchInput {
    chainId: bigint | number;
    calls: Call[];
    recentBlock: bigint | number;
}

export type ChainBatch =
    | never
    | {
        hash: Hash;
        chainId: bigint;
        calls: Call[];
        recentBlock: bigint;
    };

export const ChainAuthorizationSignatureComponentsAbi = [
    { name: "chainId", type: "uint256" },
    { name: "calls", ...CallAbi, type: "tuple[]" },
    { name: "recentBlock", type: "uint256" },
] as const;

export const ChainAuthorizationAbi = {
    type: "tuple",
    components: [
        { name: "hash", type: "bytes32" },
        ...ChainAuthorizationSignatureComponentsAbi,
    ],
} as const;

// export interface Authorization {
//     address: string;
//     chainId: number;
//     nonce: number;
//     r: string;
//     s: string;
//     yParity: number;
// }

export const AuthorizationAbi: AbiParameter = {
    type: "tuple",
    components: [
        { name: "signature", type: "bytes" },
        { name: "chainAuthorizations", ...ChainAuthorizationAbi, type: "tuple[]" },
    ],
};

export interface DelegateSigningMessage {
    address: Address;
    chainId: number;
    nonce: number;
    [key: string]: unknown;
}

export interface CallObject {
    address?: Address;
    abi?: Abi;
    functionName?: string;
    args?: unknown[];
    value?: number;
    authorizationList?: Authorization[];
    error?: string;
}

export interface IntentObject {
    destinationCall: CallObject;
    sourceCall: CallObject;
    destinationChainId: number;
    destinationTokenAddress: Address;
    destinationTokenAmount: number;
    sourceChainId: number;
    sourceTokenAddress: Address;
    sourceTokenAmount: number;
}

export interface DelegationState {
    isDelegated: boolean;
    isLoading: boolean;
    error?: string;
}

export interface DelegationConfig {
    delegateContractAddress: Address;
    sourceChainId: number;
    destinationChainId: number;
    universalAuth?: {
        chainId: number;
        nonce: number;
    };
}

export interface TxSubmitRequest {
    authorization: Authorization[];
    intentAuthorization: {
        signature: string;
        chainBatches: Array<{
            hash: string;
            chainId: bigint;
            calls: Call[];
            recentBlock: bigint;
        }>;
    };
}

export interface TxSubmitResponse {
    hash: string;
    intentId: string;
}

export function hashChainBatches(
    chainCalls: ChainBatchInput[],
): ChainBatch[] {
    return chainCalls.map(({ chainId, calls, recentBlock }) => {
        chainId = BigInt(chainId);
        recentBlock = BigInt(recentBlock);

        const hash = keccak256(
            encodeAbiParameters(ChainAuthorizationSignatureComponentsAbi, [
                chainId,
                calls,
                recentBlock,
            ]),
        );

        return {
            hash,
            chainId,
            calls,
            recentBlock,
        };
    });
}

export function getIntentHash(
    chainAuthorizations: ChainBatch[],
): Hash {
    const chainAuthorizationHashes = chainAuthorizations.map(({ hash }) => hash);
    return keccak256(
        encodeAbiParameters([{ type: "bytes32[]" }], [chainAuthorizationHashes]),
    );
}

// export async function signDelegation(
//   walletClient: WalletClient,
//   address: Address,
//   chainId: number,
//   delegateContractAddress: Address,
// ): Promise<Authorization> {
//   const publicClient = getPublicClient({ chainId });
//   const nonce = await getAccountNonce(address, publicClient);

//   const domain = {
//     name: "Authorization",
//     version: "1",
//     chainId: BigInt(chainId),
//     verifyingContract: delegateContractAddress,
//   } as const;

//   const types = {
//     Authorization: [
//       { name: "contractAddress", type: "address" },
//       { name: "chainId", type: "uint256" },
//       { name: "nonce", type: "uint256" },
//     ],
//   } as const;

//   const message = {
//     contractAddress: delegateContractAddress,
//     chainId: BigInt(chainId),
//     nonce: BigInt(nonce),
//   } as const;

//   const signature = await walletClient.signTypedData({
//     account: address,
//     domain,
//     types,
//     primaryType: "Authorization",
//     message,
//   });

//   const authorization = {
//     address: address.toString(),
//     chainId: Number(chainId),
//     nonce: Number(nonce),
//     r: signature.slice(0, 66) as `0x${string}`,
//     s: `0x${signature.slice(66, 130)}` as `0x${string}`,
//     yParity: parseInt(signature.slice(130, 132), 16) as 0 | 1,
//   };

//   return authorization;
// }

export async function submitTransaction(
    request: TxSubmitRequest,
): Promise<TxSubmitResponse> {
    try {
        const response = await fetch(`${process.env.TX_SUBMISSION_API}/transaction/submit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(request, (key, value) =>
                typeof value === 'bigint' ? value.toString() : value
            ),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Relayer API error: ${response.status} - ${errorText}`);
        }

        const result = await response.json() as TxSubmitResponse;
        return {
            hash: result.hash,
            intentId: result.intentId || request.intentAuthorization.signature,
        };
    } catch (error) {
        console.error('Error submitting transaction to relayer:', error);
        throw error;
    }
}