import {sts, Block, Bytes, Option, Result, EventType, RuntimeCtx} from '../support'
import * as v176 from '../v176'

export const poolCreated =  {
    name: 'LBP.PoolCreated',
    /**
     * Pool was created by the `CreatePool` origin.
     */
    v176: new EventType(
        'LBP.PoolCreated',
        sts.struct({
            pool: v176.AccountId32,
            data: v176.Pool,
        })
    ),
}

export const poolUpdated =  {
    name: 'LBP.PoolUpdated',
    /**
     * Pool data were updated.
     */
    v176: new EventType(
        'LBP.PoolUpdated',
        sts.struct({
            pool: v176.AccountId32,
            data: v176.Pool,
        })
    ),
}
