import { TypeormDatabase, Store } from "@subsquid/typeorm-store";
import { In } from "typeorm";
import { isNotNullOrUndefined } from "./helpers";

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

    console.log("Found pool data for pool " + p + "... mapping new data");

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
    "Got " + poolPriceData.poolPrices.length + " pool price data,",
    " " + poolPriceData.swaps.length + " swaps,",
    " " + poolPriceData.assetVolume.length + " asset volume data,",
    " " + poolPriceData.volume.length + " volume data"
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

function getAccount(m: Map<string, Account>, id: string): Account {
  let acc = m.get(id);
  if (acc == null) {
    acc = new Account();
    acc.id = id;
    m.set(id, acc);
  }
  return acc;
}

async function getPoolPriceData(
  ctx: ProcessorContext<Store>,
  pools: Pool[],
  accounts: Map<string, Account>
) {
  let poolPrices: Promise<HistoricalBlockPrice | null>[][] = [];
  let blocksData: ProcessorBlockData[] = [];
  for (let block of ctx.blocks) {
    const blockData: ProcessorBlockData = {
      relayChainBlockHeight: null,
      paraChainBlockHeight: block.header.height,
      timestamp: new Date(block.header.timestamp || 0),
      swaps: [],
      volume: new Map<string, HistoricalVolume>(),
      assetVolume: new Map<string, HistoricalAssetVolume>(),
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
          console.log(
            `No pool found for event: 
             ${event.name} ${event.id} ${event.extrinsic?.hash}
            This is probably a BUG`
          );
          continue;
        }

        const swap = createSwap(
          event,
          event.extrinsic?.hash || "",
          getAccount(accounts, buyEvent.who),
          buyEvent.assetIn,
          buyEvent.assetOut,
          buyEvent.buyPrice,
          buyEvent.amount,
          buyEvent.feeAsset,
          buyEvent.feeAmount,
          SwapType.BUY,
          swapPool,
          blockData
        );

        blockData.swaps.push(swap);

        const currentVolume = blockData.volume.get(
          swap.pool.id + "-" + swap.paraChainBlockHeight
        );
        const oldVolume = currentVolume || (await getOldVolume(ctx, swap));
        const newVolume = updateVolume(swap, currentVolume, oldVolume);
        blockData.volume.set(
          newVolume.pool.id + "-" + swap.paraChainBlockHeight,
          newVolume
        );

        const [assetInVolume, assetOutVolume] = await getAssetVolume(
          ctx,
          blockData.assetVolume,
          swap
        );

        assetInVolume.volumeIn += swap.assetInAmount;
        assetInVolume.totalVolumeIn += swap.assetInAmount;
        assetOutVolume.volumeOut += swap.assetOutAmount;
        assetOutVolume.totalVolumeOut += swap.assetOutAmount;

        blockData.assetVolume.set(
          assetInVolume.assetId + "-" + swap.paraChainBlockHeight,
          assetInVolume
        );
        blockData.assetVolume.set(
          assetOutVolume.assetId + "-" + swap.paraChainBlockHeight,
          assetOutVolume
        );
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
          console.log(
            `No pool found for event: 
             ${event.name} ${event.id} ${event.extrinsic?.hash}
            This is probably a BUG`
          );
          continue;
        }

        const swap = createSwap(
          event,
          event.extrinsic?.hash || "",
          getAccount(accounts, sellEvent.who),
          sellEvent.assetIn,
          sellEvent.assetOut,
          sellEvent.amount,
          sellEvent.salePrice,
          sellEvent.feeAsset,
          sellEvent.feeAmount,
          SwapType.SELL,
          swapPool,
          blockData
        );

        blockData.swaps.push(swap);

        const currentVolume = blockData.volume.get(
          swap.pool.id + "-" + swap.paraChainBlockHeight
        );
        const oldVolume = currentVolume || (await getOldVolume(ctx, swap));
        const newVolume = updateVolume(swap, currentVolume, oldVolume);
        blockData.volume.set(
          newVolume.pool.id + "-" + swap.paraChainBlockHeight,
          newVolume
        );

        const [assetInVolume, assetOutVolume] = await getAssetVolume(
          ctx,
          blockData.assetVolume,
          swap
        );

        assetInVolume.volumeIn += swap.assetInAmount;
        assetInVolume.totalVolumeIn += swap.assetInAmount;
        assetOutVolume.volumeOut += swap.assetOutAmount;
        assetOutVolume.totalVolumeOut += swap.assetOutAmount;

        blockData.assetVolume.set(
          assetInVolume.assetId + "-" + swap.paraChainBlockHeight,
          assetInVolume
        );
        blockData.assetVolume.set(
          assetOutVolume.assetId + "-" + swap.paraChainBlockHeight,
          assetOutVolume
        );
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
                assetATotalFees: BigInt(0), // TODO: Fees
                assetBTotalFees: BigInt(0), // TODO: Fees
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
    assetVolume: blocksData.flatMap((b) => Array.from(b.assetVolume.values())),
    volume: blocksData.flatMap((b) => Array.from(b.volume.values())),
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

  newVolume.assetAVolumeIn += assetAVolumeIn;
  newVolume.assetAVolumeOut += assetAVolumeOut;
  newVolume.assetATotalVolumeIn += assetAVolumeIn;
  newVolume.assetATotalVolumeOut += assetAVolumeOut;

  newVolume.assetBVolumeIn += assetBVolumeIn;
  newVolume.assetBVolumeOut += assetBVolumeOut;
  newVolume.assetBTotalVolumeIn += assetBVolumeIn;
  newVolume.assetBTotalVolumeOut += assetBVolumeOut;

  return newVolume;
}

async function getAssetVolume(
  ctx: ProcessorContext<Store>,
  volume: Map<string, HistoricalAssetVolume>,
  swap: Swap
) {
  const currentAssetInVolume = volume.get(
    swap.assetInId + "-" + swap.paraChainBlockHeight
  );
  const oldAssetInVolume =
    currentAssetInVolume ||
    (await ctx.store.findOne(HistoricalAssetVolume, {
      where: {
        assetId: swap.assetInId,
      },
      order: {
        paraChainBlockHeight: "DESC",
      },
    }));

  const assetInVolume = initAssetVolume(
    swap.assetInId,
    swap.paraChainBlockHeight,
    swap.relayChainBlockHeight,
    currentAssetInVolume?.volumeIn || BigInt(0),
    BigInt(0),
    currentAssetInVolume?.totalVolumeIn ||
      oldAssetInVolume?.totalVolumeIn ||
      BigInt(0),
    BigInt(0)
  );

  const currentAssetOutVolume = volume.get(
    swap.assetOutId + "-" + swap.paraChainBlockHeight
  );
  const oldAssetOutVolume =
    currentAssetOutVolume ||
    (await ctx.store.findOne(HistoricalAssetVolume, {
      where: {
        assetId: swap.assetOutId,
      },
      order: {
        paraChainBlockHeight: "DESC",
      },
    }));

  const assetOutVolume = initAssetVolume(
    swap.assetOutId,
    swap.paraChainBlockHeight,
    swap.relayChainBlockHeight,
    BigInt(0),
    currentAssetOutVolume?.volumeOut || BigInt(0),
    BigInt(0),
    currentAssetOutVolume?.totalVolumeOut ||
      oldAssetOutVolume?.totalVolumeOut ||
      BigInt(0)
  );

  return [assetInVolume, assetOutVolume];
}

function initAssetVolume(
  assetId: number,
  parachainBlockHeight: number,
  relayChainBlockHeight: number,
  volumeIn: bigint,
  volumeOut: bigint,
  totalVolumeIn: bigint,
  totalVolumeOut: bigint
) {
  return new HistoricalAssetVolume({
    id: assetId + "-" + parachainBlockHeight,
    assetId: assetId,
    volumeIn: volumeIn,
    volumeOut: volumeOut,
    totalVolumeIn: totalVolumeIn,
    totalVolumeOut: totalVolumeOut,
    relayChainBlockHeight: relayChainBlockHeight,
    paraChainBlockHeight: parachainBlockHeight,
  });
}

function createSwap(
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
    price: 0, // TODO: (sellEvent.sellPrice * BigInt(1000000000) / sellEvent.amount),
    pool: pool,
    relayChainBlockHeight: blockData.relayChainBlockHeight || 0,
    paraChainBlockHeight: blockData.paraChainBlockHeight,
    type: swapType,
  });
}

function isPoolTransfer(pools: string[], from: string, to: string): boolean {
  for (let p of pools) {
    if (p == from || p == to) return true;
  }
  return false;
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
