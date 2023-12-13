import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_} from "typeorm"
import * as marshal from "./marshal"
import {Account} from "./account.model"
import {Pool} from "./pool.model"
import {SwapType} from "./_swapType"

@Entity_()
export class Swap {
    constructor(props?: Partial<Swap>) {
        Object.assign(this, props)
    }

    /**
     * TxId
     */
    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    account!: Account

    @Index_()
    @Column_("text", {nullable: true})
    extrinsicHash!: string | undefined | null

    @Column_("int4", {nullable: false})
    assetInId!: number

    @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
    assetInAmount!: bigint

    @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
    assetInFee!: bigint

    @Column_("int4", {nullable: false})
    assetOutId!: number

    @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
    assetOutAmount!: bigint

    @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
    assetOutFee!: bigint

    @Column_("numeric", {transformer: marshal.floatTransformer, nullable: false})
    swapPrice!: number

    @Index_()
    @ManyToOne_(() => Pool, {nullable: true})
    pool!: Pool

    @Column_("varchar", {length: 4, nullable: false})
    type!: SwapType

    @Column_("int4", {nullable: false})
    relayChainBlockHeight!: number

    @Column_("int4", {nullable: false})
    paraChainBlockHeight!: number
}
