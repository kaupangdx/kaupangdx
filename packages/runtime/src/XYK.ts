import "reflect-metadata";
import {
  RuntimeModule,
  runtimeMethod,
  state,
  runtimeModule,
} from "@proto-kit/module";
import { StateMap, assert } from "@proto-kit/protocol";

import {
  Field,
  Group,
  Poseidon,
  Provable,
  PublicKey,
  Struct,
  UInt64,
} from "o1js";
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
      new TokenPair({ tokenA: tokenB, tokenB: tokenA }),
    );
  }
}

export class PoolKey extends PublicKey {
  public static fromTokenPair(tokenA: TokenId, tokenB: TokenId): PoolKey {
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
  public static fromTokenPair(tokenA: TokenId, tokenB: TokenId): TokenId {
    return TokenId.from(
      Poseidon.hash(TokenPair.toFields(TokenPair.from(tokenA, tokenB))),
    );
  }
}

export const MINIMUM_LIQUIDITY = UInt64.from(100);

export const errors = {
  tokenASupplyIsZero: () => "Token A supply is zero",
  tokenBSupplyIsZero: () => "Token B supply is zero",
  zeroAmount: () => "Cannot deposit zero amount",
  poolExists: () => "Pool already exists",
  poolDoesNotExist: () => "Pool does not exist",
  tokensMatch: () => "Cannot create pool with matching tokens",
  amountOutTooLow: () => "Token out amount too low",
  amountInTooHigh: () => "Token in amount too high",
};

@runtimeModule()
export class XYK extends RuntimeModule<unknown> {
  public static defaultPoolValue = Field(0);
  @state() public pools = StateMap.from<PoolKey, Field>(PoolKey, Field);

  public constructor(@inject("Balances") public balances: Balances) {
    super();
  }

  public poolExists(tokenA: TokenId, tokenB: TokenId) {
    const key = PoolKey.fromTokenPair(tokenA, tokenB);
    const pool = this.pools.get(key);

    return pool.isSome;
  }

  public assertPoolExists(tokenA: TokenId, tokenB: TokenId) {
    assert(this.poolExists(tokenA, tokenB), errors.poolDoesNotExist());
  }

  @runtimeMethod()
  public createPool(
    tokenA: TokenId,
    tokenB: TokenId,
    tokenASupply: Balance,
    tokenBSupply: Balance,
  ) {
    assert(tokenA.equals(tokenB).not(), errors.tokensMatch());
    assert(this.poolExists(tokenA, tokenB).not(), errors.poolExists());

    assert(tokenASupply.greaterThan(UInt64.zero), errors.tokenASupplyIsZero());
    assert(tokenBSupply.greaterThan(UInt64.zero), errors.tokenBSupplyIsZero());

    const poolKey = PoolKey.fromTokenPair(tokenA, tokenB);
    this.pools.set(poolKey, XYK.defaultPoolValue);

    const creator = this.transaction.sender;

    this.balances.transfer(tokenA, creator, poolKey, tokenASupply);
    this.balances.transfer(tokenB, creator, poolKey, tokenBSupply);

    const lpToken = LPTokenId.fromTokenPair(tokenA, tokenB);
    // sqrt(supplyA, supplyB) - MINIMUM_LIQUIDITY
    // We're dealing with uint type so modular square root should be fine
    const liquidity = UInt64.from(
      Field(tokenASupply.mul(tokenBSupply).toBigInt()).sqrt(),
    ).sub(MINIMUM_LIQUIDITY);
    // Mint lp tokens to user
    this.balances.mint(lpToken, creator, liquidity);
    // Minimum liquidity amount of  should be permanently locked away
    this.balances.mint(lpToken, PublicKey.empty(), MINIMUM_LIQUIDITY);
  }

  @runtimeMethod()
  public addLiquidity(
    tokenA: TokenId,
    tokenB: TokenId,
    amountADesired: Balance,
    amountBDesired: Balance,
    amountAMin: Balance,
    amountBMin: Balance,
  ) {
    this.assertPoolExists(tokenA, tokenB);
    const pool = PoolKey.fromTokenPair(tokenA, tokenB);

    // Amount assertions
    assert(amountAMin.greaterThan(UInt64.zero));
    assert(amountBMin.greaterThan(UInt64.zero));
    assert(amountADesired.greaterThanOrEqual(amountAMin));
    assert(amountBDesired.greaterThanOrEqual(amountBMin));

    // Reserves cannot be zero due to pool creation and constant product invariant
    const reserveA = this.balances.getBalance(tokenA, pool);
    const reserveB = this.balances.getBalance(tokenB, pool);

    const amountAOptimal = reserveA;
  }

  @runtimeMethod()
  public removeLiquidity() {}

  public calculateTokenOutAmount(
    tokenIn: TokenId,
    tokenOut: TokenId,
    amountIn: Balance,
  ) {
    const pool = PoolKey.fromTokenPair(tokenIn, tokenOut);

    const reserveIn = this.balances.getBalance(tokenIn, pool);
    const reserveOut = this.balances.getBalance(tokenOut, pool);

    return this.calculateTokenOutAmountFromReserves(
      reserveIn,
      reserveOut,
      amountIn,
    );
  }

  public calculateTokenOutAmountFromReserves(
    reserveIn: Balance,
    reserveOut: Balance,
    amountIn: Balance,
  ) {
    const numerator = amountIn.mul(reserveOut);
    const denominator = reserveIn.add(amountIn);

    return numerator.div(denominator);
  }

  public calculateAmountIn(
    tokenIn: TokenId,
    tokenOut: TokenId,
    amountOut: Balance,
  ) {
    const pool = PoolKey.fromTokenPair(tokenIn, tokenOut);

    const reserveIn = this.balances.getBalance(tokenIn, pool);
    const reserveOut = this.balances.getBalance(tokenOut, pool);

    return this.calculateAmountInFromReserves(reserveIn, reserveOut, amountOut);
  }

  public calculateAmountInFromReserves(
    reserveIn: Balance,
    reserveOut: Balance,
    amountOut: Balance,
  ) {
    const paddedTokenOutReserve = reserveOut.add(amountOut);
    const reserveOutIsSufficient = reserveOut.greaterThanOrEqual(amountOut);

    const safeTokenOutReserve = Provable.if(
      reserveOutIsSufficient,
      Balance,
      reserveOut,
      paddedTokenOutReserve,
    );

    const numerator = reserveIn.mul(amountOut);

    const denominator = safeTokenOutReserve.sub(amountOut);

    const denominatorIsSafe = denominator.greaterThan(Balance.from(0));
    const safeDenominator = Provable.if(
      denominatorIsSafe,
      Balance,
      denominator,
      Balance.from(1),
    );

    assert(denominatorIsSafe);

    const tokenInAmount = numerator.div(safeDenominator);

    return tokenInAmount;
  }

  @runtimeMethod()
  public swapExactTokensForTokens(
    tokenIn: TokenId,
    tokenOut: TokenId,
    amountIn: Balance,
    minAmountOut: Balance,
  ) {
    this.assertPoolExists(tokenIn, tokenOut);
    const pool = PoolKey.fromTokenPair(tokenIn, tokenOut);

    const amountOut = this.calculateTokenOutAmount(tokenIn, tokenOut, amountIn);

    assert(
      amountOut.greaterThanOrEqual(minAmountOut),
      errors.amountOutTooLow(),
    );

    this.balances.transfer(tokenIn, this.transaction.sender, pool, amountIn);

    this.balances.transfer(tokenOut, pool, this.transaction.sender, amountOut);
  }

  @runtimeMethod()
  public swapTokensForExactTokens(
    tokenIn: TokenId,
    tokenOut: TokenId,
    maxAmountIn: Balance,
    amountOut: Balance,
  ) {
    this.assertPoolExists(tokenIn, tokenOut);
    const pool = PoolKey.fromTokenPair(tokenIn, tokenOut);

    const amountIn = this.calculateAmountIn(tokenIn, tokenOut, amountOut);

    assert(amountIn.lessThanOrEqual(maxAmountIn), errors.amountInTooHigh());

    this.balances.transfer(tokenOut, pool, this.transaction.sender, amountOut);

    this.balances.transfer(tokenIn, this.transaction.sender, pool, amountIn);
  }
}
