import "reflect-metadata";
import {
  RuntimeModule,
  runtimeMethod,
  state,
  runtimeModule,
} from "@proto-kit/module";
import { StateMap, assert } from "@proto-kit/protocol";

import { Field, Group, Poseidon, Provable, PublicKey, Struct } from "o1js";
import { Balance, Balances, TokenId } from "./Balances";
import { inject } from "tsyringe";

export class TokenPair extends Struct({
  tokenA: TokenId,
  tokenB: TokenId,
}) {
  public static from(tokenA: TokenId, tokenB: TokenId) {
    return Provable.if(
      tokenA.greaterThan(tokenB),
      TokenPair,
      new TokenPair({ tokenA: tokenA, tokenB: tokenB }),
      new TokenPair({ tokenA: tokenB, tokenB: tokenA })
    );
  }
}

export class PoolKey extends PublicKey {
  public static fromTokenIdPair(
    tokenA: TokenId,
    tokenB: TokenId
  ): PoolKey {
    const tokenPair = TokenPair.from(tokenA, tokenB);

    const {
      x,
      y: { x0 },
    } = Poseidon.hashToGroup(TokenPair.toFields(tokenPair));

    const key = PoolKey.fromGroup(Group.fromFields([x, x0]));

    return key;
  }
}

export class LPTokenId extends TokenId {
  public static fromTokenIdPair(
    tokenA: TokenId,
    tokenB: TokenId
  ): TokenId {
    return TokenId.from(
      Poseidon.hash(TokenPair.toFields(TokenPair.from(tokenA, tokenB)))
    );
  }
}

export const errors = {
  poolExists: () => "Pool already exists",
  tokensMatch: () => "Cannot create pool with matching tokens",
  tokenOutAmountTooLow: () => "Token out amount too low",
  tokenInAmountTooHigh: () => "Token in amount too high",
};

@runtimeModule()
export class XYK extends RuntimeModule<unknown> {
  public static defaultPoolValue = Field(0);
  @state() public pools = StateMap.from<PoolKey, Field>(PoolKey, Field);

  public constructor(@inject("Balances") public balances: Balances) {
    super();
  }

  public poolExists(tokenInId: TokenId, tokenOutId: TokenId) {
    const key = PoolKey.fromTokenIdPair(tokenInId, tokenOutId);
    const pool = this.pools.get(key);

    return pool.isSome;
  }

  @runtimeMethod()
  public createPool(
    tokenA: TokenId,
    tokenB: TokenId,
    tokenASupply: Balance,
    tokenBSupply: Balance
  ) {
    assert(tokenA.equals(tokenB).not(), errors.tokensMatch());
    assert(this.poolExists(tokenA, tokenB).not(), errors.poolExists());

    const poolKey = PoolKey.fromTokenIdPair(tokenA, tokenB);
    this.pools.set(poolKey, XYK.defaultPoolValue);

    const creator = this.transaction.sender;

    this.balances.transfer(tokenA, creator, poolKey, tokenASupply);
    this.balances.transfer(tokenB, creator, poolKey, tokenBSupply);

    const lpTokenId = LPTokenId.fromTokenIdPair(tokenA, tokenB);
    this.balances.mint(lpTokenId, creator, tokenASupply);
  }
}
