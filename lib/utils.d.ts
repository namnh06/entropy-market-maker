import { Account, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { EntropyAccount, EntropyClient, EntropyGroup } from '@friktion-labs/entropy-client';
export declare function loadEntropyAccountWithName(client: EntropyClient, entropyGroup: EntropyGroup, payer: Account, entropyAccountName: string): Promise<EntropyAccount>;
export declare function loadEntropyAccountWithPubkey(client: EntropyClient, entropyGroup: EntropyGroup, payer: Account, entropyAccountPk: PublicKey): Promise<EntropyAccount>;
export declare const seqEnforcerProgramId: PublicKey;
export declare function makeInitSequenceInstruction(sequenceAccount: PublicKey, ownerPk: PublicKey, bump: number, sym: string): TransactionInstruction;
export declare function makeCheckAndSetSequenceNumberInstruction(sequenceAccount: PublicKey, ownerPk: PublicKey, seqNum: number): TransactionInstruction;
//# sourceMappingURL=utils.d.ts.map