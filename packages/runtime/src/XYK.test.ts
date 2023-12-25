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

  let pool: PoolKey;
  let reserveA = 0n,
    reserveB = 0n;

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

    const tx = await appChain.transaction(alice, () => {
      admin.setAdmin(alice);
    });

    await tx.sign();
    await tx.send();

    const block = await appChain.produceBlock();
    expect(block?.txs[0].status).toBe(true);
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
    const block1 = await appChain.produceBlock();

    expect(block1?.txs[0].status).toBe(true);

    const tx2 = await appChain.transaction(
      alice,
      () => {
        balances.mintAdmin(tokenB, alice, Balance.from(balanceToMint));
      },
      { nonce },
    );

    await tx2.sign();
    await tx2.send();
    const block2 = await appChain.produceBlock();

    expect(block2?.txs[0].status).toBe(true);

    const balanceIn = await getBalance(tokenA, alice);
    const balanceOut = await getBalance(tokenB, alice);

    expect(balanceIn?.toBigInt()).toBe(balanceToMint);
    expect(balanceOut?.toBigInt()).toBe(balanceToMint);
  });

  describe("pool interactions", () => {
    afterEach(async () => {
      // Check reserves
      expect((await getBalance(tokenA, pool))?.toBigInt()).toBe(reserveA);
      expect((await getBalance(tokenB, pool))?.toBigInt()).toBe(reserveB);
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
      const block = await appChain.produceBlock();

      expect(block?.txs[0].status).toBe(true);

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

      pool = PoolKey.fromTokenPair(tokenA, tokenB);

      reserveA = initialLiquidityA;
      reserveB = initialLiquidityB;

      expect((await getBalance(tokenA, pool))?.toBigInt()).toBe(reserveA);
      expect((await getBalance(tokenB, pool))?.toBigInt()).toBe(reserveB);
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
      let lpAddition: Balance,
        amountA: Balance,
        amountB: Balance,
        initialBalanceLP: Balance;

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
        const block = await appChain.produceBlock();

        expect(block?.txs[0].status).toBe(true);

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

        reserveA += amountA.toBigInt();
        reserveB += amountB.toBigInt();
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
        const block = await appChain.produceBlock();

        expect(block?.txs[0].status).toBe(true);

        const balanceA = await getBalance(tokenA, alice);
        const balanceB = await getBalance(tokenB, alice);
        const balanceLP = await getBalance(
          LPTokenId.fromTokenPair(tokenA, tokenB),
          alice,
        );

        expect(balanceA?.toBigInt()).toBe(balanceToMint - initialLiquidityA);
        expect(balanceB?.toBigInt()).toBe(balanceToMint - initialLiquidityB);
        expect(balanceLP?.toBigInt()).toBe(initialBalanceLP.toBigInt());

        reserveA -= amountA.toBigInt();
        reserveB -= amountB.toBigInt();
      });
    });

    describe("swap", () => {
      it("should swap exact A for B", async () => {
        const amountIn = 100n;
        const amountOut = (amountIn * reserveB) / (amountIn + reserveA); //minAmountOut but is exact amount out
        const tx = await appChain.transaction(
          alice,
          () => {
            xyk.swapExactTokensForTokens(
              tokenA,
              tokenB,
              Balance.from(amountIn),
              Balance.from(amountOut),
            );
          },
          { nonce },
        );

        await tx.sign();
        await tx.send();
        const block = await appChain.produceBlock();

        expect(block?.txs[0].status).toBe(true);

        const balanceA = await getBalance(tokenA, alice);
        const balanceB = await getBalance(tokenB, alice);

        expect(balanceA?.toBigInt()).toBe(
          balanceToMint - initialLiquidityA - amountIn,
        );
        expect(balanceB?.toBigInt()).toBe(
          balanceToMint - initialLiquidityB + amountOut,
        );

        reserveA += amountIn;
        reserveB -= amountOut;
      });
    });
  });
});
