import "reflect-metadata";
import { TestingAppChain } from "@proto-kit/sdk";
import { PrivateKey, PublicKey, UInt64, Bool } from "o1js";
import { Balance, Balances, BalancesKey, TokenId } from "./Balances";
import { LPTokenId, PoolKey, XYK } from "./XYK";
import { WrappedTokenIdArray } from "./WrappedArrays";
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

  // Restrict use of zero for tokenId
  const tokenA = TokenId.from(5);
  const tokenB = TokenId.from(7);
  const tokenC = TokenId.from(9);

  let appChain: TestingAppChain<RuntimeModules>;

  let balances: Balances;
  let xyk: XYK;
  let admin: Admin;

  const balanceToMint = 10_000n;
  const initialLiquidityA = 1000n;
  const initialLiquidityB = 2000n;
  const initialLiquidityC = 3000n;

  let poolAB: PoolKey = PoolKey.fromTokenPair(tokenA, tokenB),
    poolBC: PoolKey = PoolKey.fromTokenPair(tokenB, tokenC);
  let reserveA = 0n, // Reserve A in A/B pair
    reserveBA = 0n, // Reserve B in A/B pair
    reserveBC = 0n, // Reserve B in B/C pair
    reserveC = 0n; // Reserve C in B/C pair

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

    const tx3 = await appChain.transaction(
      alice,
      () => {
        balances.mintAdmin(tokenC, alice, Balance.from(balanceToMint));
      },
      { nonce },
    );

    await tx3.sign();
    await tx3.send();
    const block3 = await appChain.produceBlock();

    expect(block3?.txs[0].status).toBe(true);

    const balanceA = await getBalance(tokenA, alice);
    const balanceB = await getBalance(tokenB, alice);
    const balanceC = await getBalance(tokenC, alice);

    expect(balanceA?.toBigInt()).toBe(balanceToMint);
    expect(balanceB?.toBigInt()).toBe(balanceToMint);
    expect(balanceC?.toBigInt()).toBe(balanceToMint);
  });

  describe("settings", () => {
    const onePercentFee = UInt64.from(100);
    it("should enable fee setting", async () => {
      const tx = await appChain.transaction(
        alice,
        () => {
          xyk.enableFeeSetting(
            onePercentFee
          );
        },
        { nonce },
      );
      await tx.sign();
      await tx.send();
      const block = await appChain.produceBlock();

      expect(block?.txs[0].status).toBe(true);

      expect((await appChain.query.runtime.XYK.fees.get(onePercentFee))?.toBoolean()).toBe(true);
    });

    it("should disable fee setting", async () => {
      const tx = await appChain.transaction(
        alice,
        () => {
          xyk.disableFeeSetting(
            onePercentFee
          );
        },
        { nonce },
      );
      await tx.sign();
      await tx.send();
      const block = await appChain.produceBlock();

      expect(block?.txs[0].status).toBe(true);

      expect((await appChain.query.runtime.XYK.fees.get(onePercentFee))?.toBoolean()).toBe(false);
    })
  })

  describe("pool interactions", () => {
    it("should create an A/B pair", async () => {
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

      poolAB = PoolKey.fromTokenPair(tokenA, tokenB);

      reserveA = initialLiquidityA;
      reserveBA = initialLiquidityB;

      expect((await getBalance(tokenA, poolAB))?.toBigInt()).toBe(reserveA);
      expect((await getBalance(tokenB, poolAB))?.toBigInt()).toBe(reserveBA);
    });

    it("should create a B/C pair", async () => {
      const tx = await appChain.transaction(
        alice,
        () => {
          xyk.createPool(
            tokenB,
            tokenC,
            Balance.from(initialLiquidityB),
            Balance.from(initialLiquidityC),
          );
        },
        { nonce },
      );

      await tx.sign();
      await tx.send();
      const block = await appChain.produceBlock();

      expect(block?.txs[0].status).toBe(true);

      const balanceB = await getBalance(tokenB, alice);
      const balanceC = await getBalance(tokenC, alice);
      const balanceLP = await getBalance(
        LPTokenId.fromTokenPair(tokenB, tokenC),
        alice,
      );

      expect(balanceB?.toBigInt()).toBe(balanceToMint - initialLiquidityB * 2n);
      expect(balanceC?.toBigInt()).toBe(balanceToMint - initialLiquidityC);
      expect(balanceLP?.toBigInt()).toBe(
        initialLiquidityB < initialLiquidityC
          ? initialLiquidityB
          : initialLiquidityC,
      );

      poolBC = PoolKey.fromTokenPair(tokenB, tokenC);

      reserveBC = initialLiquidityB;
      reserveC = initialLiquidityC;

      expect((await getBalance(tokenB, poolBC))?.toBigInt()).toBe(reserveBC);
      expect((await getBalance(tokenC, poolBC))?.toBigInt()).toBe(reserveC);
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
      afterEach(async () => {
        // Check reserves
        expect((await getBalance(tokenA, poolAB))?.toBigInt()).toBe(reserveA);
        expect((await getBalance(tokenB, poolAB))?.toBigInt()).toBe(reserveBA);
        expect((await getBalance(tokenB, poolBC))?.toBigInt()).toBe(reserveBC);
        expect((await getBalance(tokenC, poolBC))?.toBigInt()).toBe(reserveC);
        // Log reserves
        // console.log("Reserves:", reserveA, reserveB);
      });

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
          balanceToMint - initialLiquidityB * 2n - amountB.toBigInt(),
        );
        expect(balanceLP?.toBigInt()).toBe(
          initialBalanceLP.add(lpAddition).toBigInt(),
        );

        reserveA += amountA.toBigInt();
        reserveBA += amountB.toBigInt();
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
        expect(balanceB?.toBigInt()).toBe(
          balanceToMint - initialLiquidityB * 2n,
        ); // Second pool
        expect(balanceLP?.toBigInt()).toBe(initialBalanceLP.toBigInt());

        reserveA -= amountA.toBigInt();
        reserveBA -= amountB.toBigInt();
      });
    });

    describe("swap", () => {
      let aliceBalanceA = balanceToMint - initialLiquidityA;
      let aliceBalanceB = balanceToMint - initialLiquidityB * 2n;
      let aliceBalanceC = balanceToMint - initialLiquidityC;

      const wrappedPath = new WrappedTokenIdArray({ arr: [tokenA, tokenB] });
      const dummies: TokenId[] = Array(10 - wrappedPath.arr.length).fill(
        TokenId.from(0),
      );
      wrappedPath.arr = wrappedPath.arr.concat(dummies);

      it("should swap exact A for B", async () => {
        const amountIn = 100n;
        const amountOut = (amountIn * reserveBA) / (amountIn + reserveA); //minAmountOut but is exact amount out
        const tx = await appChain.transaction(
          alice,
          () => {
            xyk.swapExactTokensForTokens(
              Balance.from(amountIn),
              Balance.from(amountOut),
              wrappedPath,
            );
          },
          { nonce },
        );

        await tx.sign();
        await tx.send();
        const block = await appChain.produceBlock();

        expect(block?.txs[0].status).toBe(true);

        aliceBalanceA -= amountIn;
        aliceBalanceB += amountOut;

        // Get live balances of Alice
        const balanceA = await getBalance(tokenA, alice);
        const balanceB = await getBalance(tokenB, alice);

        expect(balanceA?.toBigInt()).toBe(aliceBalanceA);
        expect(balanceB?.toBigInt()).toBe(aliceBalanceB);

        reserveA += amountIn;
        reserveBA -= amountOut;
      });

      it("should swap A for exact B", async () => {
        const maxAmountIn = 100n;
        const amountOut = 150n;
        const amountIn = (amountOut * reserveA) / (reserveBA - amountOut);
        const tx = await appChain.transaction(
          alice,
          () => {
            xyk.swapTokensForExactTokens(
              Balance.from(maxAmountIn),
              Balance.from(amountOut),
              wrappedPath,
            );
          },
          { nonce },
        );

        await tx.sign();
        await tx.send();
        const block = await appChain.produceBlock();

        expect(block?.txs[0].status).toBe(true);

        aliceBalanceA -= amountIn;
        aliceBalanceB += amountOut;

        const balanceA = await getBalance(tokenA, alice);
        const balanceB = await getBalance(tokenB, alice);

        expect(balanceA?.toBigInt()).toBe(aliceBalanceA);
        expect(balanceB?.toBigInt()).toBe(aliceBalanceB);

        reserveA += amountIn;
        reserveBA -= amountOut;
      });

      it("should swap exact A for C", async () => {
        const amountIn = 100n;
        const amountOutAB = (amountIn * reserveBA) / (amountIn + reserveA);
        const amountOutBC =
          (amountOutAB * reserveC) / (amountOutAB + reserveBC);

        // Add tokenC to the path
        wrappedPath.arr[2] = tokenC;

        const tx = await appChain.transaction(
          alice,
          () => {
            xyk.swapExactTokensForTokens(
              Balance.from(amountIn),
              Balance.from(amountOutBC),
              wrappedPath,
            );
          },
          { nonce },
        );

        await tx.sign();
        await tx.send();
        const block = await appChain.produceBlock();

        expect(block?.txs[0].status).toBe(true);

        aliceBalanceA -= amountIn;
        aliceBalanceC += amountOutBC;

        // Get live balances of Alice
        const balanceA = await getBalance(tokenA, alice);
        const balanceC = await getBalance(tokenC, alice);

        expect(balanceA?.toBigInt()).toBe(aliceBalanceA);
        expect(balanceC?.toBigInt()).toBe(aliceBalanceC);

        reserveA += amountIn;
        reserveBA -= amountOutAB;
        reserveBC += amountOutAB;
        reserveC -= amountOutBC;
      });

      it("should swap A for exact C", async () => {
        const maxAmountIn = 200n;
        const amountOut = 150n;
        const amountInBC = (amountOut * reserveBC) / (reserveC - amountOut);
        const amountInAB = (amountInBC * reserveA) / (reserveBA - amountInBC);

        const tx = await appChain.transaction(
          alice,
          () => {
            xyk.swapTokensForExactTokens(
              Balance.from(maxAmountIn),
              Balance.from(amountOut),
              wrappedPath,
            );
          },
          { nonce },
        );

        await tx.sign();
        await tx.send();
        const block = await appChain.produceBlock();

        expect(block?.txs[0].status).toBe(true);

        aliceBalanceA -= amountInAB;
        aliceBalanceC += amountOut;

        const balanceA = await getBalance(tokenA, alice);
        const balanceC = await getBalance(tokenC, alice);

        expect(balanceA?.toBigInt()).toBe(aliceBalanceA);
        expect(balanceC?.toBigInt()).toBe(aliceBalanceC);

        reserveA += amountInAB;
        reserveBA -= amountInBC;
        reserveBC += amountInBC;
        reserveC -= amountOut;
      });
    });
  });
});
