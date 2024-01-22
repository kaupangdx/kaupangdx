import "reflect-metadata";
import { RuntimeMethodExecutionContext } from "@proto-kit/protocol";
import { UInt64, Bool } from "o1js";
import { log } from "@proto-kit/common";
import { SafeMath, errors } from "./SafeMath";
import { container } from "tsyringe";

log.setLevel("ERROR");

describe("SafeMath", () => {

  const a: UInt64 = UInt64.from(10);
  let revert = Bool(true);

  const executionContext = container.resolve<RuntimeMethodExecutionContext>(
    RuntimeMethodExecutionContext
  );

  beforeEach(async () => {
    executionContext.clear();
    executionContext.setup({} as any);
  })

  describe("safeDiv", () => {
    it("Should divide", async () => {
      const a: UInt64 = UInt64.from(10);
      const b: UInt64 = UInt64.from(2);

      const c: UInt64 = SafeMath.safeDiv(a, b, revert);

      expect(executionContext.result.status.toBoolean()).toBe(true);
      expect(c.toBigInt()).toBe(5n);
    });

    it("Should revert wtih division by zero", async () => {
      const b: UInt64 = UInt64.from(0);

      const c: UInt64 = SafeMath.safeDiv(a, b, revert);

      expect(executionContext.result.status.toBoolean()).toBe(false);
      expect(executionContext.result.statusMessage).toBe(errors.divisionByZero());
      expect(c.toBigInt()).toBe(10n);
    });

    it("Should get safe denominator with n!=0, returns n", async () => {
      const b: UInt64 = UInt64.from(2);

      const c: UInt64 = SafeMath.getSafeDenominator(b, revert.not());

      expect(executionContext.result.status.toBoolean()).toBe(true);
      expect(c.toBigInt()).toBe(2n);
    });

    it("Should get safe denominator with n==0, returns 1", async () => {
      const b: UInt64 = UInt64.from(0);

      const c: UInt64 = SafeMath.getSafeDenominator(b, revert.not());

      expect(executionContext.result.status.toBoolean()).toBe(true);
      expect(c.toBigInt()).toBe(1n);
    });
  });

  describe("safeSub", () => {
    it("Should subtract", async () => {
      const b: UInt64 = UInt64.from(2);

      const c: UInt64 = SafeMath.safeSub(a, b, revert);

      expect(executionContext.result.status.toBoolean()).toBe(true);
      expect(c.toBigInt()).toBe(8n);
    });

    it("Should revert with subtraction underflow", async () => {
      const b: UInt64 = UInt64.from(11);

      const c: UInt64 = SafeMath.safeSub(a, b, revert);

      expect(executionContext.result.status.toBoolean()).toBe(false);
      expect(executionContext.result.statusMessage).toBe(errors.subtractionUnderflow());
      expect(c.toBigInt()).toBe(10n);
    });
  });
});
