import { DbAccessPolicyHolder, DbQueryContext } from './db-access-policy';

describe('DbAccessPolicyHolder', () => {
  it('has no policy until one is registered', () => {
    const holder = new DbAccessPolicyHolder();
    expect(holder.current).toBeNull();
  });

  it('exposes the registered policy and routes contexts through it', async () => {
    const holder = new DbAccessPolicyHolder();
    const seen: DbQueryContext[] = [];
    holder.register({
      run: async (ctx) => {
        seen.push(ctx);
        return ctx.query(ctx.args);
      },
    });

    const query = jest.fn().mockResolvedValue(['row']);
    const ctx: DbQueryContext = {
      model: 'Project',
      operation: 'findMany',
      args: { where: { id: 'p1' } },
      query,
    };
    const result = await holder.current?.run(ctx);

    expect(result).toEqual(['row']);
    expect(query).toHaveBeenCalledWith({ where: { id: 'p1' } });
    expect(seen[0]).toMatchObject({ model: 'Project', operation: 'findMany' });
  });
});
