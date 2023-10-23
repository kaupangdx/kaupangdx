import { TestingAppChain } from "@proto-kit/sdk";
import { PrivateKey, UInt64 } from "snarkyjs";
import { Balances, BalancesKey, TokenId } from "./Balances";
import { log } from "@proto-kit/common";

log.setLevel("ERROR");

describe("Balances", () => {
  let appChain: TestingAppChain<{
    Balances: typeof Balances;
  }>;
  let balances: Balances;

  const alicePrivateKey = PrivateKey.random();
  const alice = alicePrivateKey.toPublicKey();
  const bobPrivateKey = PrivateKey.random();
  const bob = bobPrivateKey.toPublicKey();
  const tokenId = TokenId.from(0);

  beforeAll(async () => {
    const totalSupply = UInt64.from(10_000);

    appChain = TestingAppChain.fromRuntime({
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

    appChain.setSigner(alicePrivateKey);
    balances = appChain.runtime.resolve("Balances");
  });

  describe("mint", () => {
    it("should mint a balance for alice", async () => {
      const tx = appChain.transaction(alice, () => {
        balances.mint(tokenId, alice, UInt64.from(1000));
      });

      await tx.sign();
      await tx.send();

      const block = await appChain.produceBlock();

      const aliceBalance = await appChain.query.runtime.Balances.balances.get(
        BalancesKey.from({
          tokenId,
          address: alice,
        })
      );

      expect(block?.txs[0].status, block?.txs[0].statusMessage).toBe(true);
      expect(aliceBalance?.toBigInt()).toBe(1000n);
    });
  });

  describe("transferSigned", () => {
    it("should mint a balance for alice", async () => {
      const tx = appChain.transaction(alice, () => {
        balances.transferSigned(tokenId, alice, bob, UInt64.from(500));
      });

      await tx.sign();
      await tx.send();

      const block = await appChain.produceBlock();

      const aliceBalance = await appChain.query.runtime.Balances.balances.get(
        BalancesKey.from({
          tokenId,
          address: alice,
        })
      );

      const bobBalance = await appChain.query.runtime.Balances.balances.get(
        BalancesKey.from({
          tokenId,
          address: bob,
        })
      );

      expect(block?.txs[0].status, block?.txs[0].statusMessage).toBe(true);
      expect(aliceBalance?.toBigInt()).toBe(500n);
      expect(bobBalance?.toBigInt()).toBe(500n);
    });
  });
});
