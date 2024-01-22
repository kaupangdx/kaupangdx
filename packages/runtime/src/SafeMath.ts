import { Provable, Bool, UInt64 } from "o1js";
import { assert } from "@proto-kit/protocol";

export const errors = {
  subtractionUnderflow: () => "Subtraction underflow",
  divisionByZero: () => "Division by zero",
};

export class SafeMath {
  public static safeSub(
    minuend: UInt64,
    subtrahend: UInt64,
    revert: Bool,
  ): UInt64 {
    const isMinuendSufficient = minuend.greaterThanOrEqual(subtrahend);
    // Revert if minuend is insufficient and revert is true
    assert(
      isMinuendSufficient.not().and(revert).not(),
      errors.subtractionUnderflow(),
    );

    const safeMinuend = Provable.if(
      isMinuendSufficient,
      UInt64,
      minuend,
      minuend.add(subtrahend),
    );

    return safeMinuend.sub(subtrahend);
  }

  public static safeDiv(
    numerator: UInt64,
    denominator: UInt64,
    revert: Bool,
  ): UInt64 {
    const safeDenominator = this.getSafeDenominator(denominator, revert);
    return numerator.div(safeDenominator);
  }

  public static getSafeDenominator(denominator: UInt64, revert: Bool): UInt64 {
    const isDenominatorZero = denominator.equals(UInt64.zero);
    // Revert if denominator is zero and revert is true
    assert(isDenominatorZero.and(revert).not(), errors.divisionByZero());

    return Provable.if(isDenominatorZero, UInt64, UInt64.from(1), denominator);
  }
}
