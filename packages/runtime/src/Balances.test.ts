import { TestingAppChain } from "@proto-kit/sdk";
import { PrivateKey, UInt64 } from "snarkyjs";
import { Balances, BalancesKey, TokenId } from "./Balances";
import { log } from "@proto-kit/common";

log.setLevel("ERROR");

describe("Balances", () => {
  it("should demonstrate how balances work", async () => {
    const totalSupply = UInt64.from(10_000);

    const appChain = TestingAppChain.fromRuntime({
      modules: {
        Balances,
      },
      config: {
        Balances: {
          totalSupply,
        },
      },
    });

    await appChain.start();

    const alicePrivateKey = PrivateKey.random();
    const alice = alicePrivateKey.toPublicKey();
    const tokenId = TokenId.from(0);

    appChain.setSigner(alicePrivateKey);

    const balances = appChain.runtime.resolve("Balances");

    const tx1 = appChain.transaction(alice, () => {
      balances.mint(tokenId, alice, UInt64.from(1000));
    });

    await tx1.sign();
    await tx1.send();

    const block1 = await appChain.produceBlock();

    const aliceBalance = await appChain.query.runtime.Balances.balances.get(
      BalancesKey.from({
        tokenId,
        address: alice,
      })
    );

    expect(block1?.txs[0].status, block1?.txs[0].statusMessage).toBe(true);
    expect(aliceBalance?.toBigInt()).toBe(1000n);
  });
});
