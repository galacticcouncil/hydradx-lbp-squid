import { HistoricalVolume, Swap, Pool, HistoricalAssetVolume } from "./model";
import type * as base from "@subsquid/substrate-data";

interface TransferEvent {
  id: string;
  assetId: number;
  blockNumber: number;
  timestamp: Date;
  extrinsicHash?: string;
  from: string;
  to: string;
  amount: bigint;
  fee?: bigint;
}

interface LBPPoolDataUpdate {
  owner: string;
  feeCollector: string;
  initialWeight: number;
  finalWeight: number;
  fee: [number, number];
  startBlockNumber?: number;
  endBlockNumber?: number;
  repayTarget?: bigint;
}

interface PoolCreatedEvent {
  id: string;
  assetAId: number;
  assetBId: number;
  assetABalance: bigint;
  assetBBalance: bigint;
  createdAt: Date;
  createdAtParaBlock: number;
  lbpPoolData?: LBPPoolDataUpdate;
}

interface ProcessorBlockData {
  timestamp: Date | null;
  paraChainBlockHeight: number;
  relayChainBlockHeight: number | null;
  swaps: Swap[];
  volume: Map<string, HistoricalVolume>;
  assetVolume: Map<string, HistoricalAssetVolume>;
}

interface FullExtrinsic extends base.Extrinsic {
  success: boolean;
  hash: base.Bytes;
}
