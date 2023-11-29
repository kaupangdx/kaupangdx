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

  const tokenInId = TokenId.from(0);
  const tokenOutId = TokenId.from(1);

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
        balances.mintAdmin(tokenInId, alice, Balance.from(balanceToMint));
      },
      { nonce },
    );

    await tx1.sign();
    await tx1.send();
    await appChain.produceBlock();

    const tx2 = await appChain.transaction(
      alice,
      () => {
        balances.mintAdmin(tokenOutId, alice, Balance.from(balanceToMint));
      },
      { nonce },
    );

    await tx2.sign();
    await tx2.send();
    await appChain.produceBlock();

    const balanceIn = await getBalance(tokenInId, alice);
    const balanceOut = await getBalance(tokenOutId, alice);

    expect(balanceIn?.toBigInt()).toBe(balanceToMint);
    expect(balanceOut?.toBigInt()).toBe(balanceToMint);
  });

  it("should create a pool", async () => {
    const tx = await appChain.transaction(
      alice,
      () => {
        xyk.createPool(
          tokenInId,
          tokenOutId,
          Balance.from(initialLiquidityA),
          Balance.from(initialLiquidityB),
        );
      },
      { nonce },
    );

    await tx.sign();
    await tx.send();
    await appChain.produceBlock();

    const balanceIn = await getBalance(tokenInId, alice);
    const balanceOut = await getBalance(tokenOutId, alice);
    const balanceLP = await getBalance(
      LPTokenId.fromTokenPair(tokenInId, tokenOutId),
      alice,
    );

    expect(balanceIn?.toBigInt()).toBe(balanceToMint - initialLiquidityA);
    expect(balanceOut?.toBigInt()).toBe(balanceToMint - initialLiquidityB);
    expect(balanceLP?.toBigInt()).toBe(
      initialLiquidityA < initialLiquidityB ? initialLiquidityA : initialLiquidityB
    );
  });

  it("should not create a pool, if one already exists", async () => {
    const tx = await appChain.transaction(
      alice,
      () => {
        xyk.createPool(
          tokenInId,
          tokenOutId,
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
});
