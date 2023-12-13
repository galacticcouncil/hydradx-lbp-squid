import { TypeormDatabase, Store } from "@subsquid/typeorm-store";
import { In } from "typeorm";
import { isNotNullOrUndefined } from "./helpers";
import { BigNumber } from "bignumber.js";

import { processor, ProcessorContext } from "./processor";
import {
  Account,
  HistoricalBlockPrice,
  Pool,
  SwapType,
  Swap,
  Transfer,
  HistoricalVolume,
  HistoricalAssetVolume,
} from "./model";
import { events, storage, calls } from "./types/";
import { BlockHeader, Event } from "@subsquid/substrate-processor";

import {
  ProcessorBlockData,
  PoolCreatedEvent,
  TransferEvent,
  LBPPoolDataUpdate,
} from "./types";

processor.run(new TypeormDatabase({ supportHotBlocks: true }), async (ctx) => {
  const newPoolData = await getPools(ctx);
  console.log("Found " + newPoolData.length + " pools");

  const lbpPoolsUpdates = await getLBPPoolUpdates(ctx);
  console.log("Found " + Object.keys(lbpPoolsUpdates).length + " pool updates");

  const allPools = await ctx.store.find(Pool);
  console.log("Got " + allPools.length + " pools from database");

  const transfersData = await getTransfers(ctx, [
    ...newPoolData.map((p) => p.id),
    ...allPools.map((p) => p.id),
  ]);
  console.log("Found " + transfersData.length + " transfers");

  let accountIds = new Set<string>();
  for (let t of transfersData) {
    accountIds.add(t.from);
    accountIds.add(t.to);
  }

  for (let p of newPoolData) {
    accountIds.add(p.id);
    if (p.lbpPoolData?.owner) accountIds.add(p.lbpPoolData.owner);
    if (p.lbpPoolData?.feeCollector) accountIds.add(p.lbpPoolData.feeCollector);
  }

  for (let p in lbpPoolsUpdates) {
    accountIds.add(lbpPoolsUpdates[p].owner);
    accountIds.add(lbpPoolsUpdates[p].feeCollector);
  }

  let accounts = accountIds
    ? await ctx.store
        .findBy(Account, { id: In([...accountIds]) })
        .then((accounts) => {
          return new Map(accounts.map((a) => [a.id, a]));
        })
    : new Map();

  const newPools: Pool[] = [];

  for (let p of newPoolData) {
    let {
      id,
      assetAId,
      assetBId,
      assetABalance,
      assetBBalance,
      createdAt,
      createdAtParaBlock,
      lbpPoolData,
    } = p;

    lbpPoolData = { ...lbpPoolData, ...lbpPoolsUpdates[id] };

    if (lbpPoolData) {
      newPools.push(
        new Pool({
          id: id,
          account: getAccount(accounts, id),
          assetAId,
          assetBId,
          assetABalance,
          assetBBalance,
          createdAt,
          createdAtParaBlock,
          owner: getAccount(accounts, lbpPoolData.owner),
          startBlockNumber: lbpPoolData.startBlockNumber,
          endBlockNumber: lbpPoolData.endBlockNumber,
          feeCollector: getAccount(accounts, lbpPoolData.feeCollector),
          fee: lbpPoolData.fee,
          initialWeight: lbpPoolData.initialWeight,
          finalWeight: lbpPoolData.finalWeight,
        })
      );
    }
  }

  for (let p in lbpPoolsUpdates) {
    const poolData = allPools.find((pool) => pool.id == p);
    const newData = lbpPoolsUpdates[p];

    console.log(`Found pool data for pool ${p}... mapping new data`);

    if (!poolData) continue;

    poolData.owner = getAccount(accounts, newData.owner);
    poolData.feeCollector = getAccount(accounts, newData.feeCollector);
    poolData.initialWeight = newData.initialWeight;
    poolData.finalWeight = newData.finalWeight;
    poolData.repayTarget = newData.repayTarget;
    poolData.startBlockNumber = newData.startBlockNumber;
    poolData.endBlockNumber = newData.endBlockNumber;
  }

  let transfers: Transfer[] = [];

  for (let t of transfersData) {
    let { id, assetId, extrinsicHash, amount, fee, blockNumber } = t;

    let from = getAccount(accounts, t.from);
    let to = getAccount(accounts, t.to);

    transfers.push(
      new Transfer({
        id,
        paraChainBlockHeight: blockNumber,
        assetId,
        extrinsicHash,
        from,
        to,
        amount,
        txFee: fee,
      })
    );
  }

  const poolPriceData = await getPoolPriceData(
    ctx,
    [...allPools, ...newPools],
    accounts
  );

  console.log(
    `Got ${poolPriceData.poolPrices.length} pool price data, 
    ${poolPriceData.swaps.length} swaps, 
    ${poolPriceData.assetVolume.length} asset volume data, 
    ${poolPriceData.volume.length} volume data`
  );

  const poolPrices: HistoricalBlockPrice[] = [];
  for (let p of poolPriceData.poolPrices) {
    poolPrices.push(new HistoricalBlockPrice(p));
  }

  await ctx.store.save(Array.from(accounts.values()));
  console.log("saving pools");
  await ctx.store.save([...allPools, ...newPools]);
  console.log("saving transfers");
  await ctx.store.insert(transfers);
  console.log("saving prices");
  await ctx.store.insert(poolPrices);
  console.log("saving swaps");
  await ctx.store.insert(poolPriceData.swaps);
  console.log("saving volume");
  await ctx.store.insert(poolPriceData.volume);
  console.log("saving asset volume");
  await ctx.store.insert(poolPriceData.assetVolume);

  console.log("Batch complete");
  console.log(
    "Relay block complete: " +
      poolPriceData.poolPrices[poolPriceData.poolPrices.length - 1]
        .relayChainBlockHeight
  );
});

async function getPools(
  ctx: ProcessorContext<Store>
): Promise<PoolCreatedEvent[]> {
  let pools: Promise<PoolCreatedEvent>[] = [];
  for (let block of ctx.blocks) {
    for (let event of block.events) {
      if (event.name == events.lbp.poolCreated.name) {
        const { pool, data } = events.lbp.poolCreated.v176.decode(event);
        pools.push(
          new Promise((resolvePool) => {
            Promise.all([
              getAssetBalance(block.header, data.assets[0], pool),
              getAssetBalance(block.header, data.assets[1], pool),
            ]).then(([assetABalance, assetBBalance]) => {
              resolvePool({
                id: pool,
                assetAId: data.assets[0],
                assetBId: data.assets[1],
                assetABalance,
                assetBBalance,
                createdAt: new Date(block.header.timestamp || 0),
                createdAtParaBlock: block.header.height,
                lbpPoolData: {
                  owner: data.owner,
                  feeCollector: data.feeCollector,
                  fee: data.fee,
                  initialWeight: data.initialWeight,
                  finalWeight: data.finalWeight,
                },
              });
            });
          })
        );
      }
    }
  }
  return await Promise.all(pools);
}

async function getPoolPriceData(
  ctx: ProcessorContext<Store>,
  pools: Pool[],
  accounts: Map<string, Account>
) {
  let poolPrices: Promise<HistoricalBlockPrice | null>[][] = [];
  let blocksData: ProcessorBlockData[] = [];
  let volume = new Map<string, HistoricalVolume>();
  let assetVolume = new Map<string, HistoricalAssetVolume>();

  for (let block of ctx.blocks) {
    const blockData: ProcessorBlockData = {
      relayChainBlockHeight: null,
      paraChainBlockHeight: block.header.height,
      timestamp: new Date(block.header.timestamp || 0),
      swaps: [],
    };

    for (let call of block.calls) {
      if (call.name == calls.parachainSystem.setValidationData.name) {
        let validationData =
          calls.parachainSystem.setValidationData.v100.decode(call);
        blockData.relayChainBlockHeight =
          validationData.data.validationData.relayParentNumber;
      }
    }

    for (let event of block.events) {
      if (event.name == events.lbp.buyExecuted.name) {
        const buyEvent = events.lbp.buyExecuted.v176.decode(event);
        const swapPool = pools.find(
          (p) =>
            (p.assetAId == buyEvent.assetIn &&
              p.assetBId == buyEvent.assetOut) ||
            (p.assetBId == buyEvent.assetIn && p.assetAId == buyEvent.assetOut)
        );

        if (!swapPool) {
          console.log(`No pool found for event: ${event.name} ${event.id}`);
          continue;
        }

        const swap = initSwap(
          event,
          event.extrinsic?.hash || "",
          getAccount(accounts, buyEvent.who),
          buyEvent.assetIn,
          buyEvent.assetOut,
          buyEvent.amount,
          buyEvent.buyPrice,
          buyEvent.feeAsset,
          buyEvent.feeAmount,
          SwapType.BUY,
          swapPool,
          blockData
        );

        blockData.swaps.push(swap);

        await handleVolumeUpdates(ctx, volume, assetVolume, swap);
      }

      if (event.name == events.lbp.sellExecuted.name) {
        const sellEvent = events.lbp.sellExecuted.v176.decode(event);
        const swapPool = pools.find(
          (p) =>
            (p.assetAId == sellEvent.assetIn &&
              p.assetBId == sellEvent.assetOut) ||
            (p.assetBId == sellEvent.assetIn &&
              p.assetAId == sellEvent.assetOut)
        );

        if (!swapPool) {
          console.log(`No pool found for event: ${event.name} ${event.id}`);
          continue;
        }

        const swap = initSwap(
          event,
          event.extrinsic?.hash || "",
          getAccount(accounts, sellEvent.who),
          sellEvent.assetIn,
          sellEvent.assetOut,
          sellEvent.assetIn === sellEvent.feeAsset
            ? sellEvent.amount + sellEvent.feeAmount
            : sellEvent.amount,
          sellEvent.salePrice,
          sellEvent.feeAsset,
          sellEvent.feeAmount,
          SwapType.SELL,
          swapPool,
          blockData
        );

        blockData.swaps.push(swap);

        await handleVolumeUpdates(ctx, volume, assetVolume, swap);
      }
    }

    poolPrices.push(
      pools.map(
        async (p) =>
          new Promise<HistoricalBlockPrice | null>((resolve) => {
            if (p.createdAtParaBlock > blockData.paraChainBlockHeight) {
              resolve(null);
              return;
            }

            Promise.all([
              getAssetBalance(block.header, p.assetAId, p.id),
              getAssetBalance(block.header, p.assetBId, p.id),
            ]).then(([assetABalance, assetBBalance]) => {
              resolve({
                id: p.id + "-" + blockData.paraChainBlockHeight,
                assetAId: p.assetAId,
                assetBId: p.assetBId,
                assetABalance: assetABalance,
                assetBBalance: assetBBalance,
                pool: p,
                paraChainBlockHeight: blockData.paraChainBlockHeight,
                relayChainBlockHeight: blockData.relayChainBlockHeight || 0,
              });
            });
          })
      )
    );

    blocksData.push(blockData);
  }

  return {
    poolPrices: (await Promise.all(poolPrices.flat())).filter(
      isNotNullOrUndefined
    ),
    swaps: blocksData.flatMap((b) => b.swaps),
    assetVolume: Array.from(assetVolume.values()),
    volume: Array.from(volume.values()),
  };
}

async function getLBPPoolUpdates(ctx: ProcessorContext<Store>) {
  const updates: { [key: string]: LBPPoolDataUpdate } = {};
  for (let block of ctx.blocks) {
    for (let event of block.events) {
      if (event.name == events.lbp.poolUpdated.name) {
        const { pool, data } = events.lbp.poolUpdated.v176.decode(event);

        updates[pool] = {
          startBlockNumber: data.start,
          endBlockNumber: data.end,
          repayTarget: data.repayTarget,
          fee: data.fee,
          initialWeight: data.initialWeight,
          finalWeight: data.finalWeight,
          feeCollector: data.feeCollector,
          owner: data.owner,
        };
      }
    }
  }
  return updates;
}

function getTransfers(
  ctx: ProcessorContext<Store>,
  pools: string[]
): TransferEvent[] {
  let transfers: TransferEvent[] = [];
  for (let block of ctx.blocks) {
    for (let event of block.events) {
      if (event.name == events.balances.transfer.name) {
        const { from, to, amount } =
          events.balances.transfer.v104.decode(event);
        if (isPoolTransfer(pools, from, to)) {
          transfers.push({
            id: event.id,
            assetId: 0,
            blockNumber: block.header.height,
            timestamp: new Date(block.header.timestamp || 0),
            extrinsicHash: event.extrinsic?.hash,
            from: from,
            to: to,
            amount: amount,
            fee: event.extrinsic?.fee || BigInt(0),
          });
        }
      } else if (event.name == events.tokens.transfer.name) {
        const { from, to, currencyId, amount } =
          events.tokens.transfer.v108.decode(event);
        if (isPoolTransfer(pools, from, to)) {
          transfers.push({
            id: event.id,
            assetId: currencyId,
            blockNumber: block.header.height,
            timestamp: new Date(block.header.timestamp || 0),
            extrinsicHash: event.extrinsic?.hash,
            from: from,
            to: to,
            amount: amount,
            fee: event.extrinsic?.fee || BigInt(0),
          });
        }
      }
    }
  }
  return transfers;
}

function updateVolume(
  swap: Swap,
  currentVolume: HistoricalVolume | undefined,
  oldVolume: HistoricalVolume | undefined
) {
  const newVolume = new HistoricalVolume({
    id: swap.pool.id + "-" + swap.paraChainBlockHeight,
    pool: swap.pool,
    assetAId: swap.pool.assetAId,
    assetBId: swap.pool.assetBId,
    averagePrice: 0,
    assetAVolumeIn: currentVolume?.assetAVolumeIn || BigInt(0),
    assetAVolumeOut: currentVolume?.assetAVolumeOut || BigInt(0),
    assetAFee: currentVolume?.assetAFee || BigInt(0),
    assetATotalFees:
      currentVolume?.assetATotalFees || oldVolume?.assetATotalFees || BigInt(0),
    assetATotalVolumeIn:
      currentVolume?.assetATotalVolumeIn ||
      oldVolume?.assetATotalVolumeIn ||
      BigInt(0),
    assetATotalVolumeOut:
      currentVolume?.assetATotalVolumeOut ||
      oldVolume?.assetATotalVolumeOut ||
      BigInt(0),
    assetBVolumeIn: currentVolume?.assetBVolumeIn || BigInt(0),
    assetBVolumeOut: currentVolume?.assetBVolumeOut || BigInt(0),
    assetBFee: currentVolume?.assetBFee || BigInt(0),
    assetBTotalFees:
      currentVolume?.assetBTotalFees || oldVolume?.assetBTotalFees || BigInt(0),
    assetBTotalVolumeIn:
      currentVolume?.assetBTotalVolumeIn ||
      oldVolume?.assetBTotalVolumeIn ||
      BigInt(0),
    assetBTotalVolumeOut:
      currentVolume?.assetBTotalVolumeOut ||
      oldVolume?.assetBTotalVolumeOut ||
      BigInt(0),
    relayChainBlockHeight: swap.relayChainBlockHeight,
    paraChainBlockHeight: swap.paraChainBlockHeight,
  });

  const assetAVolumeIn =
    swap.assetInId === newVolume.assetAId ? swap.assetInAmount : BigInt(0);
  const assetBVolumeIn =
    swap.assetInId === newVolume.assetBId ? swap.assetInAmount : BigInt(0);
  const assetAVolumeOut =
    swap.assetOutId === newVolume.assetAId ? swap.assetOutAmount : BigInt(0);
  const assetBVolumeOut =
    swap.assetOutId === newVolume.assetBId ? swap.assetOutAmount : BigInt(0);
  const assetAFee =
    swap.assetInId === newVolume.assetAId ? swap.assetInFee : swap.assetOutFee;
  const assetBFee =
    swap.assetInId === newVolume.assetBId ? swap.assetInFee : swap.assetOutFee;

  newVolume.assetAVolumeIn += assetAVolumeIn;
  newVolume.assetAVolumeOut += assetAVolumeOut;
  newVolume.assetAFee += assetAFee;
  newVolume.assetATotalVolumeIn += assetAVolumeIn;
  newVolume.assetATotalVolumeOut += assetAVolumeOut;
  newVolume.assetATotalFees += assetAFee;

  newVolume.assetBVolumeIn += assetBVolumeIn;
  newVolume.assetBVolumeOut += assetBVolumeOut;
  newVolume.assetBFee += assetBFee;
  newVolume.assetBTotalVolumeIn += assetBVolumeIn;
  newVolume.assetBTotalVolumeOut += assetBVolumeOut;
  newVolume.assetBTotalFees += assetBFee;

  newVolume.averagePrice = calculateAveragePrice(
    swap,
    newVolume,
    currentVolume,
    oldVolume
  );

  return newVolume;
}

async function handleVolumeUpdates(
  ctx: ProcessorContext<Store>,
  volume: Map<string, HistoricalVolume>,
  assetVolume: Map<string, HistoricalAssetVolume>,
  swap: Swap
) {
  const currentVolume = volume.get(
    swap.pool.id + "-" + swap.paraChainBlockHeight
  );

  const oldVolume =
    currentVolume ||
    getLastVolumeFromCache(volume, swap) ||
    (await getOldVolume(ctx, swap));

  const newVolume = updateVolume(swap, currentVolume, oldVolume);

  volume.set(swap.pool.id + "-" + swap.paraChainBlockHeight, newVolume);

  const [assetInVolume, assetOutVolume] = await getNewAssetVolume(
    ctx,
    assetVolume,
    swap
  );

  assetVolume.set(
    assetInVolume.assetId + "-" + swap.paraChainBlockHeight,
    assetInVolume
  );
  assetVolume.set(
    assetOutVolume.assetId + "-" + swap.paraChainBlockHeight,
    assetOutVolume
  );
}

async function getOldVolume(ctx: ProcessorContext<Store>, swap: Swap) {
  return await ctx.store.findOne(HistoricalVolume, {
    where: {
      pool: { id: swap.pool.id },
    },
    order: {
      paraChainBlockHeight: "DESC",
    },
  });
}

async function getNewAssetVolume(
  ctx: ProcessorContext<Store>,
  volume: Map<string, HistoricalAssetVolume>,
  swap: Swap
) {
  // Find current block volume
  const currentAssetInVolume = volume.get(
    swap.assetInId + "-" + swap.paraChainBlockHeight
  );

  const currentAssetOutVolume = volume.get(
    swap.assetOutId + "-" + swap.paraChainBlockHeight
  );

  // If not found find last volume in cache
  const cachedVolumeIn = getLastAssetVolumeFromCache(volume, swap.assetInId);
  const cachedVolumeOut = getLastAssetVolumeFromCache(volume, swap.assetOutId);

  // Last known volume for total volume
  const oldAssetInVolume =
    currentAssetInVolume ||
    cachedVolumeIn ||
    (await ctx.store.findOne(HistoricalAssetVolume, {
      where: {
        assetId: swap.assetInId,
      },
      order: {
        paraChainBlockHeight: "DESC",
      },
    }));

  // Last known volume for total volume
  const oldAssetOutVolume =
    currentAssetOutVolume ||
    cachedVolumeOut ||
    (await ctx.store.findOne(HistoricalAssetVolume, {
      where: {
        assetId: swap.assetOutId,
      },
      order: {
        paraChainBlockHeight: "DESC",
      },
    }));

  // Create new entry
  const assetInVolume = initAssetVolume(
    swap.assetInId,
    swap.paraChainBlockHeight,
    swap.relayChainBlockHeight,
    currentAssetInVolume?.volumeIn || BigInt(0),
    BigInt(0),
    oldAssetInVolume?.totalVolumeIn || BigInt(0),
    BigInt(0)
  );

  const assetOutVolume = initAssetVolume(
    swap.assetOutId,
    swap.paraChainBlockHeight,
    swap.relayChainBlockHeight,
    BigInt(0),
    currentAssetOutVolume?.volumeOut || BigInt(0),
    BigInt(0),
    oldAssetOutVolume?.totalVolumeOut || BigInt(0)
  );

  // Update new entry
  assetInVolume.volumeIn += swap.assetInAmount;
  assetInVolume.totalVolumeIn += swap.assetInAmount;
  assetOutVolume.volumeOut += swap.assetOutAmount;
  assetOutVolume.totalVolumeOut += swap.assetOutAmount;

  return [assetInVolume, assetOutVolume];
}

function initAssetVolume(
  assetId: number,
  paraChainBlockHeight: number,
  relayChainBlockHeight: number,
  volumeIn: bigint,
  volumeOut: bigint,
  totalVolumeIn: bigint,
  totalVolumeOut: bigint
) {
  return new HistoricalAssetVolume({
    id: assetId + "-" + paraChainBlockHeight,
    assetId,
    volumeIn,
    volumeOut,
    totalVolumeIn,
    totalVolumeOut,
    relayChainBlockHeight,
    paraChainBlockHeight,
  });
}

function initSwap(
  event: Event,
  hash: string,
  account: Account,
  assetIn: number,
  assetOut: number,
  amountIn: bigint,
  amountOut: bigint,
  feeAsset: number,
  feeAmount: bigint,
  swapType: SwapType,
  pool: Pool,
  blockData: ProcessorBlockData
) {
  return new Swap({
    id: event.id,
    account: account,
    extrinsicHash: hash,
    assetInId: assetIn,
    assetInAmount: amountIn,
    assetInFee: feeAsset === assetIn ? feeAmount : BigInt(0),
    assetOutId: assetOut,
    assetOutAmount: amountOut,
    assetOutFee: feeAsset === assetOut ? feeAmount : BigInt(0),
    swapPrice: new BigNumber(amountIn.toString())
      .div(amountOut.toString())
      .toNumber(),
    pool: pool,
    relayChainBlockHeight: blockData.relayChainBlockHeight || 0,
    paraChainBlockHeight: blockData.paraChainBlockHeight,
    type: swapType,
  });
}

function getLastAssetVolumeFromCache(
  volume: Map<string, HistoricalAssetVolume>,
  assetId: number
) {
  return volume.get(
    Array.from(volume.keys())
      .filter((k) => {
        return k.startsWith(assetId + "-");
      })
      .sort((a, b) => {
        return parseInt(b.split("-")[1]) - parseInt(a.split("-")[1]);
      })[0]
  );
}

function getLastVolumeFromCache(
  volume: Map<string, HistoricalVolume>,
  swap: Swap
) {
  return volume.get(
    Array.from(volume.keys())
      .filter((k) => {
        return k.startsWith(swap.pool.id + "-");
      })
      .sort((a, b) => {
        return parseInt(b.split("-")[1]) - parseInt(a.split("-")[1]);
      })[0]
  );
}

function isPoolTransfer(pools: string[], from: string, to: string): boolean {
  for (let p of pools) {
    if (p == from || p == to) return true;
  }
  return false;
}

function calculateAveragePrice(
  swap: Swap,
  newVolume: HistoricalVolume,
  currentVolume?: HistoricalVolume,
  oldVolume?: HistoricalVolume
) {
  const totalVolume = oldVolume
    ? oldVolume.assetATotalVolumeIn + oldVolume.assetATotalVolumeOut
    : currentVolume
    ? currentVolume.assetATotalVolumeIn + currentVolume.assetATotalVolumeOut
    : BigInt(0);

  const volume = newVolume.assetAVolumeIn + newVolume.assetAVolumeOut;

  const price =
    swap.assetInId === swap.pool.assetAId ? swap.swapPrice : 1 / swap.swapPrice;

  const oldPrice = currentVolume?.averagePrice || oldVolume?.averagePrice || 0;

  return oldPrice
    ? new BigNumber(totalVolume.toString())
        .multipliedBy(oldPrice)
        .plus(new BigNumber(volume.toString()).multipliedBy(price))
        .dividedBy(
          new BigNumber(totalVolume.toString()).plus(volume.toString())
        )
        .toNumber()
    : price;
}

async function getAssetBalance(
  block: BlockHeader,
  assetId: number,
  account: string
): Promise<bigint> {
  if (assetId === 0) {
    return storage.system.account.v100
      .get(block, account)
      .then((accountInfo) => {
        return accountInfo?.data.free || BigInt(0);
      });
  } else {
    return storage.tokens.accounts.v108
      .get(block, account, assetId)
      .then((accountInfo) => {
        return accountInfo?.free || BigInt(0);
      });
  }
}

function getAccount(m: Map<string, Account>, id: string): Account {
  let acc = m.get(id);
  if (acc == null) {
    acc = new Account();
    acc.id = id;
    m.set(id, acc);
  }
  return acc;
}
