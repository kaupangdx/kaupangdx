import "reflect-metadata";
import { TestingAppChain } from "@proto-kit/sdk";
import { PrivateKey, UInt64, Bool } from "o1js";
import { log } from "@proto-kit/common";
import { SafeMath, errors } from "./SafeMath";

log.setLevel("ERROR");

describe("SafeMath", () => {
  let appChain: TestingAppChain<{
    SafeMath: typeof SafeMath;
  }>;

  let safeMath: SafeMath;

  const alicePrivateKey = PrivateKey.random();
  const alice = alicePrivateKey.toPublicKey();

  let revert = Bool(true);

  beforeAll(async () => {
    appChain = TestingAppChain.fromRuntime({
      modules: {
        SafeMath,
      },
      config: {
        SafeMath: {},
      },
    });

    await appChain.start();

    appChain.setSigner(alicePrivateKey);
    safeMath = appChain.runtime.resolve("SafeMath");
  });

  describe("Safe Division", () => {
    it("Should divide", async () => {
      const a: UInt64 = UInt64.from(10);
      const b: UInt64 = UInt64.from(2);

      const tx = await appChain.transaction(alice, () => {
        safeMath.safeDiv(a, b, revert);
      });

      await tx.sign();
      await tx.send();

      const block = await appChain.produceBlock();

      expect(block?.txs[0].status).toBe(true);
    });

    it("Should not divide by zero", async () => {
      const a: UInt64 = UInt64.from(10);
      const b: UInt64 = UInt64.from(0);

      const tx = await appChain.transaction(alice, () => {
        safeMath.safeDiv(a, b, revert);
      });

      await tx.sign();
      await tx.send();

      const block = await appChain.produceBlock();
      expect(block?.txs[0].status).toBe(false);
      expect(block?.txs[0].statusMessage).toBe(errors.divisionByZero());
    });
  });
});
