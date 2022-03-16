import {
  Account,
  Commitment,
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import fs from 'fs';
import os from 'os';
import { BN } from 'bn.js';
import {
  BookSide,
  BookSideLayout,
  Cluster,
  Config,
  getMultipleAccounts,
  getPerpMarketByBaseSymbol,
  getUnixTs,
  GroupConfig,
  makeCancelAllPerpOrdersInstruction,
  makePlacePerpOrderInstruction,
  MangoAccount,
  MangoAccountLayout,
  MangoCache,
  MangoCacheLayout,
  MangoClient,
  MangoGroup,
  ONE_BN,
  PerpMarket,
  PerpMarketConfig,
  sleep,
  zeroKey,
} from '@friktion-labs/entropy-client';
import { OpenOrders } from '@project-serum/serum';
import path from 'path';
import {
  loadMangoAccountWithName,
  loadMangoAccountWithPubkey,
  makeCheckAndSetSequenceNumberInstruction,
  makeInitSequenceInstruction,
  seqEnforcerProgramId,
} from './utils';
import {
  normalizeBookChanges,
  normalizeTrades,
  OrderBook,
  streamNormalized,
  normalizeDerivativeTickers,
} from 'tardis-dev';
import { findProgramAddressSync } from '@project-serum/anchor/dist/cjs/utils/pubkey';
import IDS from './IDS.json';
import { getMintDecimals } from '../node_modules/@project-serum/serum/lib/market';
import Decimal from "decimal.js";
import { privateEncrypt } from 'crypto';
const paramsFileName = process.env.PARAMS || 'devnet.json';
const params = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, `../params/${paramsFileName}`),
    'utf-8',
  ),
);

const payer = new Account(
  JSON.parse(
    fs.readFileSync(
      process.env.KEYPAIR || os.homedir() + '/.config/solana/id.json',
      'utf-8',
    ),
  ),
);


const config = new Config(IDS);

const groupIds = config.getGroupWithName(params.group) as GroupConfig;
if (!groupIds) {
  throw new Error(`Group ${params.group} not found`);
}
const cluster = groupIds.cluster as Cluster;
const mangoProgramId = new PublicKey("4AFs3w5V5J9bDLEcNMEobdG3W4NYmXFgTe4KS41HBKqa");
// const mangoProgramId = groupIds.mangoProgramId;
const mangoGroupKey = groupIds.publicKey;

const control = { isRunning: true, interval: params.interval };

type MarketContext = {
  marketName: string;
  params: any;
  config: PerpMarketConfig;
  market: PerpMarket;
  marketIndex: number;
  bids: BookSide;
  asks: BookSide;
  lastBookUpdate: number;

  tardisBook: TardisBook;
  lastTardisUpdate: number;

  fundingRate: number;
  lastTardisFundingRateUpdate: number;

  sequenceAccount: PublicKey;
  sequenceAccountBump: number;

  sentBidPrice: number;
  sentAskPrice: number;
  lastOrderUpdate: number;
};

function getRandomNumber(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.random() * (max - min + 1) + min;
}

/**
 * Periodically fetch the account and market state
 */
async function listenAccountAndMarketState(
  connection: Connection,
  group: MangoGroup,
  state: {
    cache: MangoCache;
    mangoAccount: MangoAccount;
    marketContexts: MarketContext[];
  },
  stateRefreshInterval: number,
) {
  while (control.isRunning) {
    try {
      const inBasketOpenOrders = state.mangoAccount
        .getOpenOrdersKeysInBasket()
        .filter((pk) => !pk.equals(zeroKey));

      const allAccounts = [
        group.mangoCache,
        state.mangoAccount.publicKey,
        ...inBasketOpenOrders,
        ...state.marketContexts.map(
          (marketContext) => marketContext.market.bids,
        ),
        ...state.marketContexts.map(
          (marketContext) => marketContext.market.asks,
        ),
      ];

      const ts = getUnixTs() / 1000;
      const accountInfos = await getMultipleAccounts(connection, allAccounts);

      const cache = new MangoCache(
        accountInfos[0].publicKey,
        MangoCacheLayout.decode(accountInfos[0].accountInfo.data),
      );

      const mangoAccount = new MangoAccount(
        accountInfos[1].publicKey,
        MangoAccountLayout.decode(accountInfos[1].accountInfo.data),
      );
      const openOrdersAis = accountInfos.slice(
        2,
        2 + inBasketOpenOrders.length,
      );
      for (let i = 0; i < openOrdersAis.length; i++) {
        const ai = openOrdersAis[i];
        const marketIndex = mangoAccount.spotOpenOrders.findIndex((soo) =>
          soo.equals(ai.publicKey),
        );
        mangoAccount.spotOpenOrdersAccounts[marketIndex] =
          OpenOrders.fromAccountInfo(
            ai.publicKey,
            ai.accountInfo,
            group.dexProgramId,
          );
      }

      accountInfos
        .slice(
          2 + inBasketOpenOrders.length,
          2 + inBasketOpenOrders.length + state.marketContexts.length,
        )
        .forEach((ai, i) => {
          state.marketContexts[i].bids = new BookSide(
            ai.publicKey,
            state.marketContexts[i].market,
            BookSideLayout.decode(ai.accountInfo.data),
          );
        });

      accountInfos
        .slice(
          2 + inBasketOpenOrders.length + state.marketContexts.length,
          2 + inBasketOpenOrders.length + 2 * state.marketContexts.length,
        )
        .forEach((ai, i) => {
          state.marketContexts[i].lastBookUpdate = ts;
          state.marketContexts[i].asks = new BookSide(
            ai.publicKey,
            state.marketContexts[i].market,
            BookSideLayout.decode(ai.accountInfo.data),
          );
        });

      state.mangoAccount = mangoAccount;
      state.cache = cache;
    } catch (e) {
      console.error(
        `${new Date().getUTCDate().toString()} failed when loading state`,
        e,
      );
    } finally {
      await sleep(stateRefreshInterval);
    }
  }
}

/**
 * Load MangoCache, MangoAccount and Bids and Asks for all PerpMarkets using only
 * one RPC call.
 */
async function loadAccountAndMarketState(
  connection: Connection,
  group: MangoGroup,
  oldMangoAccount: MangoAccount,
  marketContexts: MarketContext[],
): Promise<{
  cache: MangoCache;
  mangoAccount: MangoAccount;
  marketContexts: MarketContext[];
}> {
  const inBasketOpenOrders = oldMangoAccount
    .getOpenOrdersKeysInBasket()
    .filter((pk) => !pk.equals(zeroKey));

  const allAccounts = [
    group.mangoCache,
    oldMangoAccount.publicKey,
    ...inBasketOpenOrders,
    ...marketContexts.map((marketContext) => marketContext.market.bids),
    ...marketContexts.map((marketContext) => marketContext.market.asks),
  ];

  const ts = getUnixTs() / 1000;
  const accountInfos = await getMultipleAccounts(connection, allAccounts);

  const cache = new MangoCache(
    accountInfos[0].publicKey,
    MangoCacheLayout.decode(accountInfos[0].accountInfo.data),
  );

  const mangoAccount = new MangoAccount(
    accountInfos[1].publicKey,
    MangoAccountLayout.decode(accountInfos[1].accountInfo.data),
  );
  const openOrdersAis = accountInfos.slice(2, 2 + inBasketOpenOrders.length);
  for (let i = 0; i < openOrdersAis.length; i++) {
    const ai = openOrdersAis[i];
    const marketIndex = mangoAccount.spotOpenOrders.findIndex((soo) =>
      soo.equals(ai.publicKey),
    );
    mangoAccount.spotOpenOrdersAccounts[marketIndex] =
      OpenOrders.fromAccountInfo(
        ai.publicKey,
        ai.accountInfo,
        group.dexProgramId,
      );
  }

  accountInfos
    .slice(
      2 + inBasketOpenOrders.length,
      2 + inBasketOpenOrders.length + marketContexts.length,
    )
    .forEach((ai, i) => {
      marketContexts[i].bids = new BookSide(
        ai.publicKey,
        marketContexts[i].market,
        BookSideLayout.decode(ai.accountInfo.data),
      );
    });

  accountInfos
    .slice(
      2 + inBasketOpenOrders.length + marketContexts.length,
      2 + inBasketOpenOrders.length + 2 * marketContexts.length,
    )
    .forEach((ai, i) => {
      marketContexts[i].lastBookUpdate = ts;
      marketContexts[i].asks = new BookSide(
        ai.publicKey,
        marketContexts[i].market,
        BookSideLayout.decode(ai.accountInfo.data),
      );
    });

  return {
    cache,
    mangoAccount,
    marketContexts,
  };
}

/**
 * Long running service that keeps FTX perp books updated via websocket using Tardis
 */
async function listenFtxBooks(marketContexts: MarketContext[]) {
  console.log('listen ftx books')
  const symbolToContext = Object.fromEntries(
    marketContexts.map((mc) => [mc.marketName, mc]),
  );

  const messages = streamNormalized(
    {
      exchange: 'ftx',
      symbols: marketContexts.map((mc) => mc.marketName),
    },
    normalizeTrades,
    normalizeBookChanges,
  );

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
 async function listenFtxFundingRates(marketContexts: MarketContext[]) {
  console.log('listen ftx funding rates')
  const symbolToContext = Object.fromEntries(
    marketContexts.map((mc) => [mc.marketName, mc]),
  );

  const messages = streamNormalized(
    {
      exchange: 'ftx',
      symbols: marketContexts.map((mc) => mc.marketName),
    },
    normalizeDerivativeTickers
  );

  for await (const msg of messages) {
    if (msg.type === 'derivative_ticker' && msg.fundingRate !== undefined) {
      symbolToContext[msg.symbol].fundingRate = msg.fundingRate;
      symbolToContext[msg.symbol].lastTardisFundingRateUpdate =
        msg.timestamp.getTime() / 1000;
    }
  }
}


async function fullMarketMaker() {
  const connection = new Connection(
    process.env.ENDPOINT_URL || config.cluster_urls[cluster],
    'processed' as Commitment,
  );
  const client = new MangoClient(connection, mangoProgramId);

  // load group
  const mangoGroup = await client.getMangoGroup(mangoGroupKey);

  // load mangoAccount
  let mangoAccount: MangoAccount;
  if (params.mangoAccountName) {
    mangoAccount = await loadMangoAccountWithName(
      client,
      mangoGroup,
      payer,
      params.mangoAccountName,
    );
  } else if (params.mangoAccountPubkey) {
    mangoAccount = await loadMangoAccountWithPubkey(
      client,
      mangoGroup,
      payer,
      new PublicKey(params.mangoAccountPubkey),
    );
  } else {
    throw new Error(
      'Please add mangoAccountName or mangoAccountPubkey to params file',
    );
  }

  const perpMarkets: PerpMarket[] = [];
  const marketContexts: MarketContext[] = [];

  let solMarketContext : MarketContext | null = null;;
  for (const baseSymbol in params.assets) {
    console.log('basesymbol: ', baseSymbol);
    const perpMarketConfig = getPerpMarketByBaseSymbol(
      groupIds,
      baseSymbol,
    ) as PerpMarketConfig;

    // console.log(perpMarketConfig);

    const [sequenceAccount, sequenceAccountBump] = findProgramAddressSync(
      [new Buffer(perpMarketConfig.name, 'utf-8'), payer.publicKey.toBytes()],
      seqEnforcerProgramId,
    );

    const perpMarket = await client.getPerpMarket(
      perpMarketConfig.publicKey,
      perpMarketConfig.baseDecimals,
      perpMarketConfig.quoteDecimals,
    );

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

    if (baseSymbol === 'SOL')
      solMarketContext = marketContexts[marketContexts.length - 1];
  }

  // Initialize all the sequence accounts
  const seqAccInstrs = marketContexts.map((mc) =>
    makeInitSequenceInstruction(
      mc.sequenceAccount,
      payer.publicKey,
      mc.sequenceAccountBump,
      mc.marketName,
    ),
  );
  const seqAccTx = new Transaction();
  seqAccTx.add(...seqAccInstrs);
  const seqAccTxid = await client.sendTransaction(seqAccTx, payer, []);

  const state = await loadAccountAndMarketState(
    connection,
    mangoGroup,
    mangoAccount,
    marketContexts,
  );

  const stateRefreshInterval = params.stateRefreshInterval || 5000;
  listenAccountAndMarketState(
    connection,
    mangoGroup,
    state,
    stateRefreshInterval,
  );
  

  const listenableMarketContexts = marketContexts.filter((context) => {
    console.log(context.params['disableFtxBook']);
    console.log(context.params);
    return  !(context.params.disableFtxBook || false)
  });

  console.log('listenable market contexts: ', listenableMarketContexts.map((context) => context.marketName));
  listenFtxBooks(listenableMarketContexts);
  listenFtxFundingRates(listenableMarketContexts);

  process.on('SIGINT', function () {
    console.log('Caught keyboard interrupt. Canceling orders');
    control.isRunning = false;
    onExit(client, payer, mangoGroup, mangoAccount, marketContexts);
  });

  while (control.isRunning) {
    // continue;
    try {
      mangoAccount = state.mangoAccount;

      let j = 0;
      let tx = new Transaction();
      for (let i = 0; i < marketContexts.length; i++) {
        const perpMarket = perpMarkets[i];
        // marketContexts[i].bids = await perpMarket.loadBids(connection);
        // marketContexts[i].asks = await perpMarket.loadAsks(connection);
        let ftxBook = marketContexts[i].tardisBook;
        let ftxFundingRate = marketContexts[i].fundingRate;
        console.log('market name: ', marketContexts[i].marketName);
        if (marketContexts[i].marketName === "SOL2-PERP") {
          if (solMarketContext === null) {
            throw new Error("sol market context is null");
          }
          ftxBook = solMarketContext.tardisBook;
          ftxFundingRate = solMarketContext.fundingRate;
        }
        const instrSet = makeMarketUpdateInstructions(
          mangoGroup,
          state.cache,
          mangoAccount,
          marketContexts[i],
          ftxBook,
          ftxFundingRate
        );

        if (instrSet.length > 0) {
          instrSet.forEach((ix) => tx.add(ix));
          j++;
          if (j === params.batch) {
            console.log('sending market update transaction');
            client.sendTransaction(tx, payer, []);
            tx = new Transaction();
            j = 0;
          }
        }
      }

      if (tx.instructions.length) {
        console.log('sending alternative market update transaction');
        client.sendTransaction(tx, payer, [], null);
      }
    } catch (e) {
      console.log(e);
    } finally {
      console.log(
        `${new Date().toUTCString()} sleeping for ${control.interval / 1000}s`,
      );
      await sleep(control.interval);
    }
  }
}

class TardisBook extends OrderBook {
  getSizedBestBid(quoteSize: number): number | undefined {
    let rem = quoteSize;
    for (const bid of this.bids()) {
      rem -= bid.amount * bid.price;
      if (rem <= 0) {
        return bid.price;
      }
    }
    return undefined;
  }
  getSizedBestAsk(quoteSize: number): number | undefined {
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

function makeMarketUpdateInstructions(
  group: MangoGroup,
  cache: MangoCache,
  mangoAccount: MangoAccount,
  marketContext: MarketContext,
  ftxBook: TardisBook,
  ftxFundingRate: number
): TransactionInstruction[] {
  // Right now only uses the perp
  const marketIndex = marketContext.marketIndex;
  const market = marketContext.market;
  const bids = marketContext.bids;
  const asks = marketContext.asks;

  const oracleCache = cache.priceCache[marketIndex];
  const oraclePriceI8048 = oracleCache.price;
  const oraclePrice = group.cachePriceToUi(
    oraclePriceI8048, marketIndex
  );

  const lastUpdate = oracleCache.lastUpdate;

  console.log('oracle price: ', oraclePrice.toString());
  console.log('last update: ', lastUpdate.toString());

  let ftxBid = ftxBook.getSizedBestBid(
    marketContext.params.ftxSize || 100000,
  );
  let ftxAsk = ftxBook.getSizedBestAsk(
    marketContext.params.ftxSize || 100000,
  );
  let ftxFunding = ftxFundingRate || 0.0;

  if (ftxBid === undefined || ftxAsk === undefined) {
    // TODO deal with this better; probably cancel all if there are any orders open
    console.log(`${marketContext.marketName} No FTX book`);
    console.log('market index: ', oraclePrice);
    // return [];
    ftxBid = new Decimal(oraclePrice).sub(0.01 * oraclePrice).toNumber();
    ftxAsk = new Decimal(oraclePrice).add(0.01 * oraclePrice).toNumber();
  } 
  
  if (marketContext.marketName === "SOL2-PERP") {
    ftxBid = new Decimal(ftxBid).pow(2).toNumber();
    ftxAsk = new Decimal(ftxAsk).pow(2).toNumber();
    ftxFunding = new Decimal(ftxFundingRate).toNumber();
  } 
  else {
  }

  const fairBid = ftxBid;
  const fairAsk = ftxAsk;

  const fairValue = (fairBid + fairBid) / 2;
  const ftxSpread = (fairAsk - fairBid) / fairValue;
  const equity = mangoAccount.computeValue(group, cache).toNumber();
  const perpAccount = mangoAccount.perpAccounts[marketIndex];
   
  // TODO look at event queue as well for unprocessed fills
  const basePos = perpAccount.getBasePositionUi(market);
  const fundingBias = ftxFunding || 0;

  const sizePerc = marketContext.params.sizePerc;
  const leanCoeff = marketContext.params.leanCoeff;
  const charge = (marketContext.params.charge || 0.0015) + ftxSpread / 2;
  const bias = marketContext.params.bias;
  const requoteThresh = marketContext.params.requoteThresh;
  const takeSpammers = marketContext.params.takeSpammers;
  const spammerCharge = marketContext.params.spammerCharge;
  const size = (equity * sizePerc) / fairValue;
  const lean = (-leanCoeff * basePos) / size;
  console.log('equity: ', equity.toString());

  console.log('fundingRate: ', fundingBias);
  console.log('virginBid: ', fairValue * (1 - charge + lean + bias));
  console.log('chadBid: ', fairValue * (1 - charge + lean + bias + 2*fundingBias));

  let bidPrice = fairValue * (1 - charge + lean + bias + 2*fundingBias);
  let askPrice = fairValue * (1 + charge + lean + bias + 2*fundingBias);
  // TODO volatility adjustment

  console.log('bid notional: ', bidPrice * size);
  console.log('ask notional: ', askPrice * size);

  const noise = getRandomNumber(
    0,
    0.01 * fairValue
  );

  bidPrice -= noise;
  askPrice += noise;

  console.log(bidPrice, askPrice);
  console.log('size = ', size);

  let [modelBidPrice, nativeBidSize] = market.uiToNativePriceQuantity(
    bidPrice,
    size,
  );
  let [modelAskPrice, nativeAskSize] = market.uiToNativePriceQuantity(
    askPrice,
    size,
  );

  console.log('native bid size = ', nativeBidSize.toString());
  console.log('native ask size = ', nativeAskSize.toString());

  const bestBid = bids.getBest();
  const bestAsk = asks.getBest();

  console.log('Mango best bid : ', bestBid?.price.toString(), ', Mango best ask: ', bestAsk?.price.toString() );
  const bookAdjBid =
    bestAsk !== undefined
      ? BN.min(bestAsk.priceLots.sub(ONE_BN), modelBidPrice)
      : modelBidPrice;
  const bookAdjAsk =
    bestBid !== undefined
      ? BN.max(bestBid.priceLots.add(ONE_BN), modelAskPrice)
      : modelAskPrice;


  console.log('model bid: ', modelBidPrice.toString(), ', model ask: ', modelAskPrice.toString());
  // TODO use order book to requote if size has changed

  let moveOrders = false;
  if (marketContext.lastBookUpdate >= marketContext.lastOrderUpdate) {
    // if mango book was updated recently, then MangoAccount was also updated
    const openOrders = mangoAccount
      .getPerpOpenOrders()
      .filter((o) => o.marketIndex === marketIndex);
    moveOrders = openOrders.length < 2 || openOrders.length > 2;
    for (const o of openOrders) {
      const refPrice = o.side === 'buy' ? bookAdjBid : bookAdjAsk;
      moveOrders =
        moveOrders ||
        Math.abs(o.price.toNumber() / refPrice.toNumber() - 1) > requoteThresh;
    }
  } else {
    // If order was updated before MangoAccount, then assume that sent order already executed
    moveOrders =
      moveOrders ||
      Math.abs(marketContext.sentBidPrice / bookAdjBid.toNumber() - 1) >
        requoteThresh ||
      Math.abs(marketContext.sentAskPrice / bookAdjAsk.toNumber() - 1) >
        requoteThresh;
  }

  // Start building the transaction
  const instructions: TransactionInstruction[] = [
    makeCheckAndSetSequenceNumberInstruction(
      marketContext.sequenceAccount,
      payer.publicKey,
      Math.round(getUnixTs() * 1000),
    ),
  ];

  /*
  Clear 1 lot size orders at the top of book that bad people use to manipulate the price
   */
  if (
    takeSpammers &&
    bestBid !== undefined &&
    bestBid.sizeLots.eq(ONE_BN) &&
    bestBid.priceLots.toNumber() / modelAskPrice.toNumber() - 1 >
      spammerCharge * charge + 0.0005
  ) {
    console.log(`${marketContext.marketName} taking best bid spammer`);
    const takerSell = makePlacePerpOrderInstruction(
      mangoProgramId,
      group.publicKey,
      mangoAccount.publicKey,
      payer.publicKey,
      cache.publicKey,
      market.publicKey,
      market.bids,
      market.asks,
      market.eventQueue,
      mangoAccount.getOpenOrdersKeysInBasket(),
      bestBid.priceLots,
      ONE_BN,
      new BN(Date.now()),
      'sell',
      'ioc',
    );
    instructions.push(takerSell);
  } else if (
    takeSpammers &&
    bestAsk !== undefined &&
    bestAsk.sizeLots.eq(ONE_BN) &&
    modelBidPrice.toNumber() / bestAsk.priceLots.toNumber() - 1 >
      spammerCharge * charge + 0.0005
  ) {
    console.log(`${marketContext.marketName} taking best ask spammer`);
    const takerBuy = makePlacePerpOrderInstruction(
      mangoProgramId,
      group.publicKey,
      mangoAccount.publicKey,
      payer.publicKey,
      cache.publicKey,
      market.publicKey,
      market.bids,
      market.asks,
      market.eventQueue,
      mangoAccount.getOpenOrdersKeysInBasket(),
      bestAsk.priceLots,
      ONE_BN,
      new BN(Date.now()),
      'buy',
      'ioc',
    );
    instructions.push(takerBuy);
  }
  if (moveOrders) {
    // cancel all, requote
    const cancelAllInstr = makeCancelAllPerpOrdersInstruction(
      mangoProgramId,
      group.publicKey,
      mangoAccount.publicKey,
      payer.publicKey,
      market.publicKey,
      market.bids,
      market.asks,
      new BN(20),
    );

    const placeBidInstr = makePlacePerpOrderInstruction(
      mangoProgramId,
      group.publicKey,
      mangoAccount.publicKey,
      payer.publicKey,
      cache.publicKey,
      market.publicKey,
      market.bids,
      market.asks,
      market.eventQueue,
      mangoAccount.getOpenOrdersKeysInBasket(),
      bookAdjBid,
      nativeBidSize,
      new BN(Date.now()),
      'buy',
      'postOnlySlide',
    );

    const placeAskInstr = makePlacePerpOrderInstruction(
      mangoProgramId,
      group.publicKey,
      mangoAccount.publicKey,
      payer.publicKey,
      cache.publicKey,
      market.publicKey,
      market.bids,
      market.asks,
      market.eventQueue,
      mangoAccount.getOpenOrdersKeysInBasket(),
      bookAdjAsk,
      nativeAskSize,
      new BN(Date.now()),
      'sell',
      'postOnlySlide',
    );
    instructions.push(cancelAllInstr);
    instructions.push(placeBidInstr);
    instructions.push(placeAskInstr);
    console.log(
      `${marketContext.marketName} Requoting sentBidPx: ${marketContext.sentBidPrice} newBidPx: ${bookAdjBid} sentAskPx: ${marketContext.sentAskPrice} newAskPx: ${bookAdjAsk}`,
    );
    marketContext.sentBidPrice = bookAdjBid.toNumber();
    marketContext.sentAskPrice = bookAdjAsk.toNumber();
    marketContext.lastOrderUpdate = getUnixTs() / 1000;
  } else {
    console.log(
      `${marketContext.marketName} Not requoting. No need to move orders`,
    );
  }

  // if instruction is only the sequence enforcement, then just send empty
  if (instructions.length === 1) {
    return [];
  } else {
    console.log('returning instructions with length = ', instructions.length);
    return instructions;
  }
}

async function onExit(
  client: MangoClient,
  payer: Account,
  group: MangoGroup,
  mangoAccount: MangoAccount,
  marketContexts: MarketContext[],
) {
  await sleep(control.interval);
  mangoAccount = await client.getMangoAccount(
    mangoAccount.publicKey,
    group.dexProgramId,
  );
  let tx = new Transaction();
  const txProms: any[] = [];
  for (let i = 0; i < marketContexts.length; i++) {
    const mc = marketContexts[i];
    const cancelAllInstr = makeCancelAllPerpOrdersInstruction(
      mangoProgramId,
      group.publicKey,
      mangoAccount.publicKey,
      payer.publicKey,
      mc.market.publicKey,
      mc.market.bids,
      mc.market.asks,
      new BN(20),
    );
    tx.add(cancelAllInstr);
    if (tx.instructions.length === params.batch) {
      txProms.push(client.sendTransaction(tx, payer, []));
      tx = new Transaction();
    }
  }

  if (tx.instructions.length) {
    txProms.push(client.sendTransaction(tx, payer, []));
  }
  const txids = await Promise.all(txProms);
  txids.forEach((txid) => {
    console.log(`cancel successful: ${txid.toString()}`);
  });
  process.exit();
}

function startMarketMaker() {
  if (control.isRunning) {
    fullMarketMaker().finally(startMarketMaker);
  }
}

process.on('unhandledRejection', function (err, promise) {
  console.error(
    'Unhandled rejection (promise: ',
    promise,
    ', reason: ',
    err,
    ').',
  );
});

startMarketMaker();
