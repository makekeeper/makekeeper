import { Prisma } from '@prisma/client';
import {
  DIRECT_SCOPED_MODELS,
  resolveModelScopeRule,
  SCOPE_MODEL_MAP,
} from './scope-model-map';

// Fail-closed guard for the multiuser access policy. The policy passes through
// any model whose rule is absent or `unscoped` (scope-policy.service.ts). The
// exhaustive `Record<Prisma.ModelName, …>` type already makes a NEW model a
// compile error until classified — these tests defend the remaining runtime
// gaps: a scoped model mis-declared `unscoped`, or a stale `parents` FK. A leak
// here is a CI failure instead of cross-user-visible data (CLAUDE.md §5.8).
describe('SCOPE_MODEL_MAP coverage', () => {
  const models = Prisma.dmmf.datamodel.models;

  const scopeIdModels = models
    .filter((model) => model.fields.some((field) => field.name === 'scopeId'))
    .map((model) => model.name);

  // Foreign keys THIS model holds into another model (a belongs-to: the scalar
  // FK lives here, not on the target). These are the edges that make a model's
  // rows per-scope data when the target is scoped.
  //
  // `Prisma.dmmf` strips `relationFromFields` at runtime, so we detect FK
  // ownership through this repo's hard convention (CLAUDE.md §5.8: flat FKs): a
  // to-one relation field `x` whose model also carries a scalar `xId` column.
  // The FK holder is the side with that scalar; the `x[]` back-reference on the
  // other side has no such column and is correctly skipped.
  const owningFks = (
    modelName: string,
  ): Array<{ target: string; fkField: string }> => {
    const model = models.find((m) => m.name === modelName);
    if (!model) return [];
    const scalars = new Set(
      model.fields.filter((f) => f.kind === 'scalar').map((f) => f.name),
    );
    return model.fields
      .filter((f) => f.kind === 'object' && !f.isList)
      .map((f) => ({ target: f.type, fkField: `${f.name}Id` }))
      .filter((fk) => scalars.has(fk.fkField));
  };

  const isScoped = (rule: ReturnType<typeof resolveModelScopeRule>): boolean =>
    rule !== undefined && rule.kind !== 'unscoped';

  it('finds the schema models that carry a scopeId column', () => {
    // Sanity: the DMMF lookup actually resolves (guards a silent empty set).
    expect(scopeIdModels.length).toBeGreaterThan(0);
  });

  it('classifies every Prisma model (exhaustive over the datamodel)', () => {
    // Belt-and-suspenders behind the `Record<Prisma.ModelName, …>` type check:
    // catches any model the type system somehow let slip (e.g. a generate/build
    // skew where the client's DMMF and its type declarations disagree).
    const unclassified = models
      .map((model) => model.name)
      .filter((name) => resolveModelScopeRule(name) === undefined);
    expect(unclassified).toEqual([]);
  });

  it('declares every scopeId-bearing model as a direct rule', () => {
    const missing = scopeIdModels.filter(
      (model) => resolveModelScopeRule(model)?.kind !== 'direct',
    );
    expect(missing).toEqual([]);
  });

  // The core leak-catcher: a relation-only child table (no scopeId, reached via
  // a parent — the Task / TaskComponent shape) that someone marked `unscoped`
  // would be globally readable. Any model holding a foreign key INTO a scoped
  // model is itself per-scope data and must be `direct` or `child`.
  it('never marks a model holding a FK into a scoped model as unscoped', () => {
    const leaking = models
      .map((model) => model.name)
      .filter((name) => {
        const rule = resolveModelScopeRule(name);
        if (isScoped(rule)) return false; // already confined
        return owningFks(name).some((fk) =>
          isScoped(resolveModelScopeRule(fk.target)),
        );
      });
    expect(leaking).toEqual([]);
  });

  it('lists a parent for every FK a child model holds into a scoped model', () => {
    // A child model reads through `scopeWhere`, but CREATES are only safe if
    // every scope-bearing parent FK is proven in-scope. A relation the rule
    // forgot to list would skip that ownership check.
    const gaps: string[] = [];
    for (const model of models) {
      const rule = resolveModelScopeRule(model.name);
      if (rule?.kind !== 'child') continue;
      const declared = new Set(rule.parents.map((p) => p.foreignKeyField));
      for (const fk of owningFks(model.name)) {
        if (!isScoped(resolveModelScopeRule(fk.target))) continue;
        if (!declared.has(fk.fkField)) gaps.push(`${model.name}.${fk.fkField}`);
      }
    }
    expect(gaps).toEqual([]);
  });

  it('backs every declared parent FK with a real scalar field and a scoped target', () => {
    const problems: string[] = [];
    for (const model of models) {
      const rule = resolveModelScopeRule(model.name);
      if (rule === undefined || rule.kind === 'unscoped') continue;
      const scalarFields = new Set(
        model.fields.filter((f) => f.kind === 'scalar').map((f) => f.name),
      );
      for (const parent of rule.parents ?? []) {
        if (!scalarFields.has(parent.foreignKeyField)) {
          problems.push(
            `${model.name}: no scalar field ${parent.foreignKeyField}`,
          );
        }
        if (!isScoped(resolveModelScopeRule(parent.model))) {
          problems.push(`${model.name}: parent ${parent.model} is not scoped`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('requires a written reason on every unscoped model', () => {
    const blank = Object.entries(SCOPE_MODEL_MAP)
      .filter(([, rule]) => rule.kind === 'unscoped' && !rule.reason.trim())
      .map(([name]) => name);
    expect(blank).toEqual([]);
  });

  // Project groups (#286) are a scoped tree, and `Project.groupId` is a flat FK
  // with no relation field — invisible to the generic `owningFks` sweep above,
  // so it gets its own assertion rather than being assumed covered.
  it("confines project groups and proves a project's group on create", () => {
    expect(SCOPE_MODEL_MAP.ProjectGroup).toEqual({
      kind: 'direct',
      parents: [{ model: 'ProjectGroup', foreignKeyField: 'parentId' }],
    });
    expect(SCOPE_MODEL_MAP.Project).toEqual({
      kind: 'direct',
      parents: [{ model: 'ProjectGroup', foreignKeyField: 'groupId' }],
    });
  });

  it('derives DIRECT_SCOPED_MODELS to exactly the scopeId-bearing models', () => {
    expect([...DIRECT_SCOPED_MODELS].sort()).toEqual([...scopeIdModels].sort());
  });
});
