import "reflect-metadata";
import { TestingAppChain } from "@proto-kit/sdk";
import { PrivateKey, PublicKey } from "o1js";
import { Balance, Balances, BalancesKey, TokenId } from "./Balances";
import { LPTokenId, PoolKey, XYK } from "./XYK";
import { Admin } from "./Admin";

type RuntimeModules = {
  Balances: typeof Balances;
  XYK: typeof XYK;
  Admin: typeof Admin;
};

let nonce = 0;

describe("xyk", () => {
  const aliceKey = PrivateKey.fromBase58(
    "EKFEMDTUV2VJwcGmCwNKde3iE1cbu7MHhzBqTmBtGAd6PdsLTifY",
  );
  const alice = aliceKey.toPublicKey();

  const tokenA = TokenId.from(0);
  const tokenB = TokenId.from(1);

  let appChain: TestingAppChain<RuntimeModules>;

  let balances: Balances;
  let xyk: XYK;
  let admin: Admin;

  const balanceToMint = 10_000n;
  const initialLiquidityA = 1000n;
  const initialLiquidityB = 2000n;

  async function getBalance(tokenId: TokenId, address: PublicKey) {
    return await appChain.query.runtime.Balances.balances.get(
      new BalancesKey({
        tokenId,
        address,
      }),
    );
  }

  beforeAll(async () => {
    appChain = TestingAppChain.fromRuntime({
      modules: {
        Balances,
        XYK,
        Admin,
      },
      config: {
        Balances: {},
        XYK: {},
        Admin: {},
      },
    });

    await appChain.start();

    appChain.setSigner(aliceKey);
    balances = appChain.runtime.resolve("Balances");
    xyk = appChain.runtime.resolve("XYK");
    admin = appChain.runtime.resolve("Admin");
  });

  beforeAll(async () => {
    const tx = await appChain.transaction(alice, () => {
      admin.setAdmin(alice);
    });

    await tx.sign();
    await tx.send();

    await appChain.produceBlock();
  });

  it("should mint balance for alice", async () => {
    const tx1 = await appChain.transaction(
      alice,
      () => {
        balances.mintAdmin(tokenA, alice, Balance.from(balanceToMint));
      },
      { nonce },
    );

    await tx1.sign();
    await tx1.send();
    await appChain.produceBlock();

    const tx2 = await appChain.transaction(
      alice,
      () => {
        balances.mintAdmin(tokenB, alice, Balance.from(balanceToMint));
      },
      { nonce },
    );

    await tx2.sign();
    await tx2.send();
    await appChain.produceBlock();

    const balanceIn = await getBalance(tokenA, alice);
    const balanceOut = await getBalance(tokenB, alice);

    expect(balanceIn?.toBigInt()).toBe(balanceToMint);
    expect(balanceOut?.toBigInt()).toBe(balanceToMint);
  });

  it("should create a pool", async () => {
    const tx = await appChain.transaction(
      alice,
      () => {
        xyk.createPool(
          tokenA,
          tokenB,
          Balance.from(initialLiquidityA),
          Balance.from(initialLiquidityB),
        );
      },
      { nonce },
    );

    await tx.sign();
    await tx.send();
    await appChain.produceBlock();

    const balanceIn = await getBalance(tokenA, alice);
    const balanceOut = await getBalance(tokenB, alice);
    const balanceLP = await getBalance(
      LPTokenId.fromTokenPair(tokenA, tokenB),
      alice,
    );

    expect(balanceIn?.toBigInt()).toBe(balanceToMint - initialLiquidityA);
    expect(balanceOut?.toBigInt()).toBe(balanceToMint - initialLiquidityB);
    expect(balanceLP?.toBigInt()).toBe(
      initialLiquidityA < initialLiquidityB
        ? initialLiquidityA
        : initialLiquidityB,
    );
  });

  it("should not create a pool, if one already exists", async () => {
    const tx = await appChain.transaction(
      alice,
      () => {
        xyk.createPool(
          tokenA,
          tokenB,
          Balance.from(initialLiquidityA),
          Balance.from(initialLiquidityB),
        );
      },
      { nonce },
    );

    await tx.sign();
    await tx.send();
    const block = await appChain.produceBlock();

    expect(block?.txs[0].status).toBe(false);
    expect(block?.txs[0].statusMessage).toMatch(/Pool already exists/);
  });

  describe("liquidity management", () => {
    let lpAddition: Balance, amountA: Balance, amountB: Balance, initialBalanceLP: Balance;

    it("should add liquidity", async () => {
      amountA = Balance.from(initialLiquidityA / 2n);
      const amountBMax = Balance.from(initialLiquidityB / 2n + 100n);
      // Pool has just been created so the lp supply and amountB can be calculated like this
      // also at this point total supply and alice's balance are the same thing
      initialBalanceLP = Balance.from(
        initialLiquidityA > initialLiquidityB
          ? initialLiquidityB
          : initialLiquidityA,
      );
      amountB = amountA
        .mul(Balance.from(initialLiquidityB))
        .div(Balance.from(initialLiquidityA));

      const liqA = amountA
        .mul(initialBalanceLP)
        .div(Balance.from(initialLiquidityA));
      const liqB = amountB
        .mul(initialBalanceLP)
        .div(Balance.from(initialLiquidityB));

      lpAddition = liqA.toBigInt() > liqB.toBigInt() ? liqB : liqA;

      const tx = await appChain.transaction(
        alice,
        () => {
          xyk.addLiquidity(tokenA, tokenB, amountA, amountBMax);
          //amountBMax should be slightly above needed amount since inital setup provides token price ratio of 1:2 A:B
        },
        { nonce },
      );

      await tx.sign();
      await tx.send();
      await appChain.produceBlock();

      const balanceA = await getBalance(tokenA, alice);
      const balanceB = await getBalance(tokenB, alice);
      const balanceLP = await getBalance(
        LPTokenId.fromTokenPair(tokenA, tokenB),
        alice,
      );

      expect(balanceA?.toBigInt()).toBe(
        balanceToMint - initialLiquidityA - amountA.toBigInt(),
      );
      expect(balanceB?.toBigInt()).toBe(
        balanceToMint - initialLiquidityB - amountB.toBigInt(),
      );
      expect(balanceLP?.toBigInt()).toBe(
        initialBalanceLP.add(lpAddition).toBigInt(),
      );
    });

    it("should remove liquidity", async () => {
      const tx = await appChain.transaction(
        alice,
        () => {
          xyk.removeLiquidity(tokenA, tokenB, lpAddition, amountA, amountB);
        },
        { nonce },
      );

      await tx.sign();
      await tx.send();
      await appChain.produceBlock();

      const balanceA = await getBalance(tokenA, alice);
      const balanceB = await getBalance(tokenB, alice);
      const balanceLP = await getBalance(
        LPTokenId.fromTokenPair(tokenA, tokenB),
        alice,
      );

      expect(balanceA?.toBigInt()).toBe(
        balanceToMint - initialLiquidityA,
      );
      expect(balanceB?.toBigInt()).toBe(
        balanceToMint - initialLiquidityB,
      );
      expect(balanceLP?.toBigInt()).toBe(
        initialBalanceLP.toBigInt()
      );
    });
  });
});
