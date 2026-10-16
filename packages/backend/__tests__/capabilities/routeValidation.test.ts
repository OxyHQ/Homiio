import { runRouteValidation } from '../../capabilities/handlers/routeValidation';
import * as validation from '../../middlewares/validation';

describe('runRouteValidation', () => {
  it('refuses input the route middleware refuses, with the route 400', async () => {
    await expect(
      runRouteValidation(validation.validateProperty, { body: {} }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('admits input the route middleware admits', async () => {
    await expect(
      runRouteValidation(validation.validateId('id'), {
        params: { id: '01a0646a-078f-7974-9645-a5e8be237f47' },
      }),
    ).resolves.toBeUndefined();
  });
});
