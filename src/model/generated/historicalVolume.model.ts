import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_} from "typeorm"
import * as marshal from "./marshal"
import {Pool} from "./pool.model"

@Entity_()
export class HistoricalVolume {
    constructor(props?: Partial<HistoricalVolume>) {
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

    @Column_("numeric", {transformer: marshal.floatTransformer, nullable: false})
    averagePrice!: number

    @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
    assetAVolumeIn!: bigint

    @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
    assetAVolumeOut!: bigint

    @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
    assetATotalVolumeIn!: bigint

    @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
    assetATotalVolumeOut!: bigint

    @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
    assetAFee!: bigint

    @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
    assetBFee!: bigint

    @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
    assetATotalFees!: bigint

    @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
    assetBTotalFees!: bigint

    @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
    assetBVolumeIn!: bigint

    @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
    assetBVolumeOut!: bigint

    @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
    assetBTotalVolumeIn!: bigint

    @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
    assetBTotalVolumeOut!: bigint

    @Column_("int4", {nullable: false})
    relayChainBlockHeight!: number

    @Column_("int4", {nullable: false})
    paraChainBlockHeight!: number
}
