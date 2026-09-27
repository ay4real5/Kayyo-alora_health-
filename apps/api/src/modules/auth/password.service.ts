import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id with the library defaults (19 MiB memory, 2 iterations, 1 lane) — the OWASP-recommended
 * baseline. The PHC string stored in users.password_hash records the parameters, so they can be
 * raised later without breaking existing hashes. (DECISIONS D-020)
 */
@Injectable()
export class PasswordService {
  /** Verified against when the email is unknown, so response time doesn't reveal which emails exist. */
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hash(password);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false; // malformed hash → treat as a wrong password, never as an error
    }
  }

  async burnTime(password: string): Promise<void> {
    this.dummyHash ??= hash('dummy-password-for-timing-equalisation');
    await this.verify(await this.dummyHash, password);
  }
}
