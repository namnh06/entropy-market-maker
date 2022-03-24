"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeCheckAndSetSequenceNumberInstruction = exports.makeInitSequenceInstruction = exports.seqEnforcerProgramId = exports.loadEntropyAccountWithPubkey = exports.loadEntropyAccountWithName = void 0;
const web3_js_1 = require("@solana/web3.js");
const crypto_1 = require("crypto");
const bn_js_1 = require("bn.js");
async function loadEntropyAccountWithName(client, entropyGroup, payer, entropyAccountName) {
    const ownerAccounts = await client.getEntropyAccountsForOwner(entropyGroup, payer.publicKey, true);
    for (const ownerAccount of ownerAccounts) {
        if (entropyAccountName === ownerAccount.name) {
            return ownerAccount;
        }
    }
    throw new Error(`entropyAccountName: ${entropyAccountName} not found`);
}
exports.loadEntropyAccountWithName = loadEntropyAccountWithName;
async function loadEntropyAccountWithPubkey(client, entropyGroup, payer, entropyAccountPk) {
    const entropyAccount = await client.getEntropyAccount(entropyAccountPk, entropyGroup.dexProgramId);
    if (!entropyAccount.owner.equals(payer.publicKey)) {
        throw new Error(`Invalid EntropyAccount owner: ${entropyAccount.owner.toString()}; expected: ${payer.publicKey.toString()}`);
    }
    return entropyAccount;
}
exports.loadEntropyAccountWithPubkey = loadEntropyAccountWithPubkey;
exports.seqEnforcerProgramId = new web3_js_1.PublicKey('GDDMwNyyx8uB6zrqwBFHjLLG3TBYk2F8Az4yrQC5RzMp');
function makeInitSequenceInstruction(sequenceAccount, ownerPk, bump, sym) {
    const keys = [
        { isSigner: false, isWritable: true, pubkey: sequenceAccount },
        { isSigner: true, isWritable: true, pubkey: ownerPk },
        { isSigner: false, isWritable: false, pubkey: web3_js_1.SystemProgram.programId },
    ];
    const variant = (0, crypto_1.createHash)('sha256')
        .update('global:initialize')
        .digest()
        .slice(0, 8);
    const bumpData = new bn_js_1.BN(bump).toBuffer('le', 1);
    const strLen = new bn_js_1.BN(sym.length).toBuffer('le', 4);
    const symEncoded = Buffer.from(sym);
    const data = Buffer.concat([variant, bumpData, strLen, symEncoded]);
    return new web3_js_1.TransactionInstruction({
        keys,
        data,
        programId: exports.seqEnforcerProgramId,
    });
}
exports.makeInitSequenceInstruction = makeInitSequenceInstruction;
function makeCheckAndSetSequenceNumberInstruction(sequenceAccount, ownerPk, seqNum) {
    const keys = [
        { isSigner: false, isWritable: true, pubkey: sequenceAccount },
        { isSigner: true, isWritable: false, pubkey: ownerPk },
    ];
    const variant = (0, crypto_1.createHash)('sha256')
        .update('global:check_and_set_sequence_number')
        .digest()
        .slice(0, 8);
    const seqNumBuffer = new bn_js_1.BN(seqNum).toBuffer('le', 8);
    const data = Buffer.concat([variant, seqNumBuffer]);
    return new web3_js_1.TransactionInstruction({
        keys,
        data,
        programId: exports.seqEnforcerProgramId,
    });
}
exports.makeCheckAndSetSequenceNumberInstruction = makeCheckAndSetSequenceNumberInstruction;
//# sourceMappingURL=utils.js.map