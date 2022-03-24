"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const web3_js_1 = require("@solana/web3.js");
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const bn_js_1 = require("bn.js");
const entropy_client_1 = require("@friktion-labs/entropy-client");
const serum_1 = require("@project-serum/serum");
const path_1 = __importDefault(require("path"));
const utils_1 = require("./utils");
const tardis_dev_1 = require("tardis-dev");
const pubkey_1 = require("@project-serum/anchor/dist/cjs/utils/pubkey");
// File containing info of serum markets being quoted
const IDS_json_1 = __importDefault(require("./IDS.json"));
const decimal_js_1 = __importDefault(require("decimal.js"));
// Custom quote parameters
const paramsFileName = process.env.PARAMS || 'powerperp_params.json';
const params = JSON.parse(fs_1.default.readFileSync(path_1.default.resolve(__dirname, `../params/${paramsFileName}`), 'utf-8'));
// Path to keypair
const payer = new web3_js_1.Account(JSON.parse(fs_1.default.readFileSync(process.env.KEYPAIR || os_1.default.homedir() + '/.config/solana/entropy-mainnet-authority.json', 'utf-8')));
// Read market addresses from entropy client repo. 
const config = new entropy_client_1.Config(IDS_json_1.default);
const groupIds = config.getGroupWithName(params.group);
if (!groupIds) {
    throw new Error(`Group ${params.group} not found`);
}
const cluster = groupIds.cluster;
const entropyProgramId = groupIds.entropyProgramId;
const entropyGroupKey = groupIds.publicKey;
const control = { isRunning: true, interval: params.interval };
function getRandomNumber(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.random() * (max - min + 1) + min;
}
/**
 * Periodically fetch the Entropy account and market state
 */
async function listenAccountAndMarketState(connection, group, state, stateRefreshInterval) {
    while (control.isRunning) {
        try {
            const inBasketOpenOrders = state.entropyAccount
                .getOpenOrdersKeysInBasket()
                .filter((pk) => !pk.equals(entropy_client_1.zeroKey));
            const allAccounts = [
                group.entropyCache,
                state.entropyAccount.publicKey,
                ...inBasketOpenOrders,
                ...state.marketContexts.map((marketContext) => marketContext.market.bids),
                ...state.marketContexts.map((marketContext) => marketContext.market.asks),
            ];
            const ts = (0, entropy_client_1.getUnixTs)() / 1000;
            const accountInfos = await (0, entropy_client_1.getMultipleAccounts)(connection, allAccounts);
            const cache = new entropy_client_1.EntropyCache(accountInfos[0].publicKey, entropy_client_1.EntropyCacheLayout.decode(accountInfos[0].accountInfo.data));
            const entropyAccount = new entropy_client_1.EntropyAccount(accountInfos[1].publicKey, entropy_client_1.EntropyAccountLayout.decode(accountInfos[1].accountInfo.data));
            const openOrdersAis = accountInfos.slice(2, 2 + inBasketOpenOrders.length);
            for (let i = 0; i < openOrdersAis.length; i++) {
                const ai = openOrdersAis[i];
                const marketIndex = entropyAccount.spotOpenOrders.findIndex((soo) => soo.equals(ai.publicKey));
                entropyAccount.spotOpenOrdersAccounts[marketIndex] =
                    serum_1.OpenOrders.fromAccountInfo(ai.publicKey, ai.accountInfo, group.dexProgramId);
            }
            accountInfos
                .slice(2 + inBasketOpenOrders.length, 2 + inBasketOpenOrders.length + state.marketContexts.length)
                .forEach((ai, i) => {
                state.marketContexts[i].bids = new entropy_client_1.BookSide(ai.publicKey, state.marketContexts[i].market, entropy_client_1.BookSideLayout.decode(ai.accountInfo.data));
            });
            accountInfos
                .slice(2 + inBasketOpenOrders.length + state.marketContexts.length, 2 + inBasketOpenOrders.length + 2 * state.marketContexts.length)
                .forEach((ai, i) => {
                state.marketContexts[i].lastBookUpdate = ts;
                state.marketContexts[i].asks = new entropy_client_1.BookSide(ai.publicKey, state.marketContexts[i].market, entropy_client_1.BookSideLayout.decode(ai.accountInfo.data));
            });
            state.entropyAccount = entropyAccount;
            state.cache = cache;
        }
        catch (e) {
            console.error(`${new Date().getUTCDate().toString()} failed when loading state`, e);
        }
        finally {
            await (0, entropy_client_1.sleep)(stateRefreshInterval);
        }
    }
}
/**
 * Load oracle price cache, account info and Bids and Asks for all perp markets using only
 * one RPC call.
 */
async function loadAccountAndMarketState(connection, group, oldEntropyAccount, marketContexts) {
    const inBasketOpenOrders = oldEntropyAccount
        .getOpenOrdersKeysInBasket()
        .filter((pk) => !pk.equals(entropy_client_1.zeroKey));
    const allAccounts = [
        group.entropyCache,
        oldEntropyAccount.publicKey,
        ...inBasketOpenOrders,
        ...marketContexts.map((marketContext) => marketContext.market.bids),
        ...marketContexts.map((marketContext) => marketContext.market.asks),
    ];
    const ts = (0, entropy_client_1.getUnixTs)() / 1000;
    const accountInfos = await (0, entropy_client_1.getMultipleAccounts)(connection, allAccounts);
    const cache = new entropy_client_1.EntropyCache(accountInfos[0].publicKey, entropy_client_1.EntropyCacheLayout.decode(accountInfos[0].accountInfo.data));
    const entropyAccount = new entropy_client_1.EntropyAccount(accountInfos[1].publicKey, entropy_client_1.EntropyAccountLayout.decode(accountInfos[1].accountInfo.data));
    const openOrdersAis = accountInfos.slice(2, 2 + inBasketOpenOrders.length);
    for (let i = 0; i < openOrdersAis.length; i++) {
        const ai = openOrdersAis[i];
        const marketIndex = entropyAccount.spotOpenOrders.findIndex((soo) => soo.equals(ai.publicKey));
        entropyAccount.spotOpenOrdersAccounts[marketIndex] =
            serum_1.OpenOrders.fromAccountInfo(ai.publicKey, ai.accountInfo, group.dexProgramId);
    }
    accountInfos
        .slice(2 + inBasketOpenOrders.length, 2 + inBasketOpenOrders.length + marketContexts.length)
        .forEach((ai, i) => {
        marketContexts[i].bids = new entropy_client_1.BookSide(ai.publicKey, marketContexts[i].market, entropy_client_1.BookSideLayout.decode(ai.accountInfo.data));
    });
    accountInfos
        .slice(2 + inBasketOpenOrders.length + marketContexts.length, 2 + inBasketOpenOrders.length + 2 * marketContexts.length)
        .forEach((ai, i) => {
        marketContexts[i].lastBookUpdate = ts;
        marketContexts[i].asks = new entropy_client_1.BookSide(ai.publicKey, marketContexts[i].market, entropy_client_1.BookSideLayout.decode(ai.accountInfo.data));
    });
    return {
        cache,
        entropyAccount,
        marketContexts,
    };
}
/**
 * Long running service that keeps FTX perp books updated via websocket using Tardis
 */
async function listenFtxBooks(marketContexts) {
    // console.log('listen ftx books')
    const symbolToContext = Object.fromEntries(marketContexts.map((mc) => [mc.marketName, mc]));
    const messages = (0, tardis_dev_1.streamNormalized)({
        exchange: 'ftx',
        symbols: marketContexts.map((mc) => mc.marketName),
    }, tardis_dev_1.normalizeTrades, tardis_dev_1.normalizeBookChanges);
    for await (const msg of messages) {
        if (msg.type === 'book_change') {
            symbolToContext[msg.symbol].tardisBook.update(msg);
            symbolToContext[msg.symbol].lastTardisUpdate =
                msg.timestamp.getTime() / 1000;
        }
    }
}
/**
 * Long running service that keeps FTX perp funding rates updated via websocket using Tardis
 */
async function listenFtxFundingRates(marketContexts) {
    // console.log('listen ftx funding rates')
    const symbolToContext = Object.fromEntries(marketContexts.map((mc) => [mc.marketName, mc]));
    const messages = (0, tardis_dev_1.streamNormalized)({
        exchange: 'ftx',
        symbols: marketContexts.map((mc) => mc.marketName),
    }, tardis_dev_1.normalizeDerivativeTickers);
    for await (const msg of messages) {
        if (msg.type === 'derivative_ticker' && msg.fundingRate !== undefined) {
            symbolToContext[msg.symbol].fundingRate = msg.fundingRate;
            symbolToContext[msg.symbol].lastTardisFundingRateUpdate =
                msg.timestamp.getTime() / 1000;
        }
    }
}
async function fullMarketMaker() {
    console.log(new Date().toISOString(), "Loading Market Making Params", params);
    console.log(new Date().toISOString(), "Establishing Client Connection...");
    const connection = new web3_js_1.Connection(process.env.ENDPOINT_URL || config.cluster_urls[cluster], 'processed');
    const client = new entropy_client_1.EntropyClient(connection, entropyProgramId);
    console.log(new Date().toISOString(), "Client Connection Established...");
    // load group
    console.log(new Date().toISOString(), "Loading Entropy Market Groups...");
    const entropyGroup = await client.getEntropyGroup(entropyGroupKey);
    console.log(new Date().toISOString(), "Loading Entropy Account Details...");
    // load entropyAccount
    let entropyAccount;
    if (params.entropyAccountName) {
        entropyAccount = await (0, utils_1.loadEntropyAccountWithName)(client, entropyGroup, payer, params.entropyAccountName);
    }
    else if (params.entropyAccountPubkey) {
        entropyAccount = await (0, utils_1.loadEntropyAccountWithPubkey)(client, entropyGroup, payer, new web3_js_1.PublicKey(params.entropyAccountPubkey));
    }
    else {
        throw new Error('Please add entropyAccountName or entropyAccountPubkey to params file');
    }
    const perpMarkets = [];
    const marketContexts = [];
    let btcMarketContext = null;
    ;
    let btcIVMarketContext = null;
    ;
    for (const baseSymbol in params.assets) {
        console.log(new Date().toISOString(), 'Spinning market for: ', baseSymbol);
        const perpMarketConfig = (0, entropy_client_1.getPerpMarketByBaseSymbol)(groupIds, baseSymbol);
        const [sequenceAccount, sequenceAccountBump] = (0, pubkey_1.findProgramAddressSync)([new Buffer(perpMarketConfig.name, 'utf-8'), payer.publicKey.toBytes()], utils_1.seqEnforcerProgramId);
        const perpMarket = await client.getPerpMarket(perpMarketConfig.publicKey, perpMarketConfig.baseDecimals, perpMarketConfig.quoteDecimals);
        perpMarkets.push(perpMarket);
        marketContexts.push({
            marketName: perpMarketConfig.name,
            params: params.assets[baseSymbol].perp,
            config: perpMarketConfig,
            market: perpMarket,
            marketIndex: perpMarketConfig.marketIndex,
            bids: await perpMarket.loadBids(connection),
            asks: await perpMarket.loadAsks(connection),
            lastBookUpdate: 0,
            tardisBook: new TardisBook(),
            lastTardisUpdate: 0,
            sequenceAccount,
            sequenceAccountBump,
            sentBidPrice: 0,
            sentAskPrice: 0,
            lastOrderUpdate: 0,
            fundingRate: 0,
            lastTardisFundingRateUpdate: 0,
        });
        if (baseSymbol === 'BTC') {
            btcMarketContext = marketContexts[marketContexts.length - 1];
        }
        if (baseSymbol === 'BTC_1D_IV') {
            btcIVMarketContext = marketContexts[marketContexts.length - 1];
        }
    }
    // Initialize all the sequence accounts
    const seqAccInstrs = marketContexts.map((mc) => (0, utils_1.makeInitSequenceInstruction)(mc.sequenceAccount, payer.publicKey, mc.sequenceAccountBump, mc.marketName));
    const seqAccTx = new web3_js_1.Transaction();
    seqAccTx.add(...seqAccInstrs);
    const seqAccTxid = await client.sendTransaction(seqAccTx, payer, [], undefined, undefined, "Init tx for all markets");
    const state = await loadAccountAndMarketState(connection, entropyGroup, entropyAccount, marketContexts);
    const stateRefreshInterval = params.stateRefreshInterval || 5000;
    listenAccountAndMarketState(connection, entropyGroup, state, stateRefreshInterval);
    const listenableMarketContexts = marketContexts.filter((context) => {
        // console.log(context.params['disableFtxBook']);
        // console.log(context.params);
        return !(context.params.disableFtxBook || false);
    });
    // console.log('listenable market contexts: ', listenableMarketContexts.map((context) => context.marketName));
    listenFtxBooks(listenableMarketContexts);
    listenFtxFundingRates(listenableMarketContexts);
    process.on('SIGINT', function () {
        console.log('Caught keyboard interrupt. Canceling orders');
        control.isRunning = false;
        onExit(client, payer, entropyGroup, entropyAccount, marketContexts);
    });
    while (control.isRunning) {
        try {
            entropyAccount = state.entropyAccount;
            let j = 0;
            let tx = new web3_js_1.Transaction();
            for (let i = 0; i < marketContexts.length; i++) {
                const perpMarket = perpMarkets[i];
                // marketContexts[i].bids = await perpMarket.loadBids(connection);
                // marketContexts[i].asks = await perpMarket.loadAsks(connection);
                let ftxBook = marketContexts[i].tardisBook;
                let ftxFundingRate = marketContexts[i].fundingRate;
                let IVFundingOffset = 0;
                // console.log('market name: ', marketContexts[i].marketName);
                if (marketContexts[i].marketName === "BTC^2-PERP") {
                    if (btcMarketContext === null) {
                        throw new Error("btc market context is null");
                    }
                    if (btcIVMarketContext === null) {
                        throw new Error("btc IV market context is null");
                    }
                    const instrSet = makeMarketUpdateInstructions(entropyGroup, state.cache, entropyAccount, marketContexts[i], btcMarketContext, btcIVMarketContext);
                    if (instrSet.length > 0) {
                        instrSet.forEach((ix) => tx.add(ix));
                        j++;
                        if (j === params.batch) {
                            client.sendTransaction(tx, payer, [], undefined, undefined, `${marketContexts[i].marketName} market update tx`);
                            tx = new web3_js_1.Transaction();
                            j = 0;
                        }
                    }
                }
            }
            if (tx.instructions.length) {
                // console.log('sending alternative market update transaction');
                client.sendTransaction(tx, payer, [], null, undefined, 'Updating all markets');
            }
        }
        catch (e) {
            console.log(e);
        }
        finally {
            await (0, entropy_client_1.sleep)(control.interval);
        }
    }
}
class TardisBook extends tardis_dev_1.OrderBook {
    getSizedBestBid(quoteSize) {
        let rem = quoteSize;
        for (const bid of this.bids()) {
            rem -= bid.amount * bid.price;
            if (rem <= 0) {
                return bid.price;
            }
        }
        return undefined;
    }
    getSizedBestAsk(quoteSize) {
        let rem = quoteSize;
        for (const ask of this.asks()) {
            rem -= ask.amount * ask.price;
            if (rem <= 0) {
                return ask.price;
            }
        }
        return undefined;
    }
}
function calcFundingFromIV(IVoraclePrice, days) {
    return (IVoraclePrice / 100) ** 2 / 365 * days;
}
function makeMarketUpdateInstructions(group, cache, entropyAccount, marketContext, btcMarketContext, btcIVMarketContext) {
    // Right now only uses the perp
    const marketIndex = marketContext.marketIndex;
    const market = marketContext.market;
    const bids = marketContext.bids;
    const asks = marketContext.asks;
    const ftxBook = btcMarketContext.tardisBook;
    const ftxFundingRate = btcMarketContext.fundingRate;
    // Load implied vol oracle price from the cache.
    const impliedVolMarketIndex = 2;
    const IVoracleCache = cache.priceCache[impliedVolMarketIndex];
    const IVoraclePriceI8048 = IVoracleCache.price;
    const IVoraclePrice = IVoraclePriceI8048.toNumber();
    // console.log("BTC_1D_IV Oracle Price: ", IVoraclePrice);
    const IVFundingOffset = calcFundingFromIV(IVoraclePrice, 7);
    // console.log("IVFundingOffset Oracle Price: ", IVFundingOffset);
    const oracleCache = cache.priceCache[marketIndex];
    const oraclePriceI8048 = oracleCache.price;
    const oraclePrice = group.cachePriceToUi(oraclePriceI8048, marketIndex);
    const lastUpdate = oracleCache.lastUpdate;
    // console.log('oracle price: ', oraclePrice.toString());
    // console.log('last update: ', lastUpdate.toString());
    let ftxBid = ftxBook.getSizedBestBid(marketContext.params.ftxSize || 100000);
    let ftxAsk = ftxBook.getSizedBestAsk(marketContext.params.ftxSize || 100000);
    let ftxFunding = ftxFundingRate || 0.0;
    if (ftxBid === undefined || ftxAsk === undefined) {
        // TODO deal with this better; probably cancel all if there are any orders open
        // console.log(`${marketContext.marketName} No FTX book`);
        // console.log('market index: ', oraclePrice);
        // return [];
        ftxBid = new decimal_js_1.default(oraclePrice).sub(0.01 * oraclePrice).toNumber();
        ftxAsk = new decimal_js_1.default(oraclePrice).add(0.01 * oraclePrice).toNumber();
    }
    // For BTC^2, squre BTC Price and normalize
    if (marketContext.marketName === "BTC^2-PERP") {
        ftxBid = new decimal_js_1.default(ftxBid).pow(2).toNumber() / 1000000;
        ftxAsk = new decimal_js_1.default(ftxAsk).pow(2).toNumber() / 1000000;
        ftxFunding = new decimal_js_1.default(ftxFundingRate).toNumber();
    }
    else {
    }
    const fairBid = ftxBid;
    const fairAsk = ftxAsk;
    const fairValue = (fairBid + fairBid) / 2;
    const ftxSpread = (fairAsk - fairBid) / fairValue;
    const equity = entropyAccount.computeValue(group, cache).toNumber();
    const perpAccount = entropyAccount.perpAccounts[marketIndex];
    // TODO look at event queue as well for unprocessed fills
    const basePos = perpAccount.getBasePositionUi(market);
    const fundingBias = ftxFunding || 0;
    const sizePerc = marketContext.params.sizePerc;
    const leanCoeff = marketContext.params.leanCoeff;
    const edge = (marketContext.params.edge || 0.0015) + ftxSpread / 2;
    const bias = marketContext.params.bias;
    const requoteThresh = marketContext.params.requoteThresh;
    const takeSpammers = marketContext.params.takeSpammers;
    const spammerCharge = marketContext.params.spammerCharge;
    const size = (equity * sizePerc) / fairValue;
    const lean = 0; //(-leanCoeff * basePos) / size;
    // console.log('equity: ', equity.toString()); 
    // console.log(new Date().toISOString(), `${marketContext.marketName} virginBid: `, fairBid);
    // console.log(new Date().toISOString(), `${marketContext.marketName} virginAsk: `, fairAsk);
    // console.log('FTX spread: ', ftxSpread);
    console.log(new Date().toISOString(), `${marketContext.marketName} basePos: `, basePos);
    console.log(new Date().toISOString(), `${marketContext.marketName} lean_adjust: `, lean);
    if (marketContext.marketName === "BTC^2-PERP") {
        console.log(new Date().toISOString(), `${marketContext.marketName} Variance Funding Adjust: `, IVFundingOffset);
        console.log(new Date().toISOString(), `${marketContext.marketName} Implied Volatility: `, (IVFundingOffset * 52) ** 0.5 * 100);
    }
    let bidPrice = fairValue * (1 - edge + lean + bias + IVFundingOffset);
    let askPrice = fairValue * (1 + edge + lean + bias + IVFundingOffset);
    let [modelBidPrice, nativeBidSize] = market.uiToNativePriceQuantity(bidPrice, size);
    let [modelAskPrice, nativeAskSize] = market.uiToNativePriceQuantity(askPrice, size);
    // console.log('native bid size = ', nativeBidSize.toString());
    // console.log('native ask size = ', nativeAskSize.toString());
    const bestBid = bids.getBest();
    const bestAsk = asks.getBest();
    // console.log('Entropy best bid : ', bestBid?.price.toString(), ', Entropy best ask: ', bestAsk?.price.toString() );
    const bookAdjBid = bestAsk !== undefined
        ? bn_js_1.BN.min(bestAsk.priceLots.sub(entropy_client_1.ONE_BN), modelBidPrice)
        : modelBidPrice;
    const bookAdjAsk = bestBid !== undefined
        ? bn_js_1.BN.max(bestBid.priceLots.add(entropy_client_1.ONE_BN), modelAskPrice)
        : modelAskPrice;
    console.log(new Date().toISOString(), `${marketContext.marketName} model bid: `, modelBidPrice.toString(), 'model ask: ', modelAskPrice.toString(), 'oracle px: ', new decimal_js_1.default(oraclePrice));
    // console.log('model bid: ', modelBidPrice.toString(), ', model ask: ', modelAskPrice.toString());
    // TODO use order book to requote if size has changed
    let moveOrders = false;
    if (marketContext.lastBookUpdate >= marketContext.lastOrderUpdate) {
        // if entropy book was updated recently, then EntropyAccount was also updated
        const openOrders = entropyAccount
            .getPerpOpenOrders()
            .filter((o) => o.marketIndex === marketIndex);
        moveOrders = openOrders.length < 2 || openOrders.length > 2;
        for (const o of openOrders) {
            const refPrice = o.side === 'buy' ? bookAdjBid : bookAdjAsk;
            moveOrders =
                moveOrders ||
                    Math.abs(o.price.toNumber() / refPrice.toNumber() - 1) > requoteThresh;
        }
    }
    else {
        // If order was updated before EntropyAccount, then assume that sent order already executed
        moveOrders =
            moveOrders ||
                Math.abs(marketContext.sentBidPrice / bookAdjBid.toNumber() - 1) >
                    requoteThresh ||
                Math.abs(marketContext.sentAskPrice / bookAdjAsk.toNumber() - 1) >
                    requoteThresh;
    }
    // Start building the transaction
    const instructions = [
        (0, utils_1.makeCheckAndSetSequenceNumberInstruction)(marketContext.sequenceAccount, payer.publicKey, Math.round((0, entropy_client_1.getUnixTs)() * 1000)),
    ];
    /*
    Clear 1 lot size orders at the top of book that bad people use to manipulate the price
     */
    if (takeSpammers &&
        bestBid !== undefined &&
        bestBid.sizeLots.eq(entropy_client_1.ONE_BN) &&
        bestBid.priceLots.toNumber() / modelAskPrice.toNumber() - 1 >
            spammerCharge * edge + 0.0005) {
        console.log(`${marketContext.marketName} taking best bid spammer`);
        const takerSell = (0, entropy_client_1.makePlacePerpOrderInstruction)(entropyProgramId, group.publicKey, entropyAccount.publicKey, payer.publicKey, cache.publicKey, market.publicKey, market.bids, market.asks, market.eventQueue, entropyAccount.getOpenOrdersKeysInBasket(), bestBid.priceLots, entropy_client_1.ONE_BN, new bn_js_1.BN(Date.now()), 'sell', 'ioc');
        instructions.push(takerSell);
    }
    else if (takeSpammers &&
        bestAsk !== undefined &&
        bestAsk.sizeLots.eq(entropy_client_1.ONE_BN) &&
        modelBidPrice.toNumber() / bestAsk.priceLots.toNumber() - 1 >
            spammerCharge * edge + 0.0005) {
        console.log(`${marketContext.marketName} taking best ask spammer`);
        const takerBuy = (0, entropy_client_1.makePlacePerpOrderInstruction)(entropyProgramId, group.publicKey, entropyAccount.publicKey, payer.publicKey, cache.publicKey, market.publicKey, market.bids, market.asks, market.eventQueue, entropyAccount.getOpenOrdersKeysInBasket(), bestAsk.priceLots, entropy_client_1.ONE_BN, new bn_js_1.BN(Date.now()), 'buy', 'ioc');
        instructions.push(takerBuy);
    }
    if (moveOrders && marketContext.marketName === "BTC^2-PERP") {
        // cancel all, requote
        const cancelAllInstr = (0, entropy_client_1.makeCancelAllPerpOrdersInstruction)(entropyProgramId, group.publicKey, entropyAccount.publicKey, payer.publicKey, market.publicKey, market.bids, market.asks, new bn_js_1.BN(20));
        const placeBidInstr = (0, entropy_client_1.makePlacePerpOrderInstruction)(entropyProgramId, group.publicKey, entropyAccount.publicKey, payer.publicKey, cache.publicKey, market.publicKey, market.bids, market.asks, market.eventQueue, entropyAccount.getOpenOrdersKeysInBasket(), bookAdjBid, nativeBidSize, new bn_js_1.BN(Date.now()), 'buy', 'postOnlySlide');
        const placeAskInstr = (0, entropy_client_1.makePlacePerpOrderInstruction)(entropyProgramId, group.publicKey, entropyAccount.publicKey, payer.publicKey, cache.publicKey, market.publicKey, market.bids, market.asks, market.eventQueue, entropyAccount.getOpenOrdersKeysInBasket(), bookAdjAsk, nativeAskSize, new bn_js_1.BN(Date.now()), 'sell', 'postOnlySlide');
        instructions.push(cancelAllInstr);
        instructions.push(placeBidInstr);
        instructions.push(placeAskInstr);
        console.log(new Date().toISOString(), `${marketContext.marketName} Requoting sentBidPx: ${marketContext.sentBidPrice} newBidPx: ${bookAdjBid} sentAskPx: ${marketContext.sentAskPrice} newAskPx: ${bookAdjAsk} spread: ${bookAdjAsk.toNumber() - bookAdjBid.toNumber()}`);
        marketContext.sentBidPrice = bookAdjBid.toNumber();
        marketContext.sentAskPrice = bookAdjAsk.toNumber();
        marketContext.lastOrderUpdate = (0, entropy_client_1.getUnixTs)() / 1000;
    }
    else {
        if (marketContext.marketName === "BTC^2-PERP") {
            console.log(new Date().toISOString(), `${marketContext.marketName} Not requoting... No need to move orders`);
        }
    }
    // if instruction is only the sequence enforcement, then just send empty
    if (instructions.length === 1) {
        return [];
    }
    else {
        // console.log('returning instructions with length = ', instructions.length);
        return instructions;
    }
}
async function onExit(client, payer, group, entropyAccount, marketContexts) {
    await (0, entropy_client_1.sleep)(control.interval);
    entropyAccount = await client.getEntropyAccount(entropyAccount.publicKey, group.dexProgramId);
    let tx = new web3_js_1.Transaction();
    const txProms = [];
    for (let i = 0; i < marketContexts.length; i++) {
        const mc = marketContexts[i];
        const cancelAllInstr = (0, entropy_client_1.makeCancelAllPerpOrdersInstruction)(entropyProgramId, group.publicKey, entropyAccount.publicKey, payer.publicKey, mc.market.publicKey, mc.market.bids, mc.market.asks, new bn_js_1.BN(20));
        tx.add(cancelAllInstr);
        if (tx.instructions.length === params.batch) {
            console.log(new Date().toISOString(), `${mc.marketName} cancelling all orders`);
            txProms.push(client.sendTransaction(tx, payer, [], undefined, undefined, mc.marketName));
            tx = new web3_js_1.Transaction();
        }
    }
    if (tx.instructions.length) {
        txProms.push(client.sendTransaction(tx, payer, [], undefined, undefined, "Cancelling order for all markets: "));
    }
    const txids = await Promise.all(txProms);
    txids.forEach((txid) => {
        console.log(new Date().toISOString(), `cancel successful: ${txid.toString()}`);
    });
    process.exit();
}
function startMarketMaker() {
    if (control.isRunning) {
        fullMarketMaker().finally(startMarketMaker);
    }
}
process.on('unhandledRejection', function (err, promise) {
    console.error('Unhandled rejection (promise: ', promise, ', reason: ', err, ').');
});
startMarketMaker();
//# sourceMappingURL=powerperp_mm.js.map