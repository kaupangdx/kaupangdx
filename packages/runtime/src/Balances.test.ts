import "reflect-metadata";
import { InMemorySigner, TestingAppChain } from "@proto-kit/sdk";
import { PrivateKey, UInt64 } from "o1js";
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
  let admin: Admin;

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
    admin = appChain.runtime.resolve("Admin");
  });

  describe("mint", () => {
    beforeAll(async () => {
      const tx = await appChain.transaction(alice, () => {
        admin.setAdmin(alice);
      });

      await tx.sign();
      await tx.send();

      await appChain.produceBlock();
    });

    afterAll(async () => {
      const inMemorySigner = appChain.resolveOrFail("Signer", InMemorySigner);
      inMemorySigner.config.signer = alicePrivateKey;
    });

    it("should mint a balance for alice, if alice is admin", async () => {
      const tx = await appChain.transaction(alice, () => {
        balances.mintAdmin(tokenId, alice, UInt64.from(1000));
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

    it("should not mint a balance for bob, if bob is not an admin", async () => {
      const tx = await appChain.transaction(bob, () => {
        balances.mintAdmin(tokenId, bob, UInt64.from(1000));
      });

      const inMemorySigner = appChain.resolveOrFail("Signer", InMemorySigner);
      inMemorySigner.config.signer = bobPrivateKey;

      await tx.sign();
      await tx.send();

      const block = await appChain.produceBlock();

      const bobBalance = await appChain.query.runtime.Balances.balances.get(
        BalancesKey.from({
          tokenId,
          address: bob,
        })
      );

      expect(block?.txs[0].status).toBe(false);
      expect(block?.txs[0].statusMessage).toMatch(/Sender is not admin/);
      expect(bobBalance?.toBigInt() ?? 0n).toBe(0n);
    });
  });

  describe("burn", () => {
    const burnAmount = UInt64.from(1000);

    beforeAll(async () => {
      const tx1 = await appChain.transaction(alice, () => {
        admin.setAdmin(alice);
      });

      await tx1.sign();
      await tx1.send();

      await appChain.produceBlock();
    });

    it("should burn a balance for alice, if alice is admin", async () => {
      const tx = await appChain.transaction(alice, () => {
        balances.burn(tokenId, alice, burnAmount);
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
      expect(aliceBalance?.toBigInt()).toBe(0n);
    });
  });

  describe("transferSigned", () => {
    beforeAll(async () => {
      const tx1 = await appChain.transaction(alice, () => {
        balances.mintAdmin(tokenId, alice, UInt64.from(1000));
      });

      await tx1.sign();
      await tx1.send();

      await appChain.produceBlock();
    });

    it("should transfer a balance from alice to bob", async () => {
      const tx = await appChain.transaction(alice, () => {
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
      const tx = await appChain.transaction(alice, () => {
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
