import { TypeormDatabase, Store } from "@subsquid/typeorm-store";
import { In } from "typeorm";
import * as hexUtil from "@subsquid/util-internal-hex";
import { isNotNullOrUndefined } from "./helpers";

import { processor, ProcessorContext } from "./processor";
import {
  Account,
  HistoricalPoolPriceData,
  LBPPoolData,
  Pool,
  Transfer,
} from "./model";
import { events, storage, calls } from "./types/";
import { BlockHeader } from "@subsquid/substrate-processor";

processor.run(new TypeormDatabase({ supportHotBlocks: true }), async (ctx) => {
  console.log("Getting new pools...");
  const poolsData = await getPools(ctx);
  console.log("Found " + poolsData.length + " pools");

  console.log("Getting new pool updates...");
  const lbpPoolsUpdates = await getLBPPoolUpdates(ctx);
  console.log("Found " + Object.keys(lbpPoolsUpdates).length + " pool updates");

  console.log("Getting new transfers...");
  const transfersData = await getTransfers(ctx, poolsData);
  console.log("Found " + transfersData.length + " transfers");

  console.log("Mapping new data...");
  let accountIds = new Set<string>();
  for (let t of transfersData) {
    accountIds.add(t.from);
    accountIds.add(t.to);
  }

  for (let p of poolsData) {
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

  let transfers: Transfer[] = [];

  for (let t of transfersData) {
    let { id, assetId, extrinsicHash, amount, fee, blockNumber } = t;

    let from = getAccount(accounts, t.from);
    let to = getAccount(accounts, t.to);

    transfers.push(
      new Transfer({
        id,
        assetId,
        extrinsicHash,
        from,
        to,
        amount,
        fee,
      })
    );
  }

  let pools: Pool[] = [];
  let lbpPoolsData = new Map<string, LBPPoolData>();

  for (let p of poolsData) {
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

    if (lbpPoolData) {
      lbpPoolsData.set(
        id,
        new LBPPoolData({
          id: id,
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
    pools.push(
      new Pool({
        id: id,
        account: getAccount(accounts, id),
        assetAId,
        assetBId,
        assetABalance,
        assetBBalance,
        createdAt,
        createdAtParaBlock,
      })
    );
  }

  const poolsPriceData: HistoricalPoolPriceData[] = [];
  console.log("Getting pools from database...");
  const allPools = await ctx.store.find(Pool);
  console.log("Got " + allPools.length + " pools from database");

  console.log("Getting pool price...");
  const poolPriceData = await getPoolPriceData(ctx, allPools);
  console.log("Got " + poolPriceData.length + " pool price data");

  for (let p of poolPriceData) {
    poolsPriceData.push(new HistoricalPoolPriceData(p));
  }

  for (let p in lbpPoolsUpdates) {
    const data = lbpPoolsData.get(p);
    const newData = lbpPoolsUpdates[p];

    if (!data) continue;

    data.owner = getAccount(accounts, newData.owner);
    data.feeCollector = getAccount(accounts, newData.feeCollector);
    data.initialWeight = newData.initialWeight;
    data.finalWeight = newData.finalWeight;
    data.repayTarget = newData.repayTarget;
    data.startBlockNumber = newData.startBlockNumber;
    data.endBlockNumber = newData.endBlockNumber;
  }

  await ctx.store.save(Array.from(accounts.values()));
  await ctx.store.insert(transfers);
  await ctx.store.save(pools);
  await ctx.store.save(Array.from(lbpPoolsData.values()));
  await ctx.store.insert(poolsPriceData);
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

async function createAccounts(
  ctx: ProcessorContext<Store>,
  transferEvents: TransferEvent[]
): Promise<Map<string, Account>> {
  const accountIds = new Set<string>();
  for (let t of transferEvents) {
    accountIds.add(t.from);
    accountIds.add(t.to);
  }

  const accounts = await ctx.store
    .findBy(Account, { id: In([...accountIds]) })
    .then((accounts) => {
      return new Map(accounts.map((a) => [a.id, a]));
    });

  for (let t of transferEvents) {
    updateAccounts(t.from);
    updateAccounts(t.to);
  }

  function updateAccounts(id: string): void {
    const acc = accounts.get(id);
    if (acc == null) {
      accounts.set(id, new Account({ id }));
    }
  }

  return accounts;
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
  pools: Pool[]
): Promise<PoolPriceData[]> {
  let poolPrices: Promise<PoolPriceData | null>[][] = [];
  for (let block of ctx.blocks) {
    for (let call of block.calls) {
      if (call.name == calls.parachainSystem.setValidationData.name) {
        let validationData =
          calls.parachainSystem.setValidationData.v100.decode(call);
        const relayChainBlockNumber =
          validationData.data.validationData.relayParentNumber;
        const parachainBlockNumber = block.header.height;

        poolPrices.push(
          pools.map(
            async (p) =>
              new Promise<PoolPriceData | null>((resolve) => {
                if (p.createdAtParaBlock > parachainBlockNumber) {
                  resolve(null);
                  return;
                }

                Promise.all([
                  getAssetBalance(block.header, p.assetAId, p.id),
                  getAssetBalance(block.header, p.assetBId, p.id),
                ]).then(([assetABalance, assetBBalance]) => {
                  resolve({
                    id: p.id + "-" + parachainBlockNumber,
                    assetABalance: assetABalance,
                    assetBBalance: assetBBalance,
                    pool: p,
                    relayChainBlockHeight: relayChainBlockNumber,
                    paraChainBlockHeight: parachainBlockNumber,
                  });
                });
              })
          )
        );
      }
    }
  }

  return (await Promise.all(poolPrices.flat())).filter(isNotNullOrUndefined);
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
  pools: PoolCreatedEvent[]
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

function isPoolTransfer(
  pools: PoolCreatedEvent[],
  from: string,
  to: string
): boolean {
  for (let p of pools) {
    if (p.id == from || p.id == to) return true;
  }
  return false;
}

async function getAssetBalance(
  block: BlockHeader,
  assetId: number,
  account: string
): Promise<bigint> {
  const acc = hexUtil.decodeHex(account);
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
