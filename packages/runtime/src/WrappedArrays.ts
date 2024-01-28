import {
  Provable,
  Bool,
  Struct,
  UInt64
} from "o1js";
import { assert } from "@proto-kit/protocol";
import {
  TokenId,
  Balance
} from "./Balances";

export const errors = {
  invalidArrayLength: () => "Invalid array length",
}

export class WrappedTokenIdMatrix extends Struct({
  matrix: Provable.Array(Provable.Array(TokenId, 10), 10)
}) {
  public unwrap(validateLength: Bool) {
    let matrix = this.matrix;
    for (let i = 0; i < 10; i++) {
      let arr = matrix[i];
      validateArrayLength(arr, validateLength);
      matrix[i] = arr;
    }
    return matrix;
  }
}

// TokenId extends Field
export class WrappedTokenIdArray extends Struct({
  arr: Provable.Array(TokenId, 10)
}) {
  public unwrap(validateLength: Bool) {
    const arr = this.arr;
    validateArrayLength(arr, validateLength);
    return arr;
  }
}

// Balance extends UInt64
export class WrappedBalanceArray extends Struct({
  arr: Provable.Array(Balance, 10),
}) {
  public unwrap(validateLength: Bool) {
    const arr = this.arr;
    validateArrayLength(arr, validateLength);
    return arr;
  }
}

export class WrappedBoolArray extends Struct({
  arr: Provable.Array(Bool, 10),
}) {
  public unwrap(validateLength: Bool) {
    const arr = this.arr;
    validateArrayLength(arr, validateLength);
    return arr;
  }
}

export function validateArrayLength(arr: any[], validateLength: Bool) {
    assert(
      UInt64.from(arr.length).equals(UInt64.from(10)).or(validateLength.not()),
      errors.invalidArrayLength(),
    );
}
