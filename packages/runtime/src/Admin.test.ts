import "reflect-metadata";
import { InMemorySigner, TestingAppChain } from "@proto-kit/sdk";
import { PrivateKey, UInt64 } from "snarkyjs";
import { Balances, BalancesKey, TokenId } from "./Balances";
import { log } from "@proto-kit/common";
import { Admin } from "./Admin";

log.setLevel("ERROR");

describe.skip("Admin", () => {
  let appChain: TestingAppChain<{
    Balances: typeof Balances;
    Admin: typeof Admin;
  }>;
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
    admin = appChain.runtime.resolve("Admin");
  });

  describe("setAdmin", () => {
    afterAll(async () => {
      const inMemorySigner = appChain.resolveOrFail("Signer", InMemorySigner);
      inMemorySigner.config.signer = alicePrivateKey;
    });

    it("should set admin when no admin was set yet", async () => {
      const tx = appChain.transaction(alice, () => {
        admin.setAdmin(alice);
      });

      await tx.sign();
      await tx.send();

      const block = await appChain.produceBlock();

      const currentAdmin = await appChain.query.runtime.Admin.admin.get();

      expect(block?.txs[0].status).toBe(true);
      expect(currentAdmin?.toBase58()).toBe(alice.toBase58());
    });

    it("should not set admin when an admin was already set", async () => {
      const tx = appChain.transaction(bob, () => {
        admin.setAdmin(bob);
      });

      const inMemorySigner = appChain.resolveOrFail("Signer", InMemorySigner);
      inMemorySigner.config.signer = bobPrivateKey;

      await tx.sign();
      await tx.send();

      const block = await appChain.produceBlock();

      const currentAdmin = await appChain.query.runtime.Admin.admin.get();

      expect(block?.txs[0].status).toBe(false);
      expect(block?.txs[0].statusMessage).toMatch(/Sender is not admin/);
      expect(currentAdmin?.toBase58()).toBe(alice.toBase58());
    });
  });
});
