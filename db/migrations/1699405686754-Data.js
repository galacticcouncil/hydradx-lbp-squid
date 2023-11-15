module.exports = class Data1699405686754 {
    name = 'Data1699405686754'

    async up(db) {
        await db.query(`CREATE TABLE "transfer" ("id" character varying NOT NULL, "asset_id" integer NOT NULL, "extrinsic_hash" text, "amount" numeric NOT NULL, "fee" numeric NOT NULL, "from_id" character varying, "to_id" character varying, CONSTRAINT "PK_fd9ddbdd49a17afcbe014401295" PRIMARY KEY ("id"))`)
        await db.query(`CREATE INDEX "IDX_e818cd083f48ed773afe017f7c" ON "transfer" ("asset_id") `)
        await db.query(`CREATE INDEX "IDX_070c555a86b0b41a534a55a659" ON "transfer" ("extrinsic_hash") `)
        await db.query(`CREATE INDEX "IDX_76bdfed1a7eb27c6d8ecbb7349" ON "transfer" ("from_id") `)
        await db.query(`CREATE INDEX "IDX_0751309c66e97eac9ef1149362" ON "transfer" ("to_id") `)
        await db.query(`CREATE INDEX "IDX_f4007436c1b546ede08a4fd7ab" ON "transfer" ("amount") `)
        await db.query(`CREATE TABLE "account" ("id" character varying NOT NULL, CONSTRAINT "PK_54115ee388cdb6d86bb4bf5b2ea" PRIMARY KEY ("id"))`)
        await db.query(`CREATE TABLE "lbp_pool_data" ("id" character varying NOT NULL, "fee" integer array, "start_block_number" integer, "end_block_number" integer, "repay_target" numeric, "initial_weight" integer, "final_weight" integer, "owner_id" character varying, "fee_collector_id" character varying, CONSTRAINT "PK_ea76a226c7a32f3ff74f96f1042" PRIMARY KEY ("id"))`)
        await db.query(`CREATE INDEX "IDX_f5b43080132a238b1bb85c2c3e" ON "lbp_pool_data" ("owner_id") `)
        await db.query(`CREATE INDEX "IDX_144763d0a931052831b07b8beb" ON "lbp_pool_data" ("fee_collector_id") `)
        await db.query(`CREATE TABLE "historical_pool_price_data" ("id" character varying NOT NULL, "asset_a_balance" numeric NOT NULL, "asset_b_balance" numeric NOT NULL, "relay_chain_block_height" integer NOT NULL, "para_chain_block_height" integer NOT NULL, "pool_id" character varying, CONSTRAINT "PK_2c36734f33b242bb2558325f599" PRIMARY KEY ("id"))`)
        await db.query(`CREATE INDEX "IDX_0ce136bcf4cef8f94a5a03e25a" ON "historical_pool_price_data" ("pool_id") `)
        await db.query(`CREATE TABLE "pool" ("id" character varying NOT NULL, "asset_a_id" integer NOT NULL, "asset_b_id" integer NOT NULL, "asset_a_balance" numeric NOT NULL, "asset_b_balance" numeric NOT NULL, "created_at_para_block" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "account_id" character varying, CONSTRAINT "PK_db1bfe411e1516c01120b85f8fe" PRIMARY KEY ("id"))`)
        await db.query(`CREATE INDEX "IDX_7042da86b8de81cc3e9e448f9a" ON "pool" ("account_id") `)
        await db.query(`ALTER TABLE "transfer" ADD CONSTRAINT "FK_76bdfed1a7eb27c6d8ecbb73496" FOREIGN KEY ("from_id") REFERENCES "account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`)
        await db.query(`ALTER TABLE "transfer" ADD CONSTRAINT "FK_0751309c66e97eac9ef11493623" FOREIGN KEY ("to_id") REFERENCES "account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`)
        await db.query(`ALTER TABLE "lbp_pool_data" ADD CONSTRAINT "FK_f5b43080132a238b1bb85c2c3e0" FOREIGN KEY ("owner_id") REFERENCES "account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`)
        await db.query(`ALTER TABLE "lbp_pool_data" ADD CONSTRAINT "FK_144763d0a931052831b07b8beb1" FOREIGN KEY ("fee_collector_id") REFERENCES "account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`)
        await db.query(`ALTER TABLE "historical_pool_price_data" ADD CONSTRAINT "FK_0ce136bcf4cef8f94a5a03e25a2" FOREIGN KEY ("pool_id") REFERENCES "pool"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`)
        await db.query(`ALTER TABLE "pool" ADD CONSTRAINT "FK_7042da86b8de81cc3e9e448f9a7" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`)
    }

    async down(db) {
        await db.query(`DROP TABLE "transfer"`)
        await db.query(`DROP INDEX "public"."IDX_e818cd083f48ed773afe017f7c"`)
        await db.query(`DROP INDEX "public"."IDX_070c555a86b0b41a534a55a659"`)
        await db.query(`DROP INDEX "public"."IDX_76bdfed1a7eb27c6d8ecbb7349"`)
        await db.query(`DROP INDEX "public"."IDX_0751309c66e97eac9ef1149362"`)
        await db.query(`DROP INDEX "public"."IDX_f4007436c1b546ede08a4fd7ab"`)
        await db.query(`DROP TABLE "account"`)
        await db.query(`DROP TABLE "lbp_pool_data"`)
        await db.query(`DROP INDEX "public"."IDX_f5b43080132a238b1bb85c2c3e"`)
        await db.query(`DROP INDEX "public"."IDX_144763d0a931052831b07b8beb"`)
        await db.query(`DROP TABLE "historical_pool_price_data"`)
        await db.query(`DROP INDEX "public"."IDX_0ce136bcf4cef8f94a5a03e25a"`)
        await db.query(`DROP TABLE "pool"`)
        await db.query(`DROP INDEX "public"."IDX_7042da86b8de81cc3e9e448f9a"`)
        await db.query(`ALTER TABLE "transfer" DROP CONSTRAINT "FK_76bdfed1a7eb27c6d8ecbb73496"`)
        await db.query(`ALTER TABLE "transfer" DROP CONSTRAINT "FK_0751309c66e97eac9ef11493623"`)
        await db.query(`ALTER TABLE "lbp_pool_data" DROP CONSTRAINT "FK_f5b43080132a238b1bb85c2c3e0"`)
        await db.query(`ALTER TABLE "lbp_pool_data" DROP CONSTRAINT "FK_144763d0a931052831b07b8beb1"`)
        await db.query(`ALTER TABLE "historical_pool_price_data" DROP CONSTRAINT "FK_0ce136bcf4cef8f94a5a03e25a2"`)
        await db.query(`ALTER TABLE "pool" DROP CONSTRAINT "FK_7042da86b8de81cc3e9e448f9a7"`)
    }
}