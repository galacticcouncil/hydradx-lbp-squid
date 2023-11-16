import { lookupArchive } from "@subsquid/archive-registry";
import {
  BlockHeader,
  DataHandlerContext,
  SubstrateBatchProcessor,
  SubstrateBatchProcessorFields,
  Event as _Event,
  Call as _Call,
  Extrinsic as _Extrinsic,
} from "@subsquid/substrate-processor";

import { events, calls } from "./types/";

export const processor = new SubstrateBatchProcessor()
  .setDataSource({
    // Lookup archive by the network name in Subsquid registry
    // See https://docs.subsquid.io/substrate-indexing/supported-networks/
    archive: lookupArchive("hydradx", { release: "ArrowSquid" }),
    // Chain RPC endpoint is required on Substrate
    chain: {
      // See https://docs.subsquid.io/substrate-indexing/setup/general/#set-data-source
      url: "wss://rpc.hydradx.cloud",
      capacity: 700,
      rateLimit: 700,
      maxBatchCallSize: 700,
    },
  })
  .addEvent({
    name: [
      events.balances.transfer.name,
      events.tokens.transfer.name,
      events.lbp.poolCreated.name,
      events.lbp.poolUpdated.name,
    ],
    extrinsic: true,
  })
  .addCall({
    name: [calls.parachainSystem.setValidationData.name],
  })
  .setFields({
    event: {
      args: true,
    },
    extrinsic: {
      hash: true,
      fee: true,
    },
    block: {
      timestamp: true,
    },
  })
  .setBlockRange({ from: 3681000 });

export type Fields = SubstrateBatchProcessorFields<typeof processor>;
export type Block = BlockHeader<Fields>;
export type Event = _Event<Fields>;
export type Call = _Call<Fields>;
export type Extrinsic = _Extrinsic<Fields>;
export type ProcessorContext<Store> = DataHandlerContext<Store, Fields>;
