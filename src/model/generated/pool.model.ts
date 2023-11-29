import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, OneToMany as OneToMany_} from "typeorm"
import * as marshal from "./marshal"
import {Account} from "./account.model"
import {HistoricalBlockPrice} from "./historicalBlockPrice.model"
import {HistoricalVolume} from "./historicalVolume.model"
import {Swap} from "./swap.model"

@Entity_()
export class Pool {
    constructor(props?: Partial<Pool>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    account!: Account

    @Column_("int4", {nullable: false})
    assetAId!: number

    @Column_("int4", {nullable: false})
    assetBId!: number

    @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
    assetABalance!: bigint

    @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
    assetBBalance!: bigint

    @Column_("timestamp with time zone", {nullable: false})
    createdAt!: Date

    @Column_("int4", {nullable: false})
    createdAtParaBlock!: number

    @Column_("int4", {nullable: true})
    startBlockNumber!: number | undefined | null

    @Column_("int4", {nullable: true})
    endBlockNumber!: number | undefined | null

    @Column_("int4", {array: true, nullable: true})
    fee!: (number | undefined | null)[] | undefined | null

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    feeCollector!: Account | undefined | null

    @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: true})
    repayTarget!: bigint | undefined | null

    @Column_("int4", {nullable: true})
    initialWeight!: number | undefined | null

    @Column_("int4", {nullable: true})
    finalWeight!: number | undefined | null

    @Index_()
    @ManyToOne_(() => Account, {nullable: true})
    owner!: Account | undefined | null

    @OneToMany_(() => HistoricalBlockPrice, e => e.pool)
    historicalBlockPrices!: HistoricalBlockPrice[]

    @OneToMany_(() => HistoricalVolume, e => e.pool)
    historicalVolume!: HistoricalVolume[]

    @OneToMany_(() => Swap, e => e.pool)
    swaps!: Swap[]
}
