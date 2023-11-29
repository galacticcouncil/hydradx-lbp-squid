import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_} from "typeorm"
import * as marshal from "./marshal"
import {Pool} from "./pool.model"

@Entity_()
export class HistoricalBlockPrice {
    constructor(props?: Partial<HistoricalBlockPrice>) {
        Object.assign(this, props)
    }

    /**
     * PoolId-paraChainBlockHeight
     */
    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => Pool, {nullable: true})
    pool!: Pool

    @Column_("int4", {nullable: false})
    assetAId!: number

    @Column_("int4", {nullable: false})
    assetBId!: number

    @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
    assetABalance!: bigint

    @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
    assetBBalance!: bigint

    @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
    assetATotalFees!: bigint

    @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
    assetBTotalFees!: bigint

    @Column_("int4", {nullable: false})
    relayChainBlockHeight!: number

    @Column_("int4", {nullable: false})
    paraChainBlockHeight!: number
}
