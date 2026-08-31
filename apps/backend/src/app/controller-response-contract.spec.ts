import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

// The convention guard for #291: an HTTP handler that returns nothing sends an
// EMPTY body, and the frontend's `apiJson` parses every answer as JSON. The
// empty string is not JSON, so a *successful* write surfaced in the browser as
// a parser error the user had no way to interpret ("Unexpected end of JSON
// input" in V8, "The string did not match the expected pattern" in WebKit).
// `PATCH /api/projects/groups/reorder` shipped exactly that.
//
// `apiJson` no longer chokes on an empty body, but a handler with nothing to
// say still owes the caller an answer — `{ ok: true }` — or the client silently
// gets `undefined` where its type says it has a value. Nothing in the compiler,
// the linter or the backend specs catches the omission: they assert the write,
// not the body. This does.
//
// It asks the TYPE CHECKER, not the source text, and that is the whole point.
// The handler that shipped the bug was `async reorderGroups(@Body() body: Dto)`
// — no return annotation at all — so a guard that read declarations would have
// missed the very case it exists for (69 of the repo's handlers are written
// that way). The same holds for a type named indirectly, like
// `ReturnType<Service['reorder']>`: only the checker knows what it resolves to.
// Building the program costs ~2s, once.
//
// It lives in the BACKEND rather than in each plugin because the rule is one
// rule for every controller in the repo, and only this project's test cache
// depends on all of them.

const ROOT = join(__dirname, '..', '..', '..', '..');
const SCAN_ROOTS = [join(ROOT, 'libs'), join(ROOT, 'apps')];

// Nest's routing decorators. `@All` included: it is a handler like any other.
const ROUTING_DECORATORS = new Set([
  'Get',
  'Post',
  'Put',
  'Patch',
  'Delete',
  'All',
]);

// Awaited return types that put no usable JSON on the wire. `any` is on the
// list as a self-check: it is what a handler resolves to when the program
// failed to see a type at all, and a guard that read `any` as "fine" would
// pass while checking nothing.
const EMPTY_TYPES = new Set(['void', 'undefined', 'any', 'never']);

const walkControllers = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkControllers(full));
    else if (entry.endsWith('.controller.ts')) out.push(full);
  }
  return out;
};

// The repo's own path aliases, so `@makekeeper/*` imports resolve and service
// return types come back as real types rather than `any`.
const compilerOptions = (): ts.CompilerOptions => {
  const { config } = ts.readConfigFile(
    join(ROOT, 'tsconfig.base.json'),
    ts.sys.readFile,
  );
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, ROOT);
  return {
    ...parsed.options,
    experimentalDecorators: true,
    noEmit: true,
    skipLibCheck: true,
  };
};

interface Handler {
  file: string;
  name: string;
  returnType: string;
}

const isRouted = (method: ts.MethodDeclaration): boolean =>
  (ts.getDecorators(method) ?? []).some(
    (decorator) =>
      ts.isCallExpression(decorator.expression) &&
      ts.isIdentifier(decorator.expression.expression) &&
      ROUTING_DECORATORS.has(decorator.expression.expression.text),
  );

const routedHandlers = (): Handler[] => {
  const files = SCAN_ROOTS.flatMap(walkControllers);
  const program = ts.createProgram(files, compilerOptions());
  const checker = program.getTypeChecker();
  const found: Handler[] = [];

  for (const file of files) {
    const source = program.getSourceFile(file);
    // A controller the program cannot see would be an unchecked one.
    if (!source) {
      found.push({
        file: relative(ROOT, file),
        name: '*',
        returnType: 'unread',
      });
      continue;
    }
    const visit = (node: ts.Node): void => {
      if (ts.isMethodDeclaration(node) && isRouted(node)) {
        const signature = checker.getSignatureFromDeclaration(node);
        const returned = signature
          ? checker.getReturnTypeOfSignature(signature)
          : undefined;
        // What the caller actually receives: a handler may or may not be
        // async, and `Promise<void>` is as empty as `void`.
        const settled = returned ? checker.getAwaitedType(returned) : undefined;
        found.push({
          file: relative(ROOT, file),
          name: node.name.getText(source),
          returnType: settled ? checker.typeToString(settled) : 'unresolved',
        });
      }
      node.forEachChild(visit);
    };
    source.forEachChild(visit);
  }
  return found;
};

// One program build shared by both expectations.
const handlers = routedHandlers();

describe('HTTP handlers always answer with a body (#291)', () => {
  it('resolves a return type for every routed method', () => {
    // A scan that quietly stopped seeing handlers would make the rule below
    // pass forever. The floor sits just under the real count (254), and every
    // handler found must have yielded a type the checker could resolve.
    expect(handlers.length).toBeGreaterThan(240);
    expect(
      handlers.filter(({ returnType }) =>
        ['unread', 'unresolved'].includes(returnType),
      ),
    ).toEqual([]);
  });

  it('has no handler whose response body is empty', () => {
    const empty = handlers
      .filter(({ returnType }) => EMPTY_TYPES.has(returnType))
      .map(
        ({ file, name, returnType }) => `${file} → ${name}(): ${returnType}`,
      );
    // A handler with nothing to say returns `{ ok: true }` (see
    // categories.controller.ts, tags.controller.ts) — never nothing. A handler
    // that streams answers with a `StreamableFile` (see exchange.controller.ts),
    // not by writing to `@Res()` and returning void.
    expect(empty).toEqual([]);
  });
});
