"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const web3_js_1 = require("@solana/web3.js");
const os_1 = __importDefault(require("os"));
const entropy_client_1 = require("@friktion-labs/entropy-client");
const utils_1 = require("./utils");
const pubkey_1 = require("@project-serum/anchor/dist/cjs/utils/pubkey");
const seqEnforcerProgramId = new web3_js_1.PublicKey('GDDMwNyyx8uB6zrqwBFHjLLG3TBYk2F8Az4yrQC5RzMp');
async function scratch() {
    const connection = new web3_js_1.Connection(process.env.ENDPOINT_URL || '', 'processed');
    const payer = new web3_js_1.Account(JSON.parse((0, fs_1.readFileSync)(process.env.KEYPAIR || os_1.default.homedir() + '/.config/solana/id.json', 'utf-8')));
    const config = new entropy_client_1.Config(entropy_client_1.IDS);
    const groupIds = config.getGroupWithName('mainnet.1');
    if (!groupIds) {
        throw new Error(`Group ${'mainnet.1'} not found`);
    }
    const entropyProgramId = groupIds.entropyProgramId;
    const sym = 'LUNA-PERP';
    const [sequenceAccount, bump] = (0, pubkey_1.findProgramAddressSync)([new Buffer(sym, 'utf-8'), payer.publicKey.toBytes()], seqEnforcerProgramId);
    console.log(payer.publicKey.toString());
    const client = new entropy_client_1.EntropyClient(connection, entropyProgramId);
    const tx = new web3_js_1.Transaction();
    const instr = (0, utils_1.makeInitSequenceInstruction)(sequenceAccount, payer.publicKey, bump, sym);
    tx.add(instr);
    tx.add((0, utils_1.makeCheckAndSetSequenceNumberInstruction)(sequenceAccount, payer.publicKey, Math.round((0, entropy_client_1.getUnixTs)() * 1000)));
    const txid = await client.sendTransaction(tx, payer, []);
    console.log(txid.toString());
}
scratch();
//# sourceMappingURL=scratch.js.map