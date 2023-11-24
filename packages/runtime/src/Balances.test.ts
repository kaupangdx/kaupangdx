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

  const mintAmount = UInt64.from(1000);
  const transferAmount = UInt64.from(100);
  const burnAmount = UInt64.from(10);

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
        balances.mintAdmin(tokenId, alice, mintAmount);
      });

      await tx.sign();
      await tx.send();

      const block = await appChain.produceBlock();

      const aliceBalance = await appChain.query.runtime.Balances.balances.get(
        BalancesKey.from({
          tokenId,
          address: alice,
        }),
      );

      expect(block?.txs[0].status, block?.txs[0].statusMessage).toBe(true);
      expect(aliceBalance?.toBigInt()).toBe(mintAmount.toBigInt());
    });

    it("should not mint a balance for bob, if bob is not an admin", async () => {
      const tx = await appChain.transaction(bob, () => {
        balances.mintAdmin(tokenId, bob, mintAmount);
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
        }),
      );

      expect(block?.txs[0].status).toBe(false);
      expect(block?.txs[0].statusMessage).toMatch(/Sender is not admin/);
      expect(bobBalance?.toBigInt() ?? 0n).toBe(0n);
    });
  });

  describe("burn", () => {
    it("should burn a balance for alice", async () => {
      const tx = await appChain.transaction(alice, () => {
        balances.burn(tokenId, burnAmount);
      });

      await tx.sign();
      await tx.send();

      const block = await appChain.produceBlock();

      const aliceBalance = await appChain.query.runtime.Balances.balances.get(
        BalancesKey.from({
          tokenId,
          address: alice,
        }),
      );

      expect(block?.txs[0].status, block?.txs[0].statusMessage).toBe(true);
      expect(aliceBalance?.toBigInt()).toBe(
        mintAmount.sub(burnAmount).toBigInt(),
      );
    });
  });

  describe("transferSigned", () => {
    it("should transfer a balance from alice to bob", async () => {
      const tx = await appChain.transaction(alice, () => {
        balances.transferSigned(tokenId, alice, bob, transferAmount);
      });

      await tx.sign();
      await tx.send();

      const block = await appChain.produceBlock();

      const aliceBalance = await appChain.query.runtime.Balances.balances.get(
        BalancesKey.from({
          tokenId,
          address: alice,
        }),
      );

      const bobBalance = await appChain.query.runtime.Balances.balances.get(
        BalancesKey.from({
          tokenId,
          address: bob,
        }),
      );

      expect(block?.txs[0].status, block?.txs[0].statusMessage).toBe(true);
      expect(aliceBalance?.toBigInt()).toBe(
        mintAmount.sub(burnAmount).sub(transferAmount).toBigInt(),
      );
      expect(bobBalance?.toBigInt()).toBe(transferAmount.toBigInt());
    });

    it("should not transfer a balance from alice to bob, if the transaction is not signed properly", async () => {
      const tx = await appChain.transaction(alice, () => {
        balances.transferSigned(tokenId, alice, bob, transferAmount);
      });

      const inMemorySigner = appChain.resolveOrFail("Signer", InMemorySigner);
      inMemorySigner.config.signer = bobPrivateKey;

      expect(async () => {
        await tx.sign();
      }).rejects.toThrow(/Signer didn't provide correct signature for tx/);
    });
  });
});
