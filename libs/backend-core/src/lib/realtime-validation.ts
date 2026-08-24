import { plainToInstance } from 'class-transformer';
import { validateSync, type ValidationError } from 'class-validator';

// Validates a socket command's `data` payload against a class-validator DTO,
// mirroring the HTTP ValidationPipe (transform + whitelist) the REST controllers
// get for free (§5.2). The generic gateway keeps `data` untyped, so each command
// handler runs its own payload through here before touching a field — otherwise
// a socket turn would bypass the `@MaxLength`/shape checks the HTTP path enforces.
//
// Throws on the first constraint failure; the gateway wraps command dispatch in
// try/catch and returns the message as a `{ error }` ack, so no throw escapes.
export function validateRealtimeData<T extends object>(
  cls: new () => T,
  data: unknown,
): T {
  const instance = plainToInstance(cls, data, {
    enableImplicitConversion: false,
  });
  const errors = validateSync(instance, {
    whitelist: true,
    forbidUnknownValues: true,
  });
  if (errors.length > 0) {
    throw new Error(firstConstraintMessage(errors));
  }
  return instance;
}

// The first constraint message in the (possibly nested) error tree — the same
// class-validator strings the HTTP ValidationPipe surfaces (framework output,
// not authored prose). Falls back to the offending property path when a node
// carries no constraint message, so the result is always a concrete identifier.
function firstConstraintMessage(errors: ValidationError[]): string {
  for (const error of errors) {
    if (error.constraints) {
      const messages = Object.values(error.constraints);
      if (messages.length > 0) return messages[0];
    }
    if (error.children && error.children.length > 0) {
      return firstConstraintMessage(error.children);
    }
  }
  return errors[0]?.property ?? '';
}
