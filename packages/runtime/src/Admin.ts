import { RuntimeModule, runtimeMethod, state } from "@proto-kit/module";
import { State, assert } from "@proto-kit/protocol";
import { PublicKey } from "snarkyjs";

export class Admin extends RuntimeModule<unknown> {
  @state() public admin = State.from<PublicKey>(PublicKey);

  @runtimeMethod()
  public setAdmin(newAdmin: PublicKey) {
    this.isSenderAdmin();
    this.admin.set(newAdmin);
  }

  public isSenderAdmin() {
    const admin = this.admin.get();
    const senderIsAdmin = admin.isSome.and(
      this.transaction.sender.equals(admin.value)
    );

    assert(admin.isSome.not().or(senderIsAdmin), "Sender is not admin");
  }
}
