import { InMemorySigner, TestingAppChain } from "@proto-kit/sdk";
import { PrivateKey, UInt64 } from "snarkyjs";
import { Balances, BalancesKey, TokenId } from "./Balances";
import { log } from "@proto-kit/common";
import { Admin } from "./Admin";

log.setLevel("ERROR");

describe("Balances", () => {
  let appChain: TestingAppChain<{
    Balances: typeof Balances;
    Admin: typeof Admin;
  }>;
  let balances: Balances;

  const alicePrivateKey = PrivateKey.random();
  const alice = alicePrivateKey.toPublicKey();
  const bobPrivateKey = PrivateKey.random();
  const bob = bobPrivateKey.toPublicKey();
  const tokenId = TokenId.from(0);

  beforeAll(async () => {
    appChain = TestingAppChain.fromRuntime({
      modules: {
        Balances,
        Admin,
      },
      config: {
        Balances: {},
        Admin: {},
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
    it("should transfer a balance from alice to bob", async () => {
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

    it("should not transfer a balance from alice to bob, if the transaction is not signed properly", async () => {
      const tx = appChain.transaction(alice, () => {
        balances.transferSigned(tokenId, alice, bob, UInt64.from(500));
      });

      const inMemorySigner = appChain.resolveOrFail("Signer", InMemorySigner);
      inMemorySigner.config.signer = bobPrivateKey;

      await tx.sign();
      await tx.send();

      expect(async () => {
        await appChain.produceBlock();
      }).rejects.toThrow(/create a block with zero transactions/);
    });
  });
});
