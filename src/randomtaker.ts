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
  EntropyAccount,
  EntropyAccountLayout,
  EntropyCache,
  EntropyCacheLayout,
  EntropyClient,
  EntropyGroup,
  ONE_BN,
  PerpMarket,
  PerpMarketConfig,
  sleep,
  zeroKey,
} from '@friktion-labs/entropy-client';
import { OpenOrders } from '@project-serum/serum';
import path from 'path';
import {
  loadEntropyAccountWithName,
  loadEntropyAccountWithPubkey,
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
const paramsFileName = process.env.PARAMS || 'random_taker.json';
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
<<<<<<< HEAD
  );
  
  const payer = new Account(
    JSON.parse(
      fs.readFileSync(
        process.env.KEYPAIR || os.homedir() + '/.config/solana/taker-authority.json',
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
  console.log("cluster: ", cluster);
  const entropyProgramId = new PublicKey("FcfzrnurPFXwxbx332wScnD5P86DwhpLpBbQsnr6LcH5");
  // const entropyProgramId = groupIds.entropyProgramId;
  const entropyGroupKey = groupIds.publicKey;
  console.log("programId: ",  entropyProgramId);
  const control = { isRunning: true, interval: params.interval, take_pct_limit: params.take_max_sizePerc, take_max_sizePerc: params.take_max_sizePerc, buy_sell_skew: params.buy_sell_skew};
  
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
    lastIOCside: number;
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
    group: EntropyGroup,
    state: {
      cache: EntropyCache;
      entropyAccount: EntropyAccount;
      marketContexts: MarketContext[];
    },
    stateRefreshInterval: number,
  ) {
    while (control.isRunning) {
      try {
        const inBasketOpenOrders = state.entropyAccount
          .getOpenOrdersKeysInBasket()
          .filter((pk) => !pk.equals(zeroKey));
  
        const allAccounts = [
          group.entropyCache,
          state.entropyAccount.publicKey,
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
  
        const cache = new EntropyCache(
          accountInfos[0].publicKey,
          EntropyCacheLayout.decode(accountInfos[0].accountInfo.data),
        );
  
        const entropyAccount = new EntropyAccount(
          accountInfos[1].publicKey,
          EntropyAccountLayout.decode(accountInfos[1].accountInfo.data),
        );
        const openOrdersAis = accountInfos.slice(
          2,
          2 + inBasketOpenOrders.length,
        );
        for (let i = 0; i < openOrdersAis.length; i++) {
          const ai = openOrdersAis[i];
          const marketIndex = entropyAccount.spotOpenOrders.findIndex((soo) =>
            soo.equals(ai.publicKey),
          );
          entropyAccount.spotOpenOrdersAccounts[marketIndex] =
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
  
        state.entropyAccount = entropyAccount;
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
   * Load EntropyCache, EntropyAccount and Bids and Asks for all PerpMarkets using only
   * one RPC call.
   */
  async function loadAccountAndMarketState(
    connection: Connection,
    group: EntropyGroup,
    oldEntropyAccount: EntropyAccount,
    marketContexts: MarketContext[],
  ): Promise<{
=======
  ),
);


const config = new Config(IDS);

const groupIds = config.getGroupWithName(params.group) as GroupConfig;
if (!groupIds) {
  throw new Error(`Group ${params.group} not found`);
}
const cluster = groupIds.cluster as Cluster;
console.log("cluster: ", cluster);
const entropyProgramId = new PublicKey("FcfzrnurPFXwxbx332wScnD5P86DwhpLpBbQsnr6LcH5");
// const entropyProgramId = groupIds.entropyProgramId;
const entropyGroupKey = groupIds.publicKey;
console.log("programId: ", entropyProgramId);
const control = { isRunning: true, interval: params.interval, take_pct_limit: params.take_max_sizePerc, take_max_sizePerc: params.take_max_sizePerc, buy_sell_skew: params.buy_sell_skew };
let counter = 0;

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
  lastIOCside: number;
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
  group: EntropyGroup,
  state: {
>>>>>>> 7e89c1706bf2cd4f29c5552e45e9c25341a82512
    cache: EntropyCache;
    entropyAccount: EntropyAccount;
    marketContexts: MarketContext[];
  },
  stateRefreshInterval: number,
) {
  while (control.isRunning) {
    try {
      const inBasketOpenOrders = state.entropyAccount
        .getOpenOrdersKeysInBasket()
        .filter((pk) => !pk.equals(zeroKey));

      const allAccounts = [
        group.entropyCache,
        state.entropyAccount.publicKey,
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

      const cache = new EntropyCache(
        accountInfos[0].publicKey,
        EntropyCacheLayout.decode(accountInfos[0].accountInfo.data),
      );

      const entropyAccount = new EntropyAccount(
        accountInfos[1].publicKey,
        EntropyAccountLayout.decode(accountInfos[1].accountInfo.data),
      );
      const openOrdersAis = accountInfos.slice(
        2,
        2 + inBasketOpenOrders.length,
      );
      for (let i = 0; i < openOrdersAis.length; i++) {
        const ai = openOrdersAis[i];
        const marketIndex = entropyAccount.spotOpenOrders.findIndex((soo) =>
          soo.equals(ai.publicKey),
        );
        entropyAccount.spotOpenOrdersAccounts[marketIndex] =
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

      state.entropyAccount = entropyAccount;
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
 * Load EntropyCache, EntropyAccount and Bids and Asks for all PerpMarkets using only
 * one RPC call.
 */
async function loadAccountAndMarketState(
  connection: Connection,
  group: EntropyGroup,
  oldEntropyAccount: EntropyAccount,
  marketContexts: MarketContext[],
): Promise<{
  cache: EntropyCache;
  entropyAccount: EntropyAccount;
  marketContexts: MarketContext[];
}> {
  const inBasketOpenOrders = oldEntropyAccount
    .getOpenOrdersKeysInBasket()
    .filter((pk) => !pk.equals(zeroKey));

  const allAccounts = [
    group.entropyCache,
    oldEntropyAccount.publicKey,
    ...inBasketOpenOrders,
    ...marketContexts.map((marketContext) => marketContext.market.bids),
    ...marketContexts.map((marketContext) => marketContext.market.asks),
  ];

  const ts = getUnixTs() / 1000;
  const accountInfos = await getMultipleAccounts(connection, allAccounts);

  const cache = new EntropyCache(
    accountInfos[0].publicKey,
    EntropyCacheLayout.decode(accountInfos[0].accountInfo.data),
  );

  const entropyAccount = new EntropyAccount(
    accountInfos[1].publicKey,
    EntropyAccountLayout.decode(accountInfos[1].accountInfo.data),
  );
  const openOrdersAis = accountInfos.slice(2, 2 + inBasketOpenOrders.length);
  for (let i = 0; i < openOrdersAis.length; i++) {
    const ai = openOrdersAis[i];
    const marketIndex = entropyAccount.spotOpenOrders.findIndex((soo) =>
      soo.equals(ai.publicKey),
    );
    entropyAccount.spotOpenOrdersAccounts[marketIndex] =
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
    entropyAccount,
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
  const client = new EntropyClient(connection, entropyProgramId);

  // load group
  const entropyGroup = await client.getEntropyGroup(entropyGroupKey);

  // load entropyAccount
  let entropyAccount: EntropyAccount;
  if (params.entropyAccountName) {
    entropyAccount = await loadEntropyAccountWithName(
      client,
      entropyGroup,
      payer,
      params.entropyAccountName,
    );
  } else if (params.entropyAccountPubkey) {
    entropyAccount = await loadEntropyAccountWithPubkey(
      client,
      entropyGroup,
      payer,
      new PublicKey(params.entropyAccountPubkey),
    );
  } else {
    throw new Error(
      'Please add entropyAccountName or entropyAccountPubkey to params file',
    );
  }

  const perpMarkets: PerpMarket[] = [];
  const marketContexts: MarketContext[] = [];

  let solMarketContext: MarketContext | null = null;;
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
      lastIOCside: 1
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
    entropyGroup,
    entropyAccount,
    marketContexts,
  );

  const stateRefreshInterval = params.stateRefreshInterval || 5000;
  listenAccountAndMarketState(
    connection,
    entropyGroup,
    state,
    stateRefreshInterval,
  );


  const listenableMarketContexts = marketContexts.filter((context) => {
    console.log(context.params['disableFtxBook']);
    console.log(context.params);
    return !(context.params.disableFtxBook || false)
  });

  console.log('listenable market contexts: ', listenableMarketContexts.map((context) => context.marketName));
  listenFtxBooks(listenableMarketContexts);
  listenFtxFundingRates(listenableMarketContexts);

  process.on('SIGINT', function () {
    console.log('Caught keyboard interrupt. Canceling orders');
    control.isRunning = false;
    onExit(client, payer, entropyGroup, entropyAccount, marketContexts);
  });

  while (control.isRunning) {
    // continue;
    try {
      entropyAccount = state.entropyAccount;

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
          entropyGroup,
          state.cache,
          entropyAccount,
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
  group: EntropyGroup,
  cache: EntropyCache,
  entropyAccount: EntropyAccount,
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
  const equity = entropyAccount.computeValue(group, cache).toNumber();
  const perpAccount = entropyAccount.perpAccounts[marketIndex];

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
  console.log('chadBid: ', fairValue * (1 - charge + lean + bias + 2 * fundingBias));

  let bidPrice = fairValue * (1 - charge + lean + bias + 2 * fundingBias);
  let askPrice = fairValue * (1 + charge + lean + bias + 2 * fundingBias);
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

  console.log('Entropy best bid : ', bestBid?.price.toString(), ', Entropy best ask: ', bestAsk?.price.toString());
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
  } else {
    // If order was updated before EntropyAccount, then assume that sent order already executed
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
  Should we randomly take or not?ß
   */
  let thresh = control.buy_sell_skew - 0.1 * marketContext.lastIOCside;
  let random_side = Math.random();
  let random_size = 1;

  console.log("Random Size: ", random_size);
  if (
    (counter % 1000 > 500) && bestBid
  ) {
    console.log("counter: ", counter);
    console.log(`${marketContext.marketName} Selling...`);
    const takerSell = makePlacePerpOrderInstruction(
      entropyProgramId,
      group.publicKey,
      entropyAccount.publicKey,
      payer.publicKey,
      cache.publicKey,
      market.publicKey,
      market.bids,
      market.asks,
      market.eventQueue,
      entropyAccount.getOpenOrdersKeysInBasket(),
      bestBid.priceLots,
      new BN(random_size),
      new BN(Date.now()),
      'sell',
      'ioc',
    );
    instructions.push(takerSell);
    marketContext.lastIOCside = -1;
    counter += 1;
  } else if (bestAsk) {
    console.log("count: ", counter);
    console.log(`${marketContext.marketName} Buying... `);
    const takerBuy = makePlacePerpOrderInstruction(
      entropyProgramId,
      group.publicKey,
      entropyAccount.publicKey,
      payer.publicKey,
      cache.publicKey,
      market.publicKey,
      market.bids,
      market.asks,
      market.eventQueue,
      entropyAccount.getOpenOrdersKeysInBasket(),
      bestAsk.priceLots,
      new BN(random_size),
      new BN(Date.now()),
      'buy',
      'ioc',
    );
    instructions.push(takerBuy);
    marketContext.lastIOCside = 1;
    counter += 1;

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
  client: EntropyClient,
  payer: Account,
  group: EntropyGroup,
  entropyAccount: EntropyAccount,
  marketContexts: MarketContext[],
) {
  await sleep(control.interval);
  entropyAccount = await client.getEntropyAccount(
    entropyAccount.publicKey,
    group.dexProgramId,
  );
  let tx = new Transaction();
  const txProms: any[] = [];
  for (let i = 0; i < marketContexts.length; i++) {
    const mc = marketContexts[i];
    const cancelAllInstr = makeCancelAllPerpOrdersInstruction(
      entropyProgramId,
      group.publicKey,
      entropyAccount.publicKey,
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
<<<<<<< HEAD
  
  startMarketMaker();
  
=======
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
>>>>>>> 7e89c1706bf2cd4f29c5552e45e9c25341a82512
