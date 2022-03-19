import {
  Account,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  EntropyAccount,
  EntropyClient,
  EntropyGroup,
} from '@friktion-labs/entropy-client';
import { findProgramAddressSync } from '@project-serum/anchor/dist/cjs/utils/pubkey';
import {
  blob,
  Blob,
  greedy,
  Layout,
  nu64,
  seq,
  struct,
  Structure,
  u16,
  u32,
  u8,
  UInt,
  union,
  Union,
} from 'buffer-layout';
import fs, { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { BN } from 'bn.js';

export async function loadEntropyAccountWithName(
  client: EntropyClient,
  entropyGroup: EntropyGroup,
  payer: Account,
  entropyAccountName: string,
): Promise<EntropyAccount> {
  const ownerAccounts = await client.getEntropyAccountsForOwner(
    entropyGroup,
    payer.publicKey,
    true,
  );

  for (const ownerAccount of ownerAccounts) {
    if (entropyAccountName === ownerAccount.name) {
      return ownerAccount;
    }
  }
  throw new Error(`entropyAccountName: ${entropyAccountName} not found`);
}

export async function loadEntropyAccountWithPubkey(
  client: EntropyClient,
  entropyGroup: EntropyGroup,
  payer: Account,
  entropyAccountPk: PublicKey,
): Promise<EntropyAccount> {
  const entropyAccount = await client.getEntropyAccount(
    entropyAccountPk,
    entropyGroup.dexProgramId,
  );

  if (!entropyAccount.owner.equals(payer.publicKey)) {
    throw new Error(
      `Invalid EntropyAccount owner: ${entropyAccount.owner.toString()}; expected: ${payer.publicKey.toString()}`,
    );
  }
  return entropyAccount;
}
export const seqEnforcerProgramId = new PublicKey(
  'GDDMwNyyx8uB6zrqwBFHjLLG3TBYk2F8Az4yrQC5RzMp',
);

export function makeInitSequenceInstruction(
  sequenceAccount: PublicKey,
  ownerPk: PublicKey,
  bump: number,
  sym: string,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: sequenceAccount },
    { isSigner: true, isWritable: true, pubkey: ownerPk },
    { isSigner: false, isWritable: false, pubkey: SystemProgram.programId },
  ];

  const variant = createHash('sha256')
    .update('global:initialize')
    .digest()
    .slice(0, 8);

  const bumpData = new BN(bump).toBuffer('le', 1);
  const strLen = new BN(sym.length).toBuffer('le', 4);
  const symEncoded = Buffer.from(sym);

  const data = Buffer.concat([variant, bumpData, strLen, symEncoded]);

  return new TransactionInstruction({
    keys,
    data,
    programId: seqEnforcerProgramId,
  });
}

export function makeCheckAndSetSequenceNumberInstruction(
  sequenceAccount: PublicKey,
  ownerPk: PublicKey,
  seqNum: number,
): TransactionInstruction {
  const keys = [
    { isSigner: false, isWritable: true, pubkey: sequenceAccount },
    { isSigner: true, isWritable: false, pubkey: ownerPk },
  ];
  const variant = createHash('sha256')
    .update('global:check_and_set_sequence_number')
    .digest()
    .slice(0, 8);

  const seqNumBuffer = new BN(seqNum).toBuffer('le', 8);
  const data = Buffer.concat([variant, seqNumBuffer]);
  return new TransactionInstruction({
    keys,
    data,
    programId: seqEnforcerProgramId,
  });
}
